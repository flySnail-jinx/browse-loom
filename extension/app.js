/* ================================================================
   BrowseLoom — Dashboard App (Pure Extension Edition)
   BrowseLoom is Apache-2.0.
   Based on Tab Out by Zara Zhang (MIT) — https://github.com/zarazhangrui/tab-out

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';

const StorageService = window.SuperTabOutStorage;
const TabsService = window.SuperTabOutTabs;
const SearchService = window.SuperTabOutSearch;
const MetricsService = window.SuperTabOutMetrics;

/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

// Chrome Tab Groups metadata — populated by fetchTabGroups(). Only used
// when the user is in 'group' view mode; safe to leave empty otherwise.
let tabGroupsList = [];

// Domain-card layout stays local and stable across tab refreshes. Dynamic
// sorting is opt-in through the toolbar control.
let domainCardPreferences = { sortMode: 'stable', order: [], pinned: [] };

// Browser-builtin new-tab URLs across Chromium variants (Chrome, Edge,
// Brave). The extension page URL itself is also treated as Tab Out.
const BROWSER_NEWTAB_URLS = [
  ...(TabsService?.BROWSER_NEWTAB_URLS || [
    'chrome://newtab/',
    'edge://newtab/',
    'brave://newtab/',
    'about:newtab',
  ]),
];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    if (TabsService?.fetchOpenTabs) {
      openTabs = await TabsService.fetchOpenTabs();
      return;
    }

    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;
    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id: t.id,
      url: t.url,
      title: t.title,
      windowId: t.windowId,
      active: t.active,
      pinned: t.pinned,
      groupId: typeof t.groupId === 'number' ? t.groupId : -1,
      index: t.index,
      isTabOut: t.url === newtabUrl || BROWSER_NEWTAB_URLS.includes(t.url),
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes open tabs that exactly match one of the given URLs.
 *
 * Previously this matched by hostname, which would also close tabs the
 * user never saw — e.g. closing a domain card would take down the
 * corresponding homepage tab that had been split into the Homepages
 * group. Exact-URL matching keeps the action scoped to what the card
 * actually shows and still closes every duplicate tab for each URL.
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;
  if (TabsService?.closeTabsByUrls) {
    await TabsService.closeTabsByUrls(urls);
  } else {
    const urlSet = new Set(urls);
    const allTabs = await chrome.tabs.query({});
    const toClose = allTabs
      .filter(t => !t.pinned && urlSet.has(t.url))
      .map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
}

/**
 * focusTab(tabId, url)
 *
 * Switches Chrome to the exact tab represented by a dashboard row. URL
 * fallback is retained for saved/legacy records that do not have a tab id.
 */
