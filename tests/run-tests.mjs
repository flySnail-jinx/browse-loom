#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const urls = require(resolve(root, 'extension/services/url-service.js'));
const tabs = require(resolve(root, 'extension/services/tabs-service.js'));
const searchEngines = require(resolve(root, 'extension/services/search-engine-service.js'));
const wallpapers = require(resolve(root, 'extension/services/wallpaper-service.js'));
const storage = require(resolve(root, 'extension/services/storage-service.js'));
const bookmarks = require(resolve(root, 'extension/services/bookmarks-service.js'));
const search = require(resolve(root, 'extension/services/search-service.js'));
const metrics = require(resolve(root, 'extension/services/metrics-service.js'));
const html = require(resolve(root, 'extension/services/html-service.js'));

function makeFakeStorage(seed = {}) {
  const store = { ...seed };
  return {
    store,
    async get(keys) {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map(key => [key, store[key]]));
      }
      return Object.fromEntries(Object.keys(keys).map(key => [key, store[key] ?? keys[key]]));
    },
    async set(values) {
      Object.assign(store, values);
    },
    async getBytesInUse() {
      return JSON.stringify(store).length;
    },
  };
}

async function testWorkspaceNavigationContract() {
  const index = readFileSync(resolve(root, 'extension/index.html'), 'utf8');
  const css = readFileSync(resolve(root, 'extension/bookmarks.css'), 'utf8');
  const dashboardCss = readFileSync(resolve(root, 'extension/style.css'), 'utf8');
  const glassCss = readFileSync(resolve(root, 'extension/glass.css'), 'utf8');
  const searchEngineCss = readFileSync(resolve(root, 'extension/search-engines.css'), 'utf8');
  const app = readFileSync(resolve(root, 'extension/app.js'), 'utf8');
  const ui = readFileSync(resolve(root, 'extension/bookmarks.js'), 'utf8');
  const background = readFileSync(resolve(root, 'extension/background.js'), 'utf8');
  const searchEngineUi = readFileSync(resolve(root, 'extension/search-engine-ui.js'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
  const enLocale = JSON.parse(readFileSync(resolve(root, 'extension/_locales/en/messages.json'), 'utf8'));
  const zhLocale = JSON.parse(readFileSync(resolve(root, 'extension/_locales/zh_CN/messages.json'), 'utf8'));

  assert.equal((index.match(/data-workspace-switch=/g) || []).length, 2);
  assert.equal(index.includes('workspace-edge-switch'), false);
  assert.match(index, /<nav class="workspace-switcher"[^>]+id="workspaceSwitcher"/);
  assert.match(index, /data-workspace-switch="tabs"[^>]+hidden/);
  assert.match(css, /\.workspace-switcher\s*\{[\s\S]*?left:\s*0;/);
  assert.match(css, /body\[data-workspace="bookmarks"\] \.workspace-switcher\s*\{[\s\S]*?right:\s*0;[\s\S]*?left:\s*auto;/);
  assert.match(css, /data-workspace-transition="to-bookmarks"/);
  assert.ok(ui.indexOf("document.addEventListener('click', handleWorkspaceSwitchClick)") < ui.indexOf('if (!Bookmarks) return;'));
  assert.equal(ui.includes('document.startViewTransition'), true);
  assert.equal(ui.includes('transition.finished.finally'), false);
  assert.match(ui, /transition\.finished[\s\S]{0,120}\.catch\(\(\) => \{\}\)[\s\S]{0,120}\.finally\(/);
  assert.match(ui, /workspaceUpdated\.then\(\(\) => refreshLibrary\(\)\)\.catch\(\(\) => \{\}\)/);
  assert.equal(ui.includes('source.animate'), true);
  assert.equal(ui.includes('setPointerCapture'), false);
  assert.equal(ui.includes("event.key === 'ArrowLeft' && !bookmarkOpen"), true);
  assert.equal(ui.includes("event.key === 'ArrowRight' && bookmarkOpen"), true);
  assert.equal(ui.includes("document.addEventListener('wheel', handleWorkspaceWheel, { passive: false })"), true);
  assert.equal(ui.includes("workspaceSwitcher?.addEventListener('wheel', handleWorkspaceWheel"), false);
  assert.match(ui, /Math\.abs\(event\.deltaY\) <= Math\.abs\(event\.deltaX\)/);
  assert.match(ui, /const next = workspaceSwipeDelta > 0 \? 'bookmarks' : 'tabs';/);
  assert.match(ui, /dialog\[open\], input, textarea, select, \[contenteditable="true"\], \[role="textbox"\]/);
  assert.equal(ui.includes("getElementById('bookmarkSearch')?.focus({ preventScroll: true })"), false);
  assert.match(css, /\.bookmark-grid\[hidden\],[\s\S]*?\.bookmark-list\[hidden\],[\s\S]*?\.bookmark-empty\[hidden\],[\s\S]*?\.bookmark-empty-icon\[hidden\]\s*\{\s*display:\s*none;/);
  const emptyState = index.match(/<div class="bookmark-empty" id="bookmarkEmpty"[\s\S]*?<\/div>/)?.[0] || '';
  assert.match(emptyState, /<button class="bookmark-empty-icon"[^>]+data-bookmark-action="open-add-menu"/);
  assert.match(emptyState, /class="bookmark-empty-import"[^>]+data-action="open-settings"[^>]+data-settings-view="data"/);
  assert.match(index, /<button class="bookmark-add-trigger"[^>]+data-bookmark-action="add-category"/);
  assert.equal((index.match(/class="[^"]*global-settings-trigger/g) || []).length, 1);
  assert.match(index, /id="privacySettings"[^>]+class="[^"]*settings-dialog|class="[^"]*settings-dialog[^"]*"[^>]+id="privacySettings"/);
  const settingsDialogMarkup = index.match(/<dialog[^>]+id="privacySettings"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.equal(settingsDialogMarkup.includes('data-close-dialog'), false);
  assert.match(index, /id="settingsTabData"[^>]+data-settings-view="data"/);
  assert.match(index, /id="settingsPaneData"[^>]+data-settings-pane="data"/);
  assert.match(index, /id="settingsTabGeneral"[^>]+data-settings-view="general"/);
  assert.match(index, /id="settingsPaneGeneral"[^>]+data-settings-pane="general"/);
  assert.match(index, /id="settingsTabSearch"[^>]+data-settings-view="search"/);
  assert.match(index, /id="settingsPaneSearch"[^>]+data-settings-pane="search"/);
  assert.match(index, /class="app-navigation"/);
  assert.match(index, /class="app-search-slot"/);
  assert.match(index, /id="searchSettingsStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(searchEngineUi, /function setupAppNavigation\(\)/);
  assert.match(searchEngineUi, /permissionReloadRequired/);
  assert.equal((index.match(/data-search-surface=/g) || []).length, 2);
  assert.match(index, /id="baiduSuggestionsToggle"/);
  assert.doesNotMatch(index, /id="customSearchEngineForm"/);
  assert.equal(manifest.permissions.includes("search"), true);
  assert.match(searchEngineUi, /chrome\.search\.query/);
  assert.doesNotMatch(searchEngineUi, /buildSearchUrl|chrome\.tabs\.create|window\.open/);
  assert.match(searchEngineUi, /credentials:\s*'omit'/);
  assert.match(searchEngineUi, /chrome\.permissions\.request\(\{ origins: \[Engines\.BAIDU_SUGGESTION_ORIGIN\] \}\)/);
  assert.equal(manifest.optional_host_permissions?.includes('https://suggestion.baidu.com/*'), true);
  assert.equal((index.match(/data-action="set-default-workspace"/g) || []).length, 2);
  assert.match(app, /DEFAULT_WORKSPACE_STORAGE_KEY = 'tab-out-default-workspace'/);
  assert.match(app, /localStorage\.setItem\(DEFAULT_WORKSPACE_STORAGE_KEY, next\)/);
  assert.match(ui, /document\.documentElement\.dataset\.defaultWorkspace === 'bookmarks'/);
  assert.match(ui, /applyWorkspaceShell\(defaultWorkspace\)/);
  assert.match(index, /id="bulkTabConfirmDialog"[^>]+aria-describedby="bulkTabConfirmText"/);
  assert.match(index, /id="bulkTabConfirmCancel"[^>]+type="button"/);
  assert.match(index, /id="toast"[^>]+role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.match(index, /id="toastDismiss"[^>]+type="button"/);
  assert.equal(index.includes('id="bookmarkToast"'), false);
  for (const action of ['close-all-open-tabs', 'close-domain-tabs', 'close-group-tabs', 'close-ungrouped-tabs', 'dedup-keep-one']) {
    const handler = app.match(new RegExp(`if \\(action === '${action}'\\) \\{[\\s\\S]*?\\n  \\}`))?.[0] || '';
    assert.match(handler, /openBulkTabCloseConfirm\(/, `${action} must use bulk confirmation`);
  }
  const closeExtraDashboardsHandler = app.match(/if \(action === 'close-tabout-dupes'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(closeExtraDashboardsHandler, /openBulkTabCloseConfirm\(/);
  assert.match(closeExtraDashboardsHandler, /closeTabsWithSnapshot\?\.\(tabIds, \{ allowDashboard: true \}\)/);
  assert.match(closeExtraDashboardsHandler, /offerClosedTabsUndo\(result\)/);
  const closeSingleTabHandler = app.match(/if \(action === 'close-single-tab'\) \{[\s\S]*?\n  \}/)?.[0] || '';
  assert.doesNotMatch(closeSingleTabHandler, /openBulkTabCloseConfirm\(/);
  assert.match(closeSingleTabHandler, /closeTabsWithSnapshot\?\.\(\[targetTabId\]\)/);
  assert.match(closeSingleTabHandler, /offerClosedTabsUndo\(result, tr\('toastTabClosed'\)\)/);
  assert.match(app, /window\.SuperTabOutToast = \{ show: showToast, dismiss: hideToast \}/);
  assert.match(app, /actionLabel: tr\('undo'\)[\s\S]*?TabsService\.restoreClosedTabs\(result\.snapshot\)/);
  assert.match(ui, /window\.SuperTabOutToast\?\.show\?/);
  assert.match(ui, /showToast\(message, \{ undo: \(\) => undoDelete\(result\.previous\) \}\)/);
  assert.equal(ui.includes('undoSnapshot'), false);
  assert.equal(index.includes('bookmark-settings-trigger'), false);
  assert.equal(index.includes('id="bookmarkSettingsDialog"'), false);
  assert.match(index, /class="bookmark-import-trigger"[^>]+data-action="open-settings"[^>]+data-settings-view="data"/);
  assert.match(index, /id="bookmarkImportButton"[^>]+data-bookmark-action="import-browser-bookmarks"/);
  assert.match(app, /panel\.showModal\(\)/);
  assert.match(app, /settingsDialog\?\.addEventListener\('cancel'/);
  assert.match(app, /event\.target === settingsDialog/);
  assert.match(app, /const initialView = view \|\| \(document\.body\.classList\.contains\('privacy-mode'\) \? 'privacy' : activeSettingsView\)/);
  assert.match(dashboardCss, /\.settings-dialog-shell\s*\{[\s\S]*?grid-template-columns:\s*224px minmax\(0, 1fr\)/);
  assert.match(dashboardCss, /\.settings-dialog::backdrop\s*\{/);
  assert.deepEqual(manifest.optional_permissions, ['bookmarks']);
  const faviconSetting = index.match(/<label class="privacy-setting-row">\s*<span data-i18n="externalFavicons"[\s\S]*?<\/label>/)?.[0] || '';
  assert.equal(faviconSetting.includes('checked'), false);
  assert.match(index, /data-i18n="externalFaviconsDisclosure"[^>]*>[^<]*icons\.duckduckgo\.com/);
  assert.equal(ui.includes("chrome.permissions.request({ permissions: ['bookmarks'] })"), true);
  assert.equal(ui.includes('Bookmarks.importBrowserTree(tree)'), true);
  const openBookmarkSource = ui.match(/async function openBookmark[\s\S]*?\n  }/)?.[0] || '';
  assert.match(openBookmarkSource, /chrome\.tabs\.create\(\{ url: bookmark\.url, active: true \}\)/);
  assert.equal(openBookmarkSource.includes('chrome.tabs.update'), false);
  assert.match(openBookmarkSource, /window\.open\(bookmark\.url, '_blank', 'noopener'\)/);
  const copyBookmarkLinkSource = ui.match(/async function copyBookmarkLink[\s\S]*?\n  }/)?.[0] || '';
  assert.match(ui, /data-context-action="copy-link" data-kind="bookmark"/);
  assert.match(copyBookmarkLinkSource, /navigator\.clipboard\.writeText\(bookmark\.url\)/);
  assert.match(copyBookmarkLinkSource, /showToast\(t\('linkCopied'\)\)/);
  assert.match(copyBookmarkLinkSource, /showToast\(t\('copyLinkFailed'\)\)/);
  assert.match(ui, /contextAction === 'copy-link' && kind === 'bookmark'/);
  const copiedLinks = [];
  const copyMessages = [];
  await runInNewContext(`${copyBookmarkLinkSource}\ncopyBookmarkLink('bookmark-1');`, {
    bookmarkById: () => ({ url: 'https://example.com/path?source=bookmark' }),
    navigator: { clipboard: { writeText: async value => copiedLinks.push(value) } },
    showToast: message => copyMessages.push(message),
    t: key => key,
    Error,
  });
  assert.deepEqual(copiedLinks, ['https://example.com/path?source=bookmark']);
  assert.deepEqual(copyMessages, ['linkCopied']);
  const failedCopyMessages = [];
  await runInNewContext(`${copyBookmarkLinkSource}\ncopyBookmarkLink('bookmark-1');`, {
    bookmarkById: () => ({ url: 'https://example.com/' }),
    navigator: { clipboard: { writeText: async () => { throw new Error('denied'); } } },
    showToast: message => failedCopyMessages.push(message),
    t: key => key,
    Error,
  });
  assert.deepEqual(failedCopyMessages, ['copyLinkFailed']);
  assert.equal(ui.includes("{ newTab: event.ctrlKey || event.metaKey }"), false);
  assert.equal(index.includes('id="bookmarkAddTrigger"'), false);
  assert.equal(index.includes('id="bookmarkAddMenu"'), true);
  assert.equal(ui.includes('function openAddMenu(anchor)'), true);
  const positionFloatingMenuSource = ui.match(/function positionFloatingMenu[\s\S]*?\n  }/)?.[0] || '';
  const bodyHost = { append(menu) { menu.parentElement = this; } };
  const dialogHost = { append(menu) { menu.parentElement = this; } };
  const floatingMenu = {
    hidden: true,
    parentElement: bodyHost,
    style: {},
    getBoundingClientRect() { return { width: 160, height: 120 }; },
  };
  const dialogAnchor = {
    closest(selector) { return selector === 'dialog[open]' ? dialogHost : null; },
    getBoundingClientRect() { return { left: 240, bottom: 220 }; },
  };
  runInNewContext(`${positionFloatingMenuSource}\npositionFloatingMenu(menu, anchor);`, {
    menu: floatingMenu,
    anchor: dialogAnchor,
    document: { body: bodyHost },
    window: { innerWidth: 1280, innerHeight: 800 },
  });
  assert.equal(floatingMenu.parentElement, dialogHost);
  assert.equal(floatingMenu.hidden, false);
  assert.equal(ui.includes("event.target.closest?.('dialog[open]')"), true);
  assert.equal(ui.includes("event.target.closest('#bookmarkAddMenu, #bookmarkContextMenu')"), true);
  assert.equal(ui.includes('class="bookmark-add-tile"'), true);
  assert.equal(ui.includes('class="bookmark-list-add"'), true);
  assert.equal(ui.includes("openFolderEditor(null, { category: true })"), true);
  assert.equal(ui.includes('pinnedToHome'), false);
  assert.equal(ui.includes('homeOrder'), false);
  assert.match(index, /id="bookmarkCategory"/);
  assert.match(index, /id="bookmarkMoveDialog"/);
  assert.match(index, /data-folder-exit-drop/);
  const folderViewer = index.match(/<dialog class="bookmark-folder-dialog"[\s\S]*?<\/dialog>/)?.[0] || '';
  assert.match(folderViewer, /id="bookmarkFolderRenameForm"/);
  assert.match(folderViewer, /id="bookmarkFolderDialogTitle"[^>]+type="button"[^>]+data-bookmark-action="edit-folder-name"/);
  assert.match(folderViewer, /id="bookmarkFolderDialogTitleInput"[^>]+type="text"[^>]+hidden/);
  assert.equal(folderViewer.includes('data-close-dialog="bookmarkFolderDialog"'), false);
  assert.equal(ui.includes('bookmark-folder-board-expand'), false);
  const folderTileSource = ui.match(/function folderTileMarkup[\s\S]*?\n  }/)?.[0] || '';
  const folderBoardSource = ui.match(/function folderBoardMarkup[\s\S]*?\n  }/)?.[0] || '';
  assert.equal(folderTileSource.includes('bookmark-more-button'), false);
  assert.equal(folderBoardSource.includes('bookmark-more-button'), false);
  assert.equal(index.includes('bookmarkPinned'), false);
  assert.equal(index.includes('folderPinned'), false);
  assert.equal(ui.includes('Bookmarks.moveBookmark'), true);
  assert.equal(ui.includes('Bookmarks.moveFolder'), true);
  assert.equal(ui.includes('Bookmarks.reorderFolderBookmarks'), true);
  const categoryIcons = ui.match(/const CATEGORY_ICONS = \[([\s\S]*?)\n  \];/)?.[1] || '';
  assert.equal((categoryIcons.match(/\{ id: '/g) || []).length, 24);
  assert.match(index, /id="categoryIconFieldset"[^>]+hidden/);
  assert.equal(ui.includes('function renderCategoryIconOptions()'), true);
  assert.equal(ui.includes("document.getElementById('categoryIconFieldset').hidden = !categoryMode"), true);
  assert.equal(ui.includes('async function saveFolderViewerName(event)'), true);
  assert.equal(ui.includes('function beginFolderViewerRename()'), true);
  assert.equal(ui.includes("getElementById('bookmarkFolderDialogTitleInput')?.addEventListener('change', saveFolderViewerName)"), true);
  assert.equal(ui.includes("categoryIconMarkup(normalizedCategoryIcon(category))"), true);
  assert.match(css, /\.bookmark-category-icon-options\s*\{[\s\S]*?grid-template-columns:\s*repeat\(6,/);
  assert.match(css, /\.bookmark-shell\s*\{[\s\S]*?grid-template-columns:\s*216px minmax\(420px, 1fr\)/);
  assert.match(dashboardCss, /:root\s*\{[\s\S]*?--workspace-max-width:\s*1680px;/);
  assert.match(dashboardCss, /\.missions\s*\{[\s\S]*?columns:\s*300px;/);
  assert.match(dashboardCss, /@media \(min-width:\s*1180px\)[\s\S]*?max-width:\s*min\(var\(--workspace-max-width\), calc\(100vw - var\(--command-dock-safe-area, 92px\)\)\)/);
  assert.match(glassCss, /\.container\s*\{[\s\S]*?max-width:\s*var\(--workspace-max-width\);/);
  assert.match(searchEngineCss, /@media \(min-width:\s*1180px\)[\s\S]*?\.app-navigation-inner\s*\{[\s\S]*?width:\s*min\(var\(--workspace-max-width\), calc\(100vw - var\(--command-dock-safe-area, 92px\)\)\)/);
  assert.match(css, /\.bookmark-toolbar\s*\{[\s\S]*?max-width:\s*var\(--workspace-max-width\);/);
  assert.match(css, /\.bookmark-shell\s*\{[\s\S]*?max-width:\s*var\(--workspace-max-width\);/);
  assert.match(css, /\.bookmark-grid\s*\{[\s\S]*?grid-auto-rows:\s*106px;[\s\S]*?grid-template-columns:\s*repeat\(auto-fill, minmax\(96px, 1fr\)\);[\s\S]*?gap:\s*14px 12px;/);
  assert.match(css, /\.bookmark-add-tile\s*\{[\s\S]*?height:\s*106px;/);
  assert.match(css, /\.bookmark-folder-board\s*\{[\s\S]*?padding:\s*10px 12px;/);
  assert.match(css, /\.bookmark-folder-board-head\s*\{[\s\S]*?height:\s*21px;/);
  assert.match(css, /\.bookmark-folder-link\s*\{[\s\S]*?height:\s*57px;[\s\S]*?padding:\s*2px;/);
  assert.match(css, /@media \(min-width:\s*1180px\)[\s\S]*?\.bookmark-toolbar,[\s\S]*?\.bookmark-shell\s*\{[\s\S]*?width:\s*min\(var\(--workspace-max-width\), calc\(100vw - var\(--command-dock-safe-area, 92px\)\)\)/);
  assert.match(css, /@media \(max-width:\s*1333px\)[\s\S]*?grid-template-areas:[\s\S]*?"library main recent"[\s\S]*?"library main popular"/);
  assert.match(index, /class="bookmark-activity-panel bookmark-activity-recent"/);
  assert.match(index, /class="bookmark-activity-panel bookmark-activity-popular"/);
  const bookmarkLibraryPanelCss = css.match(/\.bookmark-library-panel\s*\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(bookmarkLibraryPanelCss, /background:\s*var\(--bookmark-readable-surface\);/);
  assert.equal(bookmarkLibraryPanelCss.includes('backdrop-filter'), false);
  assert.match(css, /\.bookmark-library-panel::before\s*\{\s*display:\s*none;/);
  assert.match(css, /\.bookmark-workspace\s*\{[\s\S]*?--bookmark-readable-surface:\s*var\(--content-card-surface\);/);
  assert.match(css, /\.bookmark-library-panel,[\s\S]*?background:\s*var\(--content-card-surface\);/);
  assert.match(css, /\.bookmark-folder-board\s*\{[\s\S]*?background:\s*var\(--content-card-surface\);/);
  assert.match(css, /\.bookmark-nav-select,[\s\S]*?background:\s*transparent;/);
  assert.match(css, /\.bookmark-nav-select\.active\s*\{[\s\S]*?background:\s*var\(--bookmark-readable-surface-strong\);/);
  assert.match(css, /\.bookmark-nav-count\s*\{[\s\S]*?display:\s*block;/);
  assert.match(index, /class="bookmark-add-label"[^>]+data-bookmark-copy="addCategory"/);
  assert.match(css, /\.bookmark-list-row\s*\{[\s\S]*?background:\s*var\(--bookmark-readable-surface\);/);
  assert.match(css, /\.bookmark-tile-open > \.bookmark-tile-title,[\s\S]*?background:\s*var\(--bookmark-readable-surface\);/);
  assert.match(css, /\.bookmark-library-nav\s*\{[\s\S]*?overflow-x:\s*hidden;[\s\S]*?overflow-y:\s*auto;/);
  assert.match(css, /\.bookmark-library-nav\s*\{[\s\S]*?scrollbar-width:\s*none;/);
  assert.match(css, /\.bookmark-library-nav::\-webkit-scrollbar\s*\{[\s\S]*?display:\s*none;/);
  assert.match(css, /@media \(max-width:\s*720px\)[\s\S]*?\.bookmark-library-nav\s*\{[\s\S]*?overflow-x:\s*auto;[\s\S]*?overflow-y:\s*hidden;/);
  assert.match(css, /\.bookmark-nav-select,[\s\S]*?grid-template-columns:\s*44px minmax\(0, 1fr\) auto;[\s\S]*?min-height:\s*47px;/);
  assert.match(css, /\.bookmark-editor-dialog\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0 auto 0 0;[\s\S]*?height:\s*100dvh;[\s\S]*?margin:\s*0;/);
  assert.match(css, /\.bookmark-folder-dialog\[open\]\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;/);
  assert.match(css, /@keyframes bookmark-sheet-in\s*\{[\s\S]*?translateX\(-36px\)[\s\S]*?translateX\(0\)/);
  assert.match(css, /@keyframes bookmark-folder-dialog-in\s*\{[\s\S]*?translateY\(20px\) scale\(\.98\)[\s\S]*?translateY\(0\) scale\(1\)/);
  assert.match(css, /\.bookmark-editor-dialog\.is-closing > \.bookmark-editor,[\s\S]*?animation:\s*bookmark-sheet-out 160ms/);
  assert.match(css, /\.bookmark-folder-dialog\.is-closing > section\s*\{[\s\S]*?animation:\s*bookmark-folder-dialog-out 160ms/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.bookmark-editor-dialog::backdrop,[\s\S]*?\.bookmark-folder-dialog::backdrop,[\s\S]*?animation:\s*none !important;/);
  assert.equal(ui.includes('function showBookmarkDialog(dialog)'), true);
  assert.equal(ui.includes('function closeBookmarkDialog(dialog, returnValue)'), true);
  assert.match(ui, /dialog\.classList\.add\('is-closing'\)[\s\S]*?setTimeout\(finish, DIALOG_EXIT_DURATION_MS\)/);
  assert.match(css, /\.bookmark-folder-board\s*\{[\s\S]*?align-self:\s*stretch;/);
  assert.match(css, /\.bookmark-confirm-dialog\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?height:\s*100dvh;[\s\S]*?margin:\s*0;/);
  assert.match(css, /\.bookmark-confirm-dialog\[open\]\s*\{[\s\S]*?display:\s*grid;[\s\S]*?place-items:\s*center;/);
  assert.match(index, /id="bookmarkConfirmMoveToUnfiled"[^>]+data-category-delete-mode="move-to-unfiled"[^>]+hidden/);
  assert.match(index, /id="bookmarkConfirmDelete"[^>]+data-category-delete-mode="delete-all"/);
  assert.equal(ui.includes("contentMode: categoryContentMode"), true);
  assert.equal(ui.includes("dialog.style.setProperty('--bookmark-folder-width'"), true);
  assert.match(css, /\.bookmark-add-trigger\s*\{[\s\S]*?width:\s*100%;[\s\S]*?grid-template-columns:\s*36px minmax\(0, 1fr\);/);
  assert.match(css, /\.bookmark-import-trigger\s*\{[\s\S]*?width:\s*100%;[\s\S]*?grid-template-columns:\s*36px minmax\(0, 1fr\);/);
  assert.match(css, /\.bookmark-add-trigger\s*\{[\s\S]*?margin:\s*auto 0 0;/);
  assert.match(css, /\.bookmark-import-trigger\s*\{[\s\S]*?margin:\s*4px 0 0;/);
  assert.ok(manifest.commands?.['toggle-workspace']);
  assert.deepEqual(manifest.commands?.['bookmark-current-page']?.suggested_key, {
    default: 'Ctrl+Shift+D',
    mac: 'MacCtrl+Shift+D',
  });
  assert.equal(manifest.commands?.['bookmark-current-page']?.description, '__MSG_commandBookmarkCurrentPage__');
  assert.equal(manifest.action?.default_title, '__MSG_actionOpenBrowseLoom__');
  assert.equal(enLocale.commandBookmarkCurrentPage.message, 'Bookmark this page');
  assert.equal(zhLocale.commandBookmarkCurrentPage.message, '收藏此页');
  assert.equal(enLocale.actionOpenBrowseLoom.message, 'Open BrowseLoom');
  assert.equal(zhLocale.actionOpenBrowseLoom.message, '打开 BrowseLoom');
  assert.match(background, /chrome\.action\.onClicked\.addListener\(openBrowseLoom\)/);
  assert.match(background, /self\.SuperTabOutTabs\?\.isDashboardTab\?\./);
  assert.match(background, /command === 'bookmark-current-page'[\s\S]*?openCurrentPageBookmarkDraft\(tab\)/);
  assert.match(background, /chrome\.storage\.session\.set/);
  assert.match(background, /message\?\.type === 'consume-bookmark-capture'/);
  assert.match(background, /async function saveCurrentSession\(scope = 'currentWindow'\)/);
  assert.match(background, /message\.scope \|\| 'currentWindow'/);
  assert.equal(background.includes("message.scope || 'all'"), false);
  assert.match(ui, /categoryId:\s*UNFILED_CATEGORY_ID/);
  assert.match(ui, /focusField:\s*response\.draft\.supported \? 'bookmarkNote' : 'bookmarkUrl'/);
  assert.match(ui, /openBookmarkEditor\(null, \{[\s\S]*?prefill:\s*response\.draft/);
}

function testSidePanelTabActionScopeContract() {
  const panel = readFileSync(resolve(root, 'extension/sidepanel.js'), 'utf8');
  const resultCard = panel.match(/function renderResultCard[\s\S]*?\n  }/)?.[0] || '';
  const clickHandler = panel.match(/document\.addEventListener\('click',[\s\S]*?\n  }\);/)?.[0] || '';

  assert.match(resultCard, /data-action="focus" data-tab-id=/);
  assert.match(resultCard, /data-action="save-tab" data-tab-id=/);
  assert.match(resultCard, /data-action="close-tab" data-tab-id=/);
  assert.match(clickHandler, /focusTabById\(tabId\)/);
  assert.match(clickHandler, /closeTabsByIds\(\[tabId\]\)/);
  assert.doesNotMatch(clickHandler, /closeTabsByUrls\(\[url\]\)/);
}

async function testBackgroundRegistryContract() {
  const index = readFileSync(resolve(root, 'extension/index.html'), 'utf8');
  const manifest = JSON.parse(readFileSync(resolve(root, 'extension/manifest.json'), 'utf8'));
  const effects = readFileSync(resolve(root, 'extension/effects.mjs'), 'utf8');
  const controller = readFileSync(resolve(root, 'extension/backgrounds/background-controller.mjs'), 'utf8');
  const registry = readFileSync(resolve(root, 'extension/backgrounds/background-registry.mjs'), 'utf8');
  const lightRays = readFileSync(resolve(root, 'extension/backgrounds/light-rays.mjs'), 'utf8');
  const prism = readFileSync(resolve(root, 'extension/backgrounds/prism.mjs'), 'utf8');
  const backgroundCss = readFileSync(resolve(root, 'extension/backgrounds/backgrounds.css'), 'utf8');
  const themeInit = readFileSync(resolve(root, 'extension/theme-init.js'), 'utf8');
  const glassCss = readFileSync(resolve(root, 'extension/glass.css'), 'utf8');
  const dashboardCss = readFileSync(resolve(root, 'extension/style.css'), 'utf8');
  const bookmarksCss = readFileSync(resolve(root, 'extension/bookmarks.css'), 'utf8');
  const searchEngineCss = readFileSync(resolve(root, 'extension/search-engines.css'), 'utf8');

  assert.match(index, /id="backgroundStage"/);
  assert.equal(index.includes('id="liquidEther"'), false);
  assert.match(index, /href="backgrounds\/backgrounds\.css"/);
  assert.deepEqual(
    [...index.matchAll(/data-background-id="([^"]+)"/g)].map(match => match[1]),
    ['mountain', 'liquid-ether', 'light-rays', 'prism', 'static'],
  );
  assert.deepEqual(
    [...registry.matchAll(/\n\s+id: "([^"]+)"/g)].map(match => match[1]),
    ['mountain', 'liquid-ether', 'light-rays', 'prism', 'static'],
  );
  assert.match(registry, /DEFAULT_BACKGROUND_ID = "mountain"/);
  assert.match(registry, /getBackgroundDefinition\(id\)\?\.id \|\| DEFAULT_BACKGROUND_ID/);
  assert.match(effects, /createBackgroundController/);
  assert.equal(effects.includes('mountLiquidEther'), false);
  assert.match(controller, /activeBackground\.dispose\(\);[\s\S]{0,160}container\.replaceChildren\(\);/);
  assert.match(controller, /Falling back to mountain/);
  assert.match(controller, /WallpaperService\.getWallpaper\(id\)/);
  assert.match(controller, /URL\.createObjectURL\(record\.blob\)/);
  assert.equal(controller.includes('container.replaceChildren(layer)'), false);
  assert.ok(controller.indexOf('await image.decode()') < controller.indexOf('container.replaceChildren(mounted.element)'));
  assert.match(controller, /window\.addEventListener\("storage", onStorage\)/);
  assert.match(controller, /localStorage\.setItem\(BACKGROUND_STORAGE_KEY, id\)/);
  assert.match(controller, /event\.key === "ArrowRight"/);
  assert.match(themeInit, /localStorage\.getItem\('tab-out-background'\)/);
  assert.match(themeInit, /dataset\.background = 'mountain'/);
  assert.match(themeInit, /background\.indexOf\('user:'\) === 0/);
  assert.match(index, /id="userWallpaperInput"[^>]+accept="image\/jpeg,image\/png,image\/webp/);
  assert.match(index, /id="userWallpaperGrid"[^>]+role="radiogroup"/);
  assert.match(index, /id="wallpaperEditorDialog"/);
  assert.match(index, /id="wallpaperDeleteDialog"/);
  assert.match(index, /services\/wallpaper-service\.js[\s\S]+wallpaper-ui\.js[\s\S]+effects\.mjs/);
  assert.equal(manifest.permissions?.includes('unlimitedStorage'), false);
  assert.match(index, /id="cardOpacityRange"[^>]+min="40"[^>]+max="100"[^>]+value="60"/);
  assert.match(themeInit, /localStorage\.getItem\('tab-out-card-opacity'\)/);
  assert.match(themeInit, /style\.setProperty\('--content-card-opacity'/);
  assert.match(glassCss, /--content-card-opacity:\s*60%;/);
  assert.match(glassCss, /--content-card-surface:\s*color-mix\(in srgb, var\(--card-bg\) var\(--content-card-opacity\), transparent\);/);
  assert.match(glassCss, /\.mission-card,[\s\S]*?background:\s*var\(--content-card-surface\);/);
  assert.match(glassCss, /\.mission-card,[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(glassCss, /\.deferred-column,[\s\S]*?background:\s*var\(--content-card-surface\);[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(bookmarksCss, /--bookmark-readable-surface:\s*var\(--content-card-surface\);/);
  assert.match(bookmarksCss, /\.bookmark-search\s*\{[\s\S]*?background:\s*var\(--content-card-surface\);/);
  assert.match(searchEngineCss, /\.app-search-slot \.open-tabs-search-wrap,[\s\S]*?background:\s*var\(--content-card-surface\);[\s\S]*?backdrop-filter:\s*none;/);
  assert.match(dashboardCss, /\.card-opacity-control input\[type="range"\]/);
  assert.match(themeInit, /dataset\.defaultWorkspace = 'tabs'/);
  assert.match(themeInit, /localStorage\.getItem\('tab-out-default-workspace'\)/);
  assert.match(lightRays, /prefers-reduced-motion: reduce/);
  assert.match(lightRays, /visibilitychange/);
  assert.match(lightRays, /renderer\.forceContextLoss\(\)/);
  assert.match(prism, /const int STEPS = 72/);
  assert.match(prism, /prefers-reduced-motion: reduce/);
  assert.match(prism, /framesPerSecond = 30/);
  assert.match(prism, /renderer\.forceContextLoss\(\)/);
  assert.match(backgroundCss, /\.background-option:focus-visible/);
  assert.match(backgroundCss, /url\("\.\/mountain-default\.jpg"\)/);
  assert.match(backgroundCss, /\.user-wallpaper-layer\.is-ready/);
  assert.match(backgroundCss, /\.wallpaper-delete-dialog\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?inset:\s*0;[\s\S]*?margin:\s*auto;/);
  assert.match(backgroundCss, /prefers-reduced-motion: reduce[\s\S]+\.user-wallpaper-layer/);
}

function testWallpaperServiceContract() {
  assert.equal(wallpapers.MAX_WALLPAPERS, 10);
  assert.equal(wallpapers.MAX_SOURCE_BYTES, 20 * 1024 * 1024);
  assert.equal(wallpapers.MAX_STORED_BYTES, 8 * 1024 * 1024);
  assert.equal(wallpapers.MAX_LONG_EDGE, 3840);
  assert.equal(wallpapers.isWallpaperId('user:test-id'), true);
  assert.equal(wallpapers.isWallpaperId('mountain'), false);
  assert.equal(wallpapers.detectImageType(Uint8Array.from([0xff, 0xd8, 0xff])), 'image/jpeg');
  assert.equal(wallpapers.detectImageType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
  assert.equal(wallpapers.detectImageType(Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ])), 'image/webp');
  assert.equal(wallpapers.isAnimatedImage(Uint8Array.from([...Buffer.from('RIFFxxxxWEBPANIM')]), 'image/webp'), true);
  assert.equal(wallpapers.isAnimatedImage(Uint8Array.from([...Buffer.from('PNG acTL')]), 'image/png'), true);
  assert.deepEqual(wallpapers.ACCEPTED_TYPES, ['image/jpeg', 'image/png', 'image/webp']);

  const source = readFileSync(resolve(root, 'extension/services/wallpaper-service.js'), 'utf8');
  const ui = readFileSync(resolve(root, 'extension/wallpaper-ui.js'), 'utf8');
  assert.match(source, /indexedDB\.open\(DB_NAME, DB_VERSION\)/);
  assert.match(source, /database\.transaction\(STORE_NAME, 'readwrite'\)/);
  assert.match(source, /currentCount \+ records\.length > MAX_WALLPAPERS/);
  assert.match(source, /navigator\.storage\.persist/);
  assert.match(source, /shouldOptimize[\s\S]+MAX_STORED_BYTES[\s\S]+MAX_LONG_EDGE/);
  assert.match(source, /shouldCancel\?\.\(\)/);
  assert.match(ui, /files\.length > remaining/);
  assert.match(ui, /Wallpapers\.updateWallpaper/);
  assert.match(ui, /Wallpapers\.deleteWallpaper/);
  assert.match(ui, /super-tab-out:background-error/);
  assert.match(ui, /pointerdown/);
}

async function testBackgroundBookmarkCapture() {
  const source = readFileSync(resolve(root, 'extension/background.js'), 'utf8');
  const sessionStore = {};
  const createdTabs = [];
  const updatedTabs = [];
  let dashboardTabs = [];
  let actionListener = null;
  let commandListener = null;
  let messageListener = null;
  const event = listenerSink => ({ addListener(listener) { listenerSink(listener); } });
  const chromeMock = {
    action: {
      onClicked: event(listener => { actionListener = listener; }),
      async setBadgeText() {},
      async setBadgeBackgroundColor() {},
    },
    commands: { onCommand: event(listener => { commandListener = listener; }) },
    omnibox: {
      onInputChanged: event(() => {}),
      onInputEntered: event(() => {}),
      setDefaultSuggestion() {},
    },
    runtime: {
      id: 'test-extension',
      getURL(path = '') { return `chrome-extension://test-extension/${path}`; },
      onInstalled: event(() => {}),
      onStartup: event(() => {}),
      onMessage: event(listener => { messageListener = listener; }),
      async sendMessage() {},
    },
    sidePanel: { async setPanelBehavior() {} },
    storage: {
      session: {
        async get(key) { return { [key]: sessionStore[key] }; },
        async set(values) { Object.assign(sessionStore, values); },
        async remove(key) { delete sessionStore[key]; },
      },
    },
    tabs: {
      async query(query) {
        if (query?.active) return [{ id: 7, url: 'https://example.com/current', title: 'Current page', windowId: 1 }];
        if (query?.windowId === 1) return dashboardTabs;
        return [];
      },
      async create(options) { createdTabs.push(options); return { id: createdTabs.length + 10, ...options }; },
      async update(tabId, options) { updatedTabs.push({ tabId, options }); return { id: tabId, ...options }; },
      onCreated: event(() => {}),
      onRemoved: event(() => {}),
      onUpdated: event(() => {}),
    },
  };
  const serviceSelf = {
    SuperTabOutUrls: {},
    SuperTabOutStorage: {},
    SuperTabOutTabs: {
      isDashboardTab(tab) {
        return tab?.url === 'chrome://newtab/' || String(tab?.url || '').startsWith('chrome-extension://test-extension/index.html');
      },
    },
    SuperTabOutSearch: {},
  };
  runInNewContext(source, {
    chrome: chromeMock,
    self: serviceSelf,
    importScripts() {},
    URL,
    crypto,
    Date,
    Math,
    console,
    setTimeout,
    clearTimeout,
  }, { filename: 'background.js' });

  assert.equal(typeof actionListener, 'function');
  assert.equal(typeof commandListener, 'function');
  assert.equal(typeof messageListener, 'function');
  await actionListener({ id: 7, url: 'https://example.com/current', title: 'Current page', windowId: 1 });
  assert.equal(createdTabs[0].url, 'chrome-extension://test-extension/index.html');
  assert.equal(createdTabs[0].windowId, 1);
  assert.equal(Object.keys(sessionStore).length, 0);

  dashboardTabs = [{ id: 42, url: 'chrome-extension://test-extension/index.html', windowId: 1 }];
  await actionListener({ id: 7, url: 'https://example.com/current', title: 'Current page', windowId: 1 });
  assert.equal(createdTabs.length, 1);
  assert.equal(updatedTabs[0].tabId, 42);
  assert.equal(updatedTabs[0].options.active, true);

  await commandListener('bookmark-current-page', { id: 7, url: 'https://example.com/current', title: 'Current page', windowId: 1 });
  const firstKey = Object.keys(sessionStore)[0];
  assert.match(firstKey, /^bookmarkCapture:/);
  assert.deepEqual({
    url: sessionStore[firstKey].url,
    title: sessionStore[firstKey].title,
    supported: sessionStore[firstKey].supported,
  }, { url: 'https://example.com/current', title: 'Current page', supported: true });
  assert.match(createdTabs[1].url, /index\.html\?bookmarkCapture=/);
  assert.equal(createdTabs[1].url.includes('example.com'), false);

  const token = firstKey.slice('bookmarkCapture:'.length);
  const consumed = await new Promise(resolve => {
    const asyncResponse = messageListener(
      { type: 'consume-bookmark-capture', token },
      { url: 'chrome-extension://test-extension/index.html?bookmarkCapture=test' },
      resolve,
    );
    assert.equal(asyncResponse, true);
  });
  assert.equal(consumed.ok, true);
  assert.equal(consumed.draft.url, 'https://example.com/current');
  assert.equal(Object.keys(sessionStore).length, 0);

  await commandListener('bookmark-current-page', { id: 8, url: 'https://example.org/shortcut', title: 'Shortcut page', windowId: 1 });
  assert.equal(createdTabs.length, 3);
  assert.equal(Object.values(sessionStore)[0].title, 'Shortcut page');
}

function testUrlService() {
  assert.equal(urls.isRestorableUrl('https://a.test'), true);
  assert.equal(urls.isRestorableUrl('http://a.test'), true);
  assert.equal(urls.isRestorableUrl('file:///Users/a.txt'), true);
  assert.equal(urls.normalizeRestorableUrl('https://a.test'), 'https://a.test/');
  assert.equal(urls.normalizeRestorableUrl('file:///Users/a.txt'), 'file:///Users/a.txt');

  for (const unsafeUrl of ['javascript:alert(1)', 'data:text/html,hi', 'chrome://extensions', 'about:blank', '', 'not a url']) {
    assert.equal(urls.isRestorableUrl(unsafeUrl), false, unsafeUrl);
    assert.equal(urls.normalizeRestorableUrl(unsafeUrl), '', unsafeUrl);
  }
}

async function testTabsService() {
  assert.equal(tabs.isRealTab({ url: 'https://example.com', pinned: false }, 'ext'), true);
  assert.equal(tabs.isRealTab({ url: 'chrome://extensions', pinned: false }, 'ext'), false);
  assert.equal(tabs.isRealTab({ url: 'https://example.com', pinned: true }, 'ext'), false);

  const ids = tabs.exactUnpinnedIdsForUrls([
    { id: 1, url: 'https://a.test', pinned: false },
    { id: 2, url: 'https://a.test', pinned: true },
    { id: 3, url: 'https://b.test', pinned: false },
  ], ['https://a.test']);
  assert.deepEqual(ids, [1]);

  const domainGroups = [
    { domain: 'a.test', label: 'Alpha', firstTabPosition: 4, tabs: [{}, {}, {}] },
    { domain: 'b.test', label: 'Beta', firstTabPosition: 1, tabs: [{}] },
    { domain: 'c.test', label: 'Charlie', firstTabPosition: 7, tabs: [{}, {}] },
  ];
  assert.deepEqual(
    tabs.reconcileDomainCardOrder(['b.test', 'a.test'], ['a.test', 'b.test', 'c.test']),
    ['b.test', 'a.test', 'c.test']
  );
  assert.deepEqual(
    tabs.reorderDomainCardOrder(
      ['hidden.test', 'a.test', 'b.test', 'c.test'],
      ['a.test', 'b.test', 'c.test'],
      'a.test',
      'c.test',
      'after'
    ),
    ['hidden.test', 'b.test', 'c.test', 'a.test']
  );
  assert.deepEqual(
    tabs.sortDomainGroups(domainGroups, { sortMode: 'stable', order: ['b.test', 'a.test', 'c.test'], pinned: [] }).map(group => group.domain),
    ['b.test', 'a.test', 'c.test']
  );
  assert.deepEqual(
    tabs.sortDomainGroups(domainGroups, { sortMode: 'stable', order: ['b.test', 'a.test', 'c.test'], pinned: ['c.test'] }).map(group => group.domain),
    ['c.test', 'b.test', 'a.test']
  );
  assert.deepEqual(
    tabs.sortDomainGroups(domainGroups, { sortMode: 'count', order: ['b.test', 'a.test', 'c.test'] }).map(group => group.domain),
    ['a.test', 'c.test', 'b.test']
  );
  assert.deepEqual(
    tabs.sortDomainGroups(domainGroups, { sortMode: 'chrome', order: [] }).map(group => group.domain),
    ['b.test', 'a.test', 'c.test']
  );
  assert.deepEqual(
    tabs.sortDomainGroups(domainGroups, { sortMode: 'name', order: [] }).map(group => group.domain),
    ['a.test', 'b.test', 'c.test']
  );

  const removed = [];
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://a.test', active: false, pinned: false },
          { id: 2, url: 'https://a.test', active: true, pinned: false },
          { id: 3, url: 'https://a.test', active: false, pinned: true },
        ];
      },
      async remove(idsToRemove) {
        removed.push(...idsToRemove);
      },
    },
  };

  await tabs.closeDuplicateTabs(['https://a.test'], true);
  assert.deepEqual(removed, [1]);

  removed.length = 0;
  await tabs.closeTabsByIds([2, 3]);
  assert.deepEqual(removed, [2]);

  removed.length = 0;
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async query() {
        return [
          { id: 1, url: 'https://a.test', active: true, pinned: true },
          { id: 2, url: 'https://a.test', active: false, pinned: false },
          { id: 3, url: 'https://a.test', active: false, pinned: false },
        ];
      },
      async remove(idsToRemove) {
        removed.push(...idsToRemove);
      },
    },
  };

  await tabs.closeDuplicateTabs(['https://a.test'], true);
  assert.deepEqual(removed, [3]);

  const bulkRemoved = [];
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async query() {
        return [
          { id: 11, url: 'https://a.test/path', title: 'A', windowId: 1, index: 2, groupId: 8, active: true, pinned: false },
          { id: 12, url: 'https://pinned.test', title: 'Pinned', windowId: 1, index: 0, groupId: -1, pinned: true },
          { id: 13, url: 'chrome://settings/', title: 'Settings', windowId: 1, index: 1, groupId: -1, pinned: false },
          { id: 14, url: 'chrome-extension://ext/index.html', title: 'BrowseLoom', windowId: 1, index: 3, groupId: -1, pinned: false },
          { id: 15, url: 'https://gone.test', title: 'Gone', windowId: 2, index: 0, groupId: -1, pinned: false },
        ];
      },
      async remove(tabId) {
        if (tabId === 15) throw new Error('already gone');
        bulkRemoved.push(tabId);
      },
    },
    tabGroups: {
      async query() { return [{ id: 8, title: 'Research', color: 'blue', collapsed: true }]; },
    },
  };

  const bulkPlan = await tabs.prepareBulkClose([11, 12, 13, 14, 15]);
  assert.equal(bulkPlan.count, 2);
  assert.equal(bulkPlan.protectedPinned, 1);
  assert.equal(bulkPlan.protectedInternal, 2);
  assert.deepEqual(bulkPlan.snapshot.tabs[0], {
    id: 11,
    url: 'https://a.test/path',
    title: 'A',
    windowId: 1,
    index: 2,
    active: true,
    pinned: false,
    incognito: false,
    groupId: 8,
    groupKey: '1:8',
    groupTitle: 'Research',
    groupColor: 'blue',
    groupCollapsed: true,
  });
  assert.equal((await tabs.prepareBulkClose([14], { allowDashboard: true })).count, 1);
  const bulkClose = await tabs.closeTabsWithSnapshot([11, 12, 13, 15]);
  assert.deepEqual(bulkRemoved, [11]);
  assert.equal(bulkClose.closedCount, 1);
  assert.equal(bulkClose.failedCount, 1);
  assert.deepEqual(bulkClose.snapshot.tabs.map(tab => tab.id), [11]);

  const restoredTabCreates = [];
  const restoredWindowCreates = [];
  const restoredGroups = [];
  const restoredGroupUpdates = [];
  const restoredActivations = [];
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async get(windowId) {
        if (windowId === 1) return { id: 1 };
        throw new Error('window gone');
      },
      async create(options) {
        restoredWindowCreates.push(options);
        return { id: 20, tabs: [{ id: 201, index: 0, url: options.url }] };
      },
    },
    tabs: {
      async query() { return []; },
      async create(options) {
        restoredTabCreates.push(options);
        return { id: 101 + restoredTabCreates.length, index: options.index, url: options.url };
      },
      async group(options) {
        restoredGroups.push(options.tabIds);
        return 30 + restoredGroups.length;
      },
      async update(tabId, update) {
        restoredActivations.push({ tabId, update });
      },
    },
    tabGroups: {
      async update(groupId, update) {
        restoredGroupUpdates.push({ groupId, update });
      },
    },
  };
  const restoreResult = await tabs.restoreClosedTabs({
    version: 1,
    tabs: [
      { id: 11, url: 'https://a.test/one', title: 'One', windowId: 1, index: 1, active: true, pinned: false, groupKey: '1:8', groupTitle: 'Research', groupColor: 'blue', groupCollapsed: true },
      { id: 16, url: 'https://a.test/two', title: 'Two', windowId: 1, index: 2, active: false, pinned: false, groupKey: '1:8', groupTitle: 'Research', groupColor: 'blue', groupCollapsed: true },
      { id: 17, url: 'https://b.test/', title: 'B', windowId: 2, index: 0, active: false, pinned: false, groupKey: '', incognito: false },
    ],
  });
  assert.equal(restoreResult.restoredCount, 3);
  assert.equal(restoreResult.failedCount, 0);
  assert.equal(restoreResult.groupCount, 1);
  assert.equal(restoreResult.groupFailedCount, 0);
  assert.deepEqual(restoredTabCreates.map(item => ({ url: item.url, windowId: item.windowId, index: item.index })), [
    { url: 'https://a.test/one', windowId: 1, index: 1 },
    { url: 'https://a.test/two', windowId: 1, index: 2 },
  ]);
  assert.deepEqual(restoredWindowCreates, [{ url: 'https://b.test/', focused: false }]);
  assert.deepEqual(restoredGroups, [[102, 103]]);
  assert.deepEqual(restoredGroupUpdates, [{ groupId: 31, update: { title: 'Research', color: 'blue', collapsed: true } }]);
  assert.deepEqual(restoredActivations, [{ tabId: 102, update: { active: true } }]);

  const focusedTabs = [];
  const focusedWindows = [];
  global.chrome = {
    runtime: { id: 'ext' },
    tabs: {
      async get(tabId) {
        return { id: tabId, windowId: 9, url: 'https://a.test' };
      },
      async update(tabId, update) {
        focusedTabs.push({ tabId, update });
      },
    },
    windows: {
      async update(windowId, update) {
        focusedWindows.push({ windowId, update });
      },
    },
  };

  assert.equal((await tabs.focusTabById(7))?.id, 7);
  assert.deepEqual(focusedTabs, [{ tabId: 7, update: { active: true } }]);
  assert.deepEqual(focusedWindows, [{ windowId: 9, update: { focused: true } }]);
  assert.equal(await tabs.focusTabById(''), null);

  const quickReturnStorage = makeFakeStorage();
  const dashboardTab = { id: 5, windowId: 2, url: 'chrome://newtab/' };
  const extensionDashboardTab = { id: 6, windowId: 2, url: 'chrome-extension://ext/index.html' };
  const targetTab = { id: 7, windowId: 9, url: 'https://a.test' };
  const quickReturnFocuses = [];
  global.chrome = {
    runtime: { id: 'ext' },
    storage: { session: quickReturnStorage },
    tabs: {
      async getCurrent() {
        return dashboardTab;
      },
      async get(tabId) {
        return [dashboardTab, targetTab].find(tab => tab.id === tabId) || null;
      },
      async query(options) {
        if (options?.active) return [targetTab];
        return [dashboardTab, targetTab];
      },
      async update(tabId, update) {
        quickReturnFocuses.push({ tabId, update });
      },
    },
    windows: {
      async update(windowId, update) {
        quickReturnFocuses.push({ windowId, update });
      },
    },
  };

  assert.equal(tabs.isDashboardTab(dashboardTab, 'ext'), true);
  assert.equal(tabs.isDashboardTab(extensionDashboardTab, 'ext'), true);
  assert.equal(tabs.isDashboardTab(targetTab, 'ext'), false);
  assert.equal((await tabs.focusTabWithQuickReturn(targetTab.id))?.id, targetTab.id);
  assert.deepEqual(await tabs.getQuickReturnRoute(), {
    dashboardTabId: dashboardTab.id,
    dashboardWindowId: dashboardTab.windowId,
    targetTabId: targetTab.id,
    targetWindowId: targetTab.windowId,
  });

  quickReturnFocuses.length = 0;
  const returned = await tabs.toggleQuickReturn(targetTab);
  assert.equal(returned.direction, 'dashboard');
  assert.deepEqual(quickReturnFocuses, [
    { tabId: dashboardTab.id, update: { active: true } },
    { windowId: dashboardTab.windowId, update: { focused: true } },
  ]);

  quickReturnFocuses.length = 0;
  const revisited = await tabs.toggleQuickReturn(dashboardTab);
  assert.equal(revisited.direction, 'target');
  assert.deepEqual(quickReturnFocuses, [
    { tabId: targetTab.id, update: { active: true } },
    { windowId: targetTab.windowId, update: { focused: true } },
  ]);

  quickReturnFocuses.length = 0;
  global.chrome.tabs.query = async options => options?.active ? [dashboardTab] : [dashboardTab];
  const missingTarget = await tabs.toggleQuickReturn(dashboardTab);
  assert.equal(missingTarget.direction, 'none');
  assert.deepEqual(quickReturnFocuses, []);

  const replacementDashboard = { id: 11, windowId: targetTab.windowId, url: 'chrome-extension://ext/index.html' };
  const createdDashboardOptions = [];
  global.chrome.tabs.query = async options => options?.active ? [targetTab] : [targetTab];
  global.chrome.tabs.create = async options => {
    createdDashboardOptions.push(options);
    return replacementDashboard;
  };
  global.chrome.tabs.get = async tabId => [replacementDashboard, targetTab].find(tab => tab.id === tabId) || null;
  const recreated = await tabs.toggleQuickReturn(targetTab);
  assert.equal(recreated.direction, 'dashboard');
  assert.deepEqual(createdDashboardOptions, [{
    url: 'chrome-extension://ext/index.html',
    active: false,
    windowId: targetTab.windowId,
  }]);

  assert.deepEqual(tabs.normalizeSessionRestoreTabs({
    tabs: [
      { url: 'https://w1-0.test', windowId: 1, index: 0 },
      { url: 'javascript:alert(1)', windowId: 1, index: 99 },
      { url: 'https://w1-1.test', windowId: 1, index: 1 },
      { url: 'data:text/html,hi', windowId: 2, index: 99 },
      { url: 'https://w2-0.test', windowId: 2, index: 0 },
      { url: 'https://w2-1.test', windowId: 2, index: 1 },
    ],
  }).map(tab => tab.url), [
    'https://w1-0.test/',
    'https://w1-1.test/',
    'https://w2-0.test/',
    'https://w2-1.test/',
  ]);

  const createdWindows = [];
  const groupedTabSets = [];
  const updatedGroups = [];
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async create(options) {
        createdWindows.push(options);
        return {
          id: 7,
          tabs: options.url.map((url, index) => ({ id: index + 10, url, index })),
        };
      },
    },
    tabs: {
      async query() {
        return [
          { id: 10, url: 'https://docs.test/a', index: 0 },
          { id: 11, url: 'https://docs.test/b', index: 1 },
        ];
      },
      async group(options) {
        groupedTabSets.push(options.tabIds);
        return 21;
      },
    },
    tabGroups: {
      async update(groupId, update) {
        updatedGroups.push({ groupId, update });
      },
    },
  };

  const restored = await tabs.restoreSavedSession({
    group: 'Research',
    groupColor: 'blue',
    tabs: [
      { url: 'https://docs.test/a', title: 'A', index: 0, groupTitle: 'Research', groupColor: 'blue' },
      { url: 'https://docs.test/b', title: 'B', index: 1, groupTitle: 'Research', groupColor: 'blue' },
    ],
  }, { mode: 'originalWindows' });
  assert.deepEqual(createdWindows[0].url, ['https://docs.test/a', 'https://docs.test/b']);
  assert.deepEqual(groupedTabSets, [[10, 11]]);
  assert.deepEqual(updatedGroups, [{ groupId: 21, update: { title: 'Research', color: 'blue' } }]);
  assert.deepEqual(restored.groupIds, [21]);

  const createdTabs = [];
  const groupedCurrentWindowTabSets = [];
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async update() {},
    },
    tabs: {
      async query() {
        return [{ id: 5, url: 'chrome-extension://ext/index.html', active: true, index: 2 }];
      },
      async create(options) {
        const tab = { id: 30 + createdTabs.length, url: options.url, index: options.index };
        createdTabs.push(options);
        return tab;
      },
      async group(options) {
        groupedCurrentWindowTabSets.push(options.tabIds);
        return 31;
      },
    },
    tabGroups: {
      async update() {},
    },
  };

  await tabs.restoreSavedSession({
    group: 'Build',
    tabs: [
      { url: 'https://repo.test/issues', groupTitle: 'Build' },
      { url: 'https://repo.test/pulls', groupTitle: 'Build' },
    ],
  }, { windowId: 9, focused: false });
  assert.deepEqual(createdTabs.map(tab => ({ windowId: tab.windowId, active: tab.active, index: tab.index })), [
    { windowId: 9, active: false, index: 3 },
    { windowId: 9, active: false, index: 4 },
  ]);
  assert.deepEqual(groupedCurrentWindowTabSets, [[30, 31]]);

  const multiWindowCreates = [];
  const multiWindowGroups = [];
  let nextRestoredTabId = 100;
  global.chrome = {
    runtime: { id: 'ext' },
    windows: {
      async create(options) {
        const windowId = 20 + multiWindowCreates.length;
        multiWindowCreates.push(options);
        return {
          id: windowId,
          tabs: options.url.map((url, index) => ({ id: nextRestoredTabId++, url, index })),
        };
      },
    },
    tabs: {
      async query() { return []; },
      async group(options) {
        multiWindowGroups.push(options.tabIds);
        return 40 + multiWindowGroups.length;
      },
    },
    tabGroups: { async update() {} },
  };
  const multiWindowRestore = await tabs.restoreSavedSession({
    windows: [
      { tabs: [{ url: 'https://one.window.test', groupKey: 'group-1', groupTitle: 'One' }] },
      { tabs: [{ url: 'https://two.window.test', groupKey: 'group-1', groupTitle: 'Two' }] },
    ],
  }, { mode: 'originalWindows', focused: true });
  assert.deepEqual(multiWindowCreates.map(options => options.url), [
    ['https://one.window.test/'],
    ['https://two.window.test/'],
  ]);
  assert.deepEqual(multiWindowGroups, [[100], [101]]);
  assert.equal(multiWindowRestore.windows.length, 2);
}

async function testStorageService() {
  const fakeStorage = makeFakeStorage({
    deferred: [
      { url: 'https://a.test', title: 'A' },
      { url: 'javascript:alert(1)', title: 'Bad' },
      { url: 'file:///Users/local-note.txt', title: 'Local note' },
      { url: 'https://dismissed.test', title: 'Dismissed', dismissed: true },
      { title: 'Missing URL' },
    ],
    viewMode: 'bad',
    privacySettings: { clock: false, mottoText: 'Focus' },
    savedSessions: [
      {
        id: 'session-1',
        name: 'MV3 research',
        group: 'Extensions',
        groupColor: 'cyan',
        tabs: [
          {
            title: 'Side Panel',
            url: 'https://developer.chrome.com/docs/extensions',
            windowId: 1,
            index: 3,
            groupTitle: 'Extensions',
            groupColor: 'cyan',
          },
          {
            title: 'Unsafe',
            url: 'javascript:alert(1)',
            windowId: 1,
            index: 4,
          },
          {
            title: 'Local notes',
            url: 'file:///Users/local-notes.md',
            windowId: 1,
            index: 5,
            groupTitle: 'Extensions',
            groupColor: 'cyan',
          },
        ],
      },
    ],
  });

  global.chrome = { storage: { local: fakeStorage } };
  const migration = await storage.migrateStorage();
  assert.equal(migration.changed, true);
  assert.equal(fakeStorage.store.storageSchemaVersion, storage.CURRENT_SCHEMA_VERSION);
  assert.equal(fakeStorage.store.deferred.length, 2);
  assert.equal(fakeStorage.store.savedSessions.length, 1);
  assert.equal(fakeStorage.store.viewMode, 'group');
  assert.deepEqual(fakeStorage.store.domainCardPreferences, {
    sortMode: 'stable',
    order: [],
    pinned: [],
  });
  assert.deepEqual(fakeStorage.store.privacySettings, {
    clock: false,
    date: true,
    motto: true,
    mottoText: 'Focus',
    externalFavicons: false,
  });
  assert.equal(storage.normalizePrivacySettings({}).externalFavicons, false);
  assert.equal(storage.normalizePrivacySettings({ externalFavicons: true }).externalFavicons, true);
  assert.equal(fakeStorage.store.bookmarkLibrary.version, 3);
  assert.equal(fakeStorage.store.bookmarkLibrary.viewMode, 'grid');
  assert.deepEqual(fakeStorage.store.bookmarkLibrary.categories.map(({ id, name, icon, system, order, itemOrder }) => ({ id, name, icon, system, order, itemOrder })), [
    { id: 'category-home', name: 'Home', icon: 'home', system: 'home', order: 0, itemOrder: [] },
    { id: 'category-unfiled', name: 'Unfiled', icon: 'archive', system: 'unfiled', order: 1, itemOrder: [] },
  ]);
  assert.deepEqual(fakeStorage.store.bookmarkLibrary.folders, []);
  assert.deepEqual(fakeStorage.store.bookmarkLibrary.bookmarks, []);
  assert.equal(storage.BOOKMARK_FOLDER_ICON_IDS.length, 24);
  const normalizedIcons = storage.normalizeBookmarkLibrary({
    version: 1,
    folders: [
      { id: 'ai', name: 'AI 工具', icon: 'invalid', pinnedToHome: false },
      { id: 'design', name: '设计', icon: 'palette', pinnedToHome: false },
    ],
  });
  assert.equal(normalizedIcons.version, 3);
  assert.equal(normalizedIcons.categories.find(category => category.id === 'ai').icon, 'sparkles');
  assert.equal(normalizedIcons.categories.find(category => category.id === 'design').icon, 'palette');
  assert.equal(normalizedIcons.folders.length, 0);
  const migratedMixedLibrary = storage.normalizeBookmarkLibrary({
    version: 2,
    viewMode: 'list',
    folders: [
      { id: 'work', name: '工作', icon: 'briefcase', pinnedToHome: false },
      { id: 'links', name: '常用', icon: 'folder', pinnedToHome: true, layout: '2x1' },
    ],
    bookmarks: [
      { id: 'root-work', title: '工作台', url: 'https://work.test', folderId: 'work', pinnedToHome: false },
      { id: 'inside-links', title: '链接', url: 'https://links.test', folderId: 'links', pinnedToHome: true },
      { id: 'loose', title: '散落', url: 'https://loose.test', pinnedToHome: false },
    ],
    homeOrder: ['folder:links'],
  });
  assert.equal(migratedMixedLibrary.bookmarks.length, 3);
  assert.equal(migratedMixedLibrary.bookmarks.find(item => item.id === 'root-work').categoryId, 'work');
  assert.equal(migratedMixedLibrary.bookmarks.find(item => item.id === 'root-work').folderId, null);
  assert.equal(migratedMixedLibrary.bookmarks.find(item => item.id === 'inside-links').folderId, 'links');
  assert.equal(migratedMixedLibrary.bookmarks.find(item => item.id === 'loose').categoryId, storage.UNFILED_CATEGORY_ID);
  assert.deepEqual(migratedMixedLibrary.categories.find(item => item.id === storage.HOME_CATEGORY_ID).itemOrder, ['folder:links']);

  await storage.addDeferredTab({ url: 'https://b.test', title: 'B' });
  assert.equal(await storage.addDeferredTab({ url: 'data:text/html,hi', title: 'Bad' }), false);
  const saved = await storage.getSavedTabs();
  assert.equal(saved.active.length, 3);
  assert.equal(saved.active.some(tab => tab.url === 'file:///Users/local-note.txt'), true);
  assert.equal(saved.active.some(tab => tab.url.startsWith('javascript:')), false);
  const removable = saved.active.find(tab => tab.url === 'https://b.test/');
  const removed = await storage.removeDeferredTab(removable.id);
  assert.equal(removed.id, removable.id);
  assert.equal((await storage.getDeferred()).some(tab => tab.id === removable.id), false);
  assert.equal(await storage.restoreDeferredTabs([removed]), 1);
  assert.equal((await storage.getDeferred()).some(tab => tab.id === removable.id), true);
  await storage.updateDeferredTab(saved.active[0].id, { completed: true, completedAt: '2026-04-30T00:00:00.000Z' });
  const afterUpdate = await storage.getSavedTabs();
  assert.equal(afterUpdate.archived.length, 1);
  assert.equal(await storage.clearArchivedDeferredTabs(), 1);
  const afterArchiveClear = await storage.getSavedTabs();
  assert.equal(afterArchiveClear.archived.length, 0);
  assert.equal(afterArchiveClear.active.length, 2);
  const storedSession = (await storage.getSavedSessions())[0];
  assert.equal(storedSession.name, 'MV3 research');
  assert.equal(storedSession.groupColor, 'cyan');
  assert.equal(storedSession.windows.length, 1);
  assert.equal(storedSession.windows[0].tabs[0].groupColor, 'cyan');
  assert.equal(storedSession.windows[0].tabs[0].index, 0);
  assert.equal(storedSession.windows[0].tabs.length, 2);
  assert.equal(storedSession.windows[0].tabs.some(tab => tab.url === 'file:///Users/local-notes.md'), true);
  assert.equal(storedSession.windows[0].tabs.some(tab => tab.url.startsWith('javascript:')), false);
  await storage.addSavedSession({ name: 'Focus set', windows: [{ tabs: [{ url: 'https://focus.test' }] }] });
  assert.equal((await storage.getSavedSessions())[0].name, 'Focus set');
  assert.equal(await storage.addSavedSession({ name: 'Unsafe set', windows: [{ tabs: [{ url: 'chrome://extensions' }] }] }), false);
  assert.equal(await storage.removeSavedSession('session-1'), true);
  assert.equal((await storage.getSavedSessions()).some(session => session.id === 'session-1'), false);
  const stats = await storage.recordActivity({ type: 'closed', count: 3, domain: 'example.com' });
  assert.equal(stats.closedTotal, 3);
  assert.equal(stats.domains['example.com'], 3);
  await storage.setDomainCardPreferences({
    sortMode: 'count',
    order: ['b.test', 'a.test', 'b.test', ''],
    pinned: ['a.test', 'a.test'],
  });
  assert.deepEqual(await storage.getDomainCardPreferences(), {
    sortMode: 'count',
    order: ['b.test', 'a.test'],
    pinned: ['a.test'],
  });
  const defaultSearchSettings = await storage.getSearchSettings();
  assert.equal(defaultSearchSettings.defaultEngineId, 'google');
  assert.equal(defaultSearchSettings.version, 1);
  const schemaBeforeSearchSettings = fakeStorage.store.storageSchemaVersion;
  const savedSearchSettings = await storage.setSearchSettings({
    ...defaultSearchSettings,
    defaultEngineId: 'bing',
    customEngines: [{
      id: 'custom:12345678',
      name: 'Docs',
      searchUrlTemplate: 'https://docs.test/search?q=%s',
      color: '#123456',
    }],
    enabledEngineIds: [...defaultSearchSettings.enabledEngineIds, 'custom:12345678'],
    engineOrder: [...defaultSearchSettings.engineOrder, 'custom:12345678'],
  });
  assert.equal(savedSearchSettings.defaultEngineId, 'bing');
  assert.equal(savedSearchSettings.customEngines.length, 1);
  assert.equal(fakeStorage.store.storageSchemaVersion, schemaBeforeSearchSettings);

  const legacyBookmarkStorage = makeFakeStorage({
    storageSchemaVersion: 4,
    bookmarkLibrary: {
      version: 1,
      folders: [{ id: 'shopping', name: '购物', pinnedToHome: false }],
      bookmarks: [],
      homeOrder: [],
    },
  });
  global.chrome = { storage: { local: legacyBookmarkStorage } };
  const bookmarkMigration = await storage.migrateStorage();
  assert.equal(bookmarkMigration.changed, true);
  assert.equal(legacyBookmarkStorage.store.storageSchemaVersion, storage.CURRENT_SCHEMA_VERSION);
  assert.equal(legacyBookmarkStorage.store.bookmarkLibrary.version, 3);
  assert.equal(legacyBookmarkStorage.store.bookmarkLibrary.categories.some(category => category.icon === 'shopping'), true);

  const legacyFaviconStorage = makeFakeStorage({
    storageSchemaVersion: 7,
    privacySettings: { externalFavicons: true },
  });
  global.chrome = { storage: { local: legacyFaviconStorage } };
  await storage.migrateStorage();
  assert.equal(legacyFaviconStorage.store.privacySettings.externalFavicons, false);

  const futureStorage = makeFakeStorage({ storageSchemaVersion: storage.CURRENT_SCHEMA_VERSION + 1 });
  global.chrome = { storage: { local: futureStorage } };
  const futureMigration = await storage.migrateStorage();
  assert.equal(futureMigration.forwardVersion, true);
  assert.equal(futureStorage.store.storageSchemaVersion, storage.CURRENT_SCHEMA_VERSION + 1);
  await assert.rejects(() => storage.getSavedTabs(), /storage-schema-forward/);
  await assert.rejects(() => storage.set({ shouldNotWrite: true }), /storage-schema-forward/);
  assert.equal(futureStorage.store.shouldNotWrite, undefined);

  let releaseMigrationRead;
  let signalMigrationRead;
  const migrationReadStarted = new Promise(resolve => { signalMigrationRead = resolve; });
  const releaseMigration = new Promise(resolve => { releaseMigrationRead = resolve; });
  const concurrentStorage = makeFakeStorage({
    storageSchemaVersion: storage.CURRENT_SCHEMA_VERSION - 1,
    deferred: [{ id: 'existing', url: 'https://existing.test/', title: 'Existing', savedAt: '2026-08-31T00:00:00.000Z', completed: false }],
  });
  const originalGet = concurrentStorage.get.bind(concurrentStorage);
  concurrentStorage.get = async keys => {
    if (keys !== null) return originalGet(keys);
    const snapshot = await originalGet(keys);
    signalMigrationRead();
    await releaseMigration;
    return snapshot;
  };
  global.chrome = { storage: { local: concurrentStorage } };
  const migrating = storage.migrateStorage();
  await migrationReadStarted;
  const addingDuringMigration = storage.addDeferredTab({ url: 'https://concurrent.test/', title: 'Concurrent' });
  releaseMigrationRead();
  await Promise.all([migrating, addingDuringMigration]);
  assert.equal(
    concurrentStorage.store.deferred.some(item => item.url === 'https://concurrent.test/'),
    true,
    'storage migration must not overwrite a concurrent mutation',
  );
}

async function testBookmarksService() {
  const fakeStorage = makeFakeStorage({ storageSchemaVersion: storage.CURRENT_SCHEMA_VERSION });
  global.chrome = { storage: { local: fakeStorage } };

  assert.equal(bookmarks.normalizeUrl('example.com'), 'https://example.com/');
  assert.equal(bookmarks.normalizeUrl('javascript:alert(1)'), '');

  const listViewResult = await bookmarks.setViewMode('list');
  assert.equal(listViewResult.library.viewMode, 'list');
  assert.equal((await bookmarks.getLibrary()).viewMode, 'list');
  const gridViewResult = await bookmarks.setViewMode('grid');
  assert.equal(gridViewResult.library.viewMode, 'grid');

  const categoryResult = await bookmarks.createCategory({ name: 'AI tools', icon: 'sparkles' });
  const category = categoryResult.result;
  assert.equal(category.system, '');
  const folderResult = await bookmarks.createFolder({ name: 'Observability', categoryId: category.id, layout: '2x2' });
  const folder = folderResult.result;
  assert.equal(folder.layout, '2x2');
  assert.equal(folder.categoryId, category.id);
  assert.deepEqual(folderResult.library.categories.find(item => item.id === category.id).itemOrder, [`folder:${folder.id}`]);
  const folderIconResult = await bookmarks.updateFolder(folder.id, { icon: 'palette' });
  assert.equal(folderIconResult.result.icon, 'palette');
  assert.equal((await bookmarks.getLibrary()).folders[0].icon, 'palette');

  const firstResult = await bookmarks.createBookmark({
    title: 'Langfuse',
    url: 'langfuse.com',
    note: 'Observability',
    folderId: folder.id,
    icon: { type: 'color', color: '#6681b4', text: 'LF' },
  });
  const first = firstResult.result;
  assert.equal(first.url, 'https://langfuse.com/');
  assert.equal(first.folderId, folder.id);
  assert.equal(first.categoryId, category.id);
  assert.equal('pinnedToHome' in first, false);

  const secondResult = await bookmarks.createBookmark({ title: 'GitHub', url: 'https://github.com', categoryId: storage.HOME_CATEGORY_ID });
  const second = secondResult.result;
  assert.equal(secondResult.library.categories.find(item => item.id === storage.HOME_CATEGORY_ID).itemOrder.includes(`bookmark:${second.id}`), true);

  await bookmarks.updateBookmark(second.id, { note: 'Code' });
  const movedResult = await bookmarks.moveBookmark(second.id, { folderId: folder.id });
  assert.equal(movedResult.library.categories.find(item => item.id === storage.HOME_CATEGORY_ID).itemOrder.includes(`bookmark:${second.id}`), false);
  assert.equal(movedResult.result.categoryId, category.id);
  assert.equal(movedResult.result.note, 'Code');

  const movedOutResult = await bookmarks.moveBookmark(second.id, { categoryId: category.id, folderId: null });
  assert.equal(movedOutResult.result.folderId, null);
  assert.equal(movedOutResult.library.categories.find(item => item.id === category.id).itemOrder.includes(`bookmark:${second.id}`), true);
  const reorderedCategoryItems = await bookmarks.reorderCategoryItems(category.id, `bookmark:${second.id}`, `folder:${folder.id}`);
  assert.deepEqual(reorderedCategoryItems.library.categories.find(item => item.id === category.id).itemOrder, [`bookmark:${second.id}`, `folder:${folder.id}`]);
  const secondCategory = (await bookmarks.createCategory({ name: 'Design', icon: 'palette' })).result;
  const reorderedCategories = await bookmarks.reorderCategories(secondCategory.id, category.id);
  assert.deepEqual(reorderedCategories.library.categories.filter(item => !item.system && !item.id.startsWith('category-browser-')).map(item => item.id), [secondCategory.id, category.id]);

  await bookmarks.recordOpen(first.id);
  await bookmarks.recordOpen(first.id);
  const opened = await bookmarks.getLibrary();
  assert.equal(bookmarks.getPopularBookmarks(opened)[0].openCount, 2);
  assert.equal(bookmarks.getRecentBookmarks(opened)[0].id, first.id);
  assert.equal(bookmarks.searchLibrary(opened, 'observability')[0].id, first.id);

  const deleteResult = await bookmarks.deleteFolder(folder.id);
  assert.equal(deleteResult.library.folders.length, 0);
  assert.equal(deleteResult.library.bookmarks.length, 2);
  assert.equal(deleteResult.library.bookmarks.every(item => item.folderId === null), true);
  const restoreResult = await bookmarks.restoreLibrary(deleteResult.previous);
  assert.equal(restoreResult.library.folders.length, 1);
  assert.equal(restoreResult.library.bookmarks.length, 2);

  await bookmarks.moveBookmark(second.id, { folderId: folder.id });
  const reorderedFolder = await bookmarks.reorderFolderBookmarks(folder.id, second.id, first.id);
  assert.deepEqual(bookmarks.getFolderBookmarks(reorderedFolder.library, folder.id).map(item => item.id), [second.id, first.id]);
  const movedFolder = await bookmarks.moveFolder(folder.id, storage.HOME_CATEGORY_ID);
  assert.equal(movedFolder.result.categoryId, storage.HOME_CATEGORY_ID);
  assert.equal(movedFolder.library.bookmarks.filter(item => item.folderId === folder.id).every(item => item.categoryId === storage.HOME_CATEGORY_ID), true);
  await bookmarks.moveFolder(folder.id, category.id);
  const categoryRootBeforeDelete = (await bookmarks.createBookmark({
    title: 'Keep root bookmark',
    url: 'https://keep-root.test',
    categoryId: category.id,
  })).result;
  const deleteCategoryResult = await bookmarks.deleteCategory(category.id, { contentMode: 'move-to-unfiled' });
  assert.equal(deleteCategoryResult.library.categories.some(item => item.id === category.id), false);
  assert.equal(deleteCategoryResult.library.folders.find(item => item.id === folder.id).categoryId, storage.UNFILED_CATEGORY_ID);
  assert.equal(deleteCategoryResult.library.bookmarks.filter(item => item.folderId === folder.id).every(item => item.categoryId === storage.UNFILED_CATEGORY_ID), true);
  assert.equal(deleteCategoryResult.library.categories.find(item => item.id === storage.UNFILED_CATEGORY_ID).itemOrder.includes(`folder:${folder.id}`), true);
  assert.equal(deleteCategoryResult.library.bookmarks.find(item => item.id === categoryRootBeforeDelete.id).categoryId, storage.UNFILED_CATEGORY_ID);
  assert.equal(deleteCategoryResult.library.categories.find(item => item.id === storage.UNFILED_CATEGORY_ID).itemOrder.includes(`bookmark:${categoryRootBeforeDelete.id}`), true);

  const deleteAllCategory = (await bookmarks.createCategory({ name: 'Delete all', icon: 'trash' })).result;
  const deleteAllFolder = (await bookmarks.createFolder({ name: 'Nested', categoryId: deleteAllCategory.id })).result;
  const deleteAllRootBookmark = (await bookmarks.createBookmark({
    title: 'Delete root',
    url: 'https://delete-root.test',
    categoryId: deleteAllCategory.id,
  })).result;
  const deleteAllNestedBookmark = (await bookmarks.createBookmark({
    title: 'Delete nested',
    url: 'https://delete-nested.test',
    folderId: deleteAllFolder.id,
  })).result;
  const deleteAllResult = await bookmarks.deleteCategory(deleteAllCategory.id, { contentMode: 'delete-all' });
  assert.equal(deleteAllResult.library.categories.some(item => item.id === deleteAllCategory.id), false);
  assert.equal(deleteAllResult.library.folders.some(item => item.id === deleteAllFolder.id), false);
  assert.equal(deleteAllResult.library.bookmarks.some(item => item.id === deleteAllRootBookmark.id), false);
  assert.equal(deleteAllResult.library.bookmarks.some(item => item.id === deleteAllNestedBookmark.id), false);
  assert.equal(deleteAllResult.library.categories.some(item => item.id === storage.UNFILED_CATEGORY_ID), true);
  assert.equal(deleteAllResult.library.bookmarks.some(item => item.id === categoryRootBeforeDelete.id), true);
  const restoredDeleteAll = await bookmarks.restoreLibrary(deleteAllResult.previous);
  assert.equal(restoredDeleteAll.library.categories.some(item => item.id === deleteAllCategory.id), true);
  assert.equal(restoredDeleteAll.library.folders.some(item => item.id === deleteAllFolder.id), true);
  assert.equal(restoredDeleteAll.library.bookmarks.some(item => item.id === deleteAllRootBookmark.id), true);
  assert.equal(restoredDeleteAll.library.bookmarks.some(item => item.id === deleteAllNestedBookmark.id), true);

  const nativeTree = [{
    id: '0',
    title: '',
    children: [{
      id: '1',
      title: '书签栏',
      children: [
        { id: '2', title: '根目录书签', url: 'https://root.example' },
        {
          id: '10',
          title: '一级原名',
          children: [
            { id: '11', title: '一级书签', url: 'https://level-one.example' },
            {
              id: '20',
              title: '深层原名',
              children: [
                { id: '21', title: '深层书签', url: 'https://deep.example' },
                { id: '22', title: '不支持地址', url: 'chrome://settings' },
              ],
            },
          ],
        },
      ],
    }],
  }];
  const imported = await bookmarks.importBrowserTree(nativeTree);
  assert.deepEqual(imported.result, {
    addedCategories: 1,
    addedFolders: 2,
    addedBookmarks: 3,
    existingBookmarks: 0,
    skippedBookmarks: 1,
    totalBookmarks: 4,
  });
  const importedCategory = imported.library.categories.find(item => item.name === '书签栏');
  const importedParentFolder = imported.library.folders.find(item => item.name === '一级原名');
  const importedDeepFolder = imported.library.folders.find(item => item.name === '深层原名');
  assert.ok(importedCategory);
  assert.equal(importedParentFolder.categoryId, importedCategory.id);
  assert.equal(importedDeepFolder.categoryId, importedCategory.id);
  assert.equal(importedDeepFolder.name, '深层原名');
  assert.equal(imported.library.bookmarks.find(item => item.title === '深层书签').folderId, importedDeepFolder.id);
  assert.equal(imported.library.bookmarks.find(item => item.title === '根目录书签').folderId, null);
  const repeatedImport = await bookmarks.importBrowserTree(nativeTree);
  assert.equal(repeatedImport.result.addedCategories, 0);
  assert.equal(repeatedImport.result.addedFolders, 0);
  assert.equal(repeatedImport.result.addedBookmarks, 0);
  assert.equal(repeatedImport.result.existingBookmarks, 3);
  assert.equal(repeatedImport.result.skippedBookmarks, 1);

  const stableOrderCategory = (await bookmarks.createCategory({ name: 'Stable order', icon: 'folder' })).result;
  const stableOrderFirst = (await bookmarks.createBookmark({
    title: 'First',
    url: 'https://first.order.test',
    categoryId: stableOrderCategory.id,
  })).result;
  await bookmarks.createBookmark({
    title: 'Second',
    url: 'https://second.order.test',
    categoryId: stableOrderCategory.id,
  });
  const orderBeforeEdit = (await bookmarks.getLibrary()).categories
    .find(item => item.id === stableOrderCategory.id).itemOrder.slice();
  await bookmarks.updateBookmark(stableOrderFirst.id, {
    title: 'First edited',
    categoryId: stableOrderCategory.id,
    folderId: null,
  });
  const orderAfterEdit = (await bookmarks.getLibrary()).categories
    .find(item => item.id === stableOrderCategory.id).itemOrder;
  assert.deepEqual(orderAfterEdit, orderBeforeEdit);

  const stableOrderFolder = (await bookmarks.createFolder({
    name: 'Stable folder order',
    categoryId: stableOrderCategory.id,
  })).result;
  const stableFolderFirst = (await bookmarks.createBookmark({
    title: 'Folder first',
    url: 'https://first.folder-order.test',
    folderId: stableOrderFolder.id,
  })).result;
  await bookmarks.createBookmark({
    title: 'Folder second',
    url: 'https://second.folder-order.test',
    folderId: stableOrderFolder.id,
  });
  const folderOrderBeforeEdit = bookmarks.getFolderBookmarks(
    await bookmarks.getLibrary(),
    stableOrderFolder.id,
  ).map(item => item.id);
  await bookmarks.updateBookmark(stableFolderFirst.id, {
    title: 'Folder first edited',
    categoryId: stableOrderCategory.id,
    folderId: stableOrderFolder.id,
  });
  const folderOrderAfterEdit = bookmarks.getFolderBookmarks(
    await bookmarks.getLibrary(),
    stableOrderFolder.id,
  ).map(item => item.id);
  assert.deepEqual(folderOrderAfterEdit, folderOrderBeforeEdit);

  await assert.rejects(
    () => bookmarks.createBookmark({ title: 'Unsafe', url: 'data:text/html,hi' }),
    /bookmark-url-invalid/
  );
}

async function testCrossContextBookmarkMutations() {
  const fakeStorage = makeFakeStorage({ storageSchemaVersion: storage.CURRENT_SCHEMA_VERSION });
  const queues = new Map();
  const sharedLocks = {
    request(name, callback) {
      const previous = queues.get(name) || Promise.resolve();
      const run = previous.catch(() => undefined).then(() => callback({ name }));
      queues.set(name, run.catch(() => undefined));
      return run;
    },
  };
  const storageSource = readFileSync(resolve(root, 'extension/services/storage-service.js'), 'utf8');
  const bookmarkSource = readFileSync(resolve(root, 'extension/services/bookmarks-service.js'), 'utf8');

  function makeContext() {
    const context = {
      chrome: { storage: { local: fakeStorage } },
      navigator: { locks: sharedLocks },
      SuperTabOutUrls: urls,
      structuredClone,
      crypto,
      URL,
      Date,
      Math,
      Promise,
      console,
    };
    runInNewContext(storageSource, context);
    runInNewContext(bookmarkSource, context);
    return context.SuperTabOutBookmarks;
  }

  const first = makeContext();
  const second = makeContext();
  await Promise.all([
    first.createBookmark({ title: 'A', url: 'https://a.concurrent.test' }),
    second.createBookmark({ title: 'B', url: 'https://b.concurrent.test' }),
  ]);

  assert.deepEqual(
    fakeStorage.store.bookmarkLibrary.bookmarks.map(bookmark => bookmark.title).sort(),
    ['A', 'B'],
  );
}

function testSearchService() {
  const index = search.buildSearchIndex({
    tabs: [
      { id: 1, title: 'GitHub Pull Request', url: 'https://github.com/org/repo/pull/1', groupId: 10 },
      { id: 2, title: 'Docs', url: 'https://developer.mozilla.org/en-US/docs', groupId: -1 },
    ],
    tabGroups: [{ id: 10, title: 'Work' }],
    savedTabs: [{ id: 's1', title: 'Read later', url: 'https://example.com/article' }],
    savedSessions: [{
      id: 'session-1',
      name: 'Chrome MV3 references',
      windows: [{ tabs: [
        { title: 'Side Panel', url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel', groupTitle: 'Extensions' },
      ] }],
    }],
  });

  assert.equal(search.searchIndex(index, 'gthb')[0].title, 'GitHub Pull Request');
  assert.equal(search.searchIndex(index, 'domain:github work').length, 1);
  assert.equal(search.searchIndex(index, 'saved:true').some(record => record.title === 'Read later'), true);
  assert.equal(search.searchIndex(index, 'url:mozilla')[0].title, 'Docs');
  assert.equal(search.searchIndex(index, 'saved:true group:extensions')[0].type, 'session');
  assert.equal(search.searchIndex(index, 'domain:chrome sidepanel')[0].type, 'session');
  assert.deepEqual(search.getHighlightSegments('GitHub Pull Request', 'git pull').filter(s => s.match).map(s => s.text), ['Git', 'Pull']);
}

function testSearchEngineService() {
  const defaults = searchEngines.defaultSearchSettings();
  assert.equal(defaults.defaultEngineId, 'google');
  assert.deepEqual(defaults.enabledEngineIds, ['baidu', 'bing', 'google', 'duckduckgo']);
  assert.equal(searchEngines.validateSearchUrlTemplate('https://example.com/?q=%s').valid, true);
  assert.equal(searchEngines.validateSearchUrlTemplate('http://example.com/?q=%s').valid, false);
  assert.equal(searchEngines.validateSearchUrlTemplate('https://example.com/?q=test').valid, false);
  assert.equal(searchEngines.validateSearchUrlTemplate('https://example.com/?q=%s&other=%s').valid, false);
  assert.equal(
    searchEngines.buildSearchUrl(searchEngines.BUILTIN_ENGINES[0], '你好 world'),
    'https://www.baidu.com/s?wd=%E4%BD%A0%E5%A5%BD%20world',
  );
  assert.deepEqual(
    searchEngines.parseBaiduSuggestionPayload('({q:"你好",p:false,s:["你好星期六","你好李焕英"]});'),
    ['你好星期六', '你好李焕英'],
  );
  assert.deepEqual(searchEngines.parseBaiduSuggestionPayload('not jsonp'), []);

  const normalized = searchEngines.normalizeSearchSettings({
    defaultEngineId: 'missing',
    enabledEngineIds: [],
    engineOrder: ['google', 'google'],
    customEngines: [
      { id: 'custom:12345678', name: 'Docs', searchUrlTemplate: 'https://docs.test/?q=%s', color: '#ABCDEF' },
      { id: 'custom:87654321', name: 'Docs', searchUrlTemplate: 'https://duplicate.test/?q=%s' },
      { id: 'custom:bad-http', name: 'Unsafe', searchUrlTemplate: 'http://unsafe.test/?q=%s' },
    ],
  });
  assert.equal(normalized.defaultEngineId, 'google');
  assert.deepEqual(normalized.enabledEngineIds, ['google']);
  assert.equal(normalized.customEngines.length, 1);
  assert.equal(normalized.customEngines[0].color, '#abcdef');
}

function testMetricsService() {
  const health = metrics.calculateTabHealth([
    { url: 'https://a.test', groupId: -1 },
    { url: 'https://a.test', groupId: -1 },
    { url: 'https://b.test', groupId: 2 },
  ]);
  assert.equal(health.duplicateExtras, 1);
  assert.equal(health.tabCount, 3);
  assert.equal(health.score < 100, true);
  const summary = metrics.summarizeActivity({
    weekly: { '2026-W18': { closed: 4, saved: 2, duplicateClosed: 1, sessionsSaved: 1 } },
    domains: { 'b.test': 1, 'a.test': 3 },
  });
  assert.equal(summary.closedThisWeek, 4);
  assert.equal(summary.topDomains[0].domain, 'a.test');
  assert.deepEqual(metrics.evaluateAchievements({ closedTotal: 10, sessionsSavedTotal: 1 }, { score: 95, tabCount: 4 }), ['closed-10', 'session-saver', 'calm-deck']);
}

function testHtmlService() {
  assert.equal(
    html.escapeHtml('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'
  );
}

testUrlService();
await testWorkspaceNavigationContract();
testSidePanelTabActionScopeContract();
await testBackgroundRegistryContract();
testWallpaperServiceContract();
await testBackgroundBookmarkCapture();
await testTabsService();
await testStorageService();
await testBookmarksService();
await testCrossContextBookmarkMutations();
testSearchService();
testSearchEngineService();
testMetricsService();
testHtmlService();

console.log('Unit tests passed.');
