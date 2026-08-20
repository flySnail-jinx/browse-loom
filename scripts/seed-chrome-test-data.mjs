#!/usr/bin/env node
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    port: { type: 'string' },
    'delay-ms': { type: 'string' },
    cleanup: { type: 'string' },
    timeout: { type: 'string' },
  },
});

const port = numberOr(values.port || process.env.REMOTE_DEBUGGING_PORT, 9224);
const delayMs = numberOr(values['delay-ms'] || process.env.SEED_DELAY_MS, 900);
const timeoutMs = numberOr(values.timeout || process.env.SEED_TIMEOUT_MS, 20000);
const cleanup = stringFlag(values.cleanup ?? process.env.SEED_CLEANUP ?? '1');
const seedRunId = `dev-seed-${Date.now()}`;

const PINNED_TABS = [
  { url: 'https://github.com/', pinned: true },
  { url: 'https://developer.chrome.com/docs/extensions/', pinned: true },
  { url: 'https://web.dev/', pinned: true },
];

const TAB_GROUPS = [
  {
    title: 'Research - Chrome APIs',
    color: 'blue',
    collapsed: false,
    urls: [
      'https://developer.chrome.com/docs/extensions/reference/api/tabs',
      'https://developer.chrome.com/docs/extensions/reference/api/tabGroups',
      'https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
      'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array',
    ],
  },
  {
    title: 'Build - BrowseLoom',
    color: 'green',
    collapsed: false,
    urls: [
      'https://github.com/flySnail-jinx/browse-loom',
      'https://github.com/flySnail-jinx/browse-loom/issues',
      'https://github.com/flySnail-jinx/browse-loom/pulls',
      'https://github.com/flySnail-jinx/browse-loom/actions',
    ],
  },
  {
    title: 'Duplicates',
    color: 'yellow',
    collapsed: false,
    urls: [
      'https://developer.chrome.com/docs/extensions/reference/api/tabs',
      'https://developer.chrome.com/docs/extensions/reference/api/tabs',
      'https://developer.mozilla.org/en-US/docs/Web/API/Window',
      'https://developer.mozilla.org/en-US/docs/Web/API/Window',
    ],
  },
  {
    title: 'Saved-ish Reading',
    color: 'purple',
    collapsed: true,
    urls: [
      'https://web.dev/articles',
      'https://developer.chrome.com/blog',
      'https://github.blog/changelog',
    ],
  },
];

const UNGROUPED_TABS = [
  'https://news.ycombinator.com/',
  'https://www.wikipedia.org/',
  'https://www.w3.org/standards/',
  'https://caniuse.com/',
  'https://example.com/',
  'https://example.org/',
];

const RECENTLY_CLOSED_URL = 'https://example.com/browse-loom-recently-closed';
const SEED_URLS = [
  ...PINNED_TABS.map(tab => tab.url),
  ...TAB_GROUPS.flatMap(group => group.urls),
  ...UNGROUPED_TABS,
  RECENTLY_CLOSED_URL,
];

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringFlag(value) {
  return !['0', 'false', 'no', 'off'].includes(String(value).trim().toLowerCase());
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isoMinutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60000).toISOString();
}

function weekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