async function focusTab(tabId, url) {
  const numericTabId = tabId == null || tabId === '' ? NaN : Number(tabId);
  if (Number.isFinite(numericTabId)) {
    if (TabsService?.focusTabWithQuickReturn) {
      const focused = await TabsService.focusTabWithQuickReturn(numericTabId);
      if (focused) return;
    } else if (TabsService?.focusTabById) {
      const focused = await TabsService.focusTabById(numericTabId);
      if (focused) return;
    } else {
      try {
        const tab = await chrome.tabs.get(numericTabId);
        await chrome.tabs.update(tab.id, { active: true });
        await chrome.windows.update(tab.windowId, { focused: true });
        return;
      } catch {
        // The tab may have vanished between render and click. Fall back to URL.
      }
    }
  }

  if (!url) return;
  if (TabsService?.focusTab) {
    await TabsService.focusTab(url);
    return;
  }
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  if (TabsService?.closeDuplicateTabs) {
    await TabsService.closeDuplicateTabs(urls, keepOne);
  } else {
    const allTabs = await chrome.tabs.query({});
    const toClose = [];

    for (const url of urls) {
      const matching = allTabs.filter(t => t.url === url);
      if (keepOne) {
        const keep = matching.find(t => t.active) || matching[0];
        for (const tab of matching) {
          if (tab.id !== keep.id && !tab.pinned) toClose.push(tab.id);
        }
      } else {
        for (const tab of matching) {
          if (!tab.pinned) toClose.push(tab.id);
        }
      }
    }

    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  if (TabsService?.closeTabOutDupes) {
    await TabsService.closeTabOutDupes();
  } else {
    const extensionId = chrome.runtime.id;
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const allTabs = await chrome.tabs.query({});
    const currentWindow = await chrome.windows.getCurrent();
    const tabOutTabs = allTabs.filter(t =>
      t.url === newtabUrl || BROWSER_NEWTAB_URLS.includes(t.url)
    );

    if (tabOutTabs.length <= 1) return;

    // Keep the active Tab Out tab in the CURRENT window — that's the one the
    // user is looking at right now. Falls back to any active one, then the first.
    const keep =
      tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
      tabOutTabs.find(t => t.active) ||
      tabOutTabs[0];
    const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   CHROME TAB GROUPS + VIEW MODE

   View mode decides whether tabs are shown grouped by domain (original)
   or by Chrome tab group (Chrome's own colored group labels). Preference
   persists in chrome.storage.local under 'viewMode'. When no Chrome
   groups exist we fall back to domain view and hide the toggle pill.
   ---------------------------------------------------------------- */

async function fetchTabGroups() {
  try {
    tabGroupsList = TabsService?.fetchTabGroups
      ? await TabsService.fetchTabGroups()
      : await chrome.tabGroups.query({});
  } catch {
    // tabGroups permission missing or API unavailable — ignore.
    tabGroupsList = [];
  }
}

async function loadViewMode() {
  try {
    if (StorageService?.getViewMode) return await StorageService.getViewMode();
    const { viewMode } = await chrome.storage.local.get('viewMode');
    return viewMode === 'domain' ? 'domain' : 'group';
  } catch { return 'group'; }
}

async function saveViewMode(mode) {
  try {
    if (StorageService?.setViewMode) await StorageService.setViewMode(mode);
    else await chrome.storage.local.set({ viewMode: mode });
  } catch {}
}

async function loadDomainCardPreferences() {
  try {
    if (StorageService?.getDomainCardPreferences) {
      domainCardPreferences = await StorageService.getDomainCardPreferences();
    } else {
      const { domainCardPreferences: stored } = await chrome.storage.local.get('domainCardPreferences');
      domainCardPreferences = StorageService?.normalizeDomainCardPreferences
        ? StorageService.normalizeDomainCardPreferences(stored)
        : {
            sortMode: TabsService?.normalizeDomainSortMode?.(stored?.sortMode) || 'stable',
            order: Array.isArray(stored?.order) ? stored.order : [],
            pinned: Array.isArray(stored?.pinned) ? stored.pinned : [],
          };
    }
  } catch {
    domainCardPreferences = { sortMode: 'stable', order: [], pinned: [] };
  }
  return domainCardPreferences;
}

async function saveDomainCardPreferences(preferences) {
  const normalized = StorageService?.normalizeDomainCardPreferences
    ? StorageService.normalizeDomainCardPreferences(preferences)
    : {
        sortMode: TabsService?.normalizeDomainSortMode?.(preferences?.sortMode) || 'stable',
        order: Array.isArray(preferences?.order) ? preferences.order : [],
        pinned: Array.isArray(preferences?.pinned) ? preferences.pinned : [],
      };
  domainCardPreferences = normalized;
  if (StorageService?.setDomainCardPreferences) {
    await StorageService.setDomainCardPreferences(normalized);
  } else {
    await chrome.storage.local.set({ domainCardPreferences: normalized });
  }
  return normalized;
}

// Close tabs by numeric ids. Used for "Close all tabs in this group".
// Pinned tabs are still protected (consistent with #7 behavior).
async function closeTabsByIds(ids) {
  if (!ids || ids.length === 0) return;
  if (TabsService?.closeTabsByIds) {
    await TabsService.closeTabsByIds(ids);
  } else {
    const idSet = new Set(ids);
    const allTabs = await chrome.tabs.query({});
    const toClose = allTabs
      .filter(t => idSet.has(t.id) && !t.pinned)
      .map(t => t.id);
    if (toClose.length > 0) await chrome.tabs.remove(toClose);
  }
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   THEME SWITCHER

   Theme palettes the user can pick from. The active theme is written to localStorage and
   re-applied on load by theme-init.js before the body paints, so the
   page doesn't flash the default palette. This function only has to
   sync the DOM state and the pressed-button indicator.
   ---------------------------------------------------------------- */
const THEMES = ['system', 'white', 'material', 'cupertino', 'warm', 'midnight', 'arctic', 'forest', 'graphite', 'coast', 'plum', 'matcha', 'ember', 'lavender'];
const THEME_STORAGE_KEY = 'tab-out-theme';
const THEME_LABEL_KEYS = {
  system: 'themeSystem',
  white: 'themeWhite',
  material: 'themeMaterial',
  cupertino: 'themeCupertino',
  warm: 'themeWarm',
  midnight: 'themeMidnight',
  arctic: 'themeArctic',
  forest: 'themeForest',
  graphite: 'themeGraphite',
  coast: 'themeCoast',
  plum: 'themePlum',
  matcha: 'themeMatcha',
  ember: 'themeEmber',
  lavender: 'themeLavender',
};

function getActiveTheme() {
  const t = document.documentElement.dataset.theme;
  return THEMES.includes(t) ? t : 'system';
}

function applyTheme(name, { save = false } = {}) {
  if (!THEMES.includes(name)) return;
  document.documentElement.dataset.theme = name;
  if (save) {
    try { localStorage.setItem(THEME_STORAGE_KEY, name); } catch {}
  }
  syncThemeControls();
}

function syncThemeControls() {
  const active = getActiveTheme();
  const label = tr(THEME_LABEL_KEYS[active] || 'themeWarm');

  document.querySelectorAll('.theme-option[data-theme-name]').forEach(btn => {
    const selected = btn.dataset.themeName === active;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.classList.toggle('active', selected);
    const text = btn.querySelector('.theme-option-label');
    const key = THEME_LABEL_KEYS[btn.dataset.themeName];
    if (text && key) text.textContent = tr(key);
    if (key) btn.setAttribute('title', tr(key));
  });

  const activeLabel = document.getElementById('activeThemeLabel');
  if (activeLabel) activeLabel.textContent = label;

  const activeSwatch = document.getElementById('activeThemeSwatch');
  if (activeSwatch) {
    activeSwatch.className = `theme-swatch theme-swatch-active theme-swatch-${active}`;
  }

  const currentBtn = document.getElementById('themeCurrentBtn');
  if (currentBtn) {
    const title = tr('themeCurrentTitle', { theme: label });
    currentBtn.setAttribute('title', title);
    currentBtn.setAttribute('aria-label', title);
  }
}

function setThemeMenuOpen(open) {
  const picker = document.getElementById('themePicker');
  const button = document.getElementById('themeCurrentBtn');
  if (!picker || !button) return;
  picker.classList.toggle('theme-menu-open', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleThemeMenu() {
  const picker = document.getElementById('themePicker');
  setThemeMenuOpen(!picker?.classList.contains('theme-menu-open'));
}

function initThemeSwitcher() {
  applyTheme(getActiveTheme(), { save: false });
}


/* ----------------------------------------------------------------
   CONTENT CARD OPACITY

   One appearance preference controls the card material in both workspaces.
   Only the surface alpha changes; text and controls remain fully opaque.
   ---------------------------------------------------------------- */
const CARD_OPACITY_STORAGE_KEY = 'tab-out-card-opacity';
const CARD_OPACITY_DEFAULT = 60;
const CARD_OPACITY_MIN = 40;
const CARD_OPACITY_MAX = 100;

function normalizeCardOpacity(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return CARD_OPACITY_DEFAULT;
  return Math.min(CARD_OPACITY_MAX, Math.max(CARD_OPACITY_MIN, Math.round(numeric)));
}

function getCardOpacity() {
  try {
    const stored = localStorage.getItem(CARD_OPACITY_STORAGE_KEY);
    return stored === null ? CARD_OPACITY_DEFAULT : normalizeCardOpacity(stored);
  } catch {
    return CARD_OPACITY_DEFAULT;
  }
}

function applyCardOpacity(value, { save = false } = {}) {
  const opacity = normalizeCardOpacity(value);
  document.documentElement.style.setProperty('--content-card-opacity', `${opacity}%`);
  document.documentElement.dataset.cardOpacity = String(opacity);
  const range = document.getElementById('cardOpacityRange');
  const output = document.getElementById('cardOpacityValue');
  if (range) {
    range.value = String(opacity);
    range.setAttribute('aria-valuetext', `${opacity}%`);
  }
  if (output) output.value = `${opacity}%`;
  if (save) {
    try { localStorage.setItem(CARD_OPACITY_STORAGE_KEY, String(opacity)); } catch {}
  }
  return opacity;
}

function initCardOpacityControl() {
  const range = document.getElementById('cardOpacityRange');
  applyCardOpacity(getCardOpacity());
  range?.addEventListener('input', event => applyCardOpacity(event.currentTarget.value));
  range?.addEventListener('change', event => applyCardOpacity(event.currentTarget.value, { save: true }));
}


/* ----------------------------------------------------------------
   FONT + DENSITY SWITCHER

   Presets use system CSS generic families only. We do not bundle,
   download, or @font-face any font files; the controls adjust local
   font-family tokens plus readable/compact density variables in CSS.
   ---------------------------------------------------------------- */
const FONT_PRESETS = ['system', 'readable', 'compact', 'editorial'];
const FONT_STORAGE_KEY = 'tab-out-font-preset';
const FONT_LABEL_KEYS = {
  system: 'fontSystem',
  readable: 'fontReadable',
  compact: 'fontCompact',
  editorial: 'fontEditorial',
};
const FONT_DESC_KEYS = {
  system: 'fontSystemDesc',
  readable: 'fontReadableDesc',
  compact: 'fontCompactDesc',
  editorial: 'fontEditorialDesc',
};
const FONT_SIZE_AREAS = ['header', 'cards', 'tabs'];
const FONT_SIZE_VALUES = ['small', 'default', 'large'];
const FONT_SIZE_STORAGE_KEY = 'tab-out-font-size-overrides';
const FONT_SIZE_AREA_KEYS = {
  header: 'fontSizeHeader',
  cards: 'fontSizeCards',
  tabs: 'fontSizeTabs',
};
const FONT_SIZE_VALUE_KEYS = {
  small: 'fontSizeSmall',
  default: 'fontSizeDefault',
  large: 'fontSizeLarge',
};
const FONT_SIZE_SHORT_KEYS = {
  small: 'fontSizeSmallShort',
  default: 'fontSizeDefaultShort',
  large: 'fontSizeLargeShort',
};

function fontSizeDataKey(area) {
  return `size${area.charAt(0).toUpperCase()}${area.slice(1)}`;
}

function normalizeFontSizeSettings(settings = {}) {
  return FONT_SIZE_AREAS.reduce((next, area) => {
    const value = settings && FONT_SIZE_VALUES.includes(settings[area])
      ? settings[area]
      : 'default';
    next[area] = value;
    return next;
  }, {});
}

function getActiveFontPreset() {
  const preset = document.documentElement.dataset.fontPreset;
  return FONT_PRESETS.includes(preset) ? preset : 'system';
}

function applyFontPreset(preset, { save = false } = {}) {
  if (!FONT_PRESETS.includes(preset)) return;
  document.documentElement.dataset.fontPreset = preset;
  if (save) {
    try { localStorage.setItem(FONT_STORAGE_KEY, preset); } catch {}
  }
  syncFontControls();
}

function getActiveFontSizeSettings() {
  const fromDataset = FONT_SIZE_AREAS.reduce((settings, area) => {
    const value = document.documentElement.dataset[fontSizeDataKey(area)];
    settings[area] = FONT_SIZE_VALUES.includes(value) ? value : 'default';
    return settings;
  }, {});
  return normalizeFontSizeSettings(fromDataset);
}

function applyFontSizeSettings(settings, { save = false } = {}) {
  const normalized = normalizeFontSizeSettings(settings);
  FONT_SIZE_AREAS.forEach(area => {
    document.documentElement.dataset[fontSizeDataKey(area)] = normalized[area];
  });
  if (save) {
    try { localStorage.setItem(FONT_SIZE_STORAGE_KEY, JSON.stringify(normalized)); } catch {}
  }
  syncFontControls();
}

function syncFontControls() {
  const active = getActiveFontPreset();
  const label = tr(FONT_LABEL_KEYS[active] || 'fontSystem');
  const sizeSettings = getActiveFontSizeSettings();

  document.querySelectorAll('.font-option[data-font-preset]').forEach(btn => {
    const selected = btn.dataset.fontPreset === active;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.setAttribute('aria-checked', selected ? 'true' : 'false');
    btn.classList.toggle('active', selected);

    const preset = btn.dataset.fontPreset;
    const labelEl = btn.querySelector('.font-option-label');
    const descEl = btn.querySelector('.font-option-desc');
    const labelKey = FONT_LABEL_KEYS[preset];
    const descKey = FONT_DESC_KEYS[preset];
    if (labelEl && labelKey) labelEl.textContent = tr(labelKey);
    if (descEl && descKey) descEl.textContent = tr(descKey);
    if (labelKey) btn.setAttribute('title', tr(labelKey));
  });

  document.querySelectorAll('[data-font-copy]').forEach(el => {
    el.textContent = tr(el.dataset.fontCopy);
  });

  const sizeControls = document.querySelector('.font-size-controls');
  if (sizeControls) sizeControls.setAttribute('aria-label', tr('fontSizeByArea'));

  document.querySelectorAll('.font-size-segment').forEach(segment => {
    const area = segment.querySelector('.font-size-option[data-font-size-area]')?.dataset.fontSizeArea;
    const key = FONT_SIZE_AREA_KEYS[area];
    if (key) segment.setAttribute('aria-label', tr(key));
  });

  document.querySelectorAll('.font-size-option[data-font-size-area][data-font-size-value]').forEach(btn => {
    const area = btn.dataset.fontSizeArea;
    const value = btn.dataset.fontSizeValue;
    const selected = sizeSettings[area] === value;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    const areaLabel = tr(FONT_SIZE_AREA_KEYS[area] || 'fontSizeByArea');
    const valueLabel = tr(FONT_SIZE_VALUE_KEYS[value] || 'fontSizeDefault');
    btn.textContent = tr(FONT_SIZE_SHORT_KEYS[value] || 'fontSizeDefaultShort');
    btn.setAttribute('title', `${areaLabel}: ${valueLabel}`);
    btn.setAttribute('aria-label', `${areaLabel}: ${valueLabel}`);
  });

  const activeLabel = document.getElementById('activeFontLabel');
  if (activeLabel) activeLabel.textContent = tr('fontEntryLabel');

  const currentBtn = document.getElementById('fontCurrentBtn');
  if (currentBtn) {
    const title = tr('fontCurrentTitle', { font: label });
    currentBtn.setAttribute('title', title);
    currentBtn.setAttribute('aria-label', title);
  }
}

function setFontMenuOpen(open) {
  const picker = document.getElementById('fontPicker');
  const button = document.getElementById('fontCurrentBtn');
  if (!picker || !button) return;
  picker.classList.toggle('font-menu-open', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleFontMenu() {
  const picker = document.getElementById('fontPicker');
  setFontMenuOpen(!picker?.classList.contains('font-menu-open'));
}

function initFontSwitcher() {
  applyFontPreset(getActiveFontPreset(), { save: false });
  applyFontSizeSettings(getActiveFontSizeSettings(), { save: false });
}


/* ----------------------------------------------------------------
   LANGUAGE SWITCHER + UI COPY

   Only fixed UI labels are translated. Tab titles, URLs, Chrome group
   names, and user-entered privacy text stay exactly as the user created
   them.
   ---------------------------------------------------------------- */
const LANGUAGES = ['en', 'zh'];
const LANGUAGE_STORAGE_KEY = 'tab-out-language';
const LANGUAGE_LABEL_KEYS = {
  en: 'languageEnglish',
  zh: 'languageChinese',
};
const LANGUAGE_SHORT_LABELS = {
  en: 'EN',
  zh: '中',
};

const UI_COPY = {
  en: {
    cancel: "Cancel",
    saveForLaterHint: "Save the address to Read later, then close this tab.",
    saveGroupHint: "Save these pages as a collection. Tabs stay open.",
    saveAllHint: "Save all ungrouped pages. Tabs stay open.",
    restoreSessionHint: "Open the collection in the current window.",
    restoreWindowsHint: "Reopen pages in separate windows as saved.",
    markRead: "Mark as read",
    markReadHint: "Mark as read. The address is kept.",
    documentTitle: 'BrowseLoom',
    languageLabel: 'Language',
    languageEnglish: 'English',
    languageChinese: 'Chinese',
    languageCurrentTitle: ({ language }) => `Current language: ${language}`,
    settingsTitle: 'Settings',
    settingsSectionsLabel: "Settings categories",
    generalSettings: 'General',
    defaultWorkspaceLabel: "Default page",
    defaultWorkspaceDescription: "Opens when you create a new tab or click the extension icon.",
    workspaceTabs: "Tabs",
    workspaceBookmarks: "Bookmarks",
    appearanceSettings: 'Appearance',
    privacyScreenSettings: "Screen cover",
    dataPrivacySettings: "Data & privacy",
    networkPrivacySettings: "Network access",
    aboutSettings: 'About',
    aboutDescription: "Organize tabs and bookmark your favorite pages.",
    projectInformation: 'Project information',
    projectSource: "View code",
    openSourceLicense: 'Open-source license',
    attributionNotices: 'Attribution notices',
    thirdPartyNotices: 'Third-party notices',
    aboutLicenseSummary: 'Licensed under Apache-2.0.',
    aboutBasedOn: 'Based on',
    privacyToggleTitle: "Toggle screen cover (Esc)",
    themeLabel: 'Theme',
    themeWarm: 'Warm Parchment',
    themeWhite: 'Ivory Page',
    themeSystem: 'Adaptive Glow',
    themeMaterial: 'Material Orbit',
    themeCupertino: 'Cupertino Mist',
    themeMidnight: 'Midnight Voyage',
    themeArctic: 'Frost Field',
    themeForest: 'Forest Isle',
    themeGraphite: 'Graphite Gold',
    themeCoast: 'Coral Tide',
    themePlum: 'Plum Shade',
    themeMatcha: 'Matcha Haze',
    themeEmber: 'Ember Slate',
    themeLavender: 'Lavender Breeze',
    themeCurrentTitle: ({ theme }) => `Current theme: ${theme}`,
    backgroundLabel: 'Background',
    backgroundMountain: 'Snow peaks',
    backgroundLiquidEther: 'Liquid glow',
    backgroundLightRays: 'Light rays',
    backgroundPrism: 'Prism',
    backgroundStatic: "Static background",
    cardOpacityLabel: "Transparency",
    cardOpacityDescription: "Higher values make cards less transparent.\nApplies to cards on both the tabs and bookmarks pages.",
    fontLabel: "Font",
    fontEntryLabel: "Font",
    fontSystem: "System default",
    fontReadable: "Larger text",
    fontCompact: "Compact layout",
    fontEditorial: "Magazine style",
    fontSystemDesc: "Use your computer's default font.",
    fontReadableDesc: "Larger text with more space between lines.",
    fontCompactDesc: "Show more tabs on one screen.",
    fontEditorialDesc: "Use decorative serif lettering for headings.",
    fontCurrentTitle: ({ font }) => `Current font: ${font}`,
    fontSizeByArea: "Text size by area",
    fontSizeHeader: 'Header',
    fontSizeCards: 'Cards',
    fontSizeTabs: "Tabs",
    fontSizeSmall: "Small",
    fontSizeDefault: "Standard",
    fontSizeLarge: "Large",
    fontSizeSmallShort: "S",
    fontSizeDefaultShort: "M",
    fontSizeLargeShort: "L",
    privacyHint: "Press <kbd>Esc</kbd> to return to your tabs",
    privacySettingsTitle: "Screen cover settings",
    customize: 'Customize',
    clock: 'Clock',
    date: 'Date',
    customText: "Display text",
    externalFavicons: "Fetch website icons",
    externalFaviconsDisclosure: "Optional and off by default.\nWhen enabled, website domains are sent to DuckDuckGo to fetch icons.\nRecipient: icons.duckduckgo.com",
    mottoPlaceholder: "Write something to display",
    closeExtras: "Close extra pages",
    search: "Search tabs",
    savedForLater: "Read later",
    savedSessionsTitle: "Page collections",
    savedSessionsEmpty: "No page collections saved yet.",
    deferredEmpty: "No pages waiting to be read.",
    archive: "Finished reading",
    clearArchive: "Clear records",
    archiveSearchPlaceholder: "Search finished pages",
    versionLabel: ({ version }) => `Current version: ${version}`,
    homepages: "Website homepages",
    localFiles: 'Local files',
    multipleSites: 'Multiple sites',
    tabsLabel: 'tabs',
    tabsCompact: ({ count }) => `${count} tab${count !== 1 ? 's' : ''}`,
    windowsCompact: ({ count }) => `${count} window${count !== 1 ? 's' : ''}`,
    domainTabSummary: ({ domainCount, tabCount }) => `${domainCount} website${domainCount !== 1 ? 's' : ''}, ${tabCount} tab${tabCount !== 1 ? 's' : ''}`,
    groupTabSummary: ({ groupCount, tabCount }) => `${groupCount} group${groupCount !== 1 ? 's' : ''}, ${tabCount} tab${tabCount !== 1 ? 's' : ''}`,
    viewGroups: "By group",
    viewDomains: "By website",
    viewModeLabel: "View by",
    domainSortLabel: "Sort websites",
    domainSortStable: 'Fixed',
    domainSortChrome: "Browser order",
    domainSortCount: "Tab count",
    domainSortName: "Website name",
    domainSortCurrent: ({ mode }) => `Sort: ${mode}`,
    pinDomainCard: 'Pin card',
    unpinDomainCard: 'Unpin card',
    pinnedDomainCard: 'Pinned card',
    notGrouped: "Ungrouped",
    ungroupedInboxHint: "Tabs that are not in a group",
    smartGroup: "Auto-group",
    smartGroupHint: "Only groups tabs that are not already grouped.\nTwo or more tabs from the same website form a group.",
    saveAll: 'Save all',
    createGroupFromDomain: "New group",
    unnamedGroup: "Unnamed",
    saveForLater: "Save and close",
    closeThisTab: "Close tab",
    focusThisTab: "Switch to this tab",
    quickReturnHint: "Ctrl+Shift+Z to return",
    currentTab: "Current tab",
    expandHiddenTabs: "Show more",
    dismiss: "Delete record",
    ungroup: "Ungroup",
    createGroup: "New group",
    renameGroup: "Rename",
    recolorGroup: "Change color",
    groupActions: 'Group actions',
    cardActions: 'Card actions',
    moreActions: 'More actions',
    groupColorPickerLabel: 'Group color',
    groupColorCurrent: "Selected",
    groupColorGrey: 'Grey',
    groupColorBlue: 'Blue',
    groupColorRed: 'Red',
    groupColorYellow: 'Yellow',
    groupColorGreen: 'Green',
    groupColorPink: 'Pink',
    groupColorPurple: 'Purple',
    groupColorCyan: 'Cyan',
    groupColorOrange: 'Orange',
    collapseGroup: "Collapse",
    expandGroup: 'Expand',
    saveGroup: "Save collection",
    restoreSession: "Open together",
    restoreSessionWindows: "Open in separate windows",
    deleteSession: "Delete collection",
    undo: 'Undo',
    dismissToast: "Dismiss message",
    savedSessionTabs: ({ count }) => `${count} tab${count !== 1 ? 's' : ''}`,
    noResults: "No results found",
    inboxZeroTitle: "No tabs yet",
    inboxZeroSubtitle: "Open a page to see it here.",
    justNow: 'just now',
    yesterday: 'yesterday',
    tabOutDupeBanner: ({ count }) => `<strong id="tabOutDupeCount">${count}</strong> BrowseLoom pages are open. Keep just this one?`,
    tabsOpen: ({ count }) => `${count} tab${count !== 1 ? 's' : ''} open`,
    duplicates: ({ count }) => `${count} duplicate${count !== 1 ? 's' : ''}`,
    more: ({ count }) => `${count} more`,
    closeAllTabs: "Close all",
    bulkCloseTitle: "Close tabs?",
    bulkCloseButton: "Confirm close",
    bulkCloseScopeAll: "all open tabs",
    bulkCloseScopeDomain: ({ label }) => `website “${label}”`,
    bulkCloseScopeGroup: ({ label }) => `group “${label}”`,
    bulkCloseScopeUngrouped: "all ungrouped tabs",
    bulkCloseScopeDuplicates: "the selected duplicate tabs",
    bulkCloseScopeExtraDashboards: "extra BrowseLoom pages",
    bulkCloseBody: ({ count, scope, protectedCount = 0 }) => `Close ${count} tabs.\nScope: ${scope}.\nPinned tabs and browser or extension pages stay open.${protectedCount ? `\n${protectedCount} protected tabs excluded.` : ""}`,
    closeDuplicates: "Close duplicates",
    domainCount: ({ count }) => `${count} website${count !== 1 ? 's' : ''}`,
    groupCount: ({ count }) => `${count} group${count !== 1 ? 's' : ''}`,
    ungroupedCount: ({ count }) => `${count} ungrouped tab${count !== 1 ? 's' : ''}`,
    itemCount: ({ count }) => `${count} item${count !== 1 ? 's' : ''}`,
    minAgo: ({ count }) => `${count} min ago`,
    hrAgo: ({ count }) => `${count} hr${count !== 1 ? 's' : ''} ago`,
    daysAgo: ({ count }) => `${count} days ago`,
    toastClosedExtraTabOut: "Extra BrowseLoom pages closed.",
    toastTabClosed: "Tab closed.",
    toastSaveFailed: "Could not save. Try again.",
    toastSavedForLater: "Added to Read later.",
    toastClosedFromGroup: ({ count, label }) => `${count} tab${count !== 1 ? 's' : ''} closed.\nFrom: ${label}`,
    toastClosedUngrouped: ({ count }) => `${count} ungrouped tab${count !== 1 ? 's' : ''} closed.`,
    toastClosedDuplicates: "Duplicates closed. One tab kept for each address.",
    toastClosedChromeGroup: ({ count }) => `${count} tab${count !== 1 ? 's' : ''} closed in the group.`,
    toastUngrouped: ({ count }) => `${count} tab${count !== 1 ? 's' : ''} removed from groups.`,
    toastAllTabsClosed: "All eligible tabs closed.",
    toastBulkTabsClosed: ({ count }) => `${count} tab${count !== 1 ? 's' : ''} closed.`,
    toastBulkTabsRestored: ({ count }) => `${count} tab${count !== 1 ? 's' : ''} reopened.`,
    toastBulkTabsPartiallyRestored: ({ restored, failed }) => `${restored} tabs reopened.\n${failed} could not be reopened.`,
    toastBulkTabsRestoredWithoutGroups: ({ count }) => `${count} tabs reopened.\nSome groups could not be restored.`,
    toastBulkTabsRestoreFailed: "Could not reopen the recently closed tabs.",
    toastNoTabsClosed: "No tabs were closed.\nThey may already be closed.",
    toastGroupCreated: "Browser group created.",
    toastSmartGrouped: ({ count }) => `${count} group${count !== 1 ? 's' : ''} created automatically.`,
    toastSmartGroupNone: "No tabs available to auto-group.",
    toastGroupUpdated: "Group updated.",
    toastGroupUpdateFailed: "Could not update the group. Try again.",
    toastGroupSaved: "Group saved as a page collection.",
    toastSessionSaved: "Page collection saved.",
    toastSessionRestored: "Collection opened and browser groups restored.",
    toastSessionRestoreFailed: "Could not open the collection. Try again.",
    toastSessionDeleted: ({ title }) => `Collection “${title}” deleted.`,
    toastSessionRestoredFromUndo: "Deletion undone. Collection restored.",
    toastArchiveCleared: ({ count }) => `Cleared ${count} finished-reading records.`,
    toastArchiveRestored: ({ count }) => `Restored ${count} finished-reading records.`,
    toastDeferredRemoved: "Read later record deleted.",
    toastDeferredRestored: "Read later record restored.",
    toastStorageQuota: "Storage is full.\nDelete records you no longer need, then try again.",
    toastStorageFailed: "Could not save. Try again.",
    storageForwardTitle: "Update required",
    storageForwardBody: "This data comes from a newer version.\nThis version has stopped to protect your data.\nUpdate the extension to continue.",
  },
  zh: {
    cancel: "取消",
    saveForLaterHint: "保存网址，并关闭此标签页。",
    saveGroupHint: "保存这组网页，标签页保持打开。",
    saveAllHint: "保存全部未分组网页，不关闭标签页。",
    restoreSessionHint: "在当前窗口打开合集中的网页。",
    restoreWindowsHint: "按保存时的窗口划分，重新打开网页。",
    markRead: "标为已看完",
    markReadHint: "标为已看完，网址仍会保留。",
    documentTitle: 'BrowseLoom',
    languageLabel: '语言',
    languageEnglish: '英文',
    languageChinese: '中文',
    languageCurrentTitle: ({ language }) => `当前语言：${language}`,
    settingsTitle: '设置',
    settingsSectionsLabel: "设置分类",
    generalSettings: '常规',
    defaultWorkspaceLabel: "默认页面",
    defaultWorkspaceDescription: "新建标签页或点击扩展图标时打开。",
    workspaceTabs: "标签页",
    workspaceBookmarks: "书签",
    appearanceSettings: '外观',
    privacyScreenSettings: "遮屏",
    dataPrivacySettings: "数据隐私",
    networkPrivacySettings: "联网设置",
    aboutSettings: '关于',
    aboutDescription: "整理标签页，收藏常用网页。",
    projectInformation: '项目信息',
    projectSource: "查看代码",
    openSourceLicense: '开源许可',
    attributionNotices: '署名声明',
    thirdPartyNotices: '第三方声明',
    aboutLicenseSummary: '采用 Apache-2.0 许可。',
    aboutBasedOn: '基于',
    privacyToggleTitle: "切换遮屏（Esc）",
    themeLabel: '主题',
    themeWarm: '暖笺',
    themeWhite: '素笺',
    themeSystem: '随光',
    themeMaterial: '星轨',
    themeCupertino: '雾岸',
    themeMidnight: '夜航',
    themeArctic: '霜原',
    themeForest: '森屿',
    themeGraphite: '墨金',
    themeCoast: '珊潮',
    themePlum: '梅影',
    themeMatcha: '茶岚',
    themeEmber: '烬岩',
    themeLavender: '薰风',
    themeCurrentTitle: ({ theme }) => `当前主题：${theme}`,
    backgroundLabel: '背景',
    backgroundMountain: '雪峰',
    backgroundLiquidEther: '流光液体',
    backgroundLightRays: '光束',
    backgroundPrism: '棱镜',
    backgroundStatic: "静态背景",
    cardOpacityLabel: "透明效果",
    cardOpacityDescription: "数值越大，卡片越不透明。\n同时调整标签页和书签页的卡片。",
    fontLabel: "字体",
    fontEntryLabel: "字体",
    fontSystem: "系统默认",
    fontReadable: "大字舒适",
    fontCompact: "紧凑排列",
    fontEditorial: "杂志风格",
    fontSystemDesc: "使用电脑默认字体。",
    fontReadableDesc: "字更大，行与行之间更宽松。",
    fontCompactDesc: "一屏显示更多标签页。",
    fontEditorialDesc: "标题字体带有笔画装饰。",
    fontCurrentTitle: ({ font }) => `当前字体：${font}`,
    fontSizeByArea: "分区字号",
    fontSizeHeader: '标题',
    fontSizeCards: '卡片',
    fontSizeTabs: "标签页",
    fontSizeSmall: "小号",
    fontSizeDefault: "标准",
    fontSizeLarge: "大号",
    fontSizeSmallShort: "小号",
    fontSizeDefaultShort: "标准",
    fontSizeLargeShort: "大号",
    privacyHint: "按 <kbd>Esc</kbd> 返回标签页",
    privacySettingsTitle: "遮屏设置",
    customize: '自定义',
    clock: '时钟',
    date: '日期',
    customText: "显示文字",
    externalFavicons: "联网取图标",
    externalFaviconsDisclosure: "默认关闭，可自行开启。\n开启后，会向第三方发送网站域名。\n用于获取网站图标。\n服务方：DuckDuckGo。\n接收地址：\nicons.duckduckgo.com",
    mottoPlaceholder: "写一句想显示的话",
    closeExtras: "关闭多余页",
    search: "搜索标签页",
    savedForLater: "稍后再看",
    savedSessionsTitle: "网页合集",
    savedSessionsEmpty: "还没有保存网页合集。",
    deferredEmpty: "暂无待看网页。",
    archive: "已看完",
    clearArchive: "清空记录",
    archiveSearchPlaceholder: "搜索已看内容",
    versionLabel: ({ version }) => `当前版本：${version}`,
    homepages: "网站首页",
    localFiles: '本地文件',
    multipleSites: '多个网站',
    tabsLabel: '标签页',
    tabsCompact: ({ count }) => `${count} 个标签页`,
    windowsCompact: ({ count }) => `${count} 个窗口`,
    domainTabSummary: ({ domainCount, tabCount }) => `${domainCount} 个网站，${tabCount} 个标签页`,
    groupTabSummary: ({ groupCount, tabCount }) => `${groupCount} 个分组，${tabCount} 个标签页`,
    viewGroups: "按分组",
    viewDomains: "按网站",
    viewModeLabel: "查看方式",
    domainSortLabel: "网站排序",
    domainSortStable: '固定顺序',
    domainSortChrome: "浏览器顺序",
    domainSortCount: "标签页数量",
    domainSortName: "网站名称",
    domainSortCurrent: ({ mode }) => `排序：${mode}`,
    pinDomainCard: '置顶卡片',
    unpinDomainCard: '取消置顶',
    pinnedDomainCard: '已置顶',
    notGrouped: "未分组",
    ungroupedInboxHint: "尚未加入分组的标签页",
    smartGroup: "自动分组",
    smartGroupHint: "只整理尚未分组的标签页。\n同一网站有两个以上时，归为一组。",
    saveAll: '保存全部',
    createGroupFromDomain: "新建分组",
    unnamedGroup: "未命名",
    saveForLater: "保存并关闭",
    closeThisTab: "关闭标签页",
    focusThisTab: "切换到此页",
    quickReturnHint: "Ctrl+Shift+Z 返回",
    currentTab: "当前标签页",
    expandHiddenTabs: "展开更多",
    dismiss: "删除记录",
    ungroup: "取消分组",
    createGroup: "新建分组",
    renameGroup: "改名",
    recolorGroup: "更换颜色",
    groupActions: '分组操作',
    cardActions: '卡片操作',
    moreActions: '更多操作',
    groupColorPickerLabel: '分组颜色',
    groupColorCurrent: "已选",
    groupColorGrey: '灰色',
    groupColorBlue: '蓝色',
    groupColorRed: '红色',
    groupColorYellow: '黄色',
    groupColorGreen: '绿色',
    groupColorPink: '粉色',
    groupColorPurple: '紫色',
    groupColorCyan: '青色',
    groupColorOrange: '橙色',
    collapseGroup: "收起",
    expandGroup: '展开',
    saveGroup: "保存合集",
    restoreSession: "一起打开",
    restoreSessionWindows: "分窗口打开",
    deleteSession: "删除合集",
    undo: '撤销',
    dismissToast: "关闭提示",
    savedSessionTabs: ({ count }) => `${count} 个标签页`,
    noResults: "没找到结果",
    inboxZeroTitle: "暂无标签页",
    inboxZeroSubtitle: "打开网页后，会显示在这里。",
    justNow: '刚刚',
    yesterday: '昨天',
    tabOutDupeBanner: ({ count }) => `已打开 <strong id="tabOutDupeCount">${count}</strong> 个 BrowseLoom 页面。只保留当前这个？`,
    tabsOpen: ({ count }) => `已打开 ${count} 个标签页`,
    duplicates: ({ count }) => `${count} 个重复页`,
    more: ({ count }) => `另有 ${count} 个`,
    closeAllTabs: "全部关闭",
    bulkCloseTitle: "关闭标签页？",
    bulkCloseButton: "确认关闭",
    bulkCloseScopeAll: "全部已打开的标签页",
    bulkCloseScopeDomain: ({ label }) => `网站「${label}」`,
    bulkCloseScopeGroup: ({ label }) => `分组「${label}」`,
    bulkCloseScopeUngrouped: "全部未分组标签页",
    bulkCloseScopeDuplicates: "本次选中的重复页",
    bulkCloseScopeExtraDashboards: "多余的 BrowseLoom 页面",
    bulkCloseBody: ({ count, scope, protectedCount = 0 }) => `将关闭 ${count} 个标签页。\n范围：${scope}。\n固定标签页、浏览器页面和扩展页保留。${protectedCount ? `\n已排除 ${protectedCount} 个需保留的页面。` : ""}`,
    closeDuplicates: "关闭重复页",
    domainCount: ({ count }) => `${count} 个网站`,
    groupCount: ({ count }) => `${count} 个分组`,
    ungroupedCount: ({ count }) => `${count} 个未分组标签页`,
    itemCount: ({ count }) => `${count} 项`,
    minAgo: ({ count }) => `${count} 分钟前`,
    hrAgo: ({ count }) => `${count} 小时前`,
    daysAgo: ({ count }) => `${count} 天前`,
    toastClosedExtraTabOut: "已关闭多余的BrowseLoom页面。",
    toastTabClosed: "已关闭标签页。",
    toastSaveFailed: "保存失败，请重试。",
    toastSavedForLater: "已加入稍后再看。",
    toastClosedFromGroup: ({ count, label }) => `已关闭 ${count} 个标签页。\n来自：${label}`,
    toastClosedUngrouped: ({ count }) => `已关闭 ${count} 个未分组标签页。`,
    toastClosedDuplicates: "已关闭重复页，每个网址保留一页。",
    toastClosedChromeGroup: ({ count }) => `已关闭组内 ${count} 个标签页。`,
    toastUngrouped: ({ count }) => `已将 ${count} 个标签页移出分组。`,
    toastAllTabsClosed: "已关闭全部可关闭的标签页。",
    toastBulkTabsClosed: ({ count }) => `已关闭 ${count} 个标签页。`,
    toastBulkTabsRestored: ({ count }) => `已重新打开 ${count} 个标签页。`,
    toastBulkTabsPartiallyRestored: ({ restored, failed }) => `已重新打开 ${restored} 个标签页。\n${failed} 个未能重新打开。`,
    toastBulkTabsRestoredWithoutGroups: ({ count }) => `已重新打开 ${count} 个标签页。\n部分分组未能恢复。`,
    toastBulkTabsRestoreFailed: "刚关闭的标签页未能重新打开。",
    toastNoTabsClosed: "本次未关闭任何标签页。\n这些页面可能已经关闭。",
    toastGroupCreated: "已新建浏览器分组。",
    toastSmartGrouped: ({ count }) => `已自动建好 ${count} 个分组。`,
    toastSmartGroupNone: "暂无可自动分组的标签页。",
    toastGroupUpdated: "已更新分组。",
    toastGroupUpdateFailed: "分组修改失败，请重试。",
    toastGroupSaved: "已将分组保存为网页合集。",
    toastSessionSaved: "已保存网页合集。",
    toastSessionRestored: "已打开合集，并恢复浏览器分组。",
    toastSessionRestoreFailed: "网页合集未能打开，请重试。",
    toastSessionDeleted: ({ title }) => `已删除合集「${title}」。`,
    toastSessionRestoredFromUndo: "已撤销删除，合集已恢复。",
    toastArchiveCleared: ({ count }) => `已清空 ${count} 条已看记录。`,
    toastArchiveRestored: ({ count }) => `已恢复 ${count} 条已看记录。`,
    toastDeferredRemoved: "已删除稍后再看记录。",
    toastDeferredRestored: "已恢复稍后再看记录。",
    toastStorageQuota: "保存空间已满。\n请删除不需要的记录后重试。",
    toastStorageFailed: "保存失败，请重试。",
    storageForwardTitle: "请先更新",
    storageForwardBody: "数据来自更新版本。\n为保护数据，当前版本已停止运行。\n更新扩展后即可继续。",
  },
};

let activeLanguage = getStoredLanguage();
let extensionVersion = '';

function getStoredLanguage() {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (LANGUAGES.includes(stored)) return stored;
  } catch {}
  const preset = document.documentElement.dataset.lang;
  return LANGUAGES.includes(preset) ? preset : 'en';
}

function tr(key, params = {}) {
  const value = (UI_COPY[activeLanguage] && UI_COPY[activeLanguage][key]) || UI_COPY.en[key] || key;
  return typeof value === 'function' ? value(params) : value;
}

function getRuntimeManifestVersion() {
  try {
    return chrome?.runtime?.getManifest?.().version || '';
  } catch {
    return '';
  }
}

async function loadExtensionVersion() {
  extensionVersion = getRuntimeManifestVersion();

  if (!extensionVersion && typeof fetch === 'function') {
    try {
      const response = await fetch('manifest.json');
      if (response.ok) {
        const manifest = await response.json();
        extensionVersion = manifest?.version || '';
      }
    } catch {}
  }

  syncExtensionVersionDisplay();
}

function syncExtensionVersionDisplay() {
  const versionEl = document.getElementById('extensionVersion');
  if (!versionEl) return;

  if (!extensionVersion) {
    versionEl.hidden = true;
    versionEl.textContent = '';
    versionEl.removeAttribute('aria-label');
    versionEl.removeAttribute('title');
    return;
  }

  versionEl.hidden = false;
  versionEl.textContent = `v${extensionVersion}`;
  const label = tr('versionLabel', { version: extensionVersion });
  versionEl.setAttribute('aria-label', label);
  versionEl.setAttribute('title', label);
}

function syncLanguageControls() {
  const languageSwitcher = document.getElementById('languageSwitcher');
  if (languageSwitcher) languageSwitcher.setAttribute('aria-label', tr('languageLabel'));

  const languageMenu = document.getElementById('languageMenu');
  if (languageMenu) languageMenu.setAttribute('aria-label', tr('languageLabel'));

  const activeLabel = document.getElementById('activeLanguageLabel');
  if (activeLabel) activeLabel.textContent = LANGUAGE_SHORT_LABELS[activeLanguage] || activeLanguage.toUpperCase();

  document.querySelectorAll('.language-option[data-language]').forEach(btn => {
    const lang = btn.dataset.language;
    const selected = lang === activeLanguage;
    btn.setAttribute('aria-pressed', selected ? 'true' : 'false');
    btn.classList.toggle('active', selected);

    const labelKey = LANGUAGE_LABEL_KEYS[lang];
    const label = labelKey ? tr(labelKey) : lang;
    const labelEl = btn.querySelector('.language-option-label');
    if (labelEl) labelEl.textContent = label;
    btn.setAttribute('title', label);
  });

  const currentBtn = document.getElementById('languageCurrentBtn');
  if (currentBtn) {
    const label = tr(LANGUAGE_LABEL_KEYS[activeLanguage] || 'languageLabel');
    const title = tr('languageCurrentTitle', { language: label });
    currentBtn.setAttribute('title', title);
    currentBtn.setAttribute('aria-label', title);
  }
}

function setLanguageMenuOpen(open) {
  const picker = document.getElementById('languageSwitcher');
  const button = document.getElementById('languageCurrentBtn');
  if (!picker || !button) return;
  picker.classList.toggle('language-menu-open', open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function toggleLanguageMenu() {
  const picker = document.getElementById('languageSwitcher');
  setLanguageMenuOpen(!picker?.classList.contains('language-menu-open'));
}

function initSettingsPanelLayout() {
  const panel = document.getElementById('privacySettings');
  const languageSlot = document.getElementById('settingsLanguageSlot');
  const themeSlot = document.getElementById('settingsThemeSlot');
  const fontSlot = document.getElementById('settingsFontSlot');
  const languageSwitcher = document.getElementById('languageSwitcher');
  const themePicker = document.getElementById('themePicker');
  const fontPicker = document.getElementById('fontPicker');

  if (languageSlot && languageSwitcher) languageSlot.append(languageSwitcher);
  if (themeSlot && themePicker) themeSlot.append(themePicker);
  if (fontSlot && fontPicker) fontSlot.append(fontPicker);
  if (panel && panel.parentElement !== document.body) document.body.append(panel);
}

const DEFAULT_WORKSPACE_STORAGE_KEY = 'tab-out-default-workspace';
const DEFAULT_WORKSPACES = ['tabs', 'bookmarks'];

function getDefaultWorkspace() {
  const current = document.documentElement.dataset.defaultWorkspace;
  return DEFAULT_WORKSPACES.includes(current) ? current : 'tabs';
}

function syncDefaultWorkspaceControls() {
  const current = getDefaultWorkspace();
  document.querySelectorAll('[data-default-workspace]').forEach(button => {
    const selected = button.dataset.defaultWorkspace === current;
    button.setAttribute('aria-checked', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  });
}

function applyDefaultWorkspace(workspace, { save = false } = {}) {
  const next = DEFAULT_WORKSPACES.includes(workspace) ? workspace : 'tabs';
  document.documentElement.dataset.defaultWorkspace = next;
  if (save) {
    try {
      localStorage.setItem(DEFAULT_WORKSPACE_STORAGE_KEY, next);
    } catch { /* Keep the selection for this page when localStorage is unavailable. */ }
  }
  syncDefaultWorkspaceControls();
  return next;
}

function initDefaultWorkspaceSettings() {
  applyDefaultWorkspace(getDefaultWorkspace(), { save: false });
  const controls = [...document.querySelectorAll('[data-default-workspace]')];
  controls.forEach((control, index) => {
    control.addEventListener('keydown', event => {
      const directions = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };
      let nextIndex = index;
      if (event.key in directions) nextIndex = (index + directions[event.key] + controls.length) % controls.length;
      else if (event.key === 'Home') nextIndex = 0;
      else if (event.key === 'End') nextIndex = controls.length - 1;
      else return;
      event.preventDefault();
      const nextControl = controls[nextIndex];
      applyDefaultWorkspace(nextControl.dataset.defaultWorkspace, { save: true });
      nextControl.focus();
    });
  });
}

let activeSettingsView = 'general';

function setSettingsView(view = 'general') {
  const activeView = ['general', 'search', 'appearance', 'privacy', 'data', 'about'].includes(view) ? view : 'general';
  activeSettingsView = activeView;

  document.querySelectorAll('.settings-tab[data-settings-view]').forEach(tab => {
    const selected = tab.dataset.settingsView === activeView;
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-current', selected ? 'page' : 'false');
  });

  document.querySelectorAll('.settings-pane[data-settings-pane]').forEach(pane => {
    const selected = pane.dataset.settingsPane === activeView;
    pane.classList.toggle('active', selected);
    pane.hidden = !selected;
  });

  if (activeView !== 'appearance') {
    setLanguageMenuOpen(false);
    setThemeMenuOpen(false);
    setFontMenuOpen(false);
  }
  document.dispatchEvent(new CustomEvent('browseloom-settings-view-change', { detail: { view: activeView } }));
}

function applyStaticTranslations() {
  document.documentElement.lang = activeLanguage === 'zh' ? 'zh-CN' : 'en';
  document.documentElement.dataset.lang = activeLanguage;
  document.title = tr('documentTitle');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = tr(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-html]').forEach(el => {
    el.innerHTML = tr(el.dataset.i18nHtml);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    el.setAttribute('placeholder', tr(el.dataset.i18nPlaceholder));
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.setAttribute('title', tr(el.dataset.i18nTitle));
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    el.setAttribute('aria-label', tr(el.dataset.i18nAriaLabel));
  });

  const themeMenu = document.getElementById('themeMenu');
  if (themeMenu) themeMenu.setAttribute('aria-label', tr('themeLabel'));
  const fontMenu = document.getElementById('fontMenu');
  if (fontMenu) fontMenu.setAttribute('aria-label', tr('fontLabel'));


  const privacyToggle = document.getElementById('privacyToggle');
  if (privacyToggle) {
    privacyToggle.setAttribute('title', tr('privacyToggleTitle'));
    privacyToggle.setAttribute('aria-label', tr('privacyToggleTitle'));
  }
  document.querySelectorAll('.global-settings-trigger').forEach(button => {
    button.setAttribute('title', tr('settingsTitle'));
    button.setAttribute('aria-label', tr('settingsTitle'));
  });
  const toolbarMoreBtn = document.getElementById('toolbarMoreBtn');
  if (toolbarMoreBtn) {
    toolbarMoreBtn.setAttribute('title', tr('moreActions'));
    toolbarMoreBtn.setAttribute('aria-label', tr('moreActions'));
  }
  const toolbarActionsMenu = document.getElementById('toolbarActionsMenu');
  if (toolbarActionsMenu) toolbarActionsMenu.setAttribute('aria-label', tr('moreActions'));

  syncLanguageControls();
  syncThemeControls();
  syncFontControls();
  syncExtensionVersionDisplay();

  checkTabOutDupes();
}

function setLanguage(lang, { save = false, rerender = false } = {}) {
  if (!LANGUAGES.includes(lang)) return;
  activeLanguage = lang;
  if (save) {
    try { localStorage.setItem(LANGUAGE_STORAGE_KEY, lang); } catch {}
  }
  applyStaticTranslations();
  document.dispatchEvent(new CustomEvent('super-tab-out-language-change', { detail: { language: activeLanguage } }));
  updatePrivacyClock();
  if (rerender) renderDashboard();
}

function initLanguageSwitcher() {
  setLanguage(activeLanguage, { save: false, rerender: false });
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — chrome.storage.local

   Replaces the old server-side SQLite + REST API with Chrome's
   built-in key-value storage. Data persists across browser sessions
   and doesn't require a running server.

   Data shape stored under the "deferred" key:
   [
     {
       id: "1712345678901",          // timestamp-based unique ID
       url: "https://example.com",
       title: "Example Page",
       savedAt: "2026-04-04T10:00:00.000Z",  // ISO date string
       completed: false              // true = checked off (archived)
     },
     ...
   ]
   ---------------------------------------------------------------- */

/**
 * saveTabForLater(tab)
 *
 * Saves a single tab to the "Saved for Later" list in chrome.storage.local.
 * @param {{ url: string, title: string }} tab
 */
async function saveTabForLater(tab) {
  if (StorageService?.addDeferredTab) {
    await StorageService.addDeferredTab(tab);
    return;
  }
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  deferred.push({
    id:        Date.now().toString(),
    url:       tab.url,
    title:     tab.title,
    savedAt:   new Date().toISOString(),
    completed: false,
  });
  await chrome.storage.local.set({ deferred });
}

/**
 * getSavedTabs()
 *
 * Returns all saved tabs from chrome.storage.local.
 * Splits into active (not completed) and archived (completed).
 */
async function getSavedTabs() {
  if (StorageService?.getSavedTabs) return await StorageService.getSavedTabs();
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const visible = deferred;
  return {
    active:   visible.filter(t => !t.completed),
    archived: visible.filter(t => t.completed),
  };
}

async function getSavedSessions() {
  if (StorageService?.getSavedSessions) return await StorageService.getSavedSessions();
  try {
    const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
    return Array.isArray(savedSessions) ? savedSessions : [];
  } catch {
    return [];
  }
}

async function addSavedSession(session) {
  if (StorageService?.addSavedSession) {
    await StorageService.addSavedSession(session);
    return;
  }
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  savedSessions.unshift(session);
  await chrome.storage.local.set({ savedSessions });
}

async function removeSavedSession(id) {
  if (StorageService?.removeSavedSession) {
    return await StorageService.removeSavedSession(id);
  }
  const { savedSessions = [] } = await chrome.storage.local.get('savedSessions');
  const currentSessions = Array.isArray(savedSessions) ? savedSessions : [];
  const nextSessions = currentSessions.filter(session => session.id !== id);
  await chrome.storage.local.set({ savedSessions: nextSessions });
  return nextSessions.length !== currentSessions.length;
}

async function restoreSavedSession(session, index = 0) {
  if (StorageService?.restoreSavedSession) {
    return await StorageService.restoreSavedSession(session, index);
  }
  const sessions = await getSavedSessions();
  if (!session?.id || sessions.some(item => item.id === session.id)) return false;
  const nextSessions = sessions.slice();
  const insertIndex = Math.max(0, Math.min(Number(index) || 0, nextSessions.length));
  nextSessions.splice(insertIndex, 0, session);
  if (StorageService?.setSavedSessions) await StorageService.setSavedSessions(nextSessions);
  else await chrome.storage.local.set({ savedSessions: nextSessions });
  return true;
}

async function recordActivity(event) {
  try {
    if (StorageService?.recordActivity) await StorageService.recordActivity(event);
  } catch {}
}

async function saveTabsAsSession(tabs, name) {
  const sessionTabs = (tabs || [])
    .filter(tab => tab?.url && !tab.pinned)
    .sort((a, b) => {
      if (a.windowId !== b.windowId) return a.windowId - b.windowId;
      return (a.index || 0) - (b.index || 0);
    });

  const byWindow = new Map();
  for (const tab of sessionTabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  const windows = Array.from(byWindow.values()).map((windowTabs, windowIndex) => {
    const groupKeys = new Map();
    return {
      index: windowIndex,
      tabs: windowTabs.map((tab, tabIndex) => {
        const grouped = Number.isFinite(tab.groupId) && tab.groupId >= 0;
        if (grouped && !groupKeys.has(tab.groupId)) groupKeys.set(tab.groupId, `group-${groupKeys.size + 1}`);
        return {
          url: tab.url,
          title: tab.title || tab.url,
          index: tabIndex,
          groupKey: grouped ? groupKeys.get(tab.groupId) : '',
          groupTitle: tab.groupTitle || '',
          groupColor: tab.groupColor || '',
        };
      }),
    };
  });

  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: name || `Session ${new Date().toLocaleString()}`,
    savedAt: new Date().toISOString(),
    group: sessionTabs.find(tab => tab.groupTitle)?.groupTitle || name || '',
    groupColor: sessionTabs.find(tab => tab.groupColor)?.groupColor || '',
    windows,
  };
  await addSavedSession(session);
  await recordActivity({ type: 'sessionSaved', count: 1 });
  return session;
}

async function restoreSavedSessionToChrome(session, mode = 'currentWindow') {
  if (TabsService?.restoreSavedSession) {
    let windowId = null;
    try {
      windowId = (await chrome.windows.getCurrent())?.id;
    } catch {}
    return await TabsService.restoreSavedSession(session, {
      windowId,
      focused: false,
      active: false,
      mode,
    });
  }
  const urls = savedSessionTabs(session).map(tab => tab.url).filter(Boolean);
  if (!urls.length) return null;
  return await chrome.windows.create({ url: urls });
}

/**
 * checkOffSavedTab(id)
 *
 * Marks a saved tab as completed (checked off). It moves to the archive.
 */
async function checkOffSavedTab(id) {
  if (StorageService?.updateDeferredTab) {
    await StorageService.updateDeferredTab(id, {
      completed: true,
      completedAt: new Date().toISOString(),
    });
    return;
  }
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const tab = deferred.find(t => t.id === id);
  if (tab) {
    tab.completed = true;
    tab.completedAt = new Date().toISOString();
    await chrome.storage.local.set({ deferred });
  }
}

/**
 * dismissSavedTab(id)
 *
 * Physically removes a saved tab and returns it for short-lived undo.
 */
async function dismissSavedTab(id) {
  if (StorageService?.removeDeferredTab) {
    return await StorageService.removeDeferredTab(id);
  }
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const index = deferred.findIndex(t => t.id === id);
  if (index === -1) return null;
  const [removed] = deferred.splice(index, 1);
  await chrome.storage.local.set({ deferred });
  return removed;
}

async function clearArchivedSavedTabs() {
  if (StorageService?.clearArchivedDeferredTabs) {
    return await StorageService.clearArchivedDeferredTabs();
  }
  const { deferred = [] } = await chrome.storage.local.get('deferred');
  const current = Array.isArray(deferred) ? deferred : [];
  const next = current.filter(tab => !tab.completed);
  await chrome.storage.local.set({ deferred: next });
  return current.length - next.length;
}

async function restoreArchivedSavedTabs(archivedTabs) {
  const archived = Array.isArray(archivedTabs) ? archivedTabs : [];
  if (archived.length === 0) return 0;

  if (StorageService?.restoreDeferredTabs) {
    return await StorageService.restoreDeferredTabs(archived);
  }

  const current = StorageService?.getDeferred
    ? await StorageService.getDeferred()
    : ((await chrome.storage.local.get('deferred')).deferred || []);
  const currentList = Array.isArray(current) ? current : [];
  const existingIds = new Set(currentList.map(tab => tab.id).filter(Boolean));
  const toRestore = archived.filter(tab => tab?.id && !existingIds.has(tab.id));
  if (toRestore.length === 0) return 0;

  const next = [...currentList, ...toRestore];
  if (StorageService?.setDeferred) await StorageService.setDeferred(next);
  else await chrome.storage.local.set({ deferred: next });
  return toRestore.length;
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  if (prefersReducedMotion()) return;
  const colors = [
    '#c8713a', // amber
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;
  if (prefersReducedMotion()) {
    card.remove();
    checkAndShowEmptyState();
    return;
  }

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
let toastHideTimer = null;

function hideToast() {
  const toast = document.getElementById('toast');
  if (toastHideTimer) clearTimeout(toastHideTimer);
  toastHideTimer = null;
  toast?.classList.remove('visible');
  toast?.querySelector('.toast-action')?.remove();
}

function showToast(message, options = {}) {
  const toast = document.getElementById('toast');
  const text = document.getElementById('toastText');
  const dismiss = document.getElementById('toastDismiss');
  if (!toast || !text || !dismiss) return;

  if (toastHideTimer) clearTimeout(toastHideTimer);

  text.textContent = message;
  toast.querySelector('.toast-action')?.remove();
  dismiss.setAttribute('aria-label', tr('dismissToast'));
  dismiss.onclick = hideToast;

  if (options.actionLabel && typeof options.onAction === 'function') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toast-action';
    button.textContent = options.actionLabel;
    const handleAction = async () => {
      button.disabled = true;
      hideToast();
      try { await options.onAction(); } catch (err) {
        console.error('[tab-out] Toast action failed:', err);
        showToast(tr('toastStorageFailed'));
      }
    };
    button.addEventListener('click', handleAction);
    toast.insertBefore(button, dismiss);
  }

  toast.classList.add('visible');
  toastHideTimer = setTimeout(hideToast, options.duration || (options.actionLabel ? 7000 : 2500));
}

window.SuperTabOutToast = { show: showToast, dismiss: hideToast };

let pendingBulkClose = null;
let bulkCloseBusy = false;
let bulkClosePreparing = false;

async function openBulkTabCloseConfirm({ tabIds, scope, trigger, allowDashboard = false, activity = null }) {
  const dialog = document.getElementById('bulkTabConfirmDialog');
  const title = document.getElementById('bulkTabConfirmTitle');
  const text = document.getElementById('bulkTabConfirmText');
  const submit = document.getElementById('bulkTabConfirmSubmit');
  if (!dialog || !title || !text || !submit || dialog.open || bulkCloseBusy || bulkClosePreparing) return;

  bulkClosePreparing = true;
  try {
    const plan = await TabsService?.prepareBulkClose?.(tabIds, { allowDashboard });
    if (dialog.open) return;
    if (!plan?.count) {
      showToast(tr('toastNoTabsClosed'));
      return;
    }
    pendingBulkClose = {
      tabIds: plan.snapshot.tabs.map(tab => tab.id),
      scope,
      trigger: trigger instanceof HTMLElement ? trigger : null,
      allowDashboard,
      activity,
    };
    const protectedCount = plan.protectedPinned + plan.protectedInternal;
    title.textContent = tr('bulkCloseTitle', { count: plan.count });
    text.textContent = tr('bulkCloseBody', { count: plan.count, scope, protectedCount });
    submit.textContent = tr('bulkCloseButton', { count: plan.count });
    submit.disabled = false;
    dialog.showModal();
    requestAnimationFrame(() => document.getElementById('bulkTabConfirmCancel')?.focus({ preventScroll: true }));
  } catch (error) {
    console.error('[tab-out] Failed to prepare bulk close:', error);
    showToast(tr('toastNoTabsClosed'));
  } finally {
    bulkClosePreparing = false;
  }
}

function offerClosedTabsUndo(result, message = tr('toastBulkTabsClosed', { count: result?.closedCount || 0 })) {
  if (!result?.closedCount || !result.snapshot) return;
  showToast(message, {
    actionLabel: tr('undo'),
    duration: 7000,
    onAction: async () => {
      const restored = await TabsService.restoreClosedTabs(result.snapshot);
      await renderDashboard();
      if (restored.restoredCount === 0) {
        showToast(tr('toastBulkTabsRestoreFailed'));
      } else if (restored.failedCount > 0) {
        showToast(tr('toastBulkTabsPartiallyRestored', {
          restored: restored.restoredCount,
          failed: restored.failedCount,
        }));
      } else if (restored.groupFailedCount > 0) {
        showToast(tr('toastBulkTabsRestoredWithoutGroups', { count: restored.restoredCount }));
      } else {
        showToast(tr('toastBulkTabsRestored', { count: restored.restoredCount }));
      }
    },
  });
}

async function confirmBulkTabClose(event) {
  event.preventDefault();
  if (!pendingBulkClose || bulkCloseBusy) return;
  const pending = pendingBulkClose;
  const dialog = document.getElementById('bulkTabConfirmDialog');
  const submit = document.getElementById('bulkTabConfirmSubmit');
  const cancel = document.getElementById('bulkTabConfirmCancel');
  bulkCloseBusy = true;
  if (submit) submit.disabled = true;
  if (cancel) cancel.disabled = true;

  try {
    const result = await TabsService?.closeTabsWithSnapshot?.(pending.tabIds, { allowDashboard: pending.allowDashboard });
    if (dialog?.open) dialog.close('confirmed');
    if (!result?.closedCount) {
      showToast(tr('toastNoTabsClosed'));
      return;
    }

    playCloseSound();
    await renderDashboard();
    await recordActivity({ type: 'closed', count: result.closedCount, ...(pending.activity || {}) });
    offerClosedTabsUndo(result);
  } catch (error) {
    console.error('[tab-out] Failed to close tabs:', error);
    if (dialog?.open) dialog.close('error');
    showToast(tr('toastNoTabsClosed'));
  } finally {
    bulkCloseBusy = false;
    if (submit) submit.disabled = false;
    if (cancel) cancel.disabled = false;
  }
}

const bulkTabConfirmDialog = document.getElementById('bulkTabConfirmDialog');
document.getElementById('bulkTabConfirmForm')?.addEventListener('submit', confirmBulkTabClose);
document.getElementById('bulkTabConfirmCancel')?.addEventListener('click', () => bulkTabConfirmDialog?.close('cancel'));
bulkTabConfirmDialog?.addEventListener('cancel', event => {
  if (bulkCloseBusy) event.preventDefault();
});
bulkTabConfirmDialog?.addEventListener('click', event => {
  if (!bulkCloseBusy && event.target === bulkTabConfirmDialog) bulkTabConfirmDialog.close('cancel');
});
bulkTabConfirmDialog?.addEventListener('close', () => {
  const trigger = pendingBulkClose?.trigger;
  pendingBulkClose = null;
  if (trigger?.isConnected) trigger.focus({ preventScroll: true });
});

function initStorageErrorToasts() {
  if (!StorageService?.onStorageError) return;
  StorageService.onStorageError((detail) => {
    showToast(tr(detail.quota ? 'toastStorageQuota' : 'toastStorageFailed'));
  });
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">${escapeHtml(tr('inboxZeroTitle'))}</div>
      <div class="empty-subtitle">${escapeHtml(tr('inboxZeroSubtitle'))}</div>
    </div>
  `;

}

/**
 * timeAgo(dateStr)
 *
 * Converts an ISO date string into a human-friendly relative time.
 * "2026-04-04T10:00:00Z" → "2 hrs ago" or "yesterday"
 */
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const then = new Date(dateStr);
  const now  = new Date();
  const diffMins  = Math.floor((now - then) / 60000);
  const diffHours = Math.floor((now - then) / 3600000);
  const diffDays  = Math.floor((now - then) / 86400000);

  if (diffMins < 1)   return tr('justNow');
  if (diffMins < 60)  return tr('minAgo', { count: diffMins });
  if (diffHours < 24) return tr('hrAgo', { count: diffHours });
  if (diffDays === 1) return tr('yesterday');
  return tr('daysAgo', { count: diffDays });
}

/* ----------------------------------------------------------------
   HTML ESCAPE — prevents XSS when tab titles/URLs are injected into
   innerHTML. Tab titles come from arbitrary web pages, so they must
   be treated as untrusted input.
   ---------------------------------------------------------------- */
function escapeHtml(str) {
  if (window.SuperTabOutHtml?.escapeHtml) return window.SuperTabOutHtml.escapeHtml(str);
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Only allow http/https/file as href targets, so a saved tab with a
// javascript: URL can't execute script when clicked.
function isSafeNavUrl(url) {
  return Boolean(window.SuperTabOutUrls?.isRestorableUrl?.(url));
}


/* ----------------------------------------------------------------
   FAVICON URL + LOCAL CACHE

   We ask DuckDuckGo for favicons (no ad-targeting identity surface,
   unlike Google's s2/favicons endpoint). To avoid hitting DDG on every
   new-tab open for the same hosts, successful loads are snapshotted to
   localStorage as 16×16 PNG data URLs and reused for 7 days.

   localStorage fits the shape: synchronous read from <head>/render time,
   ~1–2 KB per entry, ~5 MB quota = thousands of domains easily. chrome.
   storage.local is async and would reintroduce render jank here.

   The snapshot happens in a delegated `load` listener (capture phase, in
   app.js's INIT block), not an inline `onload=` — MV3's default CSP
   forbids inline event handlers.
   ---------------------------------------------------------------- */
const FAVICON_CACHE_PREFIX = 'favicon:';
const FAVICON_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
let externalFaviconsEnabled = false;

function readCachedFavicon(domain) {
  if (!domain) return null;
  try {
    const raw = localStorage.getItem(FAVICON_CACHE_PREFIX + domain);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.data || !entry.ts) return null;
    if (Date.now() - entry.ts > FAVICON_CACHE_TTL_MS) {
      localStorage.removeItem(FAVICON_CACHE_PREFIX + domain);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function faviconUrlFor(domain) {
  if (!domain) return '';
  if (domain === 'localhost' || domain === '127.0.0.1' || domain === '[::1]') return '';
  const cached = readCachedFavicon(domain);
  if (cached) return cached;
  if (!externalFaviconsEnabled) return '';
  return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
}

// Snapshot a freshly-loaded favicon <img> into localStorage. Needs the
// image to be CORS-clean. DuckDuckGo's icon endpoint may not provide CORS
// headers, so external icons are allowed to render normally; if the canvas
// gets tainted we silently give up and the next render just refetches.
function cacheFaviconFromImg(domain, img) {
  if (!externalFaviconsEnabled) return;
  if (!domain || !img || !img.naturalWidth) return;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    canvas.getContext('2d').drawImage(img, 0, 0, 16, 16);
    const dataUrl = canvas.toDataURL('image/png');
    localStorage.setItem(
      FAVICON_CACHE_PREFIX + domain,
      JSON.stringify({ data: dataUrl, ts: Date.now() })
    );
  } catch { /* tainted canvas or quota — ignore */ }
}

function cleanExpiredFavicons() {
  try {
    const now = Date.now();
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(FAVICON_CACHE_PREFIX)) continue;
      try {
        const entry = JSON.parse(localStorage.getItem(key) || 'null');
        if (!entry || !entry.ts || now - entry.ts > FAVICON_CACHE_TTL_MS) {
          localStorage.removeItem(key);
        }
      } catch { localStorage.removeItem(key); }
    }
  } catch {}
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  'github.com':           'GitHub',
  'www.github.com':       'GitHub',
  'gist.github.com':      'GitHub Gist',
  'cn.bing.com':          'Bing',
  'alidocs.dingtalk.com': 'DingTalk Docs',
  'youtube.com':          'YouTube',
  'www.youtube.com':      'YouTube',
  'music.youtube.com':    'YouTube Music',
  'x.com':                'X',
  'www.x.com':            'X',
  'twitter.com':          'X',
  'www.twitter.com':      'X',
  'reddit.com':           'Reddit',
  'www.reddit.com':       'Reddit',
  'old.reddit.com':       'Reddit',
  'substack.com':         'Substack',
  'www.substack.com':     'Substack',
  'medium.com':           'Medium',
  'www.medium.com':       'Medium',
  'linkedin.com':         'LinkedIn',
  'www.linkedin.com':     'LinkedIn',
  'stackoverflow.com':    'Stack Overflow',
  'www.stackoverflow.com':'Stack Overflow',
  'news.ycombinator.com': 'Hacker News',
  'google.com':           'Google',
  'www.google.com':       'Google',
  'mail.google.com':      'Gmail',
  'docs.google.com':      'Google Docs',
  'drive.google.com':     'Google Drive',
  'calendar.google.com':  'Google Calendar',
  'meet.google.com':      'Google Meet',
  'gemini.google.com':    'Gemini',
  'chatgpt.com':          'ChatGPT',
  'www.chatgpt.com':      'ChatGPT',
  'chat.openai.com':      'ChatGPT',
  'claude.ai':            'Claude',
  'www.claude.ai':        'Claude',
  'code.claude.com':      'Claude Code',
  'notion.so':            'Notion',
  'www.notion.so':        'Notion',
  'figma.com':            'Figma',
  'www.figma.com':        'Figma',
  'slack.com':            'Slack',
  'app.slack.com':        'Slack',
  'discord.com':          'Discord',
  'www.discord.com':      'Discord',
  'wikipedia.org':        'Wikipedia',
  'en.wikipedia.org':     'Wikipedia',
  'amazon.com':           'Amazon',
  'www.amazon.com':       'Amazon',
  'netflix.com':          'Netflix',
  'www.netflix.com':      'Netflix',
  'spotify.com':          'Spotify',
  'open.spotify.com':     'Spotify',
  'vercel.com':           'Vercel',
  'www.vercel.com':       'Vercel',
  'npmjs.com':            'npm',
  'www.npmjs.com':        'npm',
  'developer.mozilla.org':'MDN',
  'arxiv.org':            'arXiv',
  'www.arxiv.org':        'arXiv',
  'huggingface.co':       'Hugging Face',
  'www.huggingface.co':   'Hugging Face',
  'producthunt.com':      'Product Hunt',
  'www.producthunt.com':  'Product Hunt',
  'xiaohongshu.com':      'RedNote',
  'www.xiaohongshu.com':  'RedNote',
  'local-files':          'Local Files',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
  more:    `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor" viewBox="0 0 24 24"><path d="M5 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm7 0a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" /></svg>`,
  chevron:`<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6" /></svg>`,
  pin:     `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 17.25V21m-4.5-9.75 1.125-6.375h6.75l1.125 6.375 2.25 2.25v.75H5.25v-.75l2.25-2.25Z" /></svg>`,
  sort:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.8" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M4 7h11M4 12h8M4 17h5m8-9v10m0 0-3-3m3 3 3-3" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];

const DOMAIN_CARD_DRAG_TOLERANCE = 7;
const domainCardDragState = {
  pointerId: null,
  startX: 0,
  startY: 0,
  draggedKey: '',
  targetKey: '',
  position: 'before',
  dragging: false,
  settleTimer: null,
};

function visibleDomainCards() {
  return Array.from(document.querySelectorAll('#openTabsMissions .domain-card[data-domain-key]'));
}

function syncDomainCardDragClasses() {
  const missions = document.getElementById('openTabsMissions');
  missions?.classList.toggle('domain-card-sorting', domainCardDragState.dragging);
  visibleDomainCards().forEach(card => {
    const key = card.dataset.domainKey || '';
    const isTarget = domainCardDragState.dragging && key === domainCardDragState.targetKey;
    card.classList.toggle('dragging', domainCardDragState.dragging && key === domainCardDragState.draggedKey);
    card.classList.toggle('drop-before', isTarget && domainCardDragState.position === 'before');
    card.classList.toggle('drop-after', isTarget && domainCardDragState.position === 'after');
  });
}

function resetDomainCardDragState() {
  domainCardDragState.pointerId = null;
  domainCardDragState.draggedKey = '';
  domainCardDragState.targetKey = '';
  domainCardDragState.position = 'before';
  domainCardDragState.dragging = false;
  syncDomainCardDragClasses();
}

function closestDomainCardAtPoint(event, candidates) {
  const direct = document.elementsFromPoint(event.clientX, event.clientY)
    .map(element => element.closest?.('.domain-card[data-domain-key]'))
    .find(card => card && candidates.includes(card));
  if (direct) return direct;

  let closest = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const card of candidates) {
    const rect = card.getBoundingClientRect();
    const dx = Math.max(rect.left - event.clientX, 0, event.clientX - rect.right);
    const dy = Math.max(rect.top - event.clientY, 0, event.clientY - rect.bottom);
    const distance = dx * dx + dy * dy;
    if (distance < closestDistance) {
      closest = card;
      closestDistance = distance;
    }
  }
  return closest;
}

function handleDomainCardPointerDown(event) {
  const target = event.target instanceof Element ? event.target : null;
  const card = target?.closest('#openTabsMissions .domain-card-sortable[data-domain-key]');
  if (!card || event.pointerType === 'touch') return;
  if (target.closest('button, a, input, select, textarea, [role="button"], [role="menuitem"], [role="menuitemradio"]')) return;
  if (event.button != null && event.button !== 0) return;

  if (domainCardDragState.settleTimer) clearTimeout(domainCardDragState.settleTimer);
  domainCardDragState.settleTimer = null;
  document.querySelectorAll('#openTabsMissions .domain-card.settled').forEach(item => item.classList.remove('settled'));

  domainCardDragState.pointerId = event.pointerId;
  domainCardDragState.startX = event.clientX;
  domainCardDragState.startY = event.clientY;
  domainCardDragState.draggedKey = card.dataset.domainKey || '';
}

function handleDomainCardPointerMove(event) {
  if (domainCardDragState.pointerId !== event.pointerId || !domainCardDragState.draggedKey) return;
  const cards = visibleDomainCards();
  const draggedCard = cards.find(card => card.dataset.domainKey === domainCardDragState.draggedKey);
  if (!draggedCard) {
    resetDomainCardDragState();
    return;
  }

  if (!domainCardDragState.dragging) {
    const dx = Math.abs(event.clientX - domainCardDragState.startX);
    const dy = Math.abs(event.clientY - domainCardDragState.startY);
    if (Math.max(dx, dy) < DOMAIN_CARD_DRAG_TOLERANCE) return;
    domainCardDragState.dragging = true;
    closeGroupActionMenus();
    try { draggedCard.setPointerCapture?.(event.pointerId); } catch {}
  }

  const draggedPinned = draggedCard.classList.contains('domain-card-pinned');
  const candidates = cards.filter(card =>
    card !== draggedCard && card.classList.contains('domain-card-pinned') === draggedPinned
  );
  const targetCard = closestDomainCardAtPoint(event, candidates);
  if (targetCard) {
    const rect = targetCard.getBoundingClientRect();
    domainCardDragState.targetKey = targetCard.dataset.domainKey || '';
    domainCardDragState.position = event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }
  syncDomainCardDragClasses();
  event.preventDefault();
}

async function handleDomainCardPointerEnd(event, { cancel = false } = {}) {
  if (domainCardDragState.pointerId !== event.pointerId && domainCardDragState.pointerId != null) return;
  const wasDragging = domainCardDragState.dragging;
  const draggedKey = domainCardDragState.draggedKey;
  const targetKey = domainCardDragState.targetKey;
  const position = domainCardDragState.position;
  const visibleKeys = visibleDomainCards().map(card => card.dataset.domainKey).filter(Boolean);
  resetDomainCardDragState();
  if (!wasDragging || cancel || !draggedKey || !targetKey) return;

  const order = TabsService?.reorderDomainCardOrder
    ? TabsService.reorderDomainCardOrder(domainCardPreferences.order, visibleKeys, draggedKey, targetKey, position)
    : domainCardPreferences.order;
  try {
    await saveDomainCardPreferences({ ...domainCardPreferences, order });
    await renderDashboard();
    const settledCard = document.querySelector(`#openTabsMissions .domain-card[data-domain-key="${CSS.escape(draggedKey)}"]`);
    settledCard?.classList.add('settled');
    if (domainCardDragState.settleTimer) clearTimeout(domainCardDragState.settleTimer);
    domainCardDragState.settleTimer = setTimeout(() => settledCard?.classList.remove('settled'), 360);
  } catch (error) {
    console.error('[tab-out] Failed to save dragged domain-card order:', error);
    showToast(tr('toastStorageFailed'));
    await renderDashboard();
  }
}

document.addEventListener('pointerdown', handleDomainCardPointerDown);
document.addEventListener('pointermove', handleDomainCardPointerMove);
document.addEventListener('pointerup', event => handleDomainCardPointerEnd(event));
document.addEventListener('pointercancel', event => handleDomainCardPointerEnd(event, { cancel: true }));


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  const extensionId = typeof chrome !== 'undefined' ? (chrome.runtime?.id || '') : '';
  if (TabsService?.isRealTab) {
    return openTabs.filter(t => TabsService.isRealTab(t, extensionId));
  }
  return openTabs.filter(t => {
    if (t.pinned) return false; // pinned tabs are sacred — keep them out of groups/stats
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const textEl  = document.getElementById('tabOutDupeText');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (textEl) {
      textEl.innerHTML = tr('tabOutDupeBanner', { count: tabOutTabs.length });
    } else if (countEl) {
      countEl.textContent = tabOutTabs.length;
    }
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function renderOpenTabRow(tab, { urlCounts = {}, titleHostname = '', showFavicon = true, extraClass = '' } = {}) {
  let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), titleHostname);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
  } catch {}

  const count = urlCounts[tab.url] || 1;
  const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeUrl = escapeHtml(tab.url || '');
  const safeTitle = escapeHtml(label);
  const safeTabId = tab.id == null ? '' : escapeHtml(String(tab.id));
  let domain = '';
  try { domain = new URL(tab.url).hostname; } catch {}
  const faviconUrl = showFavicon ? faviconUrlFor(domain) : '';
  const activeIndicator = `<span class="tab-active-indicator${tab.active ? ' is-active' : ''}"${tab.active ? ` title="${escapeHtml(tr('currentTab'))}"` : ''} aria-hidden="true"></span>`;
  const ariaPrefix = tab.active ? `${tr('currentTab')}. ` : '';

  const quickReturnHint = escapeHtml(tr('quickReturnHint'));

  return `<div class="page-chip clickable${chipClass}${extraClass ? ` ${extraClass}` : ''}" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${safeTitle} · ${quickReturnHint}" role="button" tabindex="0" aria-label="${escapeHtml(ariaPrefix + tr('focusThisTab'))}: ${safeTitle}. ${quickReturnHint}">
    ${activeIndicator}
    ${faviconUrl ? `<img class="chip-favicon" src="${escapeHtml(faviconUrl)}" alt="" data-favicon-domain="${escapeHtml(domain)}">` : ''}
    <span class="chip-text">${safeTitle}</span>${dupeTag}
    <div class="chip-actions">
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${escapeHtml(tr('saveForLaterHint'))}" aria-label="${escapeHtml(tr('saveForLater'))}: ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
      </button>
      <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${escapeHtml(tr('closeThisTab'))}" aria-label="${escapeHtml(tr('closeThisTab'))}: ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  </div>`;
}

function buildOverflowChips(hiddenTabs, urlCounts = {}, options = {}) {
  const hiddenChips = hiddenTabs
    .map(tab => renderOpenTabRow(tab, { ...options, urlCounts }))
    .join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips" role="button" tabindex="0" aria-label="${escapeHtml(tr('expandHiddenTabs'))}">
      <span class="chip-text">${escapeHtml(tr('more', { count: hiddenTabs.length }))}</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderDomainCard(group, groupIndex)
 *
 * Builds the HTML for one domain group card.
 * group = { domain: string, tabs: [{ url, title, id, windowId, active }] }
 */
function renderDomainCard(group) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');
  const safeDomainKey = escapeHtml(group.domain);
  const ports = new Set();
  for (const tab of tabs) {
    try {
      const parsed = new URL(tab.url);
      if (parsed.port) ports.add(parsed.port);
    } catch {}
  }
  const technicalHost = group.domain === 'localhost' || /^\d+(?:\.\d+){3}$/.test(group.domain) || /^\[.*\]$/.test(group.domain);
  const technicalName = technicalHost && ports.size === 1 ? `${group.domain}:${Array.from(ports)[0]}` : group.domain;
  const displayName = isLanding
    ? tr('homepages')
    : (group.label || (technicalHost ? technicalName : friendlyDomain(group.domain)));
  const subtitle = isLanding ? tr('multipleSites') : group.domain;
  const windowCount = new Set(tabs.map(tab => tab.windowId).filter(id => id != null)).size;
  const countMeta = tr('tabsCompact', { count: tabCount }) +
    (windowCount > 1 ? ` · ${tr('windowsCompact', { count: windowCount })}` : '');

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const visibleTabs = tabs.slice(0, 8);
  const extraCount = tabs.length - visibleTabs.length;
  const rowHostnames = new Set(tabs.map(tab => {
    try { return new URL(tab.url).hostname; } catch { return ''; }
  }).filter(Boolean));
  const showRowFavicons = rowHostnames.size > 1;
  const rowOptions = { urlCounts, titleHostname: isLanding ? '' : group.domain, showFavicon: showRowFavicons };
  const pageChips = visibleTabs.map(tab => renderOpenTabRow(tab, rowOptions)).join('') +
    (extraCount > 0 ? buildOverflowChips(tabs.slice(8), urlCounts, rowOptions) : '');

  const representativeDomain = rowHostnames.size === 1 ? Array.from(rowHostnames)[0] : '';
  const headerFaviconUrl = representativeDomain ? faviconUrlFor(representativeDomain) : '';
  const headerIcon = headerFaviconUrl
    ? `<img class="mission-header-icon" src="${escapeHtml(headerFaviconUrl)}" alt="" data-favicon-domain="${escapeHtml(representativeDomain)}">`
    : `<span class="mission-header-icon mission-header-icon-fallback" aria-hidden="true">${ICONS.tabs}</span>`;

  const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
  const actionsMenuId = `${stableId}-actions`;
  const pinnedDomains = new Set(domainCardPreferences.pinned || []);
  const isPinned = pinnedDomains.has(group.domain);
  const headerActionsHtml = `
    <span class="group-action-menu-control">
      <button class="icon-action-btn group-action-menu-btn" data-action="toggle-group-actions-menu"
              aria-haspopup="menu" aria-expanded="false" aria-controls="${actionsMenuId}"
              title="${escapeHtml(tr('moreActions'))}" aria-label="${escapeHtml(tr('cardActions'))}">
        ${ICONS.more}
      </button>
      <span class="group-action-menu" id="${actionsMenuId}" role="menu" aria-label="${escapeHtml(tr('cardActions'))}" popover="manual" hidden>
        <button class="group-menu-item" role="menuitem" data-action="${isPinned ? 'unpin-domain-card' : 'pin-domain-card'}" data-domain-key="${safeDomainKey}">${escapeHtml(tr(isPinned ? 'unpinDomainCard' : 'pinDomainCard'))}</button>
        <span class="group-menu-separator" aria-hidden="true"></span>
        <button class="group-menu-item" role="menuitem" data-action="create-native-group" data-domain-key="${safeDomainKey}">${escapeHtml(tr('createGroup'))}</button>
        ${hasDupes ? `<button class="group-menu-item" role="menuitem" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">${escapeHtml(tr('closeDuplicates', { count: totalExtras }))}</button>` : ''}
        <span class="group-menu-separator" aria-hidden="true"></span>
        <button class="group-menu-item danger" role="menuitem" data-action="close-domain-tabs" data-domain-key="${safeDomainKey}">${escapeHtml(tr('closeAllTabs', { count: tabCount }))}</button>
      </span>
    </span>`;

  return `
    <div class="mission-card domain-card${isPinned ? ' domain-card-pinned' : ''}${domainCardPreferences.sortMode === 'stable' ? ' domain-card-sortable' : ''} ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" data-domain-id="${stableId}" data-domain-key="${safeDomainKey}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top domain-card-top">
          ${headerIcon}
          <span class="mission-title-block">
            <span class="mission-name">${escapeHtml(displayName)}</span>
            <span class="mission-subtitle">${escapeHtml(subtitle)}</span>
          </span>
          <span class="domain-card-meta">
            ${isPinned ? `<span class="domain-pin-indicator" title="${escapeHtml(tr('pinnedDomainCard'))}" aria-hidden="true">${ICONS.pin}</span>` : ''}
            <span class="mission-count-meta">${escapeHtml(countMeta)}</span>
          </span>
          ${headerActionsHtml}
        </div>
        <div class="mission-pages">${pageChips}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${escapeHtml(tr('tabsLabel'))}</div>
      </div>
    </div>`;
}


/* ----------------------------------------------------------------
   SAVED FOR LATER — Render Checklist Column
   ---------------------------------------------------------------- */

/**
 * renderDeferredColumn()
 *
 * Reads saved tabs from chrome.storage.local and renders the right-side
 * "Saved for Later" checklist column. Shows active items as a checklist
 * and completed items in a collapsible archive.
 */
async function renderDeferredColumn() {
  const column         = document.getElementById('deferredColumn');
  const list           = document.getElementById('deferredList');
  const empty          = document.getElementById('deferredEmpty');
  const countEl        = document.getElementById('deferredCount');
  const archiveEl      = document.getElementById('deferredArchive');
  const archiveCountEl = document.getElementById('archiveCount');
  const archiveList    = document.getElementById('archiveList');

  if (!column) return;

  try {
    const { active, archived } = await getSavedTabs();

    // Hide the entire column if there's nothing to show
    if (active.length === 0 && archived.length === 0) {
      column.style.display = 'none';
      updateDashboardSideVisibility();
      return;
    }

    column.style.display = 'block';

    // Render active checklist items
    if (active.length > 0) {
      countEl.textContent = tr('itemCount', { count: active.length });
      list.innerHTML = active.map(item => renderDeferredItem(item)).join('');
      list.style.display = 'block';
      empty.style.display = 'none';
    } else {
      list.style.display = 'none';
      countEl.textContent = '';
      empty.style.display = 'block';
    }

    // Render archive section
    if (archived.length > 0) {
      archiveCountEl.textContent = `(${archived.length})`;
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      archiveEl.style.display = 'block';
    } else {
      archiveEl.style.display = 'none';
    }

  } catch (err) {
    console.warn('[tab-out] Could not load saved tabs:', err);
    column.style.display = 'none';
  } finally {
    updateDashboardSideVisibility();
  }
}

/**
 * renderDeferredItem(item)
 *
 * Builds HTML for one active checklist item: checkbox, title link,
 * domain, time ago, dismiss button.
 */
function renderDeferredItem(item) {
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  const faviconUrl = faviconUrlFor(domain);
  const ago = timeAgo(item.savedAt);
  const safeId    = escapeHtml(item.id);
  const safeUrl   = escapeHtml(isSafeNavUrl(item.url) ? item.url : '#');
  const safeTitle = escapeHtml(item.title || item.url || '');

  return `
    <div class="deferred-item" data-deferred-id="${safeId}" data-search-url="${safeUrl}" data-search-title="${safeTitle}" data-search-domain="${escapeHtml(domain)}">
      <input type="checkbox" class="deferred-checkbox" aria-label="${escapeHtml(tr('markRead'))}: ${safeTitle}" title="${escapeHtml(tr('markReadHint'))}" data-action="check-deferred" data-deferred-id="${safeId}">
      <div class="deferred-info">
        <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="deferred-title" title="${safeTitle}">
          ${faviconUrl ? `<img class="chip-favicon deferred-favicon" src="${escapeHtml(faviconUrl)}" alt="" data-favicon-domain="${escapeHtml(domain)}">` : ''}<span class="deferred-title-text">${safeTitle}</span>
        </a>
        <div class="deferred-meta">
          <span class="deferred-domain-text">${escapeHtml(domain)}</span>
          <span>${escapeHtml(ago)}</span>
        </div>
      </div>
      <button class="deferred-dismiss" data-action="dismiss-deferred" data-deferred-id="${safeId}" title="${escapeHtml(tr('dismiss'))}" aria-label="${escapeHtml(tr('dismiss'))}: ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>`;
}

/**
 * renderArchiveItem(item)
 *
 * Builds HTML for one completed/archived item (simpler: just title + date).
 */
function renderArchiveItem(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const safeId    = escapeHtml(item.id);
  const safeUrl   = escapeHtml(isSafeNavUrl(item.url) ? item.url : '#');
  const safeTitle = escapeHtml(item.title || item.url || '');
  let domain = '';
  try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch {}
  return `
    <div class="archive-item" data-deferred-id="${safeId}" data-search-url="${safeUrl}" data-search-title="${safeTitle}" data-search-domain="${escapeHtml(domain)}">
      <a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="archive-item-title" title="${safeTitle}">
        <span class="archive-item-title-text">${safeTitle}</span>
      </a>
      <span class="archive-item-date">${escapeHtml(ago)}</span>
    </div>`;
}

function updateDashboardSideVisibility() {
  const side = document.getElementById('dashboardSide');
  if (!side) return;
  const hasVisiblePanel = Array.from(side.children).some(child => child.style.display !== 'none');
  side.style.display = hasVisiblePanel ? 'flex' : 'none';
}

function savedSessionTabs(session) {
  if (Array.isArray(session?.windows) && session.windows.length > 0) {
    return session.windows.flatMap(window => Array.isArray(window?.tabs) ? window.tabs : []);
  }
  if (Array.isArray(session?.tabs) && session.tabs.length > 0) return session.tabs;
  return (Array.isArray(session?.urls) ? session.urls : [])
    .filter(url => typeof url === 'string' && url.length > 0)
    .map(url => ({ url, title: url }));
}

function savedSessionDomains(session) {
  const domains = [];
  for (const tab of savedSessionTabs(session)) {
    try {
      const domain = new URL(tab.url).hostname.replace(/^www\./, '');
      if (domain && !domains.includes(domain)) domains.push(domain);
    } catch {}
  }
  return domains;
}

function savedSessionGroupColor(session) {
  const colorName = session?.groupColor || savedSessionTabs(session).find(tab => tab.groupColor)?.groupColor || '';
  return CHROME_GROUP_COLORS[colorName] || CHROME_GROUP_COLORS.grey;
}

function renderSavedSessionItem(session) {
  const tabs = savedSessionTabs(session);
  const domains = savedSessionDomains(session);
  const title = session.group || session.name || session.title || tr('savedSessionsTitle');
  const preview = domains.slice(0, 3).join(' · ') || tabs[0]?.url || '';
  const safeId = escapeHtml(session.id || '');
  const safeTitle = escapeHtml(title);
  const safePreview = escapeHtml(preview);
  const tabCount = tabs.length;
  const windowCount = Array.isArray(session?.windows) ? session.windows.length : 1;
  const ago = timeAgo(session.savedAt);
  const color = savedSessionGroupColor(session);

  return `
    <article class="saved-session-item" data-session-id="${safeId}">
      <div class="saved-session-color" style="background:${escapeHtml(color)}"></div>
      <div class="saved-session-main">
        <div class="saved-session-title" title="${safeTitle}">
          <span class="saved-session-title-text">${safeTitle}</span>
        </div>
        <div class="saved-session-meta">
          <span>${escapeHtml(tr('savedSessionTabs', { count: tabCount }))}</span>
          <span>${escapeHtml(ago)}</span>
        </div>
        <div class="saved-session-preview">
          <span class="saved-session-preview-text">${safePreview}</span>
        </div>
        <div class="saved-session-actions">
          <button class="saved-session-action" data-action="restore-saved-session" data-session-id="${safeId}" title="${escapeHtml(tr('restoreSessionHint'))}">
            ${escapeHtml(tr('restoreSession'))}
          </button>
          ${windowCount > 1 ? `<button class="saved-session-action" data-action="restore-saved-session-windows" data-session-id="${safeId}" title="${escapeHtml(tr('restoreWindowsHint'))}">
            ${escapeHtml(tr('restoreSessionWindows'))}
          </button>` : ''}
          <button class="saved-session-action saved-session-delete" data-action="delete-saved-session" data-session-id="${safeId}">
            ${escapeHtml(tr('deleteSession'))}
          </button>
        </div>
      </div>
    </article>`;
}

async function renderSavedSessionsCard() {
  const card = document.getElementById('savedSessionsCard');
  const list = document.getElementById('savedSessionsList');
  const countEl = document.getElementById('savedSessionsCount');
  const empty = document.getElementById('savedSessionsEmpty');
  if (!card || !list) return;

  try {
    const sessions = await getSavedSessions();
    if (sessions.length === 0) {
      card.style.display = 'none';
      updateDashboardSideVisibility();
      return;
    }

    card.style.display = 'block';
    list.innerHTML = sessions.map(renderSavedSessionItem).join('');
    list.style.display = 'flex';
    if (countEl) countEl.textContent = tr('itemCount', { count: sessions.length });
    if (empty) empty.style.display = 'none';
  } catch (err) {
    console.warn('[tab-out] Could not load saved sessions:', err);
    card.style.display = 'none';
  } finally {
    updateDashboardSideVisibility();
  }
}


/* ----------------------------------------------------------------
   CHROME TAB GROUP VIEW — renders grouped tabs as cards with Chrome's
   color accent bar. A separate "Not grouped" cluster hosts the rest.
   ---------------------------------------------------------------- */

// Chrome's tab group color names → approximate hex. Chrome only exposes
// the color name via the API, so we pick visual equivalents here.
const CHROME_GROUP_COLORS = {
  grey:   '#5f6368',
  blue:   '#1a73e8',
  red:    '#d93025',
  yellow: '#f9ab00',
  green:  '#1e8e3e',
  pink:   '#e91e63',
  purple: '#9c27b0',
  cyan:   '#00bcd4',
  orange: '#e8710a',
};

const CHROME_GROUP_COLOR_ORDER = Object.keys(CHROME_GROUP_COLORS);

const CHROME_GROUP_COLOR_LABEL_KEYS = {
  grey: 'groupColorGrey',
  blue: 'groupColorBlue',
  red: 'groupColorRed',
  yellow: 'groupColorYellow',
  green: 'groupColorGreen',
  pink: 'groupColorPink',
  purple: 'groupColorPurple',
  cyan: 'groupColorCyan',
  orange: 'groupColorOrange',
};

function isChromeGroupColor(colorName) {
  return Object.prototype.hasOwnProperty.call(CHROME_GROUP_COLORS, colorName);
}

function normalizeChromeGroupColor(colorName, fallback = 'grey') {
  const normalized = String(colorName || '').trim().toLowerCase();
  return isChromeGroupColor(normalized) ? normalized : fallback;
}

function getChromeGroupColorLabel(colorName) {
  const normalized = normalizeChromeGroupColor(colorName);
  return tr(CHROME_GROUP_COLOR_LABEL_KEYS[normalized]);
}

function buildGroupColorPicker(groupInfo) {
  const currentColor = normalizeChromeGroupColor(groupInfo.color);
  const currentLabel = getChromeGroupColorLabel(currentColor);
  const pickerId = `group-color-picker-${groupInfo.id}`;
  const buttonLabel = `${tr('recolorGroup')}: ${currentLabel}`;
  const colorOptions = CHROME_GROUP_COLOR_ORDER.map(colorName => {
    const selected = colorName === currentColor;
    const label = getChromeGroupColorLabel(colorName);
    const ariaLabel = selected
      ? `${label}, ${tr('groupColorCurrent')}`
      : label;
    return `
      <button class="group-color-option${selected ? ' is-selected' : ''}"
              data-action="set-group-color"
              data-group-id="${groupInfo.id}"
              data-group-color="${colorName}"
              role="radio"
              aria-checked="${selected ? 'true' : 'false'}"
              aria-label="${escapeHtml(ariaLabel)}"
              title="${escapeHtml(label)}"
              tabindex="${selected ? '0' : '-1'}">
        <span class="group-color-swatch" style="background:${CHROME_GROUP_COLORS[colorName]}" aria-hidden="true"></span>
      </button>`;
  }).join('');

  return `
    <span class="group-color-control" data-current-color="${currentColor}">
      <button class="action-btn group-color-btn"
              data-action="toggle-group-color-picker"
              data-group-id="${groupInfo.id}"
              aria-haspopup="true"
              aria-expanded="false"
              aria-controls="${pickerId}"
              aria-label="${escapeHtml(buttonLabel)}"
              title="${escapeHtml(buttonLabel)}">
        <span class="group-color-dot" style="background:${CHROME_GROUP_COLORS[currentColor]}" aria-hidden="true"></span>
        ${escapeHtml(tr('recolorGroup'))}
      </button>
      <span class="group-color-picker"
            id="${pickerId}"
            role="radiogroup"
            aria-label="${escapeHtml(tr('groupColorPickerLabel'))}"
            hidden>
        ${colorOptions}
      </span>
    </span>`;
}

function closeGroupColorPickers({ restoreFocus = false } = {}) {
  let focusTarget = null;
  document.querySelectorAll('.group-color-control.is-open').forEach(control => {
    const button = control.querySelector('.group-color-btn');
    const picker = control.querySelector('.group-color-picker');
    if (restoreFocus && control.contains(document.activeElement)) focusTarget = button;
    control.classList.remove('is-open');
    if (picker) picker.hidden = true;
    if (button) button.setAttribute('aria-expanded', 'false');
  });
  if (focusTarget) focusTarget.focus();
}

function setGroupColorPickerOpen(control, open, { focusSelected = false } = {}) {
  const button = control?.querySelector('.group-color-btn');
  const picker = control?.querySelector('.group-color-picker');
  if (!button || !picker) return;

  control.classList.toggle('is-open', open);
  picker.hidden = !open;
  button.setAttribute('aria-expanded', open ? 'true' : 'false');

  if (open && focusSelected) {
    const selected = picker.querySelector('.group-color-option.is-selected') || picker.querySelector('.group-color-option');
    selected?.focus();
  }
}

function toggleGroupColorPicker(button, { focusSelected = false } = {}) {
  const control = button?.closest('.group-color-control');
  if (!control) return;
  const wasOpen = control.classList.contains('is-open');
  closeGroupColorPickers();
  if (!wasOpen) setGroupColorPickerOpen(control, true, { focusSelected });
}

function closeGroupActionMenus({ restoreFocus = false } = {}) {
  let focusTarget = null;
  document.querySelectorAll('.group-action-menu-control.is-open').forEach(control => {
    const button = control.querySelector('.group-action-menu-btn');
    const menu = control.querySelector('.group-action-menu');
    if (restoreFocus && control.contains(document.activeElement)) focusTarget = button;
    control.classList.remove('is-open');
    if (menu) {
      if (typeof menu.hidePopover === 'function' && menu.matches(':popover-open')) {
        menu.hidePopover();
      }
      menu.hidden = true;
      menu.style.removeProperty('--group-menu-left');
      menu.style.removeProperty('--group-menu-top');
      menu.style.removeProperty('visibility');
    }
    if (button) button.setAttribute('aria-expanded', 'false');
  });
  if (focusTarget) focusTarget.focus();
}

function showGroupActionMenu(button, menu) {
  menu.hidden = false;

  if (typeof menu.showPopover !== 'function') return;

  menu.style.visibility = 'hidden';
  menu.showPopover();

  const gap = 6;
  const viewportPadding = 8;
  const buttonRect = button.getBoundingClientRect();
  const menuRect = menu.getBoundingClientRect();
  const maxLeft = Math.max(viewportPadding, window.innerWidth - menuRect.width - viewportPadding);
  const left = Math.min(maxLeft, Math.max(viewportPadding, buttonRect.right - menuRect.width));
  const belowTop = buttonRect.bottom + gap;
  const aboveTop = buttonRect.top - menuRect.height - gap;
  const top = belowTop + menuRect.height <= window.innerHeight - viewportPadding
    ? belowTop
    : Math.max(viewportPadding, aboveTop);

  menu.style.setProperty('--group-menu-left', `${Math.round(left)}px`);
  menu.style.setProperty('--group-menu-top', `${Math.round(top)}px`);
  menu.style.removeProperty('visibility');
}

function toggleGroupActionMenu(button, { focusFirst = false } = {}) {
  const control = button?.closest('.group-action-menu-control');
  const menu = control?.querySelector('.group-action-menu');
  if (!control || !menu) return;

  const wasOpen = control.classList.contains('is-open');
  closeGroupActionMenus();
  closeGroupColorPickers();

  if (wasOpen) return;
  control.classList.add('is-open');
  showGroupActionMenu(button, menu);
  button.setAttribute('aria-expanded', 'true');
  if (focusFirst) {
    const firstItem = menu.querySelector('button,[tabindex]:not([tabindex="-1"])');
    firstItem?.focus();
  }
}

function updateGroupColorControlState(groupId, colorName) {
  const normalized = normalizeChromeGroupColor(colorName);
  const colorHex = CHROME_GROUP_COLORS[normalized];
  const colorLabel = getChromeGroupColorLabel(normalized);
  const cardEl = document.querySelector(`[data-group-id="group-${groupId}"]`);
  if (!cardEl) return;

  cardEl.style.setProperty('--group-color', colorHex);
  const control = cardEl.querySelector('.group-color-control');
  const button = control?.querySelector('.group-color-btn');
  const dot = control?.querySelector('.group-color-dot');
  const buttonLabel = `${tr('recolorGroup')}: ${colorLabel}`;

  if (control) control.dataset.currentColor = normalized;
  if (dot) dot.style.background = colorHex;
  if (button) {
    button.setAttribute('aria-label', buttonLabel);
    button.setAttribute('title', buttonLabel);
  }

  control?.querySelectorAll('.group-color-option[data-group-color]').forEach(option => {
    const selected = option.dataset.groupColor === normalized;
    option.classList.toggle('is-selected', selected);
    option.setAttribute('aria-checked', selected ? 'true' : 'false');
    option.setAttribute('tabindex', selected ? '0' : '-1');
    const label = getChromeGroupColorLabel(option.dataset.groupColor);
    option.setAttribute(
      'aria-label',
      selected ? `${label}, ${tr('groupColorCurrent')}` : label
    );
  });
}

async function updateChromeTabGroup(groupId, options) {
  if (!Number.isFinite(groupId)) throw new Error('Invalid Chrome tab group id');
  if (TabsService?.updateGroup) {
    const updated = await TabsService.updateGroup(groupId, options);
    if (updated == null) throw new Error('Chrome tabGroups API unavailable');
    return updated;
  }
  if (typeof chrome !== 'undefined' && chrome?.tabGroups?.update) {
    return await chrome.tabGroups.update(groupId, options);
  }
  throw new Error('Chrome tabGroups API unavailable');
}

function buildViewToggle(activeView) {
  if (tabGroupsList.length === 0) return '';
  return `<span class="view-toggle" role="tablist" aria-label="${escapeHtml(tr('viewModeLabel'))}">` +
    `<button class="toggle-pill${activeView === 'group'  ? ' active' : ''}" data-action="switch-view" data-view="group">${escapeHtml(tr('viewGroups'))}</button>` +
    `<button class="toggle-pill${activeView === 'domain' ? ' active' : ''}" data-action="switch-view" data-view="domain">${escapeHtml(tr('viewDomains'))}</button>` +
    `</span>`;
}

function buildDomainSortControl(activeMode) {
  const mode = TabsService?.normalizeDomainSortMode?.(activeMode) || 'stable';
  const options = [
    ['stable', tr('domainSortStable')],
    ['chrome', tr('domainSortChrome')],
    ['count', tr('domainSortCount')],
    ['name', tr('domainSortName')],
  ];
  const currentLabel = options.find(([value]) => value === mode)?.[1] || tr('domainSortStable');
  const buttonLabel = tr('domainSortCurrent', { mode: currentLabel });
  return `<span class="group-action-menu-control domain-sort-control">
    <button class="icon-action-btn group-action-menu-btn toolbar-icon-btn domain-sort-btn" id="domainSortButton"
            data-action="toggle-group-actions-menu" data-sort-mode="${mode}"
            aria-haspopup="menu" aria-expanded="false" aria-controls="domain-sort-menu"
            title="${escapeHtml(buttonLabel)}" aria-label="${escapeHtml(buttonLabel)}">
      ${ICONS.sort}
    </button>
    <span class="group-action-menu domain-sort-menu" id="domain-sort-menu" role="menu" aria-label="${escapeHtml(tr('domainSortLabel'))}" popover="manual" hidden>
      ${options.map(([value, label]) => `<button class="group-menu-item domain-sort-option${value === mode ? ' is-selected' : ''}" role="menuitemradio" aria-checked="${value === mode ? 'true' : 'false'}" data-action="set-domain-sort" data-sort-mode="${value}"><span>${escapeHtml(label)}</span><span class="domain-sort-check" aria-hidden="true">${value === mode ? '✓' : ''}</span></button>`).join('')}
    </span>
  </span>`;
}

function updateOpenTabsToolbar({ activeView, tabCount, sortMode = 'stable' }) {
  const viewEl = document.getElementById('openTabsViewToggle');
  const sortEl = document.getElementById('openTabsSortControl');
  const closeAllEl = document.getElementById('closeAllOpenTabsMenuItem');

  if (viewEl) viewEl.innerHTML = buildViewToggle(activeView);
  if (sortEl) sortEl.innerHTML = activeView === 'domain' ? buildDomainSortControl(sortMode) : '';
  if (closeAllEl) {
    closeAllEl.textContent = tr('closeAllTabs', { count: tabCount });
    closeAllEl.disabled = tabCount === 0;
  }
}

function renderTabGroupCard(groupInfo, tabs) {
  const color    = CHROME_GROUP_COLORS[groupInfo.color] || '#5f6368';
  const name     = groupInfo.title || tr('unnamedGroup');
  const tabCount = tabs.length;

  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls    = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes    = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const visibleTabs = tabs.slice(0, 8);
  const extraCount = tabs.length - visibleTabs.length;
  const rowOptions = { urlCounts, showFavicon: true };
  const pageChips = visibleTabs.map(tab => renderOpenTabRow(tab, rowOptions)).join('') +
    (extraCount > 0 ? buildOverflowChips(tabs.slice(8), urlCounts, rowOptions) : '');

  const collapseLabel = groupInfo.collapsed ? tr('expandGroup') : tr('collapseGroup');
  const actionsMenuId = `group-actions-menu-${groupInfo.id}`;
  const headerActionsHtml = `
    <div class="mission-top-actions">
      <span class="group-action-menu-control">
        <button class="icon-action-btn group-action-menu-btn"
                data-action="toggle-group-actions-menu"
                data-group-id="${groupInfo.id}"
                aria-haspopup="menu"
                aria-expanded="false"
                aria-controls="${actionsMenuId}"
                title="${escapeHtml(tr('moreActions'))}"
                aria-label="${escapeHtml(tr('groupActions'))}">
          ${ICONS.more}
        </button>
        <span class="group-action-menu" id="${actionsMenuId}" role="menu" aria-label="${escapeHtml(tr('groupActions'))}" popover="manual" hidden>
          <button class="group-menu-item" role="menuitem" data-action="rename-group" data-group-id="${groupInfo.id}">${escapeHtml(tr('renameGroup'))}</button>
          ${buildGroupColorPicker(groupInfo)}
          <button class="group-menu-item" role="menuitem" data-action="save-group-session" data-group-id="${groupInfo.id}" title="${escapeHtml(tr('saveGroupHint'))}">${escapeHtml(tr('saveGroup'))}</button>
          ${hasDupes ? `<button class="group-menu-item" role="menuitem" data-action="dedup-keep-one" data-dupe-urls="${dupeUrls.map(([url]) => encodeURIComponent(url)).join(',')}">${escapeHtml(tr('closeDuplicates', { count: totalExtras }))}</button>` : ''}
          <span class="group-menu-separator" aria-hidden="true"></span>
          <button class="group-menu-item" role="menuitem" data-action="ungroup-tabs" data-group-id="${groupInfo.id}">${escapeHtml(tr('ungroup'))}</button>
          <button class="group-menu-item danger" role="menuitem" data-action="close-group-tabs" data-group-id="${groupInfo.id}">${escapeHtml(tr('closeAllTabs', { count: tabCount }))}</button>
        </span>
      </span>
    </div>`;

  return `
    <div class="mission-card group-card${groupInfo.collapsed ? ' group-is-collapsed' : ''}" data-group-id="group-${groupInfo.id}" style="--group-color:${color}">
      <div class="status-bar" style="background:${color}"></div>
      <div class="mission-content">
        <div class="mission-top group-card-top">
          <span class="group-color-marker" style="background:${color}" aria-hidden="true"></span>
          <span class="mission-title-block"><span class="mission-name">${escapeHtml(name)}</span></span>
          <span class="mission-count-meta">${escapeHtml(tr('tabsCompact', { count: tabCount }))}</span>
          <button class="icon-action-btn group-collapse-toggle${groupInfo.collapsed ? ' is-collapsed' : ''}"
                  data-action="toggle-group-collapsed" data-group-id="${groupInfo.id}"
                  data-collapsed="${groupInfo.collapsed ? 'true' : 'false'}"
                  aria-expanded="${groupInfo.collapsed ? 'false' : 'true'}"
                  title="${escapeHtml(collapseLabel)}" aria-label="${escapeHtml(collapseLabel)}">
            ${ICONS.chevron}
          </button>
          ${headerActionsHtml}
        </div>
        <div class="mission-pages">${pageChips}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">${escapeHtml(tr('tabsLabel'))}</div>
      </div>
    </div>`;
}

function getUngroupedDomainKey(tab) {
  const url = tab?.url || '';
  if (url.startsWith('file://')) return 'local-files';
  try {
    return new URL(url).hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

function getUngroupedDomainGroups(ungroupedTabs) {
  const groups = new Map();
  for (const tab of ungroupedTabs) {
    const domain = getUngroupedDomainKey(tab);
    if (!groups.has(domain)) {
      groups.set(domain, {
        domain,
        label: domain === 'local-files' ? tr('localFiles') : friendlyDomain(domain),
        tabs: [],
        firstIndex: Number.isFinite(tab.index) ? tab.index : Number.MAX_SAFE_INTEGER,
      });
    }
    const group = groups.get(domain);
    group.tabs.push(tab);
    if (Number.isFinite(tab.index)) group.firstIndex = Math.min(group.firstIndex, tab.index);
  }
  return Array.from(groups.values()).sort((a, b) => a.firstIndex - b.firstIndex);
}

function renderUngroupedTabRow(tab, urlCounts) {
  const label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
  const count = urlCounts[tab.url] || 1;
  const dupeTag = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
  const chipClass = count > 1 ? ' chip-has-dupes' : '';
  const safeUrl = escapeHtml(tab.url || '');
  const safeTitle = escapeHtml(label);
  const safeTabId = tab.id == null ? '' : escapeHtml(String(tab.id));
  const domain = getUngroupedDomainKey(tab);
  const safeDomain = escapeHtml(domain);
  const faviconUrl = faviconUrlFor(domain);

  const activeIndicator = `<span class="tab-active-indicator${tab.active ? ' is-active' : ''}"${tab.active ? ` title="${escapeHtml(tr('currentTab'))}"` : ''} aria-hidden="true"></span>`;
  const ariaPrefix = tab.active ? `${tr('currentTab')}. ` : '';
  const quickReturnHint = escapeHtml(tr('quickReturnHint'));

  return `<article class="page-chip ungrouped-row clickable${chipClass}" data-action="focus-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${safeTitle} · ${quickReturnHint}" role="button" tabindex="0" aria-label="${escapeHtml(ariaPrefix + tr('focusThisTab'))}: ${safeTitle}. ${quickReturnHint}">
    ${activeIndicator}
    ${faviconUrl ? `<img class="chip-favicon" src="${escapeHtml(faviconUrl)}" alt="" data-favicon-domain="${safeDomain}">` : ''}
    <span class="ungrouped-row-main">
      <span class="chip-text ungrouped-title">${safeTitle}</span>${dupeTag}
      <span class="ungrouped-domain">${safeDomain}</span>
    </span>
    <div class="chip-actions">
      <button class="chip-action chip-save" data-action="defer-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" data-tab-title="${safeTitle}" title="${escapeHtml(tr('saveForLaterHint'))}" aria-label="${escapeHtml(tr('saveForLater'))}: ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0 1 11.186 0Z" /></svg>
      </button>
      <button class="chip-action chip-close" data-action="close-single-tab" data-tab-id="${safeTabId}" data-tab-url="${safeUrl}" title="${escapeHtml(tr('closeThisTab'))}" aria-label="${escapeHtml(tr('closeThisTab'))}: ${safeTitle}">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
      </button>
    </div>
  </article>`;
}

function renderUngroupedSection(ungroupedTabs) {
  const urlCounts = {};
  for (const tab of ungroupedTabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;

  const domainGroups = getUngroupedDomainGroups(ungroupedTabs);
  const smartGroupable = domainGroups.filter(group => group.tabs.length >= 2);
  const groupedBlocks = smartGroupable.map(group => {
    const stableDomain = group.domain.replace(/[^a-z0-9]/gi, '-');
    const menuId = `ungrouped-domain-actions-${stableDomain}`;
    return `
    <div class="ungrouped-domain-block" data-ungrouped-domain="${escapeHtml(group.domain)}">
      <div class="ungrouped-domain-header">
        <span class="ungrouped-domain-name">${escapeHtml(group.label)}</span>
        <span class="ungrouped-domain-count">${escapeHtml(tr('tabsCompact', { count: group.tabs.length }))}</span>
        <span class="group-action-menu-control">
          <button class="icon-action-btn group-action-menu-btn" data-action="toggle-group-actions-menu"
                  aria-haspopup="menu" aria-expanded="false" aria-controls="${menuId}"
                  title="${escapeHtml(tr('moreActions'))}" aria-label="${escapeHtml(tr('cardActions'))}">${ICONS.more}</button>
          <span class="group-action-menu" id="${menuId}" role="menu" aria-label="${escapeHtml(tr('cardActions'))}" popover="manual" hidden>
            <button class="group-menu-item" role="menuitem" data-action="create-ungrouped-domain-group" data-domain-key="${escapeHtml(group.domain)}">${escapeHtml(tr('createGroupFromDomain'))}</button>
          </span>
        </span>
      </div>
      ${group.tabs.map(tab => renderUngroupedTabRow(tab, urlCounts)).join('')}
    </div>`;
  }).join('');

  const smartDomains = new Set(smartGroupable.map(group => group.domain));
  const looseRows = domainGroups
    .filter(group => !smartDomains.has(group.domain))
    .flatMap(group => group.tabs)
    .map(tab => renderUngroupedTabRow(tab, urlCounts))
    .join('');

  const ungroupedMenuId = 'ungrouped-section-actions';

  return `
    <div class="ungrouped-section">
      <div class="ungrouped-header">
        <div class="ungrouped-heading">
          <span class="ungrouped-label">${escapeHtml(tr('notGrouped'))}</span>
          <span class="ungrouped-count">${escapeHtml(tr('tabsCompact', { count: ungroupedTabs.length }))}</span>
          <span class="ungrouped-hint">${escapeHtml(tr('ungroupedInboxHint'))}</span>
        </div>
        <div class="ungrouped-actions">
          <span class="group-action-menu-control">
            <button class="icon-action-btn group-action-menu-btn" data-action="toggle-group-actions-menu"
                    aria-haspopup="menu" aria-expanded="false" aria-controls="${ungroupedMenuId}"
                    title="${escapeHtml(tr('moreActions'))}" aria-label="${escapeHtml(tr('cardActions'))}">${ICONS.more}</button>
            <span class="group-action-menu" id="${ungroupedMenuId}" role="menu" aria-label="${escapeHtml(tr('cardActions'))}" popover="manual" hidden>
              ${smartGroupable.length > 0 ? `<button class="group-menu-item" role="menuitem" data-action="smart-group-ungrouped" title="${escapeHtml(tr('smartGroupHint'))}">${escapeHtml(tr('smartGroup'))}</button>` : ''}
              <button class="group-menu-item" role="menuitem" data-action="save-ungrouped-session" title="${escapeHtml(tr('saveAllHint'))}">${escapeHtml(tr('saveAll'))}</button>
              <span class="group-menu-separator" aria-hidden="true"></span>
              <button class="group-menu-item danger" role="menuitem" data-action="close-ungrouped-tabs">${escapeHtml(tr('closeAllTabs', { count: ungroupedTabs.length }))}</button>
            </span>
          </span>
        </div>
      </div>
      <div class="ungrouped-chips">
        ${groupedBlocks}
        ${looseRows ? `<div class="ungrouped-loose-list">${looseRows}</div>` : ''}
      </div>
    </div>`;
}

async function renderGroupView() {
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  if (!openTabsSection) return;

  const realTabs      = getRealTabs();
  const groupedTabs   = realTabs.filter(t => t.groupId >= 0);
  const ungroupedTabs = realTabs.filter(t => t.groupId === -1);

  const groupData = new Map();
  for (const g of tabGroupsList) groupData.set(g.id, { groupInfo: g, tabs: [] });
  for (const tab of groupedTabs) {
    if (groupData.has(tab.groupId)) groupData.get(tab.groupId).tabs.push(tab);
  }

  // Sort groups by the minimum tab.index within each group (Chrome's own visual order).
  const sortedGroups = Array.from(groupData.values())
    .filter(g => g.tabs.length > 0)
    .sort((a, b) => Math.min(...a.tabs.map(t => t.index)) - Math.min(...b.tabs.map(t => t.index)));

  updateOpenTabsToolbar({
    activeView: 'group',
    tabCount: realTabs.length,
  });

  const html = sortedGroups.map(({ groupInfo, tabs }) => renderTabGroupCard(groupInfo, tabs)).join('') +
               (ungroupedTabs.length > 0 ? renderUngroupedSection(ungroupedTabs) : '');

  if (sortedGroups.length > 0 || ungroupedTabs.length > 0) {
    openTabsMissionsEl.innerHTML = html;
    openTabsSection.style.display = 'block';
  } else {
    openTabsSection.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Fetches open tabs via chrome.tabs.query()
 * 2. Branches to group or domain view based on viewMode
 * 3. Renders the "Saved for Later" checklist
 */
async function renderDomainView(realTabs) {
  // Landing pages (Gmail inbox, Twitter home, etc.) get their own special group
  // so they can be closed together without affecting content tabs on the same domain.
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    // Merge personal patterns from config.local.js (if it exists)
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        // Support both exact hostname and suffix matching (for wildcard subdomains)
        const hostnameMatch = p.hostname
          ? parsed.hostname === p.hostname
          : p.hostnameEndsWith
            ? parsed.hostname.endsWith(p.hostnameEndsWith)
            : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];

  // Custom group rules from config.local.js (if any)
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  // Check if a URL matches a custom group rule; returns the rule or null
  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname
          ? parsed.hostname === r.hostname
          : r.hostnameEndsWith
            ? parsed.hostname.endsWith(r.hostnameEndsWith)
            : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true; // hostname matched, no path filter
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }

      // Check custom group rules first (e.g. merge subdomains, split by path)
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }

      let hostname;
      if (tab.url && tab.url.startsWith('file://')) {
        hostname = 'local-files';
      } else {
        hostname = new URL(tab.url).hostname;
      }
      if (!hostname) continue;

      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {
      // Skip malformed URLs
    }
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  // The first run seeds the fixed layout from the previous visual order. After
  // that, closing tabs does not change card positions; new domains append.
  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }
  const rawDomainGroups = Object.values(groupMap);
  const sourcePositions = new Map(realTabs.map((tab, index) => [tab, index]));
  for (const group of rawDomainGroups) {
    group.firstTabPosition = Math.min(...group.tabs.map(tab => sourcePositions.get(tab) ?? Number.MAX_SAFE_INTEGER));
  }

  const legacySeedGroups = [...rawDomainGroups].sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;

    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;

    return b.tabs.length - a.tabs.length;
  });

  await loadDomainCardPreferences();
  const nextOrder = TabsService?.reconcileDomainCardOrder
    ? TabsService.reconcileDomainCardOrder(domainCardPreferences.order, legacySeedGroups.map(group => group.domain))
    : [...(domainCardPreferences.order || []), ...legacySeedGroups.map(group => group.domain).filter(domain => !domainCardPreferences.order?.includes(domain))];
  if (nextOrder.length !== domainCardPreferences.order.length || nextOrder.some((domain, index) => domain !== domainCardPreferences.order[index])) {
    try {
      await saveDomainCardPreferences({ ...domainCardPreferences, order: nextOrder });
    } catch (error) {
      console.error('[tab-out] Failed to save fixed domain-card order:', error);
      domainCardPreferences = { ...domainCardPreferences, order: nextOrder };
    }
  }

  domainGroups = TabsService?.sortDomainGroups
    ? TabsService.sortDomainGroups(rawDomainGroups, domainCardPreferences, {
        locale: activeLanguage === 'zh' ? 'zh-CN' : 'en-US',
        getLabel: group => group.domain === '__landing-pages__'
          ? tr('homepages')
          : (group.label || friendlyDomain(group.domain)),
      })
    : legacySeedGroups;

  // --- Render domain cards ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');

  if (domainGroups.length > 0 && openTabsSection) {
    updateOpenTabsToolbar({
      activeView: 'domain',
      tabCount: realTabs.length,
      sortMode: domainCardPreferences.sortMode,
    });
    openTabsMissionsEl.innerHTML = domainGroups.map(g => renderDomainCard(g)).join('');
    openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    updateOpenTabsToolbar({
      activeView: 'domain',
      tabCount: 0,
      sortMode: domainCardPreferences.sortMode,
    });
    openTabsSection.style.display = 'none';
  }
}

async function renderStaticDashboard() {
  // --- Fetch tabs + Chrome tab groups in parallel ---
  await Promise.all([fetchOpenTabs(), fetchTabGroups()]);
  const realTabs = getRealTabs();

  // --- Pick view mode. When no Chrome groups exist, force domain view
  //     (the toggle pill is hidden in that case via buildViewToggle). ---
  const stored  = await loadViewMode();
  const view    = (tabGroupsList.length === 0) ? 'domain' : stored;

  if (view === 'group') {
    await renderGroupView();
  } else {
    await renderDomainView(realTabs);
  }

  // --- Check for duplicate Tab Out tabs ---
  checkTabOutDupes();

  // --- Render "Saved for Later" column ---
  await renderDeferredColumn();
  await renderSavedSessionsCard();

  const search = document.getElementById('openTabsSearch');
  if (search?.value.trim()) {
    await applyDashboardSearch(search.value);
  }
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  // Walk up the DOM to find the nearest element with data-action
  const target = e.target instanceof Element ? e.target : null;
  const actionEl = target?.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const isGroupMenuColorAction = action === 'toggle-group-color-picker' || action === 'set-group-color';
  if (actionEl.closest('.group-action-menu') && !isGroupMenuColorAction) closeGroupActionMenus();

  // ---- Switch settings panel section ----
  if (action === 'set-settings-view') {
    setSettingsView(actionEl.dataset.settingsView);
    return;
  }

  if (action === 'open-settings') {
    closeGroupActionMenus();
    setSettingsPanelOpen(true, {
      view: actionEl.dataset.settingsView,
      trigger: actionEl,
    });
    return;
  }

  if (action === 'set-default-workspace') {
    applyDefaultWorkspace(actionEl.dataset.defaultWorkspace, { save: true });
    return;
  }

  // ---- Switch color theme ----
  if (action === 'set-theme') {
    const name = actionEl.dataset.themeName;
    if (name) applyTheme(name, { save: true });
    setThemeMenuOpen(false);
    return;
  }

  // ---- Open/close theme palette ----
  if (action === 'toggle-theme-menu') {
    setLanguageMenuOpen(false);
    setFontMenuOpen(false);
    toggleThemeMenu();
    return;
  }

  // ---- Switch font and density preset ----
  if (action === 'set-font-preset') {
    const preset = actionEl.dataset.fontPreset;
    if (preset) applyFontPreset(preset, { save: true });
    setFontMenuOpen(false);
    return;
  }

  // ---- Switch a specific area's font size ----
  if (action === 'set-font-size') {
    const area = actionEl.dataset.fontSizeArea;
    const value = actionEl.dataset.fontSizeValue;
    if (FONT_SIZE_AREAS.includes(area) && FONT_SIZE_VALUES.includes(value)) {
      applyFontSizeSettings({ ...getActiveFontSizeSettings(), [area]: value }, { save: true });
    }
    return;
  }

  // ---- Open/close font preset menu ----
  if (action === 'toggle-font-menu') {
    setLanguageMenuOpen(false);
    setThemeMenuOpen(false);
    toggleFontMenu();
    return;
  }

  // ---- Open/close Chrome tab group overflow menu ----
  if (action === 'toggle-group-actions-menu') {
    e.stopPropagation();
    toggleGroupActionMenu(actionEl, { focusFirst: e.detail === 0 });
    return;
  }

  // ---- Switch interface language ----
  if (action === 'set-language') {
    const lang = actionEl.dataset.language;
    if (lang) setLanguage(lang, { save: true, rerender: true });
    setLanguageMenuOpen(false);
    return;
  }

  // ---- Open/close language menu ----
  if (action === 'toggle-language-menu') {
    setThemeMenuOpen(false);
    setFontMenuOpen(false);
    toggleLanguageMenu();
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    const dashboardTabs = openTabs.filter(tab => tab.isTabOut);
    const keep = dashboardTabs.find(tab => tab.active) || dashboardTabs[0];
    const tabIds = dashboardTabs.filter(tab => tab.id !== keep?.id).map(tab => tab.id).filter(Number.isFinite);
    const result = await TabsService?.closeTabsWithSnapshot?.(tabIds, { allowDashboard: true });
    if (!result?.closedCount) return;
    playCloseSound();
    await renderDashboard();
    offerClosedTabsUndo(result);
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // ---- Focus a specific tab ----
  if (action === 'focus-tab') {
    const tabId = actionEl.dataset.tabId;
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabId || tabUrl) await focusTab(tabId, tabUrl);
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabId = actionEl.dataset.tabId ? Number(actionEl.dataset.tabId) : NaN;
    const tabUrl = actionEl.dataset.tabUrl;
    if (!Number.isFinite(tabId) && !tabUrl) return;

    // Each rendered row represents exactly one browser tab. Legacy markup
    // without an id falls back to the first exact, unpinned URL match.
    const fallbackTab = Number.isFinite(tabId)
      ? null
      : openTabs.find(tab => !tab.pinned && tab.url === tabUrl && Number.isFinite(tab.id));
    const targetTabId = Number.isFinite(tabId) ? tabId : fallbackTab?.id;
    if (!Number.isFinite(targetTabId)) return;
    const result = await TabsService?.closeTabsWithSnapshot?.([targetTabId]);
    if (!result?.closedCount) return;

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    offerClosedTabsUndo(result, tr('toastTabClosed'));
    await recordActivity({ type: 'closed', count: result.closedCount });
    return;
  }

  // ---- Save a single tab for later (then close it) ----
  if (action === 'defer-single-tab') {
    e.stopPropagation();
    const tabId = actionEl.dataset.tabId ? Number(actionEl.dataset.tabId) : NaN;
    const tabUrl   = actionEl.dataset.tabUrl;
    const tabTitle = actionEl.dataset.tabTitle || tabUrl;
    if (!tabUrl) return;

    // Save to chrome.storage.local
    try {
      await saveTabForLater({ url: tabUrl, title: tabTitle });
    } catch (err) {
      console.error('[tab-out] Failed to save tab:', err);
      showToast(tr('toastSaveFailed'));
      return;
    }

    // Saving a row closes only the exact browser tab represented by that row.
    if (Number.isFinite(tabId)) await closeTabsByIds([tabId]);
    else await closeTabsByUrls([tabUrl]);

    // Animate chip out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => chip.remove(), 200);
    }

    showToast(tr('toastSavedForLater'));
    await recordActivity({ type: 'saved', count: 1 });
    await renderDeferredColumn();
    return;
  }

  // ---- Check off a saved tab (moves it to archive) ----
  if (action === 'check-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    await checkOffSavedTab(id);

    // Animate: strikethrough first, then slide out
    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('checked');
      setTimeout(() => {
        item.classList.add('removing');
        setTimeout(() => {
          item.remove();
          renderDeferredColumn(); // refresh counts and archive
        }, 300);
      }, 800);
    }
    return;
  }

  // ---- Dismiss a saved tab (removes it entirely) ----
  if (action === 'dismiss-deferred') {
    const id = actionEl.dataset.deferredId;
    if (!id) return;

    const removed = await dismissSavedTab(id);
    if (!removed) return;

    const item = actionEl.closest('.deferred-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => {
        item.remove();
        renderDeferredColumn();
      }, 300);
    }
    showToast(tr('toastDeferredRemoved'), {
      actionLabel: tr('undo'),
      onAction: async () => {
        const restored = await restoreArchivedSavedTabs([removed]);
        if (restored > 0) await renderDeferredColumn();
        showToast(tr('toastDeferredRestored'));
      },
    });
    return;
  }

  // ---- Clear archived saved tabs, with a short undo window ----
  if (action === 'clear-archive') {
    const { archived } = await getSavedTabs();
    if (archived.length === 0) return;

    actionEl.disabled = true;
    try {
      const removed = await clearArchivedSavedTabs();
      await renderDeferredColumn();
      showToast(tr('toastArchiveCleared', { count: removed }), {
        actionLabel: tr('undo'),
        onAction: async () => {
          const restored = await restoreArchivedSavedTabs(archived);
          await renderDeferredColumn();
          showToast(tr('toastArchiveRestored', { count: restored }));
        },
      });
    } catch (err) {
      console.error('[tab-out] Failed to clear archive:', err);
      actionEl.disabled = false;
      showToast(tr('toastStorageFailed'));
    }
    return;
  }

  // ---- Restore a saved session into open tabs and rebuild its Chrome group ----
  if (action === 'restore-saved-session' || action === 'restore-saved-session-windows') {
    const id = actionEl.dataset.sessionId;
    if (!id) return;
    const sessions = await getSavedSessions();
    const session = sessions.find(item => item.id === id);
    if (!session) return;

    actionEl.disabled = true;
    try {
      await restoreSavedSessionToChrome(session, action === 'restore-saved-session-windows' ? 'originalWindows' : 'currentWindow');
      await saveViewMode('group');
      await renderDashboard();
      showToast(tr('toastSessionRestored'));
    } catch (err) {
      console.error('[tab-out] Failed to restore saved session:', err);
      actionEl.disabled = false;
      showToast(tr('toastSessionRestoreFailed'));
    }
    return;
  }

  // ---- Delete a saved session from local storage, with undo ----
  if (action === 'delete-saved-session') {
    const id = actionEl.dataset.sessionId;
    if (!id) return;
    const sessions = await getSavedSessions();
    const sessionIndex = sessions.findIndex(item => item.id === id);
    const session = sessions[sessionIndex];
    if (!session) return;

    actionEl.disabled = true;
    await removeSavedSession(id);

    const item = actionEl.closest('.saved-session-item');
    if (item) {
      item.classList.add('removing');
      setTimeout(() => renderSavedSessionsCard(), 250);
    } else {
      await renderSavedSessionsCard();
    }
    const sessionTitle = session.group || session.name || session.title || tr('savedSessionsTitle');
    showToast(tr('toastSessionDeleted', { title: sessionTitle }), {
      actionLabel: tr('undo'),
      onAction: async () => {
        const restored = await restoreSavedSession(session, sessionIndex);
        if (restored) await renderSavedSessionsCard();
        showToast(tr('toastSessionRestoredFromUndo'));
      },
    });
    return;
  }

  // ---- Pin or unpin a domain card without changing its saved position ----
  if (action === 'pin-domain-card' || action === 'unpin-domain-card') {
    const domainKey = actionEl.dataset.domainKey;
    if (!domainKey) return;
    const pinned = new Set(domainCardPreferences.pinned || []);
    if (action === 'pin-domain-card') pinned.add(domainKey);
    else pinned.delete(domainKey);
    try {
      await saveDomainCardPreferences({ ...domainCardPreferences, pinned: Array.from(pinned) });
      await renderDashboard();
    } catch (error) {
      console.error('[tab-out] Failed to update pinned domain cards:', error);
      showToast(tr('toastStorageFailed'));
    }
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainKey = actionEl.dataset.domainKey;
    const group    = domainGroups.find(g => g.domain === domainKey);
    if (!group) return;

    const groupLabel = group.domain === '__landing-pages__' ? tr('homepages') : (group.label || friendlyDomain(group.domain));
    await openBulkTabCloseConfirm({
      tabIds: group.tabs.map(tab => tab.id).filter(Number.isFinite),
      scope: tr('bulkCloseScopeDomain', { label: groupLabel }),
      trigger: actionEl,
      activity: { domain: group.domain },
    });
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    const tabIds = [];
    for (const url of urls) {
      const matching = openTabs.filter(tab => tab.url === url && !tab.pinned);
      const keep = matching.find(tab => tab.active) || matching[0];
      matching.forEach(tab => { if (tab.id !== keep?.id && Number.isFinite(tab.id)) tabIds.push(tab.id); });
    }
    await openBulkTabCloseConfirm({
      tabIds,
      scope: tr('bulkCloseScopeDuplicates'),
      trigger: actionEl,
      activity: { type: 'duplicateClosed' },
    });
    return;
  }

  // ---- Create a native Chrome group from a domain card ----
  if (action === 'create-native-group') {
    const domainKey = actionEl.dataset.domainKey;
    const group = domainGroups.find(g => g.domain === domainKey);
    if (!group) return;
    const tabIds = group.tabs.map(tab => tab.id).filter(Boolean);
    const title = group.domain === '__landing-pages__' ? tr('homepages') : (group.label || friendlyDomain(group.domain));
    await TabsService?.groupTabs?.(tabIds, { title, color: 'blue' });
    await fetchTabGroups();
    await saveViewMode('group');
    await renderDashboard();
    showToast(tr('toastGroupCreated'));
    return;
  }

  // ---- Save all ungrouped tabs as one local session ----
  if (action === 'save-ungrouped-session') {
    const ungroupedTabs = getRealTabs().filter(t => t.groupId === -1);
    if (ungroupedTabs.length === 0) return;
    actionEl.disabled = true;
    await saveTabsAsSession(ungroupedTabs, tr('notGrouped'));
    await renderSavedSessionsCard();
    showToast(tr('toastSessionSaved'));
    return;
  }

  // ---- Close all ungrouped tabs ----
  if (action === 'close-ungrouped-tabs') {
    const ungroupedTabs = getRealTabs().filter(t => t.groupId === -1);
    const tabIds = ungroupedTabs.map(tab => tab.id).filter(Boolean);
    if (tabIds.length === 0) return;
    await openBulkTabCloseConfirm({
      tabIds,
      scope: tr('bulkCloseScopeUngrouped'),
      trigger: actionEl,
    });
    return;
  }

  // ---- Smart group ungrouped tabs by domain ----
  if (action === 'smart-group-ungrouped') {
    const ungroupedTabs = getRealTabs().filter(t => t.groupId === -1);
    const groups = getUngroupedDomainGroups(ungroupedTabs).filter(group => group.tabs.length >= 2);
    if (groups.length === 0) {
      showToast(tr('toastSmartGroupNone'));
      return;
    }

    actionEl.disabled = true;
    let createdCount = 0;
    for (const group of groups) {
      const tabIds = group.tabs.map(tab => tab.id).filter(Boolean);
      if (tabIds.length < 2) continue;
      const groupId = await TabsService?.groupTabs?.(tabIds, { title: group.label, color: 'blue' });
      if (groupId != null) createdCount += 1;
    }
    await fetchTabGroups();
    await saveViewMode('group');
    await renderDashboard();
    showToast(createdCount > 0 ? tr('toastSmartGrouped', { count: createdCount }) : tr('toastSmartGroupNone'));
    return;
  }

  // ---- Create one Chrome tab group from an ungrouped domain cluster ----
  if (action === 'create-ungrouped-domain-group') {
    const domainKey = actionEl.dataset.domainKey;
    const group = getUngroupedDomainGroups(getRealTabs().filter(t => t.groupId === -1))
      .find(item => item.domain === domainKey);
    if (!group) return;
    const tabIds = group.tabs.map(tab => tab.id).filter(Boolean);
    if (tabIds.length === 0) return;
    actionEl.disabled = true;
    await TabsService?.groupTabs?.(tabIds, { title: group.label, color: 'blue' });
    await fetchTabGroups();
    await saveViewMode('group');
    await renderDashboard();
    showToast(tr('toastGroupCreated'));
    return;
  }

  // ---- Switch between Groups view and Domains view ----
  if (action === 'switch-view') {
    const newView = actionEl.dataset.view === 'group' ? 'group' : 'domain';
    await saveViewMode(newView);
    await renderDashboard();
    return;
  }

  // ---- Choose a domain-card sorting mode from the compact toolbar menu ----
  if (action === 'set-domain-sort') {
    const sortMode = TabsService?.normalizeDomainSortMode?.(actionEl.dataset.sortMode) || 'stable';
    try {
      await saveDomainCardPreferences({ ...domainCardPreferences, sortMode });
      await renderDashboard();
    } catch (error) {
      console.error('[tab-out] Failed to update domain-card sorting:', error);
      showToast(tr('toastStorageFailed'));
    }
    return;
  }

  // ---- Close all tabs in a Chrome tab group ----
  if (action === 'close-group-tabs') {
    const groupId   = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    const groupTabs = openTabs.filter(t => t.groupId === groupId);
    const tabIds    = groupTabs.map(t => t.id);
    const groupInfo = tabGroupsList.find(group => group.id === groupId);
    await openBulkTabCloseConfirm({
      tabIds,
      scope: tr('bulkCloseScopeGroup', { label: groupInfo?.title || tr('unnamedGroup') }),
      trigger: actionEl,
    });
    return;
  }

  // ---- Rename a Chrome tab group ----
  if (action === 'rename-group') {
    const groupId = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    const current = tabGroupsList.find(g => g.id === groupId);
    const title = prompt(tr('renameGroup'), current?.title || '');
    if (title == null) return;
    await TabsService?.updateGroup?.(groupId, { title: title.trim() });
    await renderDashboard();
    showToast(tr('toastGroupUpdated'));
    return;
  }

  // ---- Open / close Chrome tab group color picker ----
  if (action === 'toggle-group-color-picker') {
    const groupId = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    e.stopPropagation();
    toggleGroupColorPicker(actionEl, { focusSelected: e.detail === 0 });
    return;
  }

  // ---- Recolor a Chrome tab group ----
  if (action === 'set-group-color') {
    const groupId = Number(actionEl.dataset.groupId);
    const normalized = normalizeChromeGroupColor(actionEl.dataset.groupColor, '');
    if (!Number.isFinite(groupId) || !normalized) return;

    e.stopPropagation();
    const current = tabGroupsList.find(g => g.id === groupId);
    const previousColor = normalizeChromeGroupColor(current?.color);
    closeGroupColorPickers();
    if (normalized === previousColor) return;

    updateGroupColorControlState(groupId, normalized);
    try {
      await updateChromeTabGroup(groupId, { color: normalized });
      if (current) current.color = normalized;
      await fetchTabGroups();
      showToast(tr('toastGroupUpdated'));
    } catch (err) {
      console.error('[tab-out] Failed to update Chrome tab group color:', err);
      updateGroupColorControlState(groupId, previousColor);
      showToast(tr('toastGroupUpdateFailed'));
    }
    return;
  }

  // ---- Collapse / expand a Chrome tab group ----
  if (action === 'toggle-group-collapsed') {
    const groupId = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    const collapsed = actionEl.dataset.collapsed === 'true';
    await TabsService?.updateGroup?.(groupId, { collapsed: !collapsed });
    await renderDashboard();
    showToast(tr('toastGroupUpdated'));
    return;
  }

  // ---- Save Chrome tab group as a session ----
  if (action === 'save-group-session') {
    const groupId = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    const groupInfo = tabGroupsList.find(g => g.id === groupId);
    const groupTabs = openTabs
      .filter(t => t.groupId === groupId)
      .map(t => ({ ...t, groupTitle: groupInfo?.title || '', groupColor: groupInfo?.color || '' }));
    await saveTabsAsSession(groupTabs, groupInfo?.title || tr('unnamedGroup'));
    await renderSavedSessionsCard();
    showToast(tr('toastGroupSaved'));
    return;
  }

  // ---- Ungroup a Chrome tab group (move tabs out, keep them open) ----
  if (action === 'ungroup-tabs') {
    const groupId = Number(actionEl.dataset.groupId);
    if (!Number.isFinite(groupId)) return;
    const groupTabs = openTabs.filter(t => t.groupId === groupId);
    for (const tab of groupTabs) {
      try { await chrome.tabs.ungroup(tab.id); } catch { /* tab vanished — ignore */ }
    }
    await renderDashboard();
    showToast(tr('toastUngrouped', { count: groupTabs.length }));
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    await openBulkTabCloseConfirm({
      tabIds: openTabs.map(tab => tab.id).filter(Number.isFinite),
      scope: tr('bulkCloseScopeAll'),
      trigger: actionEl,
    });
    return;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const target = e.target instanceof Element ? e.target : null;
  const actionEl = target?.closest('[role="button"][data-action]');
  if (!actionEl || actionEl.tagName === 'BUTTON') return;
  e.preventDefault();
  actionEl.click();
});

document.addEventListener('keydown', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const option = target?.closest('.group-color-option');
  if (!option) return;

  const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
  if (!keys.includes(e.key)) return;

  const options = Array.from(option.closest('.group-color-picker')?.querySelectorAll('.group-color-option') || []);
  if (options.length === 0) return;

  e.preventDefault();
  const currentIndex = Math.max(0, options.indexOf(option));
  let nextIndex = currentIndex;
  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIndex = (currentIndex + 1) % options.length;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIndex = (currentIndex - 1 + options.length) % options.length;
  if (e.key === 'Home') nextIndex = 0;
  if (e.key === 'End') nextIndex = options.length - 1;
  options[nextIndex].focus();
});

// ---- Archive toggle — expand/collapse the archive section ----
document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  const toggle = target?.closest('#archiveToggle');
  if (!toggle) return;

  toggle.classList.toggle('open');
  toggle.setAttribute('aria-expanded', toggle.classList.contains('open') ? 'true' : 'false');
  const body = document.getElementById('archiveBody');
  if (body) {
    body.style.display = body.style.display === 'none' ? 'block' : 'none';
  }
});

