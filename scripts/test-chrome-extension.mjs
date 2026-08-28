#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const defaultChromeBin = join(root, 'tools/chrome-for-testing/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
const chromeBin = process.env.CHROME_BIN || defaultChromeBin;
const headless = process.env.HEADLESS !== '0';

if (!existsSync(chromeBin)) {
  throw new Error(`Chrome for Testing binary not found: ${chromeBin}`);
}

class CdpPage {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.opened = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', reject, { once: true });
    });
    this.ws.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve: ok, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else ok(message.result);
        return;
      }
      if (message.method && this.events.has(message.method)) {
        for (const handler of this.events.get(message.method)) handler(message.params || {});
      }
    });
  }

  on(method, handler) {
    if (!this.events.has(method)) this.events.set(method, []);
    this.events.get(method).push(handler);
  }

  async send(method, params = {}, timeoutMs = 8000) {
    await this.opened;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
    });
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed');
    }
    return result.result?.value;
  }

  async navigate(url) {
    await this.send('Page.navigate', { url });
    await this.waitFor('document.readyState === "complete"');
  }

  async waitFor(expression, timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        if (await this.evaluate(`Boolean(${expression})`)) return;
      } catch {}
      await sleep(80);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function freePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function waitForJson(url, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { return await fetchJson(url); } catch { await sleep(100); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function newTarget(port, url) {
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
}

async function findExtensionBase(port) {
  await newTarget(port, 'chrome://newtab/');
  const start = Date.now();
  while (Date.now() - start < 10000) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const worker = targets.find(item => item.type === 'service_worker' && /^chrome-extension:\/\/[^/]+\/background\.js/.test(item.url || ''));
    if (worker) return worker.url.replace(/\/background\.js.*$/, '');
    const target = targets.find(item => item.type === 'page' && /^chrome-extension:\/\/[^/]+\/index\.html/.test(item.url || ''));
    if (target) return target.url.replace(/\/index\.html.*$/, '');
    await sleep(150);
  }
  throw new Error('Could not discover BrowseLoom extension URL from Chrome targets');
}

async function stopChrome(chrome) {
  if (!chrome || chrome.exitCode != null) return;
  const exited = new Promise(resolve => chrome.once('exit', resolve));
  chrome.kill('SIGTERM');
  await Promise.race([exited, sleep(2000)]);
  if (chrome.exitCode == null) {
    chrome.kill('SIGKILL');
    await Promise.race([exited, sleep(1000)]);
  }
}

async function openExtensionPage(port, url) {
  const target = await newTarget(port, url);
  const page = new CdpPage(target.webSocketDebuggerUrl);
  const errors = [];
  page.on('Runtime.exceptionThrown', params => {
    const details = params.exceptionDetails;
    errors.push(details?.exception?.description || details?.text || 'Runtime exception');
  });
  page.on('Log.entryAdded', params => {
    if (params.entry?.level === 'error') {
      const details = [params.entry.text, params.entry.url].filter(Boolean).join(' ');
      errors.push(details);
    }
  });
  await page.send('Runtime.enable');
  await page.send('Log.enable');
  await page.send('Page.enable');
  await page.waitFor('document.readyState === "complete"');
  page.errors = errors;
  return page;
}

async function main() {
  const port = await freePort();
  const profile = await mkdtemp(join(tmpdir(), 'browse-loom-chrome-extension-'));
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
    '--window-size=1365,900',
    ...(headless ? ['--headless=new'] : []),
    'chrome://newtab/',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  let page;
  try {
    await waitForJson(`http://127.0.0.1:${port}/json/version`);
    const extensionBase = await findExtensionBase(port);

    page = await openExtensionPage(port, `${extensionBase}/index.html`);
    await page.waitFor('document.querySelector("#themeCurrentBtn")');
    await page.waitFor('document.querySelector("#backgroundStage canvas")');
    await page.waitFor('window.SuperTabOutBookmarks && document.body.dataset.workspace === "tabs"');
    if (process.env.SETTINGS_IA_ONLY === '1') {
      await page.evaluate(`document.querySelector('#privacySettingsBtn').click()`);
      await page.waitFor('document.querySelector("#privacySettings")?.open');
      assert.deepEqual(await page.evaluate(`(() => {
        const dialog = document.querySelector('#privacySettings');
        const sidebar = dialog.querySelector('.settings-sidebar').getBoundingClientRect();
        const content = dialog.querySelector('.settings-content').getBoundingClientRect();
        return {
          triggerCount: document.querySelectorAll('.global-settings-trigger').length,
          tabLabels: Array.from(dialog.querySelectorAll('.settings-tab')).map(tab => tab.textContent.trim()),
          leftMenuBeforeContent: sidebar.right <= content.left,
          activeView: dialog.querySelector('.settings-tab.active')?.dataset.settingsView || '',
          hasCloseControl: !!dialog.querySelector('[data-close-dialog], .settings-close, [aria-label="Close"]'),
        };
      })()`), {
        triggerCount: 2,
        tabLabels: ['Appearance', 'Privacy screen', 'Data & privacy', 'About'],
        leftMenuBeforeContent: true,
        activeView: 'appearance',
        hasCloseControl: false,
      });
      if (process.env.SETTINGS_IA_SCREENSHOT) {
        const screenshot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
        await writeFile(resolve(process.env.SETTINGS_IA_SCREENSHOT), Buffer.from(screenshot.data, 'base64'));
      }
      await page.evaluate(`document.querySelector('#settingsTabData').click()`);
      await page.waitFor('document.querySelector("#settingsPaneData")?.classList.contains("active")');
      assert.equal(await page.evaluate(`document.querySelector('#settingsPaneData #bookmarkImportButton') !== null`), true);
      assert.equal(await page.evaluate(`(() => { const dialog = document.querySelector('#privacySettings'); dialog.click(); return dialog.open; })()`), false);

      await page.evaluate(`document.querySelector('[data-workspace-switch="bookmarks"]').click()`);
      await page.waitFor('document.body.dataset.workspace === "bookmarks"');
      await sleep(450);
      await page.evaluate(`document.querySelector('.bookmark-import-trigger').click()`);
      await page.waitFor('document.querySelector("#privacySettings")?.open && document.querySelector("#settingsPaneData")?.classList.contains("active")');
      assert.equal(await page.evaluate(`document.querySelector('#bookmarkGlobalSettingsBtn')?.getAttribute('aria-expanded')`), 'true');
      await page.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
      await page.waitFor('!document.querySelector("#privacySettings")?.open');

      await page.send('Emulation.setDeviceMetricsOverride', {
        width: 390,
        height: 844,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await page.evaluate(`document.querySelector('#bookmarkGlobalSettingsBtn').click()`);
      const mobileDialog = await page.evaluate(`(() => {
        const dialog = document.querySelector('#privacySettings');
        const rect = dialog.getBoundingClientRect();
        return {
          open: dialog.open,
          rememberedView: dialog.querySelector('.settings-tab.active')?.dataset.settingsView || '',
          insideViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          pageHasHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        };
      })()`);
      assert.deepEqual(mobileDialog, {
        open: true,
        rememberedView: 'data',
        insideViewport: true,
        pageHasHorizontalOverflow: false,
      });
      assert.deepEqual(page.errors.filter(error => !error.includes('/config.local.js')), []);
      console.log('Settings information architecture regression passed.');
      return;
    }
    await page.evaluate(`document.body.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 80,
      deltaY: 0
    }))`);
    await page.waitFor('document.body.dataset.workspace === "bookmarks"');
    await sleep(450);
    await page.evaluate(`document.body.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: -80,
      deltaY: 0
    }))`);
    await page.waitFor('document.body.dataset.workspace === "tabs"');
    await sleep(450);
    await page.evaluate(`document.querySelector('#openTabsSearch')?.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaX: 80,
      deltaY: 0
    }))`);
    await sleep(250);
    assert.equal(await page.evaluate(`document.body.dataset.workspace`), 'tabs');
    const glassRuntime = await page.evaluate(`(() => {
      const canvas = document.querySelector('#backgroundStage canvas');
      const glassPanel = document.querySelector('header');
      return {
        canvasCount: document.querySelectorAll('#backgroundStage canvas').length,
        canvasWidth: canvas?.width || 0,
        canvasHeight: canvas?.height || 0,
        panelBackdrop: glassPanel ? getComputedStyle(glassPanel).backdropFilter : '',
      };
    })()`);
    assert.equal(glassRuntime.canvasCount, 1);
    assert.equal(glassRuntime.canvasWidth > 0, true);
    assert.equal(glassRuntime.canvasHeight > 0, true);
    assert.equal(glassRuntime.panelBackdrop, 'none');
    assert.deepEqual(
      await page.evaluate(`(() => ({
        active: document.documentElement.dataset.background,
        selected: document.querySelector('.background-option[aria-checked="true"]')?.dataset.backgroundId || '',
        stored: localStorage.getItem('tab-out-background'),
      }))()`),
      { active: 'liquid-ether', selected: 'liquid-ether', stored: null },
    );
    await page.evaluate(`document.querySelector('[data-background-id="light-rays"]')?.click()`);
    await page.waitFor('document.documentElement.dataset.background === "light-rays" && document.querySelector("#backgroundStage canvas")');
    assert.deepEqual(
      await page.evaluate(`(() => ({
        canvasCount: document.querySelectorAll('#backgroundStage canvas').length,
        selected: document.querySelector('.background-option[aria-checked="true"]')?.dataset.backgroundId || '',
        stored: localStorage.getItem('tab-out-background'),
      }))()`),
      { canvasCount: 1, selected: 'light-rays', stored: 'light-rays' },
    );
    await page.evaluate(`document.querySelector('[data-background-id="prism"]')?.click()`);
    await page.waitFor('document.documentElement.dataset.background === "prism" && document.querySelector("#backgroundStage canvas")');
    assert.deepEqual(
      await page.evaluate(`(() => ({
        canvasCount: document.querySelectorAll('#backgroundStage canvas').length,
        selected: document.querySelector('.background-option[aria-checked="true"]')?.dataset.backgroundId || '',
        stored: localStorage.getItem('tab-out-background'),
      }))()`),
      { canvasCount: 1, selected: 'prism', stored: 'prism' },
    );
    await page.evaluate(`document.querySelector('[data-background-id="static"]')?.click()`);
    await page.waitFor('document.documentElement.dataset.background === "static"');
    assert.equal(await page.evaluate(`document.querySelectorAll('#backgroundStage canvas').length`), 0);
    await page.evaluate(`document.querySelector('[data-background-id="liquid-ether"]')?.click()`);
    await page.waitFor('document.documentElement.dataset.background === "liquid-ether" && document.querySelector("#backgroundStage canvas")');
    const cardParityFixtureIds = await page.evaluate(`(async () => {
      const tabs = await Promise.all([
        chrome.tabs.create({ url: 'https://example.com/style-parity-one', active: false }),
        chrome.tabs.create({ url: 'https://example.com/style-parity-two', active: false }),
        chrome.tabs.create({ url: 'https://example.com/style-parity-one', active: false }),
        chrome.tabs.create({ url: 'https://example.org/group-fixture', active: false }),
        chrome.tabs.create({ url: 'https://example.org/group-fixture', active: false })
      ]);
      await chrome.tabs.group({ tabIds: [tabs[3].id, tabs[4].id] });
      return tabs.map(tab => tab.id);
    })()`);
    await sleep(500);
    await page.evaluate(`renderDashboard()`);
    await page.evaluate(`document.querySelector('[data-action="switch-view"][data-view="domain"]')?.click()`);
    await page.waitFor(`document.querySelectorAll('.mission-card.domain-card .page-chip[data-action="focus-tab"][data-tab-url^="https://example.com/style-parity-"]').length === 3`);
    const toolbarLayout = await page.evaluate(`(() => {
      const toolbar = document.querySelector('.dashboard-toolbar');
      const summary = document.querySelector('#openTabsSummary');
      const search = document.querySelector('.dashboard-toolbar .open-tabs-search-wrap');
      const view = document.querySelector('#openTabsViewToggle');
      const sort = document.querySelector('#domainSortButton');
      const privacy = document.querySelector('#privacyToggle');
      const more = document.querySelector('#toolbarMoreBtn');
      const rect = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
      };
      return {
        hasGreeting: !!toolbar.querySelector('h1, #greeting, #dateDisplay'),
        summaryText: summary.textContent,
        summary: rect(summary),
        search: rect(search),
        view: rect(view),
        sort: rect(sort),
        privacy: rect(privacy),
        more: rect(more),
      };
    })()`);
    assert.equal(toolbarLayout.hasGreeting, false);
    assert.match(toolbarLayout.summaryText, /domain.*tab/i);
    assert.ok(toolbarLayout.summary.right <= toolbarLayout.search.left, `Summary is not before search: ${JSON.stringify(toolbarLayout)}`);
    assert.ok(toolbarLayout.search.right <= toolbarLayout.view.left, `Search is not before view toggle: ${JSON.stringify(toolbarLayout)}`);
    assert.ok(toolbarLayout.view.right <= toolbarLayout.sort.left, `View toggle is not before domain sorting: ${JSON.stringify(toolbarLayout)}`);
    assert.ok(toolbarLayout.sort.right <= toolbarLayout.privacy.left, `Domain sorting is not before privacy: ${JSON.stringify(toolbarLayout)}`);
    assert.ok(toolbarLayout.privacy.right <= toolbarLayout.more.left, `Privacy is not before more: ${JSON.stringify(toolbarLayout)}`);
    const toolbarControlParity = await page.evaluate(`(() => {
      const searchWrap = document.querySelector('.dashboard-toolbar .open-tabs-search-wrap');
      const searchInput = document.querySelector('#openTabsSearch');
      const viewToggle = document.querySelector('#openTabsViewToggle .view-toggle');
      const sortButton = document.querySelector('#domainSortButton');
      const privacy = document.querySelector('#privacyToggle');
      const more = document.querySelector('#toolbarMoreBtn');
      const defaultWrapStyle = getComputedStyle(searchWrap);
      const defaultViewStyle = getComputedStyle(viewToggle);
      const defaultSortStyle = getComputedStyle(sortButton);
      const defaultSurface = {
        searchBorderColor: defaultWrapStyle.borderColor,
        viewBorderColor: defaultViewStyle.borderColor,
        sortBorderColor: defaultSortStyle.borderColor,
        searchBackground: defaultWrapStyle.backgroundColor,
        viewBackground: defaultViewStyle.backgroundColor,
        sortBackground: defaultSortStyle.backgroundColor,
        searchRadius: defaultWrapStyle.borderRadius,
        viewRadius: defaultViewStyle.borderRadius,
        sortRadius: defaultSortStyle.borderRadius,
      };
      searchInput.focus();
      const inputStyle = getComputedStyle(searchInput);
      const wrapStyle = getComputedStyle(searchWrap);
      const privacyStyle = getComputedStyle(privacy);
      const moreStyle = getComputedStyle(more);
      const height = element => element.getBoundingClientRect().height;
      return {
        searchHeight: height(searchWrap),
        viewHeight: height(viewToggle),
        sortHeight: height(sortButton),
        privacyHeight: height(privacy),
        moreHeight: height(more),
        inputOutlineStyle: inputStyle.outlineStyle,
        inputOutlineWidth: inputStyle.outlineWidth,
        inputBorderWidth: inputStyle.borderWidth,
        wrapperFocusShadow: wrapStyle.boxShadow,
        ...defaultSurface,
        privacyBackground: privacyStyle.backgroundColor,
        moreBackground: moreStyle.backgroundColor,
        privacyBorderColor: privacyStyle.borderColor,
        moreBorderColor: moreStyle.borderColor,
      };
    })()`);
    assert.equal(toolbarControlParity.searchHeight, 40, `Toolbar controls are not on the 40px size system: ${JSON.stringify(toolbarControlParity)}`);
    assert.ok(Math.abs(toolbarControlParity.searchHeight - toolbarControlParity.viewHeight) <= 1, `Search and view toggle heights differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.ok(Math.abs(toolbarControlParity.searchHeight - toolbarControlParity.sortHeight) <= 1, `Search and domain sorting heights differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.ok(Math.abs(toolbarControlParity.searchHeight - toolbarControlParity.privacyHeight) <= 1, `Search and privacy heights differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.ok(Math.abs(toolbarControlParity.searchHeight - toolbarControlParity.moreHeight) <= 1, `Search and more heights differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.inputOutlineStyle, 'none', `Search input still has a native focus outline: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.inputOutlineWidth, '0px', `Search input outline width is not reset: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.inputBorderWidth, '0px', `Search input still has a native border: ${JSON.stringify(toolbarControlParity)}`);
    assert.notEqual(toolbarControlParity.wrapperFocusShadow, 'none', `Search wrapper has no focus-visible feedback: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchBorderColor, toolbarControlParity.viewBorderColor, `Search and view toggle borders differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchBorderColor, toolbarControlParity.sortBorderColor, `Search and domain sorting borders differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchBackground, toolbarControlParity.viewBackground, `Search and view toggle surfaces differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchBackground, toolbarControlParity.sortBackground, `Search and domain sorting surfaces differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchRadius, toolbarControlParity.viewRadius, `Search and view toggle radii differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.searchRadius, toolbarControlParity.sortRadius, `Search and domain sorting radii differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.privacyBackground, toolbarControlParity.moreBackground, `Privacy and more surfaces differ: ${JSON.stringify(toolbarControlParity)}`);
    assert.equal(toolbarControlParity.privacyBorderColor, toolbarControlParity.moreBorderColor, `Privacy and more borders differ: ${JSON.stringify(toolbarControlParity)}`);
    await page.evaluate(`document.querySelector('#openTabsSearch')?.blur()`);
    assert.deepEqual(
      await page.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('.mission-card.domain-card .page-chip[data-tab-url^="https://example.com/style-parity-"]'));
        const card = rows[0]?.closest('.mission-card');
        return {
          rowCount: rows.length,
          uniqueTabIds: new Set(rows.map(row => row.dataset.tabId)).size,
          footerCount: card?.querySelectorAll(':scope > .mission-content > .actions').length || 0,
          pinInMenu: !!card?.querySelector('.group-action-menu [data-action="pin-domain-card"]'),
          manualMoveInMenu: !!card?.querySelector('.group-action-menu [data-action^="move-domain-card-"]'),
          createInMenu: !!card?.querySelector('.group-action-menu [data-action="create-native-group"]'),
          closeInMenu: !!card?.querySelector('.group-action-menu [data-action="close-domain-tabs"]'),
        };
      })()`),
      { rowCount: 3, uniqueTabIds: 3, footerCount: 0, pinInMenu: true, manualMoveInMenu: false, createInMenu: true, closeInMenu: true }
    );
    const fixedOrderBeforeClose = await page.evaluate(`Array.from(document.querySelectorAll('.mission-card.domain-card')).map(card => card.dataset.domainKey)`);
    await page.evaluate(`(() => {
      const duplicateRows = Array.from(document.querySelectorAll('.mission-card.domain-card .page-chip[data-tab-url="https://example.com/style-parity-one"]'));
      duplicateRows[0]?.querySelector('[data-action="close-single-tab"]')?.click();
    })()`);
    await page.waitFor(`new Promise(resolve => chrome.tabs.query({ url: 'https://example.com/style-parity-one' }, tabs => resolve(tabs.length === 1)))`);
    assert.equal(
      await page.evaluate(`new Promise(resolve => chrome.tabs.query({ url: 'https://example.com/style-parity-one' }, tabs => resolve(tabs.length)))`),
      1
    );
    await page.waitFor(`document.querySelector('#domainSortButton')?.dataset.sortMode === 'stable'`);
    const fixedOrderAfterClose = await page.evaluate(`Array.from(document.querySelectorAll('.mission-card.domain-card')).map(card => card.dataset.domainKey)`);
    assert.deepEqual(
      fixedOrderAfterClose,
      fixedOrderBeforeClose.filter(domain => fixedOrderAfterClose.includes(domain)),
      'Closing a tab changed the fixed domain-card order'
    );
    const storedFixedPreferences = await page.evaluate(`new Promise(resolve => chrome.storage.local.get('domainCardPreferences', value => resolve(value.domainCardPreferences)))`);
    assert.equal(storedFixedPreferences.sortMode, 'stable');
    assert.ok(storedFixedPreferences.order.includes('example.com'));

    await page.evaluate(`document.querySelector('[data-action="set-domain-sort"][data-sort-mode="count"]')?.click()`);
    await page.waitFor(`document.querySelector('#domainSortButton')?.dataset.sortMode === 'count'`);
    const countSortedCardSizes = await page.evaluate(`Array.from(document.querySelectorAll('.mission-card.domain-card')).map(card => card.querySelectorAll('.page-chip[data-action="focus-tab"]').length)`);
    assert.deepEqual(countSortedCardSizes, [...countSortedCardSizes].sort((a, b) => b - a));
    await page.evaluate(`document.querySelector('[data-action="set-domain-sort"][data-sort-mode="stable"]')?.click()`);
    await page.waitFor(`document.querySelector('#domainSortButton')?.dataset.sortMode === 'stable'`);
    await page.evaluate(`(() => {
      const row = document.querySelector('.mission-card.domain-card [data-tab-url^="https://example.com/style-parity-"]');
      row?.closest('.domain-card')?.querySelector('[data-action="pin-domain-card"]')?.click();
    })()`);
    await page.waitFor(`document.querySelector('.mission-card.domain-card-pinned [data-tab-url^="https://example.com/style-parity-"]')`);
    const pinnedHeaderLayout = await page.evaluate(`(() => {
      const row = document.querySelector('.mission-card.domain-card-pinned [data-tab-url^="https://example.com/style-parity-"]');
      const card = row.closest('.domain-card');
      const header = card.querySelector('.domain-card-top').getBoundingClientRect();
      const menuButton = card.querySelector('[data-action="toggle-group-actions-menu"]').getBoundingClientRect();
      return {
        hasPin: !!card.querySelector('.domain-pin-indicator'),
        headerTop: header.top,
        headerBottom: header.bottom,
        buttonTop: menuButton.top,
        buttonBottom: menuButton.bottom,
      };
    })()`);
    assert.equal(pinnedHeaderLayout.hasPin, true);
    assert.ok(
      pinnedHeaderLayout.buttonTop >= pinnedHeaderLayout.headerTop - 1 && pinnedHeaderLayout.buttonBottom <= pinnedHeaderLayout.headerBottom + 1,
      `Pinned card overflow menu wrapped to another row: ${JSON.stringify(pinnedHeaderLayout)}`
    );
    await page.evaluate(`document.querySelector('.mission-card.domain-card-pinned [data-action="unpin-domain-card"]')?.click()`);
    await page.waitFor(`!document.querySelector('.mission-card.domain-card-pinned [data-tab-url^="https://example.com/style-parity-"]')`);

    const draggedDomainOrder = await page.evaluate(`(async () => {
      const cards = Array.from(document.querySelectorAll('.domain-card-sortable:not(.domain-card-pinned)'));
      const first = cards[0];
      const second = cards[1];
      const before = cards.map(card => card.dataset.domainKey);
      const start = first.querySelector('.mission-title-block').getBoundingClientRect();
      const end = second.getBoundingClientRect();
      const pointer = (type, x, y) => new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 37,
        pointerType: 'mouse',
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y
      });
      first.querySelector('.mission-title-block').dispatchEvent(pointer('pointerdown', start.left + 8, start.top + 8));
      document.dispatchEvent(pointer('pointermove', end.left + end.width / 2, end.bottom - 6));
      document.dispatchEvent(pointer('pointerup', end.left + end.width / 2, end.bottom - 6));
      await new Promise(resolve => setTimeout(resolve, 650));
      const after = Array.from(document.querySelectorAll('.domain-card-sortable:not(.domain-card-pinned)')).map(card => card.dataset.domainKey);
      const stored = await new Promise(resolve => chrome.storage.local.get('domainCardPreferences', value => resolve(value.domainCardPreferences.order)));
      return { before, after, stored };
    })()`);
    assert.deepEqual(draggedDomainOrder.after.slice(0, 2), [draggedDomainOrder.before[1], draggedDomainOrder.before[0]]);
    assert.ok(draggedDomainOrder.stored.indexOf(draggedDomainOrder.before[1]) < draggedDomainOrder.stored.indexOf(draggedDomainOrder.before[0]));
    const domainCardSurface = await page.evaluate(`(() => {
      const element = document.querySelector('.mission-card.domain-card [data-tab-url^="https://example.com/style-parity-"]').closest('.mission-card');
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
        edgeStripeContent: getComputedStyle(element, '::before').content,
      };
    })()`);
    assert.equal(domainCardSurface.edgeStripeContent, 'none', `Domain card still renders an edge stripe: ${JSON.stringify(domainCardSurface)}`);
    const domainMenuColumnLayout = await page.evaluate(`(() => {
      const missions = document.querySelector('#openTabsMissions');
      const makeTabs = (domain, count) => Array.from({ length: count }, (_, index) => ({
        id: 9000 + index,
        windowId: 1,
        active: index === 0,
        url: 'https://' + domain + '/fixture-' + index,
        title: domain + ' fixture tab ' + index + ' with a deliberately long title'
      }));
      externalFaviconsEnabled = false;
      missions.style.width = '960px';
      missions.innerHTML = [
        renderDomainCard({ domain: 'short.test', tabs: makeTabs('short.test', 1) }),
        renderDomainCard({ domain: 'tall.test', tabs: makeTabs('tall.test', 3) }),
        renderDomainCard({ domain: 'medium.test', tabs: makeTabs('medium.test', 2) }),
        renderDomainCard({ domain: 'menu.test', tabs: makeTabs('menu.test', 4) }),
        renderDomainCard({ domain: 'after-one.test', tabs: makeTabs('after-one.test', 2) }),
        renderDomainCard({ domain: 'after-two.test', tabs: makeTabs('after-two.test', 4) }),
        renderDomainCard({ domain: 'after-three.test', tabs: makeTabs('after-three.test', 3) }),
        renderDomainCard({ domain: 'after-four.test', tabs: makeTabs('after-four.test', 5) }),
        renderDomainCard({ domain: 'after-five.test', tabs: makeTabs('after-five.test', 2) })
      ].join('');
      const card = missions.querySelector('[data-domain-id="domain-menu-test"]');
      const header = card.querySelector('.mission-top');
      const pages = card.querySelector('.mission-pages');
      const button = card.querySelector('[data-action="toggle-group-actions-menu"]');
      const menu = card.querySelector('.group-action-menu');
      const captureRect = element => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      };
      const before = {
        card: captureRect(card),
        header: captureRect(header),
        pages: captureRect(pages),
        fragments: Array.from(card.getClientRects(), rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
      };
      button.click();
      const after = {
        card: captureRect(card),
        header: captureRect(header),
        pages: captureRect(pages),
        cardZIndex: getComputedStyle(card).zIndex,
        menuInTopLayer: menu.matches(':popover-open'),
        fragments: Array.from(card.getClientRects(), rect => ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }))
      };
      return { before, after };
    })()`);
    assert.ok(
      Math.abs(domainMenuColumnLayout.after.header.left - domainMenuColumnLayout.after.pages.left) < 2,
      `Opening a domain-card menu split its header and rows across CSS columns: ${JSON.stringify(domainMenuColumnLayout)}`
    );
    assert.equal(domainMenuColumnLayout.after.cardZIndex, 'auto');
    assert.equal(domainMenuColumnLayout.after.menuInTopLayer, true);
    await page.evaluate(`(() => {
      document.querySelector('#openTabsMissions')?.style.removeProperty('width');
      externalFaviconsEnabled = true;
      renderDashboard();
    })()`);
    await page.waitFor(`document.querySelector('.mission-card.domain-card .page-chip[data-tab-url^="https://example.com/style-parity-"]')`);
    await page.evaluate(`document.querySelector('[data-action="switch-view"][data-view="group"]')?.click()`);
    await page.waitFor(`document.querySelector('.ungrouped-domain-block[data-ungrouped-domain="example.com"]')`);
    await page.waitFor(`document.querySelectorAll('.mission-card.group-card .page-chip[data-tab-url="https://example.org/group-fixture"]').length === 2`);
    assert.deepEqual(
      await page.evaluate(`(() => {
        const rows = Array.from(document.querySelectorAll('.mission-card.group-card .page-chip[data-tab-url="https://example.org/group-fixture"]'));
        const card = rows[0]?.closest('.mission-card');
        return {
          rowCount: rows.length,
          uniqueTabIds: new Set(rows.map(row => row.dataset.tabId)).size,
          footerCount: card?.querySelectorAll(':scope > .mission-content > .actions').length || 0,
          hasCollapseToggle: !!card?.querySelector('[data-action="toggle-group-collapsed"]'),
          closeInMenu: !!card?.querySelector('.group-action-menu [data-action="close-group-tabs"]'),
        };
      })()`),
      { rowCount: 2, uniqueTabIds: 2, footerCount: 0, hasCollapseToggle: true, closeInMenu: true }
    );
    await page.evaluate(`(() => {
      const row = document.querySelector('.mission-card.group-card .page-chip[data-tab-url="https://example.org/group-fixture"]');
      row?.closest('.mission-card')?.querySelector('[data-action="toggle-group-collapsed"]')?.click();
    })()`);
    await page.waitFor(`(() => {
      const row = document.querySelector('.mission-card.group-card .page-chip[data-tab-url="https://example.org/group-fixture"]');
      return !!row?.closest('.mission-card')?.classList.contains('group-is-collapsed');
    })()`);
    const groupInboxCardSurface = await page.evaluate(`(() => {
      const element = document.querySelector('.ungrouped-domain-block[data-ungrouped-domain="example.com"]');
      const style = getComputedStyle(element);
      return {
        borderRadius: style.borderRadius,
        borderColor: style.borderColor,
        backgroundColor: style.backgroundColor,
        backdropFilter: style.backdropFilter,
        boxShadow: style.boxShadow,
        edgeStripeContent: getComputedStyle(element, '::before').content,
      };
    })()`);
    await page.evaluate(`new Promise(resolve => chrome.tabs.query({}, tabs => {
      const fixtureIds = new Set(${JSON.stringify(cardParityFixtureIds)});
      const existingIds = tabs.filter(tab => fixtureIds.has(tab.id)).map(tab => tab.id);
      if (existingIds.length === 0) resolve();
      else chrome.tabs.remove(existingIds, resolve);
    }))`);
    assert.deepEqual(groupInboxCardSurface, domainCardSurface);
    const defaultTheme = await page.evaluate(`(() => {
      const activeOption = document.querySelector('.theme-option[aria-pressed="true"]');
      const firstOption = document.querySelector('.theme-option[data-theme-name]');
      return {
        theme: document.documentElement.dataset.theme,
        activeTheme: activeOption?.dataset.themeName || '',
        firstTheme: firstOption?.dataset.themeName || '',
        activeLabel: document.querySelector('#activeThemeLabel')?.textContent.trim() || '',
        storedTheme: localStorage.getItem('tab-out-theme')
      };
    })()`);
    assert.equal(defaultTheme.theme, 'system');
    assert.equal(defaultTheme.activeTheme, 'system');
    assert.equal(defaultTheme.firstTheme, 'system');
    assert.equal(defaultTheme.activeLabel, 'Adaptive Glow');
    assert.equal(defaultTheme.storedTheme, null);
    await page.waitFor('/\\d/.test(document.querySelector("#openTabsSummary")?.textContent || "")');
    assert.match(await page.evaluate(`document.querySelector('#openTabsSummary')?.textContent.trim() || ''`), /\d/);
    assert.equal(await page.evaluate(`document.querySelectorAll('footer, #statTabs').length`), 0);
    await page.evaluate(`document.querySelector('#privacySettingsBtn')?.click()`);
    await page.evaluate(`document.querySelector('#settingsTabAbout')?.click()`);
    await page.waitFor('document.querySelector("#settingsPaneAbout")?.classList.contains("active")');
    assert.deepEqual(
      await page.evaluate(`(() => ({
        versionMatchesManifest: document.querySelector('#extensionVersion')?.textContent.trim() === 'v' + chrome.runtime.getManifest().version,
        aboutTabCurrent: document.querySelector('#settingsTabAbout')?.getAttribute('aria-current'),
        links: Array.from(document.querySelectorAll('#settingsPaneAbout .about-links a')).map(link => link.textContent.trim()),
      }))()`),
      {
        versionMatchesManifest: true,
        aboutTabCurrent: 'page',
        links: ['Project source', 'Open-source license', 'Attribution notices', 'Third-party notices'],
      },
    );
    assert.deepEqual(
      await page.evaluate(`Array.from(document.querySelectorAll('.theme-option[data-theme-name]')).map(btn => btn.dataset.themeName).slice(0, 4)`),
      ['system', 'white', 'material', 'cupertino']
    );
    await page.evaluate(`document.querySelector('[data-theme-name="material"]').click()`);
    await page.waitFor('document.documentElement.dataset.theme === "material"');
    assert.equal(await page.evaluate(`document.querySelector('#activeThemeLabel')?.textContent.trim()`), 'Material Orbit');
    await page.evaluate(`document.querySelector('[data-theme-name="cupertino"]').click()`);
    await page.waitFor('document.documentElement.dataset.theme === "cupertino"');
    assert.equal(await page.evaluate(`document.querySelector('#activeThemeLabel')?.textContent.trim()`), 'Cupertino Mist');
    await page.evaluate(`document.querySelector('[data-language="zh"]').click()`);
    await page.waitFor('document.documentElement.dataset.lang === "zh"');
    assert.deepEqual(
      await page.evaluate(`Array.from(document.querySelectorAll('.theme-option[data-theme-name]')).map(btn => btn.querySelector('.theme-option-label')?.textContent.trim())`),
      ['随光', '素笺', '星轨', '雾岸', '暖笺', '夜航', '霜原', '森屿', '墨金', '珊潮', '梅影', '茶岚', '烬岩', '薰风']
    );
    await page.evaluate(`document.querySelector('[data-theme-name="system"]').click()`);
    await page.waitFor('document.querySelector("#activeThemeLabel")?.textContent.trim() === "随光"');
    assert.equal(await page.evaluate(`document.querySelector('#commandDockToolsBtn, #commandDrawer, #toolsView') === null`), true);
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const mobileToolbar = await page.evaluate(`(() => {
      const toolbar = document.querySelector('.dashboard-toolbar');
      const visibleControls = Array.from(toolbar.querySelectorAll('#openTabsSummary, .open-tabs-search-wrap, #openTabsViewToggle, #openTabsSortControl, #privacyToggle, #privacySettingsBtn, #toolbarMoreBtn'))
        .filter(element => element.getClientRects().length > 0)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { id: element.id || element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
        });
      const rect = toolbar.getBoundingClientRect();
      return {
        toolbar: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        controls: visibleControls,
        scrollWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    })()`);
    assert.ok(mobileToolbar.toolbar.left >= 0 && mobileToolbar.toolbar.right <= mobileToolbar.viewportWidth, `Mobile toolbar overflow: ${JSON.stringify(mobileToolbar)}`);
    assert.equal(mobileToolbar.scrollWidth, mobileToolbar.viewportWidth, `Mobile page has horizontal overflow: ${JSON.stringify(mobileToolbar)}`);
    assert.ok(mobileToolbar.controls.every(control => control.left >= 0 && control.right <= mobileToolbar.viewportWidth), `Mobile toolbar control overflow: ${JSON.stringify(mobileToolbar)}`);
    await page.evaluate(`(() => {
      window.scrollTo(0, 0);
      document.querySelector('#privacySettingsBtn').click();
    })()`);
    const mobileSettingsPanel = await page.evaluate(`(() => {
      const panel = document.querySelector('#privacySettings');
      const rect = panel.getBoundingClientRect();
      const centerEl = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(rect.height / 2, 120));
      return {
        display: getComputedStyle(panel).display,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        centerInside: panel === centerEl || panel.contains(centerEl),
      };
    })()`);
    assert.notEqual(mobileSettingsPanel.display, 'none');
    assert.ok(mobileSettingsPanel.left >= 0, `Settings panel left overflow: ${JSON.stringify(mobileSettingsPanel)}`);
    assert.ok(mobileSettingsPanel.right <= mobileSettingsPanel.viewportWidth, `Settings panel right overflow: ${JSON.stringify(mobileSettingsPanel)}`);
    assert.ok(mobileSettingsPanel.top >= 0, `Settings panel top overflow: ${JSON.stringify(mobileSettingsPanel)}`);
    assert.ok(mobileSettingsPanel.bottom <= mobileSettingsPanel.viewportHeight, `Settings panel bottom overflow: ${JSON.stringify(mobileSettingsPanel)}`);
    assert.equal(mobileSettingsPanel.centerInside, true);
    assert.equal(await page.evaluate(`(() => {
      const panel = document.querySelector('#privacySettings');
      panel.click();
      return panel.open;
    })()`), false);
    const escapeState = await page.evaluate(`(() => {
      document.querySelector('#privacySettingsBtn').click();
      document.querySelector('[data-settings-view="privacy"]').click();
      const input = document.querySelector('#psMottoInput');
      input.focus();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      const panel = document.querySelector('#privacySettings');
      return {
        activeId: document.activeElement?.id || '',
        panelOpen: panel.open,
      };
    })()`);
    assert.notEqual(escapeState.activeId, 'psMottoInput');
    assert.equal(escapeState.panelOpen, false);
    assert.deepEqual(page.errors.filter(error => !error.includes('/config.local.js')), []);
    page.close();
    page = null;

    page = await openExtensionPage(port, `${extensionBase}/sidepanel.html`);
    await page.waitFor('document.querySelector("#tabsView") && document.querySelector("#resultList")');
    assert.deepEqual(await page.evaluate(`({
      tabsActive: document.querySelector('#tabsView').classList.contains('active'),
      hasToolsView: document.querySelector('#toolsView') !== null,
      hasSaveWindow: document.querySelector('#saveSessionBtn') !== null,
      hasSaveAllWindows: document.querySelector('#saveAllWindowsBtn') !== null
    })`), {
      tabsActive: true,
      hasToolsView: false,
      hasSaveWindow: true,
      hasSaveAllWindows: true,
    });
    assert.deepEqual(page.errors, []);
    console.log('Chrome extension regression passed.');
  } finally {
    if (page) page.close();
    await stopChrome(chrome);
    await rm(profile, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