function buildSeedStorage() {
  const seededAt = new Date().toISOString();
  const currentWeek = weekKey();
  const bookmarkIcon = (color, text) => ({ type: 'color', color, text });

  // Intentionally seed a pre-v7 snapshot so browser acceptance also exercises
  // migration of legacy dismissed items and flat saved-session records.
  return {
    storageSchemaVersion: 2,
    storageLastMigratedAt: seededAt,
    devSeedRunId: seedRunId,
    devSeededAt: seededAt,
    viewMode: 'group',
    privacyMode: false,
    privacySettings: {
      clock: true,
      date: true,
      motto: true,
      mottoText: 'Your browsing stays on this device.',
      externalFavicons: true,
    },
    deferred: [
      {
        id: 'seed-deferred-permissions',
        url: 'https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions',
        title: 'Chrome extension permissions checklist',
        savedAt: isoMinutesAgo(60 * 22),
        completed: false,
        dismissed: false,
      },
      {
        id: 'seed-deferred-side-panel',
        url: 'https://developer.chrome.com/docs/extensions/reference/api/sidePanel',
        title: 'Side Panel API follow-up',
        savedAt: isoMinutesAgo(60 * 16),
        completed: false,
        dismissed: false,
      },
      {
        id: 'seed-deferred-store-policy',
        url: 'https://developer.chrome.com/docs/webstore/program-policies/privacy',
        title: 'Store privacy disclosure review',
        savedAt: isoMinutesAgo(60 * 10),
        completed: false,
        dismissed: false,
      },
      {
        id: 'seed-deferred-finished-release',
        url: 'https://github.com/flySnail-jinx/browse-loom/releases',
        title: 'Release notes already checked',
        savedAt: isoMinutesAgo(60 * 48),
        completed: true,
        completedAt: isoMinutesAgo(60 * 3),
        dismissed: false,
      },
      {
        id: 'seed-deferred-dismissed-archive',
        url: 'https://example.com/browse-loom-dismissed-seed',
        title: 'Dismissed seed item',
        savedAt: isoMinutesAgo(60 * 72),
        completed: false,
        dismissed: true,
      },
    ],
    savedSessions: [
      {
        id: 'seed-session-manual-regression',
        name: 'Manual regression deck',
        title: 'Manual regression deck',
        savedAt: isoMinutesAgo(35),
        group: 'QA',
        tabs: [
          {
            url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
            title: 'Tabs API',
            pinned: false,
            groupTitle: 'Research - Chrome APIs',
          },
          {
            url: 'https://developer.chrome.com/docs/extensions/reference/api/tabGroups',
            title: 'Tab Groups API',
            pinned: false,
            groupTitle: 'Research - Chrome APIs',
          },
          {
            url: 'https://github.com/flySnail-jinx/browse-loom/issues',
            title: 'Issue queue',
            pinned: false,
            groupTitle: 'Build - BrowseLoom',
          },
        ],
        urls: [
          'https://developer.chrome.com/docs/extensions/reference/api/tabs',
          'https://developer.chrome.com/docs/extensions/reference/api/tabGroups',
          'https://github.com/flySnail-jinx/browse-loom/issues',
        ],
      },
      {
        id: 'seed-session-store-assets',
        name: 'Store listing references',
        title: 'Store listing references',
        savedAt: isoMinutesAgo(60 * 26),
        group: 'Publishing',
        tabs: [
          {
            url: 'https://developer.chrome.com/docs/webstore/listing',
            title: 'Chrome Web Store listing docs',
            pinned: false,
            groupTitle: 'Publishing',
          },
          {
            url: 'https://developer.chrome.com/docs/webstore/images',
            title: 'Chrome Web Store image assets',
            pinned: false,
            groupTitle: 'Publishing',
          },
        ],
        urls: [
          'https://developer.chrome.com/docs/webstore/listing',
          'https://developer.chrome.com/docs/webstore/images',
        ],
      },
    ],
    activityStats: {
      closedTotal: 32,
      savedTotal: 13,
      duplicateClosedTotal: 11,
      sessionsSavedTotal: 2,
      weekly: {
        [currentWeek]: {
          closed: 8,
          saved: 3,
          duplicateClosed: 4,
          sessionsSaved: 1,
        },
      },
      domains: {
        'developer.chrome.com': 12,
        'github.com': 8,
        'stackoverflow.com': 5,
        'web.dev': 3,
        'example.com': 2,
      },
    },
    achievements: ['closed-10', 'saved-10', 'dedupe-10', 'session-saver'],
    bookmarkLibrary: {
      version: 3,
      viewMode: 'grid',
      categories: [
        {
          id: 'category-home', name: 'Home', icon: 'home', system: 'home', order: 0,
          itemOrder: ['folder:seed-folder-build', 'folder:seed-folder-design', 'bookmark:seed-bookmark-webdev'],
          createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-category-research', name: 'Research', icon: 'book', system: '', order: 1,
          itemOrder: ['folder:seed-folder-research', 'bookmark:seed-bookmark-mdn'],
          createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-category-inspiration', name: 'Inspiration', icon: 'sparkles', system: '', order: 2,
          itemOrder: ['bookmark:seed-bookmark-design'],
          createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'category-unfiled', name: 'Unfiled', icon: 'archive', system: 'unfiled', order: 3,
          itemOrder: [], createdAt: seededAt, updatedAt: seededAt,
        },
      ],
      folders: [
        {
          id: 'seed-folder-build', name: 'Build', icon: 'code', categoryId: 'category-home',
          layout: '2x2', order: 0, createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-folder-design', name: 'Design', icon: 'palette', categoryId: 'category-home',
          layout: '2x1', order: 1, createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-folder-research', name: 'Browser APIs', icon: 'book', categoryId: 'seed-category-research',
          layout: '2x2', order: 0, createdAt: seededAt, updatedAt: seededAt,
        },
      ],
      bookmarks: [
        {
          id: 'seed-bookmark-repo', title: 'BrowseLoom', url: 'https://github.com/flySnail-jinx/browse-loom',
          note: 'Project source', categoryId: 'category-home', folderId: 'seed-folder-build',
          icon: bookmarkIcon('#315f8c', 'BL'), order: 0, openCount: 12,
          lastOpenedAt: isoMinutesAgo(45), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-chrome', title: 'Chrome Extensions', url: 'https://developer.chrome.com/docs/extensions/',
          note: 'Platform documentation', categoryId: 'category-home', folderId: 'seed-folder-build',
          icon: bookmarkIcon('#d9753f', 'CE'), order: 1, openCount: 9,
          lastOpenedAt: isoMinutesAgo(80), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-actions', title: 'GitHub Actions', url: 'https://docs.github.com/actions',
          note: 'Release automation', categoryId: 'category-home', folderId: 'seed-folder-build',
          icon: bookmarkIcon('#24292f', 'GA'), order: 2, openCount: 5,
          lastOpenedAt: isoMinutesAgo(180), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-a11y', title: 'Web Accessibility', url: 'https://web.dev/accessibility',
          note: 'Inclusive interface patterns', categoryId: 'category-home', folderId: 'seed-folder-design',
          icon: bookmarkIcon('#17736a', 'A11Y'), order: 0, openCount: 7,
          lastOpenedAt: isoMinutesAgo(125), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-material', title: 'Material Design', url: 'https://m3.material.io/',
          note: 'Interaction references', categoryId: 'category-home', folderId: 'seed-folder-design',
          icon: bookmarkIcon('#6750a4', 'M3'), order: 1, openCount: 6,
          lastOpenedAt: isoMinutesAgo(240), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-webdev', title: 'web.dev', url: 'https://web.dev/',
          note: 'Modern web guidance', categoryId: 'category-home', folderId: null,
          icon: bookmarkIcon('#0b57d0', 'W'), order: 0, openCount: 11,
          lastOpenedAt: isoMinutesAgo(60), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-tabs', title: 'Tabs API', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabs',
          note: 'Tab lifecycle reference', categoryId: 'seed-category-research', folderId: 'seed-folder-research',
          icon: bookmarkIcon('#4285f4', 'T'), order: 0, openCount: 10,
          lastOpenedAt: isoMinutesAgo(35), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-groups', title: 'Tab Groups API', url: 'https://developer.chrome.com/docs/extensions/reference/api/tabGroups',
          note: 'Native group management', categoryId: 'seed-category-research', folderId: 'seed-folder-research',
          icon: bookmarkIcon('#34a853', 'TG'), order: 1, openCount: 8,
          lastOpenedAt: isoMinutesAgo(95), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-mdn', title: 'MDN Web Docs', url: 'https://developer.mozilla.org/',
          note: 'Web platform reference', categoryId: 'seed-category-research', folderId: null,
          icon: bookmarkIcon('#1b1b1b', 'MDN'), order: 0, openCount: 13,
          lastOpenedAt: isoMinutesAgo(25), createdAt: seededAt, updatedAt: seededAt,
        },
        {
          id: 'seed-bookmark-design', title: 'Design Systems', url: 'https://www.designsystems.com/',
          note: 'Visual system notes', categoryId: 'seed-category-inspiration', folderId: null,
          icon: bookmarkIcon('#c44875', 'DS'), order: 0, openCount: 4,
          lastOpenedAt: isoMinutesAgo(300), createdAt: seededAt, updatedAt: seededAt,
        },
      ],
    },
  };
}