let _dashboardSearchRun = 0;

function resetSearchHighlights(root = document) {
  root.querySelectorAll('[data-search-raw-text]').forEach(el => {
    el.textContent = el.dataset.searchRawText || '';
  });
}

function highlightTextElement(el, query) {
  if (!el || !SearchService?.getHighlightSegments) return;
  if (!el.dataset.searchRawText) el.dataset.searchRawText = el.textContent || '';
  const segments = SearchService.getHighlightSegments(el.dataset.searchRawText, query);
  el.innerHTML = segments
    .map(segment => segment.match
      ? `<mark class="search-match">${escapeHtml(segment.text)}</mark>`
      : escapeHtml(segment.text))
    .join('');
}

function resetDashboardSearch() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (missionsEl) {
    missionsEl.classList.remove('is-searching');
    missionsEl.querySelectorAll('.mission-card, .page-chip, .ungrouped-section').forEach(el => {
      el.classList.remove('search-hidden');
    });
    missionsEl.querySelectorAll('.mission-card.search-revealed').forEach(card => {
      card.classList.remove('search-revealed');
    });
    missionsEl.querySelectorAll('.page-chips-overflow').forEach(overflow => {
      if (overflow.parentElement?.querySelector('.page-chip-overflow')) {
        overflow.style.display = 'none';
      }
    });
  }

  const column = document.getElementById('deferredColumn');
  const hasSavedItems = !!document.querySelector('.deferred-item, .archive-item');
  if (column) column.style.display = hasSavedItems ? 'block' : 'none';
  document.querySelectorAll('.deferred-item, .archive-item').forEach(el => {
    el.classList.remove('search-hidden');
  });
  const empty = document.getElementById('deferredEmpty');
  if (empty) {
    const hasActiveItems = !!document.querySelector('.deferred-item');
    empty.style.display = hasSavedItems && !hasActiveItems ? 'block' : 'none';
    const label = empty.querySelector('[data-i18n="deferredEmpty"]') || empty;
    label.textContent = tr('deferredEmpty');
  }

  const sessionsCard = document.getElementById('savedSessionsCard');
  const sessionItems = document.querySelectorAll('.saved-session-item[data-session-id]');
  if (sessionsCard) sessionsCard.style.display = sessionItems.length > 0 ? 'block' : 'none';
  sessionItems.forEach(el => el.classList.remove('search-hidden'));
  const sessionsList = document.getElementById('savedSessionsList');
  if (sessionsList) sessionsList.style.display = sessionItems.length > 0 ? 'flex' : 'none';
  const sessionsCount = document.getElementById('savedSessionsCount');
  if (sessionsCount) sessionsCount.textContent = sessionItems.length > 0 ? tr('itemCount', { count: sessionItems.length }) : '';
  const sessionsEmpty = document.getElementById('savedSessionsEmpty');
  if (sessionsEmpty) sessionsEmpty.style.display = 'none';

  resetSearchHighlights();
  updateDashboardSideVisibility();
}

