/* Search-engine UI controller.
   Local mode keeps filtering the workspace; external mode owns only its suggestion popover. */
(function () {
  'use strict';

  const Engines = window.SuperTabOutSearchEngines;
  const Storage = window.SuperTabOutStorage;
  if (!Engines || !Storage) return;

  const COPY = {
    en: {
      searchSettings: 'Search',
      searchFailed: "Could not open search. Try again.",
      builtInEngines: "Search the web",
      builtInDescription: "Web searches use your browser's default search.\nYou can change it in browser settings.\nThe search box starts by finding open or saved content.",
      onlineSuggestions: "Search suggestions",
      baiduSuggestions: "Baidu suggestions",
      baiduSuggestionsDisclosure: "Optional and off by default.\nWhen enabled, text entered in web search is sent to Baidu.\nRecipient: suggestion.baidu.com\nSuggestions come from Baidu.\nResults still use your browser's default search.",
      tabs: 'Tabs',
      bookmarks: 'Bookmarks',
      localSearch: "Search open & saved",
      searchWith: ({ engine }) => `Use ${engine}`,
      searchQueryWith: ({ engine, query }) => `Search ${engine} for “${query}”`,
      suggestionsFrom: "Suggestions from Baidu",
      noLocalResults: "No content found",
      noLocalResultsFor: ({ query }) => `No results for “${query}”.\nTry searching the web.`,
      externalPlaceholder: ({ engine }) => `Use ${engine}`,
      permissionDenied: "Baidu suggestions do not have access.\nAllow access in the browser prompt for:\nsuggestion.baidu.com",
      permissionReloadRequired: "Access is not active yet.\nOpen chrome://extensions and reload BrowseLoom.\nThen turn Baidu suggestions on again.",
      permissionGestureRequired: "Click the switch and follow the browser's permission prompt.",
      permissionUnavailable: "This browser does not support the required permission.\nBaidu suggestions remain off.",
      permissionFailed: ({ message }) => `Permission request failed.\nReason: ${message}`,
      saved: "Search settings saved.",
      storageError: "Could not save search settings. Try again.",
    },
    zh: {
      searchSettings: '搜索',
      searchFailed: "搜索未能打开，请重试。",
      builtInEngines: "搜网页",
      builtInDescription: "搜网页时，使用浏览器的默认搜索。\n可在浏览器设置中更换。\n搜索框默认查找已打开或保存的内容。",
      onlineSuggestions: "搜索建议",
      baiduSuggestions: "百度建议",
      baiduSuggestionsDisclosure: "默认关闭，可自行开启。\n开启后，搜网页时的输入会发给百度。\n接收地址：\nsuggestion.baidu.com\n搜索建议由百度提供。\n搜索结果仍使用浏览器的默认搜索。",
      tabs: '标签页',
      bookmarks: '书签',
      localSearch: "搜已存内容",
      searchWith: ({ engine }) => `用${engine}`,
      searchQueryWith: ({ engine, query }) => `用${engine}查找「${query}」`,
      suggestionsFrom: "建议来自百度",
      noLocalResults: "没找到内容",
      noLocalResultsFor: ({ query }) => `没找到「${query}」。\n可以试试搜网页。`,
      externalPlaceholder: ({ engine }) => `用${engine}`,
      permissionDenied: "未获得百度建议的访问权限。\n请在浏览器提示中允许访问：\nsuggestion.baidu.com",
      permissionReloadRequired: "授权尚未生效。\n请打开扩展管理页：\nchrome://extensions\n重新加载 BrowseLoom。\n然后再次开启百度建议。",
      permissionGestureRequired: "请点击开关，按浏览器提示授权。",
      permissionUnavailable: "此浏览器暂不支持所需授权。\n百度建议未开启。",
      permissionFailed: ({ message }) => `授权失败。\n原因：${message}`,
      saved: "已保存搜索设置。",
      storageError: "搜索设置保存失败，请重试。",
    },
  };

  const BROWSER_ENGINE = Object.freeze({ id: 'browser', name: 'Default search', nameZh: '默认搜索', mark: '⌕' });

  const surfaces = {
    tabs: { mode: 'local', engineId: '', query: '', resultCount: 0 },
    bookmarks: { mode: 'local', engineId: '', query: '', resultCount: 0 },
  };
  let settings = Engines.defaultSearchSettings();
  let suggestionTimer = 0;
  let suggestionRun = 0;
  let suggestionAbort = null;
  let activeSuggestionIndex = -1;

  function language() {
    return document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
  }

  function t(key, params = {}) {
    const value = COPY[language()][key] || COPY.en[key] || key;
    return typeof value === 'function' ? value(params) : value;
  }

  function engineName(engine) {
    return language() === 'zh' ? (engine.nameZh || engine.name) : engine.name;
  }

  function surfaceInput(surface) {
    return document.getElementById(surface === 'bookmarks' ? 'bookmarkSearch' : 'openTabsSearch');
  }

  function surfaceWrap(surface) {
    return document.querySelector(`[data-search-surface="${surface}"]`);
  }

  function localSurfaceName(surface) {
    return t(surface === 'bookmarks' ? 'bookmarks' : 'tabs');
  }

  function showToast(message) {
    window.SuperTabOutToast?.show?.(message);
  }

  function showSearchStatus(message, kind = 'info') {
    const status = document.getElementById('searchSettingsStatus');
    if (!status) {
      showToast(message);
      return;
    }
    status.textContent = message;
    status.dataset.kind = kind;
    status.hidden = false;
  }

  function classifyPermissionFailure(error) {
    const message = String(error?.message || error || '').trim();
    const normalized = message.toLocaleLowerCase();
    if (normalized.includes('manifest') || normalized.includes('must be included') || normalized.includes('specified')) {
      return { key: 'permissionReloadRequired', params: {} };
    }
    if (normalized.includes('user gesture')) {
      return { key: 'permissionGestureRequired', params: {} };
    }
    if (normalized.includes('not supported') || normalized.includes('undefined')) {
      return { key: 'permissionUnavailable', params: {} };
    }
    return { key: message ? 'permissionFailed' : 'permissionDenied', params: { message } };
  }

  function setupAppNavigation() {
    const searchSlot = document.querySelector('.app-search-slot');
    const actionsSlot = document.querySelector('.app-actions-slot');
    const tabsSearch = document.querySelector('[data-search-surface="tabs"]');
    const bookmarkSearch = document.querySelector('[data-search-surface="bookmarks"]');
    const privacyToggle = document.getElementById('privacyToggle');
    const settingsButton = document.getElementById('privacySettingsBtn');
    const settingsDialog = document.getElementById('privacySettings');

    if (searchSlot && tabsSearch && bookmarkSearch) searchSlot.append(tabsSearch, bookmarkSearch);
    if (actionsSlot && privacyToggle && settingsButton) actionsSlot.append(privacyToggle, settingsButton);
    if (settingsDialog) document.body.append(settingsDialog);
    document.body.classList.add('app-navigation-ready');
  }

  function createMark(engine, local = false) {
    const mark = document.createElement('span');
    mark.className = 'search-source-mark';
    mark.textContent = local ? '⌕' : (engine?.mark || '?');
    if (!local && engine?.color) mark.style.setProperty('--engine-color', engine.color);
    mark.setAttribute('aria-hidden', 'true');
    return mark;
  }

  function ensureSurfacePopovers(surface) {
    const wrap = surfaceWrap(surface);
    if (!wrap) return {};
    let menu = wrap.querySelector('.search-source-menu');
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'search-source-menu';
      menu.setAttribute('role', 'menu');
      menu.hidden = true;
      wrap.append(menu);
    }
    let suggestions = wrap.querySelector('.search-suggestions');
    if (!suggestions) {
      suggestions = document.createElement('div');
      suggestions.className = 'search-suggestions';
      suggestions.setAttribute('role', 'listbox');
      suggestions.hidden = true;
      wrap.append(suggestions);
    }
    return { wrap, menu, suggestions };
  }

  function renderSourceButton(surface) {
    const state = surfaces[surface];
    const wrap = surfaceWrap(surface);
    const button = wrap?.querySelector('[data-search-action="toggle-source-menu"]');
    const input = surfaceInput(surface);
    if (!button || !input) return;
    const engine = state.mode === 'external' ? BROWSER_ENGINE : null;
    const mark = button.querySelector('.search-source-mark');
    if (mark) {
      mark.textContent = engine?.mark || '⌕';
      if (engine?.color) mark.style.setProperty('--engine-color', engine.color);
      else mark.style.removeProperty('--engine-color');
    }
    const label = engine ? engineName(engine) : `${localSurfaceName(surface)} · ${t('localSearch')}`;
    button.setAttribute('aria-label', label);
    button.title = label;
    input.dataset.searchMode = state.mode;
    input.dataset.searchEngineId = engine?.id || '';
    if (engine) {
      input.placeholder = t('externalPlaceholder', { engine: engineName(engine) });
      input.setAttribute('aria-label', input.placeholder);
    } else if (surface === 'bookmarks') {
      input.placeholder = language() === 'zh' ? '搜索书签' : 'Search bookmarks';
      input.setAttribute('aria-label', input.placeholder);
    } else {
      input.placeholder = language() === 'zh' ? '搜索标签页' : 'Search tabs';
      input.setAttribute('aria-label', input.placeholder);
    }
  }

  function renderSourceMenu(surface) {
    const { menu } = ensureSurfacePopovers(surface);
    if (!menu) return;
    menu.replaceChildren();
    const local = document.createElement('button');
    local.type = 'button';
    local.className = 'search-source-option';
    local.dataset.searchSource = 'local';
    local.dataset.searchSurfaceTarget = surface;
    local.setAttribute('role', 'menuitemradio');
    local.setAttribute('aria-checked', surfaces[surface].mode === 'local' ? 'true' : 'false');
    local.append(createMark(null, true));
    const localLabel = document.createElement('span');
    localLabel.textContent = localSurfaceName(surface);
    local.append(localLabel);
    const localCheck = document.createElement('span');
    localCheck.className = 'search-source-check';
    localCheck.textContent = surfaces[surface].mode === 'local' ? '✓' : '';
    local.append(localCheck);
    menu.append(local);

    const divider = document.createElement('div');
    divider.className = 'search-menu-divider';
    menu.append(divider);

    for (const engine of [BROWSER_ENGINE]) {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'search-source-option';
      option.dataset.searchSource = engine.id;
      option.dataset.searchSurfaceTarget = surface;
      option.setAttribute('role', 'menuitemradio');
      const selected = surfaces[surface].mode === 'external' && surfaces[surface].engineId === engine.id;
      option.setAttribute('aria-checked', selected ? 'true' : 'false');
      option.append(createMark(engine));
      const name = document.createElement('span');
      name.textContent = engineName(engine);
      option.append(name);
      const check = document.createElement('span');
      check.className = 'search-source-check';
      check.textContent = selected ? '✓' : '';
      option.append(check);
      menu.append(option);
    }

  }

  function hideSurfacePopovers(surface, { suggestions = true } = {}) {
    const { menu, suggestions: suggestionList, wrap } = ensureSurfacePopovers(surface);
    if (menu) menu.hidden = true;
    if (suggestions && suggestionList) suggestionList.hidden = true;
    wrap?.querySelector('[data-search-action="toggle-source-menu"]')?.setAttribute('aria-expanded', 'false');
    activeSuggestionIndex = -1;
  }

  function hideAllPopovers(exceptSurface = '') {
    for (const surface of Object.keys(surfaces)) {
      if (surface !== exceptSurface) hideSurfacePopovers(surface);
    }
  }

  async function applyLocalQuery(surface, query) {
    if (surface === 'tabs') await window.SuperTabOutDashboardSearch?.apply?.(query);
    else window.SuperTabOutBookmarkSearch?.setQuery?.(query);
  }

  async function setSearchMode(surface, mode) {
    const input = surfaceInput(surface);
    if (!input) return;
    const engine = mode === 'external'
      ? BROWSER_ENGINE
      : null;
    for (const targetSurface of Object.keys(surfaces)) {
      const targetInput = surfaceInput(targetSurface);
      surfaces[targetSurface].mode = engine ? 'external' : 'local';
      surfaces[targetSurface].engineId = engine?.id || '';
      await applyLocalQuery(targetSurface, engine ? '' : (targetInput?.value || ''));
      renderSourceButton(targetSurface);
      renderSourceMenu(targetSurface);
      hideSurfacePopovers(targetSurface);
    }
    input.focus({ preventScroll: true });
    if (engine && input.value.trim()) scheduleSuggestions(surface);
  }

  async function hasBaiduSuggestionPermission() {
    try {
      return await chrome.permissions.contains({ origins: [Engines.BAIDU_SUGGESTION_ORIGIN] });
    } catch {
      return false;
    }
  }

  async function fetchBaiduSuggestions(query, signal) {
    if (!settings.baiduSuggestionsEnabled || !(await hasBaiduSuggestionPermission())) return [];
    const url = new URL('https://suggestion.baidu.com/su');
    url.searchParams.set('p', '3');
    url.searchParams.set('ie', 'UTF-8');
    url.searchParams.set('cb', '');
    url.searchParams.set('wd', query);
    const response = await fetch(url, {
      signal,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`baidu-suggestion-http:${response.status}`);
    return Engines.parseBaiduSuggestionPayload(await response.text());
  }

  function renderSuggestions(surface, values = []) {
    const state = surfaces[surface];
    const input = surfaceInput(surface);
    const engine = BROWSER_ENGINE;
    const { suggestions } = ensureSurfacePopovers(surface);
    const query = input?.value.trim() || '';
    if (!suggestions || !engine || !query || state.mode !== 'external') {
      if (suggestions) suggestions.hidden = true;
      return;
    }
    suggestions.replaceChildren();
    if (values.length) {
      const label = document.createElement('div');
      label.className = 'search-suggestions-label';
      label.textContent = t('suggestionsFrom');
      suggestions.append(label);
      for (const value of values) {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'search-suggestion-option';
        option.dataset.searchSuggestion = value;
        option.dataset.searchEngineId = engine.id;
        option.setAttribute('role', 'option');
        option.append(createMark(engine));
        const text = document.createElement('span');
        text.textContent = value;
        option.append(text);
        suggestions.append(option);
      }
    }
    const submit = document.createElement('button');
    submit.type = 'button';
    submit.className = 'search-suggestion-option search-submit-option';
    submit.dataset.searchSuggestion = query;
    submit.dataset.searchEngineId = engine.id;
    submit.setAttribute('role', 'option');
    submit.append(createMark(engine));
    const submitText = document.createElement('span');
    submitText.textContent = t('searchQueryWith', { engine: engineName(engine), query });
    submit.append(submitText);
    suggestions.append(submit);
    suggestions.hidden = false;
    activeSuggestionIndex = -1;
  }

  function scheduleSuggestions(surface) {
    window.clearTimeout(suggestionTimer);
    suggestionAbort?.abort();
    const state = surfaces[surface];
    const input = surfaceInput(surface);
    const engine = BROWSER_ENGINE;
    const query = input?.value.trim() || '';
    if (state.mode !== 'external' || !engine || !query) {
      renderSuggestions(surface, []);
      return;
    }
    renderSuggestions(surface, []);
    if (!settings.baiduSuggestionsEnabled) return;
    const run = ++suggestionRun;
    suggestionTimer = window.setTimeout(async () => {
      suggestionAbort = new AbortController();
      try {
        const values = await fetchBaiduSuggestions(query, suggestionAbort.signal);
        if (run !== suggestionRun || input.value.trim() !== query) return;
        renderSuggestions(surface, values);
      } catch (error) {
        if (error?.name !== 'AbortError') renderSuggestions(surface, []);
      }
    }, 220);
  }

  async function executeSearch(query) {
    const text = String(query || '').trim();
    if (!text) return;
    try {
      await chrome.search.query({ text, disposition: 'NEW_TAB' });
    } catch {
      showToast(t('searchFailed'));
    }
  }

  function renderFallback(surface) {
    const state = surfaces[surface];
    const root = document.getElementById(surface === 'tabs' ? 'dashboardSearchFallback' : 'bookmarkSearchFallback');
    const show = state.mode === 'local' && Boolean(state.query) && state.resultCount === 0;
    if (!root) return;
    root.hidden = !show;
    if (!show) return;
    if (surface === 'tabs') {
      const text = document.getElementById('dashboardSearchFallbackText');
      if (text) text.textContent = t('noLocalResultsFor', { query: state.query });
    }
    const actions = root.querySelector('[data-search-fallback-actions]');
    if (!actions) return;
    actions.replaceChildren();
    for (const engine of [BROWSER_ENGINE]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.searchFallbackEngine = engine.id;
      button.dataset.searchFallbackSurface = surface;
      button.append(createMark(engine));
      const label = document.createElement('span');
      label.textContent = t('searchWith', { engine: engineName(engine) });
      button.append(label);
      actions.append(button);
    }
  }

  function renderCopy() {
    document.querySelectorAll('[data-search-copy]').forEach(element => {
      element.textContent = t(element.dataset.searchCopy);
    });
    for (const surface of Object.keys(surfaces)) {
      renderSourceButton(surface);
      renderSourceMenu(surface);
      renderFallback(surface);
    }
    renderSettings();
  }

  function renderSettings() {
    const suggestionToggle = document.getElementById('baiduSuggestionsToggle');
    if (suggestionToggle) suggestionToggle.checked = settings.baiduSuggestionsEnabled;
  }

  async function saveSettings(next, { toast = false } = {}) {
    try {
      settings = await Storage.setSearchSettings(next);
      renderSettings();
      for (const surface of Object.keys(surfaces)) {
        renderSourceButton(surface);
        renderSourceMenu(surface);
        renderFallback(surface);
      }
      if (toast) showSearchStatus(t('saved'), 'success');
      return true;
    } catch {
      showSearchStatus(t('storageError'), 'error');
      return false;
    }
  }

  async function handleSuggestionToggle(toggle) {
    if (toggle.checked) {
      let granted = false;
      let permissionError = null;
      try {
        if (typeof chrome.permissions?.request !== 'function') throw new Error('permissions API not supported');
        granted = await chrome.permissions.request({ origins: [Engines.BAIDU_SUGGESTION_ORIGIN] });
      } catch (error) {
        permissionError = error;
      }
      if (!granted) {
        toggle.checked = false;
        const failure = classifyPermissionFailure(permissionError);
        showSearchStatus(t(failure.key, failure.params), 'error');
        return;
      }
      await saveSettings({ ...settings, baiduSuggestionsEnabled: true }, { toast: true });
      return;
    }
    try { await chrome.permissions.remove({ origins: [Engines.BAIDU_SUGGESTION_ORIGIN] }); } catch {}
    await saveSettings({ ...settings, baiduSuggestionsEnabled: false }, { toast: true });
  }

  document.addEventListener('browseloom-local-search-results', event => {
    const surface = event.detail?.surface;
    if (!surfaces[surface]) return;
    surfaces[surface].query = String(event.detail?.query || '');
    surfaces[surface].resultCount = Math.max(0, Number(event.detail?.count) || 0);
    renderFallback(surface);
  });

  document.addEventListener('super-tab-out-language-change', renderCopy);
  document.addEventListener('browseloom-settings-view-change', event => {
    if (event.detail?.view === 'search') renderSettings();
  });

  document.addEventListener('input', event => {
    const input = event.target.closest?.('#openTabsSearch, #bookmarkSearch');
    if (!input) return;
    const surface = input.id === 'bookmarkSearch' ? 'bookmarks' : 'tabs';
    hideSurfacePopovers(surface, { suggestions: false });
    if (input.dataset.searchMode !== 'external') return;
    scheduleSuggestions(surface);
  });

  document.addEventListener('focusin', event => {
    const input = event.target.closest?.('#openTabsSearch, #bookmarkSearch');
    if (!input) return;
    const surface = input.id === 'bookmarkSearch' ? 'bookmarks' : 'tabs';
    hideSurfacePopovers(surface, { suggestions: false });
    if (input.dataset.searchMode !== 'external' || !input.value.trim()) return;
    scheduleSuggestions(surface);
  });

  document.addEventListener('change', async event => {
    if (event.target.id === 'baiduSuggestionsToggle') await handleSuggestionToggle(event.target);
  });

  document.addEventListener('click', async event => {
    const trigger = event.target.closest?.('[data-search-action="toggle-source-menu"]');
    if (trigger) {
      const surface = trigger.closest('[data-search-surface]')?.dataset.searchSurface;
      const { menu } = ensureSurfacePopovers(surface);
      const nextOpen = menu.hidden;
      hideAllPopovers(surface);
      renderSourceMenu(surface);
      menu.hidden = !nextOpen;
      trigger.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      return;
    }

    const source = event.target.closest?.('[data-search-source]');
    if (source) {
      const surface = source.dataset.searchSurfaceTarget;
      await setSearchMode(surface, source.dataset.searchSource === 'local' ? 'local' : 'external');
      return;
    }

    const suggestion = event.target.closest?.('[data-search-suggestion]');
    if (suggestion) {
      await executeSearch(suggestion.dataset.searchSuggestion);
      return;
    }

    const fallback = event.target.closest?.('[data-search-fallback-engine]');
    if (fallback) {
      const query = surfaces[fallback.dataset.searchFallbackSurface]?.query || '';
      await executeSearch(query);
      return;
    }

    if (!event.target.closest?.('[data-search-surface]')) hideAllPopovers();
  });

  document.addEventListener('keydown', async event => {
    const input = event.target.closest?.('#openTabsSearch, #bookmarkSearch');
    if (!input || input.dataset.searchMode !== 'external') return;
    const surface = input.id === 'bookmarkSearch' ? 'bookmarks' : 'tabs';
    const { suggestions } = ensureSurfacePopovers(surface);
    const options = [...suggestions.querySelectorAll('[data-search-suggestion]')];
    if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      activeSuggestionIndex = (activeSuggestionIndex + delta + options.length) % options.length;
      options.forEach((option, index) => option.classList.toggle('is-active', index === activeSuggestionIndex));
      options[activeSuggestionIndex].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopImmediatePropagation();
      const active = options[activeSuggestionIndex];
      await executeSearch(active?.dataset.searchSuggestion || input.value);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopImmediatePropagation();
      hideSurfacePopovers(surface);
    }
  }, true);

  async function init() {
    setupAppNavigation();
    try {
      settings = await Storage.getSearchSettings();
      if (settings.baiduSuggestionsEnabled && !(await hasBaiduSuggestionPermission())) {
        settings = await Storage.setSearchSettings({ ...settings, baiduSuggestionsEnabled: false });
      }
    } catch {
      settings = Engines.defaultSearchSettings();
    }
    for (const surface of Object.keys(surfaces)) {
      ensureSurfacePopovers(surface);
      renderSourceButton(surface);
      renderSourceMenu(surface);
    }
    renderCopy();
  }

  init();
})();
