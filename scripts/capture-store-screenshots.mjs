#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const outputDir = join(root, 'store-assets');
const defaultChromeBin = join(root, 'tools/chrome-for-testing/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const chromeBin = process.env.CHROME_BIN || defaultChromeBin;

if (!existsSync(chromeBin)) throw new Error(`Chrome for Testing binary not found: ${chromeBin}`);

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.opened = new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', resolveOpen, { once: true });
      this.ws.addEventListener('error', rejectOpen, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve: resolveCommand, reject, timer } = this.pending.get(message.id);
      clearTimeout(timer);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolveCommand(message.result);
    });
  }

  async send(method, params = {}, timeoutMs = 12000) {
    await this.opened;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolveCommand, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolveCommand, reject, timer });
    });
  }

  async evaluate(expression, timeoutMs = 12000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, timeoutMs);
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result?.value;
  }

  async waitFor(expression, timeoutMs = 12000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      try {
        if (await this.evaluate(`Boolean(${expression})`, 3000)) return;
      } catch {}
      await sleep(100);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

function sleep(ms) {
  return new Promise(resolveSleep => setTimeout(resolveSleep, ms));
}

async function freePort() {
  const server = createServer();
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  await new Promise(resolveClose => server.close(resolveClose));
  return port;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function waitForJson(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try { return await fetchJson(url); } catch { await sleep(120); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function newTarget(port, url) {
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

async function findExtensionBase(port) {
  await newTarget(port, 'chrome://newtab/');
  const startedAt = Date.now();
  while (Date.now() - startedAt < 12000) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const worker = targets.find(item => item.type === 'service_worker' && /^chrome-extension:\/\/[^/]+\/background\.js/.test(item.url || ''));
    if (worker) return worker.url.replace(/\/background\.js.*$/, '');
    const page = targets.find(item => item.type === 'page' && /^chrome-extension:\/\/[^/]+\/index\.html/.test(item.url || ''));
    if (page) return page.url.replace(/\/index\.html.*$/, '');
    await sleep(150);
  }
  throw new Error('Could not discover BrowseLoom extension URL from Chrome targets');
}

async function runSeeder(port) {
  const child = spawn(process.execPath, [join(root, 'scripts/seed-chrome-test-data.mjs'), '--port', String(port), '--delay-ms', '30'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolveExit => child.once('exit', resolveExit));
  if (code !== 0) throw new Error(output.trim() || `Seeder exited with ${code}`);
  process.stdout.write(output);
}

async function capture(page, filename) {
  await sleep(1200);
  const result = await page.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality: 92,
    fromSurface: true,
    captureBeyondViewport: false,
  }, 20000);
  const path = join(outputDir, filename);
  await writeFile(path, Buffer.from(result.data, 'base64'));
  console.log(`Captured ${path}`);
}

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode != null) return;
  const exited = new Promise(resolveExit => chrome.once('exit', resolveExit));
  chrome.kill('SIGTERM');
  await Promise.race([exited, sleep(2000)]);
  if (chrome.exitCode == null) chrome.kill('SIGKILL');
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'browseloom-store-capture-'));
  const chrome = spawn(chromeBin, [
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${port}`,
    '--remote-allow-origins=*',
    `--load-extension=${extensionDir}`,
    `--disable-extensions-except=${extensionDir}`,
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-sync',
    '--metrics-recording-only',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1280,800',
    '--headless=new',
    'chrome://newtab/',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let page;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const extensionBase = await findExtensionBase(port);
    await runSeeder(port);

    const target = await newTarget(port, `${extensionBase}/index.html`);
    page = new CdpPage(target.webSocketDebuggerUrl);
    await page.send('Runtime.enable');
    await page.send('Page.enable');
    await page.send('Page.navigate', { url: `${extensionBase}/index.html` });
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.waitFor('document.readyState === "complete"');
    await page.evaluate(`(async () => {
      localStorage.setItem('tab-out-language', 'en');
      localStorage.setItem('tab-out-theme', 'cupertino');
      localStorage.setItem('tab-out-background', 'prism');
      const currentTab = await chrome.tabs.getCurrent();
      const dashboardUrl = chrome.runtime.getURL('index.html');
      const dashboardTabs = await chrome.tabs.query({});
      const duplicateDashboardIds = dashboardTabs
        .filter(tab => tab.id !== currentTab?.id && (
          tab.url?.startsWith(dashboardUrl) || tab.url === 'chrome://newtab/'
        ))
        .map(tab => tab.id)
        .filter(Number.isFinite);
      if (duplicateDashboardIds.length) await chrome.tabs.remove(duplicateDashboardIds);
      await chrome.storage.local.set({
        viewMode: 'domain',
        privacyMode: false,
        privacySettings: {
          clock: true,
          date: true,
          motto: true,
          mottoText: 'Your browsing stays on this device.',
          externalFavicons: true,
        },
      });
    })()`);
    await page.send('Page.reload', { ignoreCache: true });
    await page.waitFor('document.readyState === "complete"');
    await page.waitFor('window.SuperTabOutBookmarks && document.body.dataset.workspace === "tabs"');
    await page.waitFor('document.querySelectorAll("#openTabsMissions .domain-card, #openTabsMissions .group-card").length > 2');
    await page.waitFor('document.querySelector("#backgroundStage canvas")');
    await capture(page, 'browseloom-1-tabs.jpg');

    await page.evaluate(`document.querySelector('[data-workspace-switch="bookmarks"]').click()`);
    await page.waitFor('document.body.dataset.workspace === "bookmarks"');
    await page.waitFor('document.querySelectorAll("#bookmarkGrid .bookmark-tile, #bookmarkGrid .bookmark-folder-board").length > 2');
    await capture(page, 'browseloom-2-bookmarks.jpg');

    await page.evaluate(`document.querySelector('[data-workspace-switch="tabs"]').click()`);
    await page.waitFor('document.body.dataset.workspace === "tabs"');
    await page.evaluate(`document.querySelector('[data-action="switch-view"][data-view="group"]')?.click()`);
    await page.waitFor('document.querySelectorAll("#openTabsMissions .group-card").length > 1');
    await capture(page, 'browseloom-3-groups.jpg');

    await page.evaluate(`document.querySelector('#privacyToggle').click()`);
    await page.waitFor('document.body.classList.contains("privacy-mode")');
    await page.waitFor('document.querySelector("#privacyTime")?.textContent.trim().length > 0');
    await capture(page, 'browseloom-4-privacy.jpg');

    await page.evaluate(`(async () => {
      document.querySelector('#privacyToggle').click();
      await new Promise(resolve => setTimeout(resolve, 250));
      document.querySelector('#privacySettingsBtn').click();
    })()`);
    await page.waitFor('getComputedStyle(document.querySelector("#privacySettings")).display !== "none"');
    await page.waitFor('document.querySelector("#settingsPaneAppearance").classList.contains("active")');
    await capture(page, 'browseloom-5-settings.jpg');
  } finally {
    page?.close();
    await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(`[BrowseLoom Screenshot Capture] ${error.stack || error}`);
  process.exit(1);
});