async function buildDashboardSearchIndex() {
  if (!SearchService?.buildSearchIndex) return [];
  const { active, archived } = await getSavedTabs();
  const savedSessions = await getSavedSessions();
  return SearchService.buildSearchIndex({
    tabs: getRealTabs(),
    tabGroups: tabGroupsList,
    savedTabs: [...active, ...archived],
    savedSessions,
  });
}

function applyOpenTabSearchResults(results, query) {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const matchedUrls = new Set(
    results
      .filter(record => record.type === 'tab')
      .map(record => record.url)
  );

  missionsEl.classList.add('is-searching');

  missionsEl.querySelectorAll('.mission-card').forEach(card => {
    let anyVisible = false;
    card.querySelectorAll('.page-chips-overflow').forEach(overflow => {
      overflow.style.display = 'contents';
    });

    card.querySelectorAll('.page-chip:not(.page-chip-overflow)').forEach(chip => {
      const visible = matchedUrls.has(chip.dataset.tabUrl || '');
      chip.classList.toggle('search-hidden', !visible);
      if (visible) {
        anyVisible = true;
        highlightTextElement(chip.querySelector('.chip-text'), query);
      }
    });

    card.classList.toggle('search-hidden', !anyVisible);
    card.classList.toggle('search-revealed', anyVisible && card.classList.contains('group-is-collapsed'));
    if (anyVisible) highlightTextElement(card.querySelector('.mission-name'), query);
  });

  missionsEl.querySelectorAll('.ungrouped-section').forEach(section => {
    let anyVisible = false;
    section.querySelectorAll('.page-chip').forEach(chip => {
      const visible = matchedUrls.has(chip.dataset.tabUrl || '');
      chip.classList.toggle('search-hidden', !visible);
      if (visible) {
        anyVisible = true;
        highlightTextElement(chip.querySelector('.chip-text'), query);
      }
    });
    section.classList.toggle('search-hidden', !anyVisible);
    if (anyVisible) highlightTextElement(section.querySelector('.ungrouped-label'), query);
  });
}

