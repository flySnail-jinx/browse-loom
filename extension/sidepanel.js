'use strict';

(function initSuperTabOutPanel() {
  if (!document.getElementById('tabsView')) return;

  const $ = selector => document.querySelector(selector);
  const LANGUAGE_KEY = 'tab-out-language';
  const COPY = {
      en: {
      restoreRecent: "Reopen",
      untitled: "Untitled",
      saveWindowHint: "Save pages in this window. The window stays open.",
      saveAllWindowsHint: "Save pages in all windows. The windows stay open.",
      saveForLaterHint: "Save the address to Read later, then close this tab.",
      commandCenter: "Tabs", refresh: 'Refresh', searchPlaceholder: "Search tabs, Read later, and collections",
      searchLabel: "Search tabs, Read later, and collections", saveWindow: "Save this window", saveAllWindows: "Save all windows",
      cleanDuplicates: "Close duplicates", newTabDashboard: "Open home", noResults: "No results found",
      recentlyClosed: 'Recently closed', restore: "Open in this window", restoreWindows: "Open in separate windows",
      nothingRecentlyClosed: "No recently closed pages.", jump: "Switch", saveAction: "Save and close", closeAction: 'Close',
      open: "Open page", saved: 'Saved', savedSession: "Page collection", tabPlural: 'tabs',
      tabWindow: ({ count }) => `Window with ${count} tab${count === 1 ? '' : 's'}`, sessionSaved: "Page collection saved.", noDuplicates: "No duplicate tabs.",
      duplicatesCleaned: "Duplicate tabs closed.", savedForLater: "Added to Read later.", tabClosed: "Tab closed.",
      storageForward: "Update BrowseLoom first.\nThis data comes from a newer version.\nThis version has stopped to protect your data.",
      operationFailed: "Action could not be completed. Try again.",
    },
      zh: {
      restoreRecent: "重新打开",
      untitled: "未命名",
      saveWindowHint: "保存此窗口内的网页，不关闭窗口。",
      saveAllWindowsHint: "保存所有窗口内的网页，不关闭窗口。",
      saveForLaterHint: "保存网址，并关闭此标签页。",
      commandCenter: "标签页", refresh: '刷新', searchPlaceholder: "搜索标签页、稍后再看和网页合集",
      searchLabel: "搜索标签页、稍后再看和网页合集", saveWindow: "保存此窗口", saveAllWindows: "保存所有窗口",
      cleanDuplicates: "关闭重复页", newTabDashboard: "打开主页", noResults: "没找到结果",
      recentlyClosed: '最近关闭', restore: "在此窗口打开", restoreWindows: "分窗口打开",
      nothingRecentlyClosed: "暂无最近关闭的页面。", jump: "切换", saveAction: "保存并关闭", closeAction: '关闭',
      open: "打开网页", saved: '已保存', savedSession: "网页合集", tabPlural: '个标签页',
      tabWindow: ({ count }) => `窗口内有 ${count} 个标签页`, sessionSaved: "已保存网页合集。", noDuplicates: "没有重复的标签页。",
      duplicatesCleaned: "已关闭重复标签页。", savedForLater: "已加入稍后再看。", tabClosed: "已关闭标签页。",
      storageForward: "请先更新 BrowseLoom。\n数据来自更新版本。\n为保护数据，当前版本已停止运行。",
      operationFailed: "操作未完成，请重试。",
    },
  };

  let language = getLanguage();
  let openTabs = [];
  let tabGroups = [];
  let savedTabs = { active: [], archived: [] };
  let savedSessions = [];
  let currentQuery = '';

  function getLanguage() {
    try {
      const stored = localStorage.getItem(LANGUAGE_KEY);
      if (stored === 'zh' || stored === 'en') return stored;
    } catch {}
    return 'en';
  }

  function tr(key, params = {}) {
    const value = COPY[language]?.[key] || COPY.en[key] || key;
    return typeof value === 'function' ? value(params) : value;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function setText(selector, key) {
    document.querySelectorAll(selector).forEach(element => { element.textContent = tr(key); });
  }

  function setAttr(selector, attribute, key) {
    document.querySelectorAll(selector).forEach(element => { element.setAttribute(attribute, tr(key)); });
  }

  function applyTranslations({ rerender = false } = {}) {
    language = getLanguage();
    setText('.panel-header h1', 'commandCenter');
    setAttr('#refreshBtn', 'title', 'refresh');
    setAttr('#refreshBtn', 'aria-label', 'refresh');
    setAttr('#panelSearch', 'placeholder', 'searchPlaceholder');
    setAttr('#panelSearch', 'aria-label', 'searchLabel');
    setText('#saveSessionBtn', 'saveWindow');
    setText('#saveAllWindowsBtn', 'saveAllWindows');
    setAttr('#saveSessionBtn', 'title', 'saveWindowHint');
    setAttr('#saveAllWindowsBtn', 'title', 'saveAllWindowsHint');
    document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
    setText('#dedupeBtn', 'cleanDuplicates');
    setText('#newTabBtn', 'newTabDashboard');
    setText('#recentTitle', 'recentlyClosed');
    if (rerender) renderAll();
  }

  function toast(message) {
    const element = $('#panelToast');
    if (!element) return;
    element.textContent = message;
    element.classList.add('visible');
    setTimeout(() => element.classList.remove('visible'), 2200);
  }

  function domainFor(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return ''; }
  }

  function normalizeRestorableUrl(url) {
    return self.SuperTabOutUrls?.normalizeRestorableUrl?.(url) || '';
  }

  function sessionTabs(session) {
    if (Array.isArray(session?.windows)) {
      return session.windows.flatMap(window => Array.isArray(window?.tabs) ? window.tabs : []);
    }
    if (Array.isArray(session?.tabs)) return session.tabs;
    return (Array.isArray(session?.urls) ? session.urls : []).map(url => ({ url }));
  }

  function highlight(text) {
    if (!currentQuery || !self.SuperTabOutSearch?.getHighlightSegments) return escapeHtml(text);
    return self.SuperTabOutSearch.getHighlightSegments(text, currentQuery)
      .map(segment => segment.match
        ? `<mark class="search-match">${escapeHtml(segment.text)}</mark>`
        : escapeHtml(segment.text))
      .join('');
  }

  function buildIndex() {
    return self.SuperTabOutSearch.buildSearchIndex({
      tabs: openTabs,
      tabGroups,
      savedTabs: [...savedTabs.active, ...savedTabs.archived],
      savedSessions,
    });
  }

  function renderResultCard(record) {
    const title = record.type === 'session' && !record.source.title && !record.source.name
      ? tr('savedSession')
      : record.title || record.url || tr('untitled');
    const numericTabId = Number(record.tabId);
    const tabId = record.tabId !== null && record.tabId !== '' && Number.isSafeInteger(numericTabId) && numericTabId >= 0
      ? String(numericTabId)
      : '';
    const meta = record.type === 'tab'
      ? `${record.domain || domainFor(record.url)}${record.group ? ` · ${record.group}` : ''}`
      : record.type === 'saved'
        ? `${tr('saved')} · ${record.domain || domainFor(record.url)}`
        : `${tr('savedSession')} · ${sessionTabs(record.source).length} ${tr('tabPlural')}`;
    let actions = '';
    if (record.type === 'tab') {
      actions = `<button data-action="focus" data-tab-id="${escapeHtml(tabId)}" data-url="${escapeHtml(record.url)}">${escapeHtml(tr('jump'))}</button>
        <button data-action="save-tab" data-tab-id="${escapeHtml(tabId)}" title="${escapeHtml(tr('saveForLaterHint'))}" data-url="${escapeHtml(record.url)}" data-title="${escapeHtml(title)}">${escapeHtml(tr('saveAction'))}</button>
        <button data-action="close-tab" data-tab-id="${escapeHtml(tabId)}" data-url="${escapeHtml(record.url)}">${escapeHtml(tr('closeAction'))}</button>`;
    } else if (record.type === 'saved') {
      actions = `<button data-action="open-url" data-url="${escapeHtml(record.url)}">${escapeHtml(tr('open'))}</button>`;
    } else {
      const windowCount = Array.isArray(record.source?.windows) ? record.source.windows.length : 1;
      actions = `<button data-action="restore-saved-session" data-session-id="${escapeHtml(record.source.id)}">${escapeHtml(tr('restore'))}</button>
        ${windowCount > 1 ? `<button data-action="restore-saved-session-windows" data-session-id="${escapeHtml(record.source.id)}">${escapeHtml(tr('restoreWindows'))}</button>` : ''}`;
    }
    return `<article class="result-card"><div class="result-title">${highlight(title)}</div><div class="result-meta">${highlight(meta)}</div><div class="result-actions">${actions}</div></article>`;
  }

  function renderResults() {
    const list = $('#resultList');
    if (!list) return;
    const query = currentQuery.trim();
    const records = query
      ? self.SuperTabOutSearch.searchIndex(buildIndex(), query)
      : buildIndex().filter(record => record.type === 'tab').slice(0, 25);
    list.innerHTML = records.slice(0, 40).map(renderResultCard).join('')
      || `<div class="result-card"><div class="result-meta">${escapeHtml(tr('noResults'))}</div></div>`;
  }

  async function renderRecent() {
    const list = $('#recentList');
    if (!list) return;
    let sessions = [];
    try { sessions = await self.SuperTabOutTabs.getRecentlyClosed(8); } catch {}
    list.innerHTML = sessions.map(entry => {
      const title = entry.tab?.title || tr('tabWindow', { count: entry.window?.tabs?.length || 0 });
      const sessionId = entry.tab?.sessionId || entry.window?.sessionId;
      const meta = entry.tab?.url || (entry.window?.tabs || []).map(tab => tab.url).filter(Boolean).slice(0, 2).join(' · ');
      return `<div class="recent-card"><div class="result-title">${escapeHtml(title)}</div><div class="recent-meta">${escapeHtml(meta || '')}</div><div class="result-actions"><button data-action="restore-recent" data-session-id="${escapeHtml(sessionId || '')}">${escapeHtml(tr('restoreRecent'))}</button></div></div>`;
    }).join('') || `<div class="recent-card"><div class="recent-meta">${escapeHtml(tr('nothingRecentlyClosed'))}</div></div>`;
  }

  async function renderAll() {
    renderResults();
    await renderRecent();
  }

  async function refreshData() {
    try {
      openTabs = (await self.SuperTabOutTabs.fetchOpenTabs())
        .filter(tab => self.SuperTabOutTabs.isRealTab(tab, chrome.runtime.id));
      tabGroups = await self.SuperTabOutTabs.fetchTabGroups();
      savedTabs = await self.SuperTabOutStorage.getSavedTabs();
      savedSessions = await self.SuperTabOutStorage.getSavedSessions();
      await renderAll();
    } catch (error) {
      if (error?.code === 'storage-schema-forward') {
        $('#resultList').innerHTML = `<div class="result-card"><div class="result-meta">${escapeHtml(tr('storageForward'))}</div></div>`;
        return;
      }
      throw error;
    }
  }

  async function saveSession(scope) {
    const response = await chrome.runtime.sendMessage({ type: 'save-current-session', scope });
    if (response?.ok) {
      toast(tr('sessionSaved'));
      await refreshData();
    } else toast(tr('operationFailed'));
  }

  async function cleanDuplicates() {
    const counts = new Map();
    for (const tab of openTabs) counts.set(tab.url, (counts.get(tab.url) || 0) + 1);
    const urls = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([url]) => url);
    if (urls.length === 0) return toast(tr('noDuplicates'));
    const closed = await self.SuperTabOutTabs.closeDuplicateTabs(urls, true);
    await self.SuperTabOutStorage.recordActivity({ type: 'duplicateClosed', count: closed.length || urls.length });
    toast(tr('duplicatesCleaned'));
    await refreshData();
  }

  async function restoreSavedSession(id, mode) {
    const session = savedSessions.find(item => item.id === id);
    if (!session) return;
    await self.SuperTabOutTabs.restoreSavedSession(session, { focused: true, mode });
    await refreshData();
  }

  document.addEventListener('click', async event => {
    const actionElement = event.target.closest('[data-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.action;
    const url = actionElement.dataset.url;
    const tabId = actionElement.dataset.tabId && Number.isSafeInteger(Number(actionElement.dataset.tabId)) && Number(actionElement.dataset.tabId) >= 0
      ? Number(actionElement.dataset.tabId)
      : null;
    if (action === 'focus') {
      if (tabId !== null) await self.SuperTabOutTabs.focusTabById(tabId);
      else await self.SuperTabOutTabs.focusTab(url);
    }
    if (action === 'save-tab') {
      const restorableUrl = normalizeRestorableUrl(url);
      if (!restorableUrl) return;
      await self.SuperTabOutStorage.addDeferredTab({ url: restorableUrl, title: actionElement.dataset.title || restorableUrl });
      if (tabId !== null) await self.SuperTabOutTabs.closeTabsByIds([tabId]);
      await self.SuperTabOutStorage.recordActivity({ type: 'saved', count: 1, domain: domainFor(restorableUrl) });
      toast(tr('savedForLater'));
      await refreshData();
    }
    if (action === 'close-tab' && tabId !== null) {
      const closed = await self.SuperTabOutTabs.closeTabsByIds([tabId]);
      await self.SuperTabOutStorage.recordActivity({ type: 'closed', count: closed.length || 1, domain: domainFor(url) });
      toast(tr('tabClosed'));
      await refreshData();
    }
    if (action === 'open-url') {
      const restorableUrl = normalizeRestorableUrl(url);
      if (restorableUrl) await chrome.tabs.create({ url: restorableUrl });
    }
    if (action === 'restore-recent') {
      await self.SuperTabOutTabs.restoreSession(actionElement.dataset.sessionId);
      await refreshData();
    }
    if (action === 'restore-saved-session') await restoreSavedSession(actionElement.dataset.sessionId, 'currentWindow');
    if (action === 'restore-saved-session-windows') await restoreSavedSession(actionElement.dataset.sessionId, 'originalWindows');
  });

  $('#panelSearch')?.addEventListener('input', event => {
    currentQuery = event.target.value;
    renderResults();
  });
  $('#refreshBtn')?.addEventListener('click', refreshData);
  $('#saveSessionBtn')?.addEventListener('click', () => saveSession('currentWindow'));
  $('#saveAllWindowsBtn')?.addEventListener('click', () => saveSession('all'));
  $('#dedupeBtn')?.addEventListener('click', cleanDuplicates);
  $('#newTabBtn')?.addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') }));
  document.addEventListener('super-tab-out-panel-refresh', refreshData);
  document.addEventListener('super-tab-out-language-change', () => applyTranslations({ rerender: true }));
  window.addEventListener('storage', event => {
    if (event.key === LANGUAGE_KEY) applyTranslations({ rerender: true });
  });
  chrome.storage?.onChanged?.addListener?.((_changes, areaName) => {
    if (areaName === 'local') refreshData().catch(() => {});
  });

  applyTranslations();
  refreshData().catch(error => console.error('[super-tab-out] Side panel refresh failed:', error));
})();
