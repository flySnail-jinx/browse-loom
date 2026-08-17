'use strict';

(function initSuperTabOutPanel() {
  if (!document.getElementById('tabsView')) return;

  const $ = selector => document.querySelector(selector);
  const LANGUAGE_KEY = 'tab-out-language';
  const COPY = {
    en: {
      commandCenter: 'Tab Center', refresh: 'Refresh', searchPlaceholder: 'Search tabs, saved items, sessions',
      searchLabel: 'Search tabs saved items and sessions', saveWindow: 'Save window', saveAllWindows: 'Save all windows',
      cleanDuplicates: 'Clean duplicates', newTabDashboard: 'New tab dashboard', noResults: 'No results',
      recentlyClosed: 'Recently closed', restore: 'Restore here', restoreWindows: 'Restore windows',
      nothingRecentlyClosed: 'Nothing recently closed.', jump: 'Jump', saveAction: 'Save', closeAction: 'Close',
      open: 'Open', saved: 'Saved', savedSession: 'Saved session', tabPlural: 'tabs',
      tabWindow: ({ count }) => `${count} tab window`, sessionSaved: 'Session saved', noDuplicates: 'No duplicates',
      duplicatesCleaned: 'Duplicates cleaned', savedForLater: 'Saved for later', tabClosed: 'Tab closed',
      storageForward: 'Update BrowseLoom before continuing. This version stopped to protect newer local data.',
      operationFailed: 'Could not complete that action.',
    },
    zh: {
      commandCenter: '标签中心', refresh: '刷新', searchPlaceholder: '搜索标签页、稍后再看和会话',
      searchLabel: '搜索标签页、稍后再看和会话', saveWindow: '保存当前窗口', saveAllWindows: '保存全部窗口',
      cleanDuplicates: '清理重复项', newTabDashboard: '新标签页仪表盘', noResults: '没有结果',
      recentlyClosed: '最近关闭', restore: '恢复到当前窗口', restoreWindows: '按窗口恢复',
      nothingRecentlyClosed: '没有最近关闭的内容。', jump: '跳转', saveAction: '保存', closeAction: '关闭',
      open: '打开', saved: '已保存', savedSession: '已保存会话', tabPlural: '个标签页',
      tabWindow: ({ count }) => `${count} 个标签页窗口`, sessionSaved: '会话已保存', noDuplicates: '没有重复项',
      duplicatesCleaned: '重复项已清理', savedForLater: '已加入稍后再看', tabClosed: '标签页已关闭',
      storageForward: '请先更新 BrowseLoom。当前版本已停止运行，以保护更新版本的本地数据。',
      operationFailed: '无法完成该操作。',
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
    const title = record.title || record.url || 'Untitled';
    const meta = record.type === 'tab'
      ? `${record.domain || domainFor(record.url)}${record.group ? ` · ${record.group}` : ''}`
      : record.type === 'saved'
        ? `${tr('saved')} · ${record.domain || domainFor(record.url)}`
        : `${tr('savedSession')} · ${sessionTabs(record.source).length} ${tr('tabPlural')}`;
    let actions = '';
    if (record.type === 'tab') {
      actions = `<button data-action="focus" data-url="${escapeHtml(record.url)}">${escapeHtml(tr('jump'))}</button>
        <button data-action="save-tab" data-url="${escapeHtml(record.url)}" data-title="${escapeHtml(title)}">${escapeHtml(tr('saveAction'))}</button>
        <button data-action="close-url" data-url="${escapeHtml(record.url)}">${escapeHtml(tr('closeAction'))}</button>`;
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
      return `<div class="recent-card"><div class="result-title">${escapeHtml(title)}</div><div class="recent-meta">${escapeHtml(meta || '')}</div><div class="result-actions"><button data-action="restore-recent" data-session-id="${escapeHtml(sessionId || '')}">${escapeHtml(tr('restore'))}</button></div></div>`;
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
    if (action === 'focus') await self.SuperTabOutTabs.focusTab(url);
    if (action === 'save-tab') {
      const restorableUrl = normalizeRestorableUrl(url);
      if (!restorableUrl) return;
      await self.SuperTabOutStorage.addDeferredTab({ url: restorableUrl, title: actionElement.dataset.title || restorableUrl });
      await self.SuperTabOutTabs.closeTabsByUrls([url]);
      await self.SuperTabOutStorage.recordActivity({ type: 'saved', count: 1, domain: domainFor(restorableUrl) });
      toast(tr('savedForLater'));
      await refreshData();
    }
    if (action === 'close-url') {
      const closed = await self.SuperTabOutTabs.closeTabsByUrls([url]);
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