function applySavedSearchResults(results, query) {
  const column = document.getElementById('deferredColumn');
  if (!column) return;

  const matchedSavedIds = new Set(
    results
      .filter(record => record.type === 'saved')
      .map(record => String(record.source?.id || '').trim())
      .filter(Boolean)
  );

  let activeVisible = 0;
  document.querySelectorAll('.deferred-item[data-deferred-id]').forEach(item => {
    const visible = matchedSavedIds.has(item.dataset.deferredId);
    item.classList.toggle('search-hidden', !visible);
    if (visible) {
      activeVisible += 1;
      highlightTextElement(item.querySelector('.deferred-title-text'), query);
      highlightTextElement(item.querySelector('.deferred-domain-text'), query);
    }
  });

  let archiveVisible = 0;
  document.querySelectorAll('.archive-item[data-deferred-id]').forEach(item => {
    const visible = matchedSavedIds.has(item.dataset.deferredId);
    item.classList.toggle('search-hidden', !visible);
    if (visible) {
      archiveVisible += 1;
      highlightTextElement(item.querySelector('.archive-item-title-text'), query);
    }
  });

  const countEl = document.getElementById('deferredCount');
  if (countEl) countEl.textContent = activeVisible > 0 ? tr('itemCount', { count: activeVisible }) : '';

  const archiveCountEl = document.getElementById('archiveCount');
  if (archiveCountEl) archiveCountEl.textContent = archiveVisible > 0 ? `(${archiveVisible})` : '';

  const empty = document.getElementById('deferredEmpty');
  if (empty) {
    empty.style.display = activeVisible === 0 && archiveVisible === 0 ? 'block' : 'none';
    const label = empty.querySelector('[data-i18n="deferredEmpty"]') || empty;
    label.textContent = activeVisible === 0 && archiveVisible === 0 ? tr('noResults') : tr('deferredEmpty');
  }

  const archiveEl = document.getElementById('deferredArchive');
  const archiveBody = document.getElementById('archiveBody');
  const archiveToggle = document.getElementById('archiveToggle');
  if (archiveEl) archiveEl.style.display = archiveVisible > 0 ? 'block' : 'none';
  if (archiveVisible > 0 && archiveBody) archiveBody.style.display = 'block';
  if (archiveVisible > 0 && archiveToggle) archiveToggle.classList.add('open');

  column.style.display = activeVisible > 0 || archiveVisible > 0 ? 'block' : 'none';
  updateDashboardSideVisibility();
}

