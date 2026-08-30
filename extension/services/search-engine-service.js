/* BrowseLoom search-engine model.
   Built-in definitions stay in code; chrome.storage.local only stores user choices. */
(function (global) {
  'use strict';

  const SEARCH_SETTINGS_VERSION = 1;
  const MAX_CUSTOM_ENGINES = 20;
  const DEFAULT_ENGINE_ID = 'google';
  const BAIDU_SUGGESTION_ORIGIN = 'https://suggestion.baidu.com/*';

  const BUILTIN_ENGINES = Object.freeze([
    Object.freeze({
      id: 'baidu',
      name: 'Baidu',
      nameZh: '百度',
      mark: '百',
      color: '#315efb',
      searchUrlTemplate: 'https://www.baidu.com/s?wd=%s',
    }),
    Object.freeze({
      id: 'bing',
      name: 'Bing',
      nameZh: '必应',
      mark: 'B',
      color: '#008373',
      searchUrlTemplate: 'https://www.bing.com/search?q=%s',
    }),
    Object.freeze({
      id: 'google',
      name: 'Google',
      nameZh: 'Google',
      mark: 'G',
      color: '#4285f4',
      searchUrlTemplate: 'https://www.google.com/search?q=%s',
    }),
    Object.freeze({
      id: 'duckduckgo',
      name: 'DuckDuckGo',
      nameZh: 'DuckDuckGo',
      mark: 'D',
      color: '#de5833',
      searchUrlTemplate: 'https://duckduckgo.com/?q=%s',
    }),
  ]);

  const BUILTIN_BY_ID = new Map(BUILTIN_ENGINES.map(engine => [engine.id, engine]));
  const BUILTIN_IDS = Object.freeze(BUILTIN_ENGINES.map(engine => engine.id));

  function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  function normalizeColor(value) {
    const color = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(color) ? color : '#64748b';
  }

  function validateSearchUrlTemplate(value) {
    const template = String(value || '').trim();
    const placeholderCount = (template.match(/%s/g) || []).length;
    if (placeholderCount !== 1) {
      return { valid: false, code: 'placeholder', template: '' };
    }
    if (template.length > 2048) {
      return { valid: false, code: 'length', template: '' };
    }
    try {
      const parsed = new URL(template.replace('%s', 'browseloom-query'));
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
        return { valid: false, code: 'https', template: '' };
      }
    } catch {
      return { valid: false, code: 'url', template: '' };
    }
    return { valid: true, code: '', template };
  }

  function normalizeCustomEngine(value, index = 0) {
    const source = isPlainObject(value) ? value : {};
    const id = /^custom:[a-z0-9-]{8,80}$/i.test(String(source.id || ''))
      ? String(source.id)
      : '';
    const name = String(source.name || '').trim().slice(0, 40);
    const url = validateSearchUrlTemplate(source.searchUrlTemplate);
    if (!id || !name || !url.valid) return null;
    const createdAt = typeof source.createdAt === 'string' ? source.createdAt : '';
    const updatedAt = typeof source.updatedAt === 'string' ? source.updatedAt : createdAt;
    return {
      id,
      name,
      nameZh: name,
      mark: String(source.mark || name).trim().slice(0, 2).toUpperCase() || `S${index + 1}`,
      color: normalizeColor(source.color),
      searchUrlTemplate: url.template,
      custom: true,
      createdAt,
      updatedAt,
    };
  }

  function defaultSearchSettings() {
    return {
      version: SEARCH_SETTINGS_VERSION,
      defaultEngineId: DEFAULT_ENGINE_ID,
      enabledEngineIds: [...BUILTIN_IDS],
      engineOrder: [...BUILTIN_IDS],
      baiduSuggestionsEnabled: false,
      customEngines: [],
    };
  }

  function normalizeSearchSettings(value) {
    const source = isPlainObject(value) ? value : {};
    const customEngines = [];
    const seenIds = new Set(BUILTIN_IDS);
    const seenNames = new Set(BUILTIN_ENGINES.map(engine => engine.name.toLocaleLowerCase()));
    for (const [index, raw] of (Array.isArray(source.customEngines) ? source.customEngines : []).entries()) {
      if (customEngines.length >= MAX_CUSTOM_ENGINES) break;
      const engine = normalizeCustomEngine(raw, index);
      const nameKey = engine?.name.toLocaleLowerCase();
      if (!engine || seenIds.has(engine.id) || seenNames.has(nameKey)) continue;
      seenIds.add(engine.id);
      seenNames.add(nameKey);
      customEngines.push(engine);
    }

    const allIds = [...BUILTIN_IDS, ...customEngines.map(engine => engine.id)];
    const enabledEngineIds = [];
    for (const id of Array.isArray(source.enabledEngineIds) ? source.enabledEngineIds : BUILTIN_IDS) {
      if (allIds.includes(id) && !enabledEngineIds.includes(id)) enabledEngineIds.push(id);
    }
    if (enabledEngineIds.length === 0) enabledEngineIds.push(DEFAULT_ENGINE_ID);

    const engineOrder = [];
    for (const id of Array.isArray(source.engineOrder) ? source.engineOrder : allIds) {
      if (allIds.includes(id) && !engineOrder.includes(id)) engineOrder.push(id);
    }
    for (const id of allIds) if (!engineOrder.includes(id)) engineOrder.push(id);

    const requestedDefault = String(source.defaultEngineId || DEFAULT_ENGINE_ID);
    const defaultEngineId = enabledEngineIds.includes(requestedDefault)
      ? requestedDefault
      : (enabledEngineIds.includes(DEFAULT_ENGINE_ID) ? DEFAULT_ENGINE_ID : enabledEngineIds[0]);

    return {
      version: SEARCH_SETTINGS_VERSION,
      defaultEngineId,
      enabledEngineIds,
      engineOrder,
      baiduSuggestionsEnabled: source.baiduSuggestionsEnabled === true,
      customEngines,
    };
  }

  function getAllEngines(settings) {
    const normalized = normalizeSearchSettings(settings);
    const byId = new Map([
      ...BUILTIN_ENGINES.map(engine => [engine.id, engine]),
      ...normalized.customEngines.map(engine => [engine.id, engine]),
    ]);
    return normalized.engineOrder.map(id => byId.get(id)).filter(Boolean);
  }

  function getEnabledEngines(settings) {
    const normalized = normalizeSearchSettings(settings);
    const enabled = new Set(normalized.enabledEngineIds);
    return getAllEngines(normalized).filter(engine => enabled.has(engine.id));
  }

  function getEngine(settings, id) {
    return getAllEngines(settings).find(engine => engine.id === id) || null;
  }

  function buildSearchUrl(engine, query) {
    const validation = validateSearchUrlTemplate(engine?.searchUrlTemplate);
    const text = String(query || '').trim();
    if (!validation.valid || !text) return '';
    return validation.template.replace('%s', encodeURIComponent(text));
  }

  function parseBaiduSuggestionPayload(payload) {
    const text = String(payload || '');
    const match = text.match(/(?:^|[,({])\s*s\s*:\s*(\[[\s\S]*?\])\s*[,}]/);
    if (!match) return [];
    try {
      const values = JSON.parse(match[1]);
      if (!Array.isArray(values)) return [];
      return values
        .map(value => String(value || '').trim())
        .filter(Boolean)
        .slice(0, 10);
    } catch {
      return [];
    }
  }

  const api = {
    SEARCH_SETTINGS_VERSION,
    MAX_CUSTOM_ENGINES,
    DEFAULT_ENGINE_ID,
    BAIDU_SUGGESTION_ORIGIN,
    BUILTIN_ENGINES,
    BUILTIN_IDS,
    defaultSearchSettings,
    normalizeSearchSettings,
    normalizeCustomEngine,
    validateSearchUrlTemplate,
    getAllEngines,
    getEnabledEngines,
    getEngine,
    buildSearchUrl,
    parseBaiduSuggestionPayload,
  };

  global.SuperTabOutSearchEngines = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