class CdpPage {
  constructor(wsUrl) {
    if (typeof WebSocket === 'undefined') {
      throw new Error('This script requires a Node.js runtime with global WebSocket support.');
    }
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
        const { resolve: ok, reject, timer } = this.pending.get(message.id);
        clearTimeout(timer);
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

  async send(method, params = {}, commandTimeoutMs = 10000) {
    await this.opened;
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, commandTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  async evaluate(expression, commandTimeoutMs = 10000) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, commandTimeoutMs);
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || 'Runtime evaluation failed';
      throw new Error(text);
    }
    return result.result?.value;
  }

  async waitFor(expression, waitTimeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < waitTimeoutMs) {
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

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function waitForJson(url, waitTimeoutMs = timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitTimeoutMs) {
    try { return await fetchJson(url); } catch { await sleep(150); }
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function newTarget(targetUrl) {
  return fetchJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(targetUrl)}`, { method: 'PUT' });
}

function isExtensionWorkerTarget(target) {
  return target?.type === 'service_worker'
    && /^chrome-extension:\/\/[^/]+\/background\.js/.test(target.url || '')
    && target.webSocketDebuggerUrl;
}

async function findExtensionWorkerTarget(waitTimeoutMs = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < waitTimeoutMs) {
    const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    const target = targets.find(isExtensionWorkerTarget);
    if (target) return target;
    await sleep(100);
  }
  return null;
}

async function wakeExtensionWorker() {
  try {
    await newTarget('chrome://newtab/');
  } catch {}
}

async function openExtensionRuntime() {
  let target = await findExtensionWorkerTarget();
  if (!target) {
    await wakeExtensionWorker();
    target = await findExtensionWorkerTarget(timeoutMs);
  }
  if (!target) throw new Error('Could not find BrowseLoom background service worker target.');

  const runtime = new CdpPage(target.webSocketDebuggerUrl);
  await runtime.send('Runtime.enable', {}, 15000);
  try {
    await runtime.waitFor(
      'Boolean(globalThis.chrome?.runtime?.id) && chrome.runtime.getManifest?.().name === "BrowseLoom"',
      timeoutMs,
    );
    return runtime;
  } catch (error) {
    runtime.close();
    throw error;
  }
}

function seedScenarioInExtension(config) {
  return (async () => {
    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const seedUrlSet = new Set(config.seedUrls);
    const seedUrlKeys = new Set(config.seedUrls.map(urlKey).filter(Boolean));
    const seedGroupTitles = new Set(config.groups.map(group => group.title));

    function urlKey(value) {
      try {
        const parsed = new URL(value);
        const host = parsed.hostname.replace(/^www\./, '');
        const path = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${host}${path}`;
      } catch {
        return '';
      }
    }

    function decodedUrl(value) {
      try { return decodeURIComponent(value); } catch { return value || ''; }
    }

    function matchesSeededUrl(value) {
      if (!value) return false;
      if (seedUrlSet.has(value) || seedUrlKeys.has(urlKey(value))) return true;

      let parsed;
      try { parsed = new URL(value); } catch { return false; }

      const host = parsed.hostname.replace(/^www\./, '');
      const path = parsed.pathname.replace(/\/+$/, '') || '/';
      const decoded = decodedUrl(value);

      if (host === 'accounts.google.com') {
        return decoded.includes('mail.google.com/mail/u/0/')
          || decoded.includes('docs.google.com/document/u/0/');
      }
      if (host === 'linkedin.com') {
        return path === '/feed' || path === '/uas/login' || decoded.includes('linkedin.com/feed/');
      }
      if (host === 'x.com') return true;
      if (host === 'notion.com' || host === 'notion.so') return true;
      if (host === 'developer.chrome.com') {
        return path === '/blog' || path.startsWith('/docs/extensions/reference/api/');
      }
      if (host === 'web.dev') return path === '/articles';

      return false;
    }

    async function createTab(windowId, url, options = {}) {
      const tab = await chrome.tabs.create({
        windowId,
        url,
        active: options.active === true,
        pinned: options.pinned === true,
      });
      await sleep(options.delay ?? 120);
      return tab;
    }

    async function createGroup(windowId, groupConfig) {
      const tabs = [];
      for (const url of groupConfig.urls) {
        tabs.push(await createTab(windowId, url));
      }
      const tabIds = tabs.map(tab => tab.id).filter(Number.isFinite);
      if (tabIds.length === 0) return null;
      const groupId = await chrome.tabs.group({ tabIds });
      await chrome.tabGroups.update(groupId, {
        title: groupConfig.title,
        color: groupConfig.color,
        collapsed: groupConfig.collapsed === true,
      });
      return groupId;
    }

    async function openDashboard(windowId) {
      await chrome.tabs.create({
        windowId,
        url: chrome.runtime.getURL('index.html'),
        active: true,
      });
      await sleep(120);
    }

    async function cleanupSeededTabs() {
      if (!config.cleanup) return 0;
      const [tabs, tabGroups] = await Promise.all([
        chrome.tabs.query({}),
        chrome.tabGroups.query({}),
      ]);
      const seedGroupIds = new Set(
        tabGroups
          .filter(group => seedGroupTitles.has(group.title))
          .map(group => group.id),
      );
      const ids = tabs
        .filter(tab => seedGroupIds.has(tab.groupId) || matchesSeededUrl(tab.url || ''))
        .map(tab => tab.id)
        .filter(Number.isFinite);
      if (ids.length > 0) {
        await chrome.tabs.remove(ids);
        await sleep(300);
      }
      return ids.length;
    }

    await chrome.storage.local.set(config.storage);
    if (typeof localStorage !== 'undefined') {
      for (const [key, value] of Object.entries(config.localStorage || {})) {
        localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
      }
    }

    const closedSeedTabs = await cleanupSeededTabs();
    await sleep(config.delayMs);

    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    const windowId = windows[0]?.id;
    if (!windowId) throw new Error('No normal Chrome window found for seed data.');

    let createdTabs = 0;
    for (const tab of config.pinnedTabs) {
      await createTab(windowId, tab.url, { pinned: tab.pinned === true });
      createdTabs += 1;
    }

    let createdGroups = 0;
    for (const group of config.groups) {
      const groupId = await createGroup(windowId, group);
      if (Number.isFinite(groupId)) createdGroups += 1;
      createdTabs += group.urls.length;
    }

    for (const url of config.ungroupedTabs) {
      await createTab(windowId, url);
      createdTabs += 1;
    }

    const recentTab = await createTab(windowId, config.recentlyClosedUrl, { delay: 350 });
    await sleep(350);
    await chrome.tabs.remove(recentTab.id);
    await openDashboard(windowId);

    return {
      seedRunId: config.seedRunId,
      closedSeedTabs,
      createdTabs,
      createdGroups,
      savedTabs: config.storage.deferred.length,
      savedSessions: config.storage.savedSessions.length,
    };
  })();
}