function applySavedSessionSearchResults(results, query) {
  const card = document.getElementById('savedSessionsCard');
  if (!card) return;

  const matchedSessionIds = new Set(
    results
      .filter(record => record.type === 'session')
      .map(record => String(record.source?.id || '').trim())
      .filter(Boolean)
  );

  let visibleCount = 0;
  document.querySelectorAll('.saved-session-item[data-session-id]').forEach(item => {
    const visible = matchedSessionIds.has(item.dataset.sessionId);
    item.classList.toggle('search-hidden', !visible);
    if (visible) {
      visibleCount += 1;
      highlightTextElement(item.querySelector('.saved-session-title-text'), query);
      highlightTextElement(item.querySelector('.saved-session-preview-text'), query);
    }
  });

  const list = document.getElementById('savedSessionsList');
  if (list) list.style.display = visibleCount > 0 ? 'flex' : 'none';

  const countEl = document.getElementById('savedSessionsCount');
  if (countEl) countEl.textContent = visibleCount > 0 ? tr('itemCount', { count: visibleCount }) : '';

  const empty = document.getElementById('savedSessionsEmpty');
  if (empty) {
    empty.style.display = visibleCount === 0 ? 'block' : 'none';
    const label = empty.querySelector('[data-i18n="savedSessionsEmpty"]') || empty;
    label.textContent = visibleCount === 0 ? tr('noResults') : tr('savedSessionsEmpty');
  }

  card.style.display = visibleCount > 0 ? 'block' : 'none';
  updateDashboardSideVisibility();
}

