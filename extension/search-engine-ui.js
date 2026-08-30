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
      builtInEngines: 'Built-in engines',
      builtInDescription: 'Choose the default web search and which engines appear in the search source menu.',
      onlineSuggestions: 'Online suggestions',
      baiduSuggestions: 'Baidu search suggestions',
      baiduSuggestionsDisclosure: 'Off by default. When enabled, text typed with any web search engine is sent to suggestion.baidu.com for suggestions.',
      customEngines: 'Custom engines',
      customDescription: 'Add an HTTPS search URL containing exactly one %s placeholder.',
      addEngine: 'Add engine',
      engineName: 'Name',
      engineUrl: 'Search URL',
      engineColor: 'Icon color',
      cancel: 'Cancel',
      saveEngine: 'Save engine',
      default: 'Default',
      setDefault: 'Set as default',
      enabled: 'Show engine',
      moveUp: 'Move up',
      moveDown: 'Move down',
      edit: 'Edit',
      delete: 'Delete',
      deleteConfirm: 'Delete this custom search engine?',
      emptyCustom: 'No custom search engines yet.',
      tabs: 'Tabs',
      bookmarks: 'Bookmarks',
      localSearch: 'Local search',
      searchWith: ({ engine }) => `Search with ${engine}`,
      searchQueryWith: ({ engine, query }) => `Search ${engine} for “${query}”`,
      suggestionsFrom: 'Suggestions by Baidu',
      noLocalResults: 'No local results',
      noLocalResultsFor: ({ query }) => `Nothing local matched “${query}”. Search the web instead:`,
      externalPlaceholder: ({ engine }) => `Search with ${engine}`,
      addSearchEngine: 'Add search engine…',
      permissionDenied: 'Site access was not granted. Allow suggestion.baidu.com in the browser permission prompt, then try again.',
      permissionReloadRequired: 'The new site permission is not active yet. Reload BrowseLoom on chrome://extensions, then enable suggestions again.',
      permissionGestureRequired: 'Click the switch directly to request site access.',
      permissionUnavailable: 'This browser does not support runtime site permissions. Baidu suggestions remain off.',
      permissionFailed: ({ message }) => `Could not request site access: ${message}`,
      saved: 'Search settings saved.',
      storageError: 'Could not save search settings.',
      duplicateName: 'Use a unique engine name.',
      tooManyEngines: 'You can add up to 20 custom engines.',
      invalidName: 'Enter an engine name.',
      invalidUrl: 'Use an HTTPS URL containing exactly one %s placeholder.',
    },
    zh: {
      searchSettings: '搜索',
      builtInEngines: '内置搜索引擎',
      builtInDescription: '选择默认网页搜索，并控制搜索来源菜单中显示哪些引擎。',
      onlineSuggestions: '在线联想',
      baiduSuggestions: '百度搜索联想',
      baiduSuggestionsDisclosure: '默认关闭。开启后，使用任意网页搜索引擎时，都会将输入文字发送到 suggestion.baidu.com 获取联想。',
      customEngines: '自定义搜索引擎',
      customDescription: '添加包含且仅包含一个 %s 占位符的 HTTPS 搜索地址。',
      addEngine: '添加引擎',
      engineName: '名称',
      engineUrl: '搜索地址',
      engineColor: '图标颜色',
      cancel: '取消',
      saveEngine: '保存引擎',
      default: '默认',
      setDefault: '设为默认',
      enabled: '显示引擎',
      moveUp: '上移',
      moveDown: '下移',
      edit: '编辑',
      delete: '删除',
      deleteConfirm: '删除这个自定义搜索引擎？',
      emptyCustom: '还没有自定义搜索引擎。',
      tabs: '标签页',
      bookmarks: '书签',
      localSearch: '本地搜索',
      searchWith: ({ engine }) => `使用 ${engine} 搜索`,
      searchQueryWith: ({ engine, query }) => `使用 ${engine} 搜索“${query}”`,
      suggestionsFrom: '百度搜索联想',
      noLocalResults: '没有本地结果',
      noLocalResultsFor: ({ query }) => `本地没有找到“${query}”，可以改用网页搜索：`,
      externalPlaceholder: ({ engine }) => `使用 ${engine} 搜索`,
      addSearchEngine: '添加搜索引擎…',
      permissionDenied: '浏览器未授予 suggestion.baidu.com 访问权限。请在权限提示中选择允许后重试。',
      permissionReloadRequired: '新的站点权限尚未生效。请在 chrome://extensions 中重新加载 BrowseLoom，再开启联想。',
      permissionGestureRequired: '请直接点击开关，以触发浏览器的站点权限申请。',
      permissionUnavailable: '当前浏览器不支持运行时站点权限，百度联想保持关闭。',
      permissionFailed: ({ message }) => `无法申请站点访问权限：${message}`,
      saved: '搜索设置已保存。',
      storageError: '无法保存搜索设置。',
      duplicateName: '请使用不重复的引擎名称。',
      tooManyEngines: '最多可以添加 20 个自定义搜索引擎。',
      invalidName: '请输入引擎名称。',
      invalidUrl: '请输入包含且仅包含一个 %s 占位符的 HTTPS 地址。',
    },
  };

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
    const engine = state.mode === 'external' ? Engines.getEngine(settings, state.engineId) : null;
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
      input.placeholder = language() === 'zh' ? '筛选标签页' : 'Filter tabs';
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

    for (const engine of Engines.getEnabledEngines(settings)) {
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

    const addDivider = document.createElement('div');
    addDivider.className = 'search-menu-divider';
    menu.append(addDivider);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'search-source-option search-source-add';
    add.dataset.searchAction = 'add-custom-engine';
    add.setAttribute('role', 'menuitem');
    const addMark = document.createElement('span');
    addMark.className = 'search-source-mark search-source-add-mark';
    addMark.textContent = '+';
    addMark.setAttribute('aria-hidden', 'true');
    const addLabel = document.createElement('span');
    addLabel.textContent = t('addSearchEngine');
    add.append(addMark, addLabel);
    menu.append(add);
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

  async function setSearchMode(surface, mode, engineId = '') {
    const input = surfaceInput(surface);
    if (!input) return;
    const engine = mode === 'external'
      ? (Engines.getEngine(settings, engineId) || Engines.getEngine(settings, settings.defaultEngineId))
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
    const engine = Engines.getEngine(settings, state.engineId);
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
    const engine = Engines.getEngine(settings, state.engineId);
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

  async function executeSearch(engineId, query) {
    const engine = Engines.getEngine(settings, engineId);
    const url = Engines.buildSearchUrl(engine, query);
    if (!url) return;
    try {
      await chrome.tabs.create({ url, active: true });
    } catch {
      window.open(url, '_blank', 'noopener');
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
    for (const engine of Engines.getEnabledEngines(settings)) {
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

  function orderedEngines(custom) {
    return Engines.getAllEngines(settings).filter(engine => Boolean(engine.custom) === custom);
  }

  function enabledToggle(engine) {
    const label = document.createElement('label');
    label.className = 'search-engine-enabled privacy-setting-switch';
    label.title = t('enabled');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = settings.enabledEngineIds.includes(engine.id);
    input.dataset.searchEnableEngine = engine.id;
    const track = document.createElement('span');
    track.className = 'privacy-setting-switch-track';
    track.setAttribute('aria-hidden', 'true');
    label.append(input, track);
    return label;
  }

  function defaultEngineButton(engine) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'search-engine-default-button';
    button.dataset.searchSetDefault = engine.id;
    button.title = t('setDefault');
    button.append(createMark(engine));
    const name = document.createElement('span');
    name.className = 'search-engine-name';
    name.textContent = engineName(engine);
    button.append(name);
    if (settings.defaultEngineId === engine.id) {
      const badge = document.createElement('span');
      badge.className = 'search-default-badge';
      badge.textContent = t('default');
      button.append(badge);
    }
    return button;
  }

  function orderActions(engine) {
    const actions = document.createElement('div');
    actions.className = 'search-engine-order-actions';
    for (const [direction, symbol, label] of [['up', '↑', t('moveUp')], ['down', '↓', t('moveDown')]]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.searchMoveEngine = engine.id;
      button.dataset.searchMoveDirection = direction;
      button.title = label;
      button.setAttribute('aria-label', label);
      button.textContent = symbol;
      actions.append(button);
    }
    return actions;
  }

  function renderSettings() {
    const builtInList = document.getElementById('searchEngineSettingsList');
    if (builtInList) {
      builtInList.replaceChildren();
      for (const engine of orderedEngines(false)) {
        const row = document.createElement('div');
        row.className = 'search-engine-settings-row';
        row.append(defaultEngineButton(engine), enabledToggle(engine), orderActions(engine));
        builtInList.append(row);
      }
    }

    const customList = document.getElementById('customSearchEngineList');
    if (customList) {
      customList.replaceChildren();
      const customEngines = orderedEngines(true);
      if (!customEngines.length) {
        const empty = document.createElement('p');
        empty.className = 'search-custom-empty';
        empty.textContent = t('emptyCustom');
        customList.append(empty);
      }
      for (const engine of customEngines) {
        const row = document.createElement('div');
        row.className = 'search-custom-engine-row';
        row.append(defaultEngineButton(engine), enabledToggle(engine));
        const actions = document.createElement('div');
        actions.className = 'search-custom-row-actions';
        for (const [action, symbol, label] of [['edit', '✎', t('edit')], ['delete', '×', t('delete')]]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.searchCustomAction = action;
          button.dataset.searchCustomEngineId = engine.id;
          button.title = label;
          button.setAttribute('aria-label', label);
          button.textContent = symbol;
          actions.append(button);
        }
        row.append(actions);
        customList.append(row);
      }
    }

    const suggestionToggle = document.getElementById('baiduSuggestionsToggle');
    if (suggestionToggle) suggestionToggle.checked = settings.baiduSuggestionsEnabled;
  }

  async function saveSettings(next, { toast = false } = {}) {
    try {
      settings = await Storage.setSearchSettings(next);
      renderSettings();
      for (const surface of Object.keys(surfaces)) {
        if (surfaces[surface].mode === 'external' && !settings.enabledEngineIds.includes(surfaces[surface].engineId)) {
          surfaces[surface].engineId = settings.defaultEngineId;
        }
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

  function closeCustomForm() {
    const form = document.getElementById('customSearchEngineForm');
    if (!form) return;
    form.reset();
    form.hidden = true;
    document.getElementById('customSearchEngineId').value = '';
    document.getElementById('customSearchEngineColor').value = '#64748b';
    document.getElementById('customSearchEngineError').textContent = '';
  }

  function openCustomForm(engine = null) {
    const form = document.getElementById('customSearchEngineForm');
    if (!form) return;
    form.hidden = false;
    document.getElementById('customSearchEngineId').value = engine?.id || '';
    document.getElementById('customSearchEngineName').value = engine?.name || '';
    document.getElementById('customSearchEngineUrl').value = engine?.searchUrlTemplate || '';
    document.getElementById('customSearchEngineColor').value = engine?.color || '#64748b';
    document.getElementById('customSearchEngineError').textContent = '';
    document.getElementById('customSearchEngineName').focus({ preventScroll: true });
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
    const enable = event.target.closest?.('[data-search-enable-engine]');
    if (enable) {
      const ids = new Set(settings.enabledEngineIds);
      if (enable.checked) ids.add(enable.dataset.searchEnableEngine);
      else ids.delete(enable.dataset.searchEnableEngine);
      await saveSettings({ ...settings, enabledEngineIds: [...ids] });
      return;
    }
    if (event.target.id === 'baiduSuggestionsToggle') await handleSuggestionToggle(event.target);
  });

  document.addEventListener('click', async event => {
    const addSearchEngine = event.target.closest?.('[data-search-action="add-custom-engine"]');
    if (addSearchEngine) {
      hideAllPopovers();
      document.getElementById('privacySettingsBtn')?.click();
      document.getElementById('settingsTabSearch')?.click();
      openCustomForm();
      return;
    }

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
      await setSearchMode(surface, source.dataset.searchSource === 'local' ? 'local' : 'external', source.dataset.searchSource);
      return;
    }

    const suggestion = event.target.closest?.('[data-search-suggestion]');
    if (suggestion) {
      await executeSearch(suggestion.dataset.searchEngineId, suggestion.dataset.searchSuggestion);
      return;
    }

    const fallback = event.target.closest?.('[data-search-fallback-engine]');
    if (fallback) {
      const query = surfaces[fallback.dataset.searchFallbackSurface]?.query || '';
      await executeSearch(fallback.dataset.searchFallbackEngine, query);
      return;
    }

    const setDefault = event.target.closest?.('[data-search-set-default]');
    if (setDefault) {
      const ids = new Set(settings.enabledEngineIds);
      ids.add(setDefault.dataset.searchSetDefault);
      await saveSettings({
        ...settings,
        defaultEngineId: setDefault.dataset.searchSetDefault,
        enabledEngineIds: [...ids],
      }, { toast: true });
      return;
    }

    const move = event.target.closest?.('[data-search-move-engine]');
    if (move) {
      const order = [...settings.engineOrder];
      const engine = Engines.getEngine(settings, move.dataset.searchMoveEngine);
      const group = order.filter(id => Boolean(Engines.getEngine(settings, id)?.custom) === Boolean(engine?.custom));
      const groupIndex = group.indexOf(move.dataset.searchMoveEngine);
      const nextGroupIndex = move.dataset.searchMoveDirection === 'up' ? groupIndex - 1 : groupIndex + 1;
      const peerId = group[nextGroupIndex];
      if (engine && groupIndex >= 0 && peerId) {
        const index = order.indexOf(engine.id);
        const nextIndex = order.indexOf(peerId);
        [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
        await saveSettings({ ...settings, engineOrder: order });
      }
      return;
    }

    if (event.target.closest?.('#addCustomSearchEngine')) {
      openCustomForm();
      return;
    }
    if (event.target.closest?.('#cancelCustomSearchEngine')) {
      closeCustomForm();
      return;
    }

    const customAction = event.target.closest?.('[data-search-custom-action]');
    if (customAction) {
      const engine = settings.customEngines.find(item => item.id === customAction.dataset.searchCustomEngineId);
      if (!engine) return;
      if (customAction.dataset.searchCustomAction === 'edit') openCustomForm(engine);
      if (customAction.dataset.searchCustomAction === 'delete' && window.confirm(t('deleteConfirm'))) {
        await saveSettings({
          ...settings,
          customEngines: settings.customEngines.filter(item => item.id !== engine.id),
          enabledEngineIds: settings.enabledEngineIds.filter(id => id !== engine.id),
          engineOrder: settings.engineOrder.filter(id => id !== engine.id),
        }, { toast: true });
      }
      return;
    }

    if (!event.target.closest?.('[data-search-surface]')) hideAllPopovers();
  });

  document.getElementById('customSearchEngineForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const idInput = document.getElementById('customSearchEngineId');
    const name = document.getElementById('customSearchEngineName').value.trim();
    const searchUrlTemplate = document.getElementById('customSearchEngineUrl').value.trim();
    const color = document.getElementById('customSearchEngineColor').value;
    const error = document.getElementById('customSearchEngineError');
    if (!name) { error.textContent = t('invalidName'); return; }
    const editingId = idInput.value;
    if (!editingId && settings.customEngines.length >= Engines.MAX_CUSTOM_ENGINES) {
      error.textContent = t('tooManyEngines');
      return;
    }
    const duplicate = Engines.getAllEngines(settings).some(engine => engine.id !== editingId && engine.name.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicate) { error.textContent = t('duplicateName'); return; }
    if (!Engines.validateSearchUrlTemplate(searchUrlTemplate).valid) { error.textContent = t('invalidUrl'); return; }
    const now = new Date().toISOString();
    const existing = settings.customEngines.find(engine => engine.id === editingId);
    const id = existing?.id || `custom:${crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const nextEngine = {
      id,
      name,
      nameZh: name,
      mark: name.slice(0, 2).toUpperCase(),
      color,
      searchUrlTemplate,
      custom: true,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const customEngines = existing
      ? settings.customEngines.map(engine => engine.id === id ? nextEngine : engine)
      : [...settings.customEngines, nextEngine];
    const enabledEngineIds = existing ? settings.enabledEngineIds : [...settings.enabledEngineIds, id];
    const engineOrder = existing ? settings.engineOrder : [...settings.engineOrder, id];
    if (await saveSettings({ ...settings, customEngines, enabledEngineIds, engineOrder }, { toast: true })) closeCustomForm();
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
      await executeSearch(input.dataset.searchEngineId, active?.dataset.searchSuggestion || input.value);
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
