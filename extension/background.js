/**
 * background.js — Service Worker
 *
 * Keeps the badge fresh and owns browser-level entry points:
 * toolbar action, manifest commands, omnibox, and light session actions.
 */

importScripts(
  'services/url-service.js',
  'services/storage-service.js',
  'services/tabs-service.js',
  'services/search-service.js'
);

const INTERNAL_URL_PREFIXES = ['chrome://', 'chrome-extension://', 'about:', 'edge://', 'brave://'];

function isRealWebTab(tab) {
  if (!tab || tab.pinned) return false;
  const url = tab.url || '';
  return !INTERNAL_URL_PREFIXES.some(prefix => url.startsWith(prefix));
}

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({});
    const count = tabs.filter(isRealWebTab).length;

    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    if (count === 0) return;

    const color = count <= 10 ? '#3d7a4a' : count <= 20 ? '#b8892e' : '#b35a5a';
    await chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    chrome.action.setBadgeText({ text: '' });
  }
}

async function openSidePanel(tab) {
  try {
    await chrome.sidePanel.setOptions({ path: 'sidepanel.html', enabled: true });
    const windowId = tab?.windowId || (await chrome.windows.getCurrent()).id;
    await chrome.sidePanel.open({ windowId });
  } catch {
    const url = chrome.runtime.getURL('sidepanel.html');
    await chrome.tabs.create({ url });
  }
}

async function configureActionClickBehavior() {
  try {
    // The toolbar action owns quick bookmark capture instead of the side panel.
    await chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: false });
  } catch {}
}

function isBookmarkablePageUrl(value) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

async function openCurrentPageBookmarkDraft(sourceTab) {
  const tab = sourceTab?.id ? sourceTab : (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  const token = crypto.randomUUID();
  const storageKey = `bookmarkCapture:${token}`;
  const supported = isBookmarkablePageUrl(tab?.url);
  const draft = {
    url: supported ? tab.url : '',
    title: supported ? (tab.title || tab.url) : '',
    supported,
    createdAt: new Date().toISOString(),
  };
  await chrome.storage.session.set({ [storageKey]: draft });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`index.html?bookmarkCapture=${encodeURIComponent(token)}`) });
  } catch (error) {
    await chrome.storage.session.remove(storageKey);
    throw error;
  }
}

async function consumeBookmarkCapture(token, sender) {
  if (!/^[0-9a-f-]{36}$/i.test(String(token || ''))) return null;
  if (!String(sender?.url || '').startsWith(chrome.runtime.getURL('index.html'))) return null;
  const storageKey = `bookmarkCapture:${token}`;
  const stored = await chrome.storage.session.get(storageKey);
  await chrome.storage.session.remove(storageKey);
  return stored[storageKey] || null;
}

function normalizeRestorableUrl(url) {
  return self.SuperTabOutUrls?.normalizeRestorableUrl?.(url) || '';
}

function buildSessionWindows(realTabs, groupInfo) {
  const byWindow = new Map();
  for (const tab of realTabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  return Array.from(byWindow.values()).map((windowTabs, windowIndex) => {
    const groupKeys = new Map();
    return {
      index: windowIndex,
      tabs: windowTabs.map((tab, tabIndex) => {
        const group = groupInfo.get(tab.groupId);
        if (group && !groupKeys.has(tab.groupId)) groupKeys.set(tab.groupId, `group-${groupKeys.size + 1}`);
        return {
          url: tab.url,
          title: tab.title || tab.url,
          index: tabIndex,
          groupKey: group ? groupKeys.get(tab.groupId) : '',
          groupTitle: group?.title || '',
          groupColor: group?.color || '',
        };
      }),
    };
  });
}

async function saveCurrentSession(scope = 'currentWindow') {
  const tabs = await chrome.tabs.query(scope === 'currentWindow' ? { currentWindow: true } : {});
  const realTabs = tabs.filter(isRealWebTab).sort((a, b) => {
    if (a.windowId !== b.windowId) return a.windowId - b.windowId;
    return a.index - b.index;
  });

  const groupIds = Array.from(new Set(realTabs.map(tab => tab.groupId).filter(id => id >= 0)));
  const groupInfo = new Map();
  for (const groupId of groupIds) {
    try {
      const group = await chrome.tabGroups.get(groupId);
      groupInfo.set(groupId, group);
    } catch {}
  }

  const session = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `Session ${new Date().toLocaleString()}`,
    savedAt: new Date().toISOString(),
    windows: buildSessionWindows(realTabs, groupInfo),
  };

  const saved = await self.SuperTabOutStorage.addSavedSession(session);
  if (!saved) throw new Error('session-empty');
  await self.SuperTabOutStorage.recordActivity({ type: 'sessionSaved', count: 1 });
  return session;
}

async function broadcastToExtensionPages(message) {
  const tabs = await chrome.tabs.query({ url: chrome.runtime.getURL('*') });
  for (const tab of tabs) {
    if (!tab.id) continue;
    try { await chrome.tabs.sendMessage(tab.id, message); } catch {}
  }
}

async function buildOmniboxSuggestions(query) {
  const tabs = (await self.SuperTabOutTabs.fetchOpenTabs()).filter(tab => self.SuperTabOutTabs.isRealTab(tab, chrome.runtime.id));
  const groups = await self.SuperTabOutTabs.fetchTabGroups();
  const saved = await self.SuperTabOutStorage.getSavedTabs();
  const sessions = await self.SuperTabOutStorage.getSavedSessions();
  const index = self.SuperTabOutSearch.buildSearchIndex({
    tabs,
    tabGroups: groups,
    savedTabs: [...saved.active, ...saved.archived],
    savedSessions: sessions,
  });
  const searchSuggestions = self.SuperTabOutSearch.searchIndex(index, query)
    .slice(0, 5)
    .map(record => ({
      content: record.type === 'tab' ? `tab:${record.url}` : record.type === 'saved' ? `url:${record.url}` : `session:${record.source.id}`,
      description: `${record.type.toUpperCase()} ${escapeOmnibox(record.title)} <dim>${escapeOmnibox(record.domain || record.url || '')}</dim>`,
    }));
  return searchSuggestions.slice(0, 6);
}