async function applyDashboardSearch(query) {
  const run = ++_dashboardSearchRun;
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    resetDashboardSearch();
    document.dispatchEvent(new CustomEvent('browseloom-local-search-results', {
      detail: { surface: 'tabs', query: '', count: 0 },
    }));
    return;
  }

  resetDashboardSearch();
  const index = await buildDashboardSearchIndex();
  if (run !== _dashboardSearchRun) return;

  const results = SearchService?.searchIndex ? SearchService.searchIndex(index, trimmed) : [];
  applyOpenTabSearchResults(results, trimmed);
  applySavedSearchResults(results, trimmed);
  applySavedSessionSearchResults(results, trimmed);
  document.dispatchEvent(new CustomEvent('browseloom-local-search-results', {
    detail: { surface: 'tabs', query: trimmed, count: results.length },
  }));
}

window.SuperTabOutDashboardSearch = {
  apply: applyDashboardSearch,
  reset: resetDashboardSearch,
};

// ---- Open-tabs search — filter domain cards and chips as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'openTabsSearch') return;
  if (e.target.dataset.searchMode === 'external') return;
  await applyDashboardSearch(e.target.value);
});

// ---- Keyboard shortcuts for the search pill ----
document.addEventListener('keydown', (e) => {
  const search = document.getElementById('openTabsSearch');
  if (!search) return;
  if (search.dataset.searchMode === 'external' && document.activeElement === search) return;

  // "/" focuses the search (unless the user is already typing somewhere
  // else, or the privacy screen is covering the dashboard).
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
    if (document.body.classList.contains('privacy-mode')) return;
    if (document.body.dataset.workspace === 'bookmarks') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    e.preventDefault();
    search.focus();
    search.select();
    return;
  }

  // Escape clears and blurs when the search input is focused. We stop
  // propagation so the privacy-mode Esc handler below doesn't ALSO fire
  // and flip privacy on top of the search clear.
  if (e.key === 'Escape' && document.activeElement === search) {
    search.value = '';
    search.dispatchEvent(new Event('input'));
    search.blur();
    e.stopImmediatePropagation();
  }
});

