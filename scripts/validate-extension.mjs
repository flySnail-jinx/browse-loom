#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EXTENSION_PACKAGE_FILES, REQUIRED_ZIP_ENTRIES, ROOT_PACKAGE_FILES } from './release-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extensionDir = join(root, 'extension');
const failures = [];
function fail(message) {
  failures.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${relative(root, path)} is not valid JSON: ${error.message}`);
    return null;
  }
}

function checkManifest() {
  const manifestPath = join(extensionDir, 'manifest.json');
  const manifest = readJson(manifestPath);
  if (!manifest) return;

  if (manifest.manifest_version !== 3) fail('manifest.json must use manifest_version 3');
  if (manifest.minimum_chrome_version !== '116') fail('manifest.json minimum_chrome_version must be 116');
  if (!manifest.chrome_url_overrides?.newtab) fail('manifest.json must override the new tab page');

  for (const permission of ['tabs', 'storage', 'tabGroups', 'sidePanel', 'sessions', 'favicon']) {
    if (!manifest.permissions?.includes(permission)) {
      fail(`manifest.json is missing permission: ${permission}`);
    }
  }
  if (!manifest.optional_permissions?.includes('bookmarks')) {
    fail('manifest.json must declare bookmarks as an optional permission');
  }
  if (manifest.permissions?.includes('bookmarks')) {
    fail('manifest.json must not require bookmarks at install time');
  }
  if (!manifest.optional_host_permissions?.includes('https://suggestion.baidu.com/*')) {
    fail('manifest.json must declare Baidu suggestions as an optional host permission');
  }
  if (manifest.host_permissions?.includes('https://suggestion.baidu.com/*')) {
    fail('Baidu suggestions must not be a required host permission');
  }

  const quickReturnCommand = manifest.commands?.['toggle-quick-return'];
  if (quickReturnCommand?.suggested_key?.default !== 'Ctrl+Shift+Z') {
    fail('manifest.json quick return command must use Ctrl+Shift+Z by default');
  }
  if (quickReturnCommand?.suggested_key?.mac !== 'MacCtrl+Shift+Z') {
    fail('manifest.json quick return command must preserve the physical Control key on macOS');
  }
  if (quickReturnCommand?.description !== '__MSG_commandToggleQuickReturn__') {
    fail('manifest.json quick return command must use the localized description');
  }

  const bookmarkPageCommand = manifest.commands?.['bookmark-current-page'];
  if (bookmarkPageCommand?.suggested_key?.default !== 'Ctrl+Shift+D') {
    fail('manifest.json bookmark current page command must use Ctrl+Shift+D by default');
  }
  if (bookmarkPageCommand?.suggested_key?.mac !== 'MacCtrl+Shift+D') {
    fail('manifest.json bookmark current page command must preserve the physical Control key on macOS');
  }
  if (bookmarkPageCommand?.description !== '__MSG_commandBookmarkCurrentPage__') {
    fail('manifest.json bookmark current page command must use the localized description');
  }
  if (manifest.action?.default_title !== '__MSG_actionOpenBrowseLoom__') {
    fail('manifest.json toolbar action must use the localized BrowseLoom entry title');
  }

  for (const path of [
    manifest.chrome_url_overrides?.newtab,
    manifest.side_panel?.default_path,
    manifest.background?.service_worker,
    'app.js',
    'bookmarks.js',
    'wallpaper-ui.js',
    'search-engine-ui.js',
    'style.css',
    'bookmarks.css',
    'search-engines.css',
    'glass.css',
    'effects.mjs',
    'backgrounds/backgrounds.css',
    'backgrounds/background-controller.mjs',
    'backgrounds/background-registry.mjs',
    'backgrounds/mountain-default.jpg',
    'backgrounds/liquid-ether.mjs',
    'backgrounds/light-rays.mjs',
    'backgrounds/prism.mjs',
    'theme-init.js',
    'services/search-engine-service.js',
    'services/wallpaper-service.js',
  ]) {
    if (path && !existsSync(join(extensionDir, path))) {
      fail(`manifest or runtime references missing file: ${path}`);
    }
  }
}

async function collectFiles(dir, predicate, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(path, predicate, out);
    } else if (predicate(path)) {
      out.push(path);
    }
  }
  return out;
}

async function checkSyntax() {
  const jsFiles = await collectFiles(extensionDir, path => path.endsWith('.js') || path.endsWith('.mjs'));
  for (const file of jsFiles) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status !== 0) {
      fail(`${relative(root, file)} failed syntax check:\n${result.stderr || result.stdout}`);
    }
  }
}

function checkHtmlScripts(htmlFile, expectedScripts = []) {
  const indexPath = join(extensionDir, htmlFile);
  const html = readFileSync(indexPath, 'utf8');
  const scripts = [...html.matchAll(/<script\s+src="([^"]+)"/g)].map(match => match[1]);

  for (const script of scripts) {
    if (script === 'config.local.js') continue;
    if (!existsSync(join(extensionDir, script))) fail(`${htmlFile} references missing script: ${script}`);
  }

  let previousIndex = -1;
  const appIndex = scripts.indexOf('app.js');
  for (const script of expectedScripts) {
    const scriptIndex = scripts.indexOf(script);
    if (scriptIndex === -1) {
      fail(`${htmlFile} does not load ${script}`);
      continue;
    }
    if (scriptIndex <= previousIndex) fail(`${script} loads out of order in ${htmlFile}`);
    if (appIndex !== -1 && scriptIndex > appIndex) fail(`${script} must load before app.js`);
    previousIndex = scriptIndex;
  }
}

function checkIndexScripts() {
  checkHtmlScripts('index.html', [
    'services/url-service.js',
    'services/html-service.js',
    'services/storage-service.js',
    'services/bookmarks-service.js',
    'services/tabs-service.js',
    'services/search-service.js',
    'services/metrics-service.js',
  ]);
  checkHtmlScripts('sidepanel.html', [
    'services/url-service.js',
    'services/storage-service.js',
    'services/tabs-service.js',
    'services/search-service.js',
  ]);
}

function checkDashboardInformationStructure() {
  const indexHtml = readFileSync(join(extensionDir, 'index.html'), 'utf8');
  const appJs = readFileSync(join(extensionDir, 'app.js'), 'utf8');

  if (/<footer\b/i.test(indexHtml)) {
    fail('index.html must not restore the redundant in-page dashboard footer');
  }
  for (const id of ['privacySettings', 'settingsTabData', 'settingsPaneData', 'settingsTabAbout', 'settingsPaneAbout', 'extensionVersion']) {
    if (!indexHtml.includes(`id="${id}"`)) {
      fail(`index.html is missing dashboard information structure element: ${id}`);
    }
  }
  for (const removedId of ['openTabsSummary', 'bookmarkSectionTitle', 'bookmarkSectionCount']) {
    if (indexHtml.includes(`id="${removedId}"`)) {
      fail(`index.html restored redundant dashboard statistic: ${removedId}`);
    }
  }
  if (appJs.includes("getElementById('statTabs')")) {
    fail('app.js must not update the removed duplicate footer tab count');
  }
}

function checkDistZip(zipPath) {
  if (!existsSync(zipPath)) {
    fail(`${relative(root, zipPath)} is missing; package before validating`);
    return;
  }
  const result = spawnSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail(`Could not inspect ${relative(root, zipPath)} with unzip`);
    return;
  }

  const entries = result.stdout.split('\n').filter(Boolean);
  if (!entries.includes('manifest.json')) fail(`${relative(root, zipPath)} must contain manifest.json at the ZIP root`);
  for (const required of REQUIRED_ZIP_ENTRIES) {
    if (!entries.includes(required)) fail(`${relative(root, zipPath)} is missing required entry: ${required}`);
  }

  const forbidden = [
    '.git/',
    '.DS_Store',
    '__MACOSX',
    'config.local.js',
    '.claude/',
    'tools/',
    'icons/icon-source.png',
    'icons/icon.svg',
    'services/actions-service.js',
  ];
  for (const entry of entries) {
    if (forbidden.some(token => entry.includes(token))) {
      fail(`${relative(root, zipPath)} contains forbidden entry: ${entry}`);
    }
    if (!entry.endsWith('/') && !REQUIRED_ZIP_ENTRIES.includes(entry)) {
      fail(`${relative(root, zipPath)} contains unexpected entry: ${entry}`);
    }
  }

  for (const entry of REQUIRED_ZIP_ENTRIES) {
    const extracted = spawnSync('unzip', ['-p', zipPath, entry], { encoding: null });
    if (extracted.status !== 0) continue;
    const sourcePath = EXTENSION_PACKAGE_FILES.includes(entry)
      ? join(extensionDir, entry)
      : ROOT_PACKAGE_FILES.includes(entry) ? join(root, entry) : null;
    if (!sourcePath || !existsSync(sourcePath)) continue;
    const sourceHash = createHash('sha256').update(readFileSync(sourcePath)).digest('hex');
    const zipHash = createHash('sha256').update(extracted.stdout).digest('hex');
    if (sourceHash !== zipHash) fail(`${relative(root, zipPath)} contains stale content: ${entry}`);
  }
}

async function main() {
  const manifest = readJson(join(extensionDir, 'manifest.json'));
  checkManifest();
  checkIndexScripts();
  checkDashboardInformationStructure();
  await checkSyntax();
  if (manifest?.version) {
    checkDistZip(join(root, `dist/browse-loom-chrome-${manifest.version}.zip`));
    checkDistZip(join(root, `dist/browse-loom-edge-${manifest.version}.zip`));
  }

  if (failures.length > 0) {
    console.error('Extension validation failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log('Extension validation passed.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