function escapeOmnibox(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function handleOmniboxSelection(text) {
  if (text === 'sidepanel' || text === 'panel') {
    await openSidePanel();
    return;
  }
  if (text === 'dedupe' || text === 'clean') {
    const tabs = (await self.SuperTabOutTabs.fetchOpenTabs()).filter(tab => self.SuperTabOutTabs.isRealTab(tab, chrome.runtime.id));
    const counts = new Map();
    for (const tab of tabs) counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
    const urls = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([url]) => url);
    const closed = await self.SuperTabOutTabs.closeDuplicateTabs(urls, true);
    await self.SuperTabOutStorage.recordActivity({ type: 'duplicateClosed', count: closed.length || urls.length });
    await updateBadge();
    return;
  }
  if (text === 'privacy') {
    await broadcastToExtensionPages({ type: 'toggle-privacy-mode' });
    return;
  }
  if (text === 'save' || text === 'save-session') {
    await saveCurrentSession();
    return;
  }
  if (text.startsWith('tab:')) {
    await self.SuperTabOutTabs.focusTab(text.slice(4));
    return;
  }
  if (text.startsWith('url:')) {
    const url = normalizeRestorableUrl(text.slice(4));
    if (url) await chrome.tabs.create({ url });
    return;
  }
  if (text.startsWith('session:')) {
    const id = text.slice(8);
    const sessions = await self.SuperTabOutStorage.getSavedSessions();
    const session = sessions.find(item => item.id === id);
    if (session) await self.SuperTabOutTabs.restoreSavedSession(session, { focused: true });
    return;
  }

  const suggestions = await buildOmniboxSuggestions(text);
  if (suggestions[0]) {
    await handleOmniboxSelection(suggestions[0].content);
  } else {
    await openSidePanel();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  updateBadge();
  configureActionClickBehavior();
  chrome.omnibox.setDefaultSuggestion({
    description: 'Search BrowseLoom tabs, saved items, and sessions. Try "panel" or "save".',
  });
});

chrome.runtime.onStartup.addListener(() => {
  updateBadge();
  configureActionClickBehavior();
});
chrome.action.onClicked.addListener(openCurrentPageBookmarkDraft);
chrome.tabs.onCreated.addListener(updateBadge);
chrome.tabs.onRemoved.addListener(updateBadge);
chrome.tabs.onUpdated.addListener(updateBadge);

chrome.commands.onCommand.addListener(async (command, tab) => {
  try {
    if (command === 'open-side-panel') {
      await openSidePanel();
    } else if (command === 'save-current-session') {
      await saveCurrentSession();
    } else if (command === 'toggle-privacy-mode') {
      await broadcastToExtensionPages({ type: 'toggle-privacy-mode' });
    } else if (command === 'toggle-quick-return') {
      await self.SuperTabOutTabs.toggleQuickReturn(tab);
    } else if (command === 'toggle-workspace') {
      const targetTab = tab || (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
      if (!targetTab?.id) return;
      try { await chrome.runtime.sendMessage({ type: 'toggle-workspace', targetTabId: targetTab.id }); } catch {}
    } else if (command === 'bookmark-current-page') {
      await openCurrentPageBookmarkDraft(tab);
    }
  } catch (error) {
    console.error('[super-tab-out] Command failed', { command, code: error?.code || '', message: error?.message || String(error) });
  }
});

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  try {
    const suggestions = await buildOmniboxSuggestions(text);
    suggest([
      { content: 'sidepanel', description: 'Open <match>BrowseLoom</match> side panel' },
      { content: 'save-session', description: 'Save current browsing session' },
      { content: 'dedupe', description: 'Clean duplicate open tabs' },
      { content: 'privacy', description: 'Toggle privacy mode on BrowseLoom pages' },
      ...suggestions,
    ]);
  } catch {
    suggest([{ content: 'sidepanel', description: 'Open BrowseLoom side panel' }]);
  }
});

chrome.omnibox.onInputEntered.addListener((text) => {
  handleOmniboxSelection(text);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    if (message?.type === 'open-side-panel') {
      await openSidePanel(sender.tab);
      sendResponse({ ok: true });
    } else if (message?.type === 'save-current-session') {
      const session = await saveCurrentSession(message.scope || 'currentWindow');
      sendResponse({ ok: true, session });
    } else if (message?.type === 'restore-saved-session') {
      const sessions = await self.SuperTabOutStorage.getSavedSessions();
      const session = sessions.find(item => item.id === message.id);
      const restored = session ? await self.SuperTabOutTabs.restoreSavedSession(session, {
        focused: true,
        mode: message.mode === 'originalWindows' ? 'originalWindows' : 'currentWindow',
      }) : null;
      sendResponse({ ok: !!restored, restored });
    } else if (message?.type === 'consume-bookmark-capture') {
      const draft = await consumeBookmarkCapture(message.token, sender);
      sendResponse({ ok: !!draft, draft });
    } else {
      sendResponse({ ok: false });
    }
  })().catch(error => {
    console.error('[super-tab-out] Message failed', {
      type: message?.type || '',
      code: error?.code || '',
      message: error?.message || String(error),
    });
    sendResponse({ ok: false, error: error?.code || error?.message || 'operation-failed' });
  });
  return true;
});

configureActionClickBehavior();
updateBadge();