// ---- Archive search — filter archived items as user types ----
document.addEventListener('input', async (e) => {
  if (e.target.id !== 'archiveSearch') return;

  const q = e.target.value.trim().toLowerCase();
  const archiveList = document.getElementById('archiveList');
  if (!archiveList) return;

  try {
    const { archived } = await getSavedTabs();

    if (q.length < 2) {
      // Show all archived items
      archiveList.innerHTML = archived.map(item => renderArchiveItem(item)).join('');
      return;
    }

    // Filter by title or URL containing the query string
    const results = archived.filter(item =>
      (item.title || '').toLowerCase().includes(q) ||
      (item.url  || '').toLowerCase().includes(q)
    );

    archiveList.innerHTML = results.map(item => renderArchiveItem(item)).join('')
      || `<div style="font-size:12px;color:var(--muted);padding:8px 0">${escapeHtml(tr('noResults'))}</div>`;
  } catch (err) {
    console.warn('[tab-out] Archive search failed:', err);
  }
});


/* ----------------------------------------------------------------
   FAVICON FALLBACK — hide broken favicon images.
   Inline onerror attributes are blocked by the MV3 default CSP, so we
   use a single delegated listener in the capture phase (the 'error'
   event doesn't bubble).
   ---------------------------------------------------------------- */
document.addEventListener('error', (e) => {
  const el = e.target;
  if (el && el.tagName === 'IMG') el.style.display = 'none';
}, true);

// Same pattern for `load` — any successfully-loaded favicon with a
// data-favicon-domain attribute gets snapshotted into localStorage so
// the next new-tab open skips the network request.
document.addEventListener('load', (e) => {
  const el = e.target;
  if (!el || el.tagName !== 'IMG') return;
  const domain = el.dataset.faviconDomain;
  if (!domain) return;
  // Skip if the src is already a data: URL (came from cache).
  if ((el.currentSrc || el.src || '').startsWith('data:')) return;
  cacheFaviconFromImg(domain, el);
}, true);


/* ----------------------------------------------------------------
   PRIVACY MODE — hide dashboard content during screen sharing

   Toggled by the lock icon in the header or by Esc. State is stored in
   chrome.storage.local so it survives new tabs. initPrivacyMode() runs
   before the first render so the dashboard never flashes into view when
   a locked session is reopened.
   ---------------------------------------------------------------- */

const PRIVACY_DEFAULTS = { clock: true, date: true, motto: true, mottoText: '', externalFavicons: false };

async function getPrivacyMode() {
  try {
    if (StorageService?.getPrivacyMode) return await StorageService.getPrivacyMode();
    const { privacyMode } = await chrome.storage.local.get('privacyMode');
    return privacyMode === true;
  } catch { return false; }
}

async function getPrivacySettings() {
  try {
    if (StorageService?.getPrivacySettings) return await StorageService.getPrivacySettings();
    const { privacySettings } = await chrome.storage.local.get('privacySettings');
    return { ...PRIVACY_DEFAULTS, ...privacySettings };
  } catch { return { ...PRIVACY_DEFAULTS }; }
}

async function savePrivacySettings(settings) {
  try {
    if (StorageService?.setPrivacySettings) await StorageService.setPrivacySettings(settings);
    else await chrome.storage.local.set({ privacySettings: settings });
  } catch {}
}

async function setPrivacyMode(enabled) {
  try {
    if (StorageService?.setPrivacyMode) await StorageService.setPrivacyMode(enabled);
    else await chrome.storage.local.set({ privacyMode: enabled });
  } catch {}
  document.body.classList.toggle('privacy-mode', enabled);
  if (enabled) {
    await applyPrivacyWidgets();
    startPrivacyClock();
  } else {
    const panel = document.getElementById('privacySettings');
    if (panel?.open) setSettingsPanelOpen(false);
    stopPrivacyClock();
    // Refresh is suppressed while locked (see scheduleRefresh); catch up now.
    renderDashboard();
  }
}

async function applyPrivacyWidgets() {
  const s = await getPrivacySettings();
  const timeEl   = document.getElementById('privacyTime');
  const dateEl   = document.getElementById('privacyDate');
  const mottoEl  = document.getElementById('privacyMotto');

  if (timeEl)   timeEl.style.display   = s.clock  ? '' : 'none';
  if (dateEl)   dateEl.style.display   = s.date   ? '' : 'none';
  if (mottoEl) {
    mottoEl.style.display = s.motto && s.mottoText ? '' : 'none';
    mottoEl.textContent   = s.mottoText || '';
  }

  // Sync checkboxes in the settings panel with persisted state.
  const ids = { psClock: 'clock', psDate: 'date', psMotto: 'motto' };
  for (const [elId, key] of Object.entries(ids)) {
    const cb = document.getElementById(elId);
    if (cb) cb.checked = s[key];
  }
  const mottoInput = document.getElementById('psMottoInput');
  if (mottoInput) mottoInput.value = s.mottoText || '';
  const mottoEdit = document.getElementById('psMottoEdit');
  if (mottoEdit) mottoEdit.style.display = s.motto ? '' : 'none';
  const faviconCb = document.getElementById('psFavicons');
  if (faviconCb) faviconCb.checked = s.externalFavicons === true;
  externalFaviconsEnabled = s.externalFavicons === true;
}

let privacyClockInterval = null;

function updatePrivacyClock() {
  const now = new Date();
  const timeEl = document.getElementById('privacyTime');
  const dateEl = document.getElementById('privacyDate');
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', hour12: false,
    });
  }
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString(activeLanguage === 'zh' ? 'zh-CN' : 'en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  }
}

function startPrivacyClock() {
  updatePrivacyClock();
  if (!privacyClockInterval) privacyClockInterval = setInterval(updatePrivacyClock, 1000);
}

function stopPrivacyClock() {
  if (privacyClockInterval) {
    clearInterval(privacyClockInterval);
    privacyClockInterval = null;
  }
}

async function togglePrivacyMode() {
  const current = document.body.classList.contains('privacy-mode');
  await setPrivacyMode(!current);
}

document.getElementById('privacyToggle')?.addEventListener('click', togglePrivacyMode);

function isSettingsPanelOpen() {
  const panel = document.getElementById('privacySettings');
  return Boolean(panel?.open);
}

let settingsTriggerElement = null;

function setSettingsPanelOpen(open, { view, trigger } = {}) {
  const panel = document.getElementById('privacySettings');
  if (!panel) return;
  if (open) {
    settingsTriggerElement = trigger instanceof HTMLElement ? trigger : document.activeElement;
    const initialView = view || (document.body.classList.contains('privacy-mode') ? 'privacy' : activeSettingsView);
    setSettingsView(initialView);
    if (!panel.open) panel.showModal();
    document.querySelectorAll('.global-settings-trigger').forEach(button => button.setAttribute('aria-expanded', 'true'));
    panel.querySelector('.settings-tab.active')?.focus({ preventScroll: true });
    return;
  }
  setLanguageMenuOpen(false);
  setThemeMenuOpen(false);
  setFontMenuOpen(false);
  const restoreTarget = settingsTriggerElement;
  if (panel.contains(document.activeElement)) document.activeElement.blur();
  if (panel.open) panel.close();
  if (restoreTarget instanceof HTMLElement && restoreTarget.isConnected) {
    queueMicrotask(() => restoreTarget.focus({ preventScroll: true }));
  }
}

const settingsDialog = document.getElementById('privacySettings');
settingsDialog?.addEventListener('cancel', event => {
  event.preventDefault();
  setSettingsPanelOpen(false);
});
settingsDialog?.addEventListener('click', event => {
  if (event.target === settingsDialog) setSettingsPanelOpen(false);
});
settingsDialog?.addEventListener('close', () => {
  document.querySelectorAll('.global-settings-trigger').forEach(button => button.setAttribute('aria-expanded', 'false'));
  const trigger = settingsTriggerElement;
  settingsTriggerElement = null;
  if (trigger instanceof HTMLElement && trigger.isConnected) {
    requestAnimationFrame(() => {
      if (trigger.isConnected) trigger.focus({ preventScroll: true });
    });
  }
});

// Esc toggles privacy. Typing in any text input first defuses Esc to just
// blur the field — including the open-tabs search handled above.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (document.getElementById('bulkTabConfirmDialog')?.open) return;
  if (isSettingsPanelOpen()) {
    e.preventDefault();
    setSettingsPanelOpen(false);
    return;
  }
  // The bookmark workspace owns Escape for its menus and dialogs. Privacy
  // mode remains a tab-management shortcut and must not steal that key.
  if (document.body.dataset.workspace === 'bookmarks') return;
  if (document.querySelector('.group-color-control.is-open')) {
    e.preventDefault();
    closeGroupColorPickers({ restoreFocus: true });
    return;
  }
  if (document.querySelector('.group-action-menu-control.is-open')) {
    e.preventDefault();
    closeGroupActionMenus({ restoreFocus: true });
    return;
  }
  const languageSwitcher = document.getElementById('languageSwitcher');
  if (languageSwitcher?.classList.contains('language-menu-open')) {
    e.preventDefault();
    setLanguageMenuOpen(false);
    return;
  }
  const themePicker = document.getElementById('themePicker');
  if (themePicker?.classList.contains('theme-menu-open')) {
    e.preventDefault();
    setThemeMenuOpen(false);
    return;
  }
  const fontPicker = document.getElementById('fontPicker');
  if (fontPicker?.classList.contains('font-menu-open')) {
    e.preventDefault();
    setFontMenuOpen(false);
    return;
  }
  const active = document.activeElement;
  const GUARDED_IDS = ['psMottoInput', 'openTabsSearch', 'archiveSearch'];
  if (active && GUARDED_IDS.includes(active.id)) {
    e.preventDefault();
    active.blur();
    return;
  }
  e.preventDefault();
  togglePrivacyMode();
});

document.addEventListener('click', (e) => {
  const target = e.target instanceof Element ? e.target : null;
  if (!target?.closest('.group-color-control')) closeGroupColorPickers();
  if (!target?.closest('.group-action-menu-control')) closeGroupActionMenus();

  const languageSwitcher = document.getElementById('languageSwitcher');
  if (languageSwitcher && target && !languageSwitcher.contains(target)) setLanguageMenuOpen(false);
  const themePicker = document.getElementById('themePicker');
  if (themePicker && target && !themePicker.contains(target)) setThemeMenuOpen(false);
  const fontPicker = document.getElementById('fontPicker');
  if (fontPicker && target && !fontPicker.contains(target)) setFontMenuOpen(false);

});

for (const id of ['psClock', 'psDate', 'psMotto', 'psFavicons']) {
  document.getElementById(id)?.addEventListener('change', async () => {
    const s = await getPrivacySettings();
    s.clock  = document.getElementById('psClock')?.checked ?? true;
    s.date   = document.getElementById('psDate')?.checked ?? true;
    s.motto  = document.getElementById('psMotto')?.checked ?? true;
    s.externalFavicons = document.getElementById('psFavicons')?.checked ?? false;
    await savePrivacySettings(s);
    await applyPrivacyWidgets();
    renderDashboard();
  });
}

const _privacyMottoInput = document.getElementById('psMottoInput');
if (_privacyMottoInput) {
  const saveMotto = async () => {
    const s = await getPrivacySettings();
    s.mottoText = _privacyMottoInput.value.trim();
    await savePrivacySettings(s);
    applyPrivacyWidgets();
  };
  _privacyMottoInput.addEventListener('blur', saveMotto);
  _privacyMottoInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); _privacyMottoInput.blur(); }
  });
}

async function initPrivacyMode() {
  const enabled = await getPrivacyMode();
  if (enabled) {
    document.body.classList.add('privacy-mode');
    await applyPrivacyWidgets();
    startPrivacyClock();
  }
}


/* ----------------------------------------------------------------
   LIVE TAB LISTENERS — re-render when tabs change
   Debounced so rapid tab changes don't cause excessive re-renders.
   ---------------------------------------------------------------- */
let _tabRefreshTimer = null;
let _initialRenderDone = false;

function scheduleRefresh() {
  if (_tabRefreshTimer) clearTimeout(_tabRefreshTimer);
  _tabRefreshTimer = setTimeout(() => {
    // While privacy mode covers the dashboard, skip the re-render — the
    // user can't see it, and we'd be thrashing the DOM behind the lock.
    if (document.body.classList.contains('privacy-mode')) return;
    // Entrance animations are a one-shot greeting; don't replay them on
    // every tab event or the dashboard flickers as tabs come and go.
    if (_initialRenderDone) document.body.classList.add('no-entrance-anim');
    renderDashboard();
  }, 300);
}

if (typeof chrome !== 'undefined' && chrome.tabs) {
  chrome.tabs.onCreated.addListener(scheduleRefresh);
  chrome.tabs.onRemoved.addListener(scheduleRefresh);
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    // Only refresh on meaningful changes; ignore intermediate loading noise.
    if (changeInfo.status === 'complete' || changeInfo.url) scheduleRefresh();
  });
  // Only refresh when the user switches BACK to a BrowseLoom tab —
  // not on every tab switch across the browser.
  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    try {
      const tab = await chrome.tabs.get(activeInfo.tabId);
      if (tab.url && tab.url.startsWith(`chrome-extension://${chrome.runtime.id}/`)) {
        scheduleRefresh();
      }
    } catch { /* tab may have closed before the query resolved */ }
  });
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'toggle-privacy-mode') togglePrivacyMode();
  });
}


// Ctrl/Cmd + Shift + G — quickly toggle between Groups and Domains view.
// No-op when no Chrome tab groups exist.
document.addEventListener('keydown', async (e) => {
  if (e.key === 'Escape') {
    closeGroupColorPickers();
    setThemeMenuOpen(false);
    setFontMenuOpen(false);
  }
  if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
  if (e.key !== 'G' && e.key !== 'g') return;
  if (tabGroupsList.length === 0) return;
  e.preventDefault();
  const stored = await loadViewMode();
  await saveViewMode(stored === 'group' ? 'domain' : 'group');
  await renderDashboard();
});


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
initSettingsPanelLayout();
initDefaultWorkspaceSettings();
initThemeSwitcher();
initCardOpacityControl();
initFontSwitcher();
initLanguageSwitcher();
loadExtensionVersion();
initStorageErrorToasts();
cleanExpiredFavicons();

async function initApp() {
  try {
    const migration = await StorageService?.migrateStorage?.();
    if (migration?.forwardVersion) {
      document.body.dataset.storageBlocked = 'forward-version';
      const alert = document.createElement('main');
      alert.className = 'storage-version-block';
      alert.setAttribute('role', 'alert');
      alert.innerHTML = `<h1>${escapeHtml(tr('storageForwardTitle'))}</h1><p>${escapeHtml(tr('storageForwardBody'))}</p>`;
      document.body.replaceChildren(alert);
      return;
    }
  } catch (err) {
    if (err?.code === 'storage-schema-forward') {
      document.body.dataset.storageBlocked = 'forward-version';
      const alert = document.createElement('main');
      alert.className = 'storage-version-block';
      alert.setAttribute('role', 'alert');
      alert.innerHTML = `<h1>${escapeHtml(tr('storageForwardTitle'))}</h1><p>${escapeHtml(tr('storageForwardBody'))}</p>`;
      document.body.replaceChildren(alert);
      return;
    }
    console.warn('[tab-out] Storage migration failed:', err);
  }

  // initPrivacyMode runs first so a locked session never flashes the
  // dashboard into view before the body.privacy-mode class lands.
  await initPrivacyMode();
  await renderDashboard();
  _initialRenderDone = true;
}

initApp();