async function main() {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const runtime = await openExtensionRuntime();

  try {
    const config = {
      seedRunId,
      delayMs,
      cleanup,
      pinnedTabs: PINNED_TABS,
      groups: TAB_GROUPS,
      ungroupedTabs: UNGROUPED_TABS,
      recentlyClosedUrl: RECENTLY_CLOSED_URL,
      seedUrls: Array.from(new Set(SEED_URLS)),
      storage: buildSeedStorage(),
      localStorage: {
        'tab-out-theme': 'system',
        'tab-out-font-preset': 'compact',
        'tab-out-font-size-overrides': {
          header: 'default',
          cards: 'default',
          tabs: 'small',
        },
      },
    };

    const expression = `(${seedScenarioInExtension.toString()})(${JSON.stringify(config)})`;
    const result = await runtime.evaluate(expression, Math.max(timeoutMs, 30000));

    console.log(
      `Seeded BrowseLoom test data: ${result.createdTabs} tabs, `
      + `${result.createdGroups} groups, ${result.savedTabs} saved items, `
      + `${result.savedSessions} sessions. Closed ${result.closedSeedTabs} old seed tabs.`,
    );
  } finally {
    runtime.close();
  }
}

main().catch(error => {
  console.error(`[BrowseLoom Seeder] ${error.message || error}`);
  process.exit(1);
});
