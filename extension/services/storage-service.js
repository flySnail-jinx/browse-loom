/* BrowseLoom storage service.
   Keeps chrome.storage.local access behind one schema-aware boundary. */
(function (global) {
  'use strict';

  const CURRENT_SCHEMA_VERSION = 8;
  const STORAGE_SCHEMA_KEY = 'storageSchemaVersion';
  const STORAGE_LAST_MIGRATED_KEY = 'storageLastMigratedAt';
  const DEFERRED_KEY = 'deferred';
  const SAVED_SESSIONS_KEY = 'savedSessions';
  const ACTIVITY_STATS_KEY = 'activityStats';
  const ACHIEVEMENTS_KEY = 'achievements';
  const VIEW_MODE_KEY = 'viewMode';
  const DOMAIN_CARD_PREFERENCES_KEY = 'domainCardPreferences';
  const PRIVACY_MODE_KEY = 'privacyMode';
  const PRIVACY_SETTINGS_KEY = 'privacySettings';
  const BOOKMARK_LIBRARY_KEY = 'bookmarkLibrary';
  const HOME_CATEGORY_ID = 'category-home';
  const UNFILED_CATEGORY_ID = 'category-unfiled';
  const BOOKMARK_FOLDER_ICON_IDS = Object.freeze([
    'home', 'folder', 'star', 'briefcase', 'sparkles', 'palette', 'code', 'tools',
    'shopping', 'book', 'newspaper', 'image', 'music', 'video', 'gamepad', 'message',
    'globe', 'plane', 'heart', 'dumbbell', 'wallet', 'food', 'lightbulb', 'archive',
  ]);

  const PRIVACY_DEFAULTS = {
    clock: true,
    date: true,
    motto: true,
    mottoText: '',
    externalFavicons: false,
  };

  const storageErrorListeners = [];
  let testMutationQueue = Promise.resolve();

  function getStorageArea() {
    return global.chrome?.storage?.local || null;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isPlainObject(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
  }

  function isQuotaError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('quota') || message.includes('bytes') || message.includes('maximum');
  }

  function normalizeRestorableUrl(url) {
    if (global.SuperTabOutUrls?.normalizeRestorableUrl) {
      return global.SuperTabOutUrls.normalizeRestorableUrl(url);
    }
    return '';
  }

  function normalizeStorageError(error, operation) {
    return {
      operation,
      quota: isQuotaError(error),
      message: error?.message || String(error || 'Storage operation failed'),
    };
  }

  function notifyStorageError(error, operation) {
    const detail = normalizeStorageError(error, operation);
    for (const listener of storageErrorListeners) {
      try { listener(detail); } catch {}
    }
    return detail;
  }

  function onStorageError(listener) {
    if (typeof listener !== 'function') return () => {};
    storageErrorListeners.push(listener);
    return () => {
      const index = storageErrorListeners.indexOf(listener);
      if (index !== -1) storageErrorListeners.splice(index, 1);
    };
  }

  async function getRaw(keys) {
    const area = getStorageArea();
    if (!area) return {};
    try {
      return await area.get(keys);
    } catch (error) {
      notifyStorageError(error, 'get');
      throw error;
    }
  }

  async function setRaw(values) {
    const area = getStorageArea();
    if (!area) return;
    try {
      await area.set(values);
    } catch (error) {
      notifyStorageError(error, 'set');
      throw error;
    }
  }

  function forwardSchemaError(version) {
    const error = new Error(`storage-schema-forward:${version}`);
    error.code = 'storage-schema-forward';
    error.storedVersion = version;
    error.supportedVersion = CURRENT_SCHEMA_VERSION;
    return error;
  }

  async function assertSupportedSchema() {
    const data = await getRaw(STORAGE_SCHEMA_KEY);
    const version = Number(data[STORAGE_SCHEMA_KEY] || 0);
    if (Number.isFinite(version) && version > CURRENT_SCHEMA_VERSION) {
      throw forwardSchemaError(version);
    }
    return version;
  }

  async function get(keys) {
    await assertSupportedSchema();
    return await getRaw(keys);
  }

  async function set(values) {
    await assertSupportedSchema();
    await setRaw(values);
  }

  function withMutationLock(operation) {
    const lockManager = global.navigator?.locks;
    if (lockManager?.request) {
      return lockManager.request('super-tab-out:storage-mutation', operation);
    }
    if (typeof module !== 'undefined' && module.exports) {
      const run = testMutationQueue.catch(() => undefined).then(operation);
      testMutationQueue = run;
      return run;
    }
    const error = new Error('storage-lock-unavailable');
    error.code = 'storage-lock-unavailable';
    return Promise.reject(error);
  }

  async function mutateStoredValue(key, normalize, updater) {
    return await withMutationLock(async () => {
      const data = await get(key);
      const current = normalize(data[key]);
      const next = typeof structuredClone === 'function'
        ? structuredClone(current)
        : JSON.parse(JSON.stringify(current));
      const result = await updater(next, current);
      const normalized = normalize(next);
      await set({ [key]: normalized });
      return { value: normalized, result, previous: current };
    });
  }

  async function getBytesInUse(keys = null) {
    const area = getStorageArea();
    if (!area || typeof area.getBytesInUse !== 'function') return null;
    try {
      return await area.getBytesInUse(keys);
    } catch (error) {
      notifyStorageError(error, 'getBytesInUse');
      return null;
    }
  }

  function normalizeDeferredItem(item, index) {
    const source = isPlainObject(item) ? item : {};
    const url = normalizeRestorableUrl(source.url);
    if (!url) return null;
    const title = typeof source.title === 'string' ? source.title : url;
    const savedAt = typeof source.savedAt === 'string' ? source.savedAt : nowIso();
    const id = typeof source.id === 'string' && source.id
      ? source.id
      : `${Date.now()}-${index}`;

    return {
      id,
      url,
      title,
      savedAt,
      completed: source.completed === true,
      ...(typeof source.completedAt === 'string' ? { completedAt: source.completedAt } : {}),
    };
  }

  function normalizeDeferred(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(item => isPlainObject(item))
      .map(normalizeDeferredItem)
      .filter(Boolean);
  }

  function normalizeSavedTab(tab, index, fallback = {}) {
    if (!isPlainObject(tab) || tab.pinned === true) return null;
    const url = normalizeRestorableUrl(tab.url);
    if (!url) return null;
    return {
      url,
      title: typeof tab.title === 'string' ? tab.title : url,
      index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : index,
      groupKey: typeof tab.groupKey === 'string' ? tab.groupKey : (fallback.groupKey || ''),
      groupTitle: typeof tab.groupTitle === 'string' ? tab.groupTitle : (fallback.groupTitle || ''),
      groupColor: typeof tab.groupColor === 'string' ? tab.groupColor : (fallback.groupColor || ''),
    };
  }

  function normalizeSavedWindow(window, index) {
    const source = isPlainObject(window) ? window : {};
    const tabs = (Array.isArray(source.tabs) ? source.tabs : [])
      .map((tab, tabIndex) => normalizeSavedTab(tab, tabIndex))
      .filter(Boolean)
      .sort((a, b) => a.index - b.index)
      .map((tab, tabIndex) => ({ ...tab, index: tabIndex }));
    return { index, tabs };
  }

  function legacySavedWindows(source) {
    const sourceTabs = Array.isArray(source.tabs) && source.tabs.length > 0
      ? source.tabs
      : (Array.isArray(source.urls) ? source.urls.map(url => ({ url })) : []);
    const byWindow = new Map();
    sourceTabs.forEach((tab, index) => {
      if (!isPlainObject(tab) || tab.pinned === true) return;
      const legacyWindow = Number.isFinite(Number(tab.windowId)) ? Number(tab.windowId) : 0;
      if (!byWindow.has(legacyWindow)) byWindow.set(legacyWindow, []);
      const groupTitle = typeof tab.groupTitle === 'string' ? tab.groupTitle : (source.group || '');
      const groupColor = typeof tab.groupColor === 'string' ? tab.groupColor : (source.groupColor || '');
      byWindow.get(legacyWindow).push({
        ...tab,
        index: Number.isFinite(Number(tab.index)) ? Number(tab.index) : index,
        groupKey: groupTitle || groupColor ? `legacy:${groupTitle}\n${groupColor}` : '',
        groupTitle,
        groupColor,
      });
    });
    return Array.from(byWindow.values()).map((tabs, index) => ({ index, tabs }));
  }

  function normalizeSavedSession(session, index) {
    const source = isPlainObject(session) ? session : {};
    const sourceWindows = Array.isArray(source.windows) && source.windows.length > 0
      ? source.windows
      : legacySavedWindows(source);
    const windows = sourceWindows
      .map(normalizeSavedWindow)
      .filter(window => window.tabs.length > 0)
      .map((window, windowIndex) => ({ ...window, index: windowIndex }));

    return {
      id: typeof source.id === 'string' && source.id ? source.id : `${Date.now()}-session-${index}`,
      name: typeof source.name === 'string' ? source.name : '',
      title: typeof source.title === 'string' ? source.title : '',
      savedAt: typeof source.savedAt === 'string' ? source.savedAt : nowIso(),
      group: typeof source.group === 'string' ? source.group : '',
      groupColor: typeof source.groupColor === 'string' ? source.groupColor : '',
      windows,
    };
  }

  function normalizeSavedSessions(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter(item => isPlainObject(item))
      .map(normalizeSavedSession)
      .filter(session => session.windows.some(window => window.tabs.length > 0));
  }

  function weekKey(date = new Date()) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
  }

  function normalizeActivityStats(value) {
    const source = isPlainObject(value) ? value : {};
    return {
      closedTotal: Number(source.closedTotal) || 0,
      savedTotal: Number(source.savedTotal) || 0,
      duplicateClosedTotal: Number(source.duplicateClosedTotal) || 0,
      sessionsSavedTotal: Number(source.sessionsSavedTotal) || 0,
      weekly: isPlainObject(source.weekly) ? source.weekly : {},
      domains: isPlainObject(source.domains) ? source.domains : {},
    };
  }

  function normalizeAchievements(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function normalizeViewMode(value) {
    return value === 'domain' ? 'domain' : 'group';
  }

  function normalizeDomainCardPreferences(value) {
    const source = isPlainObject(value) ? value : {};
    const validSortModes = new Set(['stable', 'chrome', 'count', 'name']);
    const uniqueStrings = items => Array.isArray(items)
      ? items.filter((item, index, values) => typeof item === 'string' && item && values.indexOf(item) === index).slice(0, 2000)
      : [];
    return {
      sortMode: validSortModes.has(source.sortMode) ? source.sortMode : 'stable',
      order: uniqueStrings(source.order),
      pinned: uniqueStrings(source.pinned),
    };
  }

  function normalizePrivacySettings(value) {
    const source = isPlainObject(value) ? value : {};
    return {
      clock: source.clock !== false,
      date: source.date !== false,
      motto: source.motto !== false,
      mottoText: typeof source.mottoText === 'string' ? source.mottoText : '',
      externalFavicons: source.externalFavicons === true,
    };
  }

  function normalizeBookmarkIcon(value, fallbackText = '') {
    const source = isPlainObject(value) ? value : {};
    if (source.type === 'color') {
      const color = typeof source.color === 'string' && /^#[0-9a-f]{6}$/i.test(source.color)
        ? source.color
        : '#5f7fb8';
      const text = typeof source.text === 'string'
        ? source.text.trim().slice(0, 2)
        : fallbackText.trim().slice(0, 2);
      return { type: 'color', color, text };
    }
    return { type: 'online' };
  }

  function suggestBookmarkFolderIcon(name) {
    const value = String(name || '').trim().toLocaleLowerCase();
    const rules = [
      [/(^|\s)(ai|aigc)(\s|$)|人工智能|智能|模型|助手/, 'sparkles'],
      [/设计|创意|灵感|design|creative/, 'palette'],
      [/编程|开发|代码|程序|code|coding|dev/, 'code'],
      [/工作|办公|项目|客户|work|office|project/, 'briefcase'],
      [/工具|效率|tool|utilit/, 'tools'],
      [/购物|商城|电商|买|shop|store|mall/, 'shopping'],
      [/阅读|书|文档|read|book|doc/, 'book'],
      [/新闻|资讯|媒体|news|media/, 'newspaper'],
      [/图片|摄影|相册|image|photo/, 'image'],
      [/音乐|音频|music|audio/, 'music'],
      [/视频|影视|电影|video|movie/, 'video'],
      [/游戏|game|gaming/, 'gamepad'],
      [/社交|聊天|沟通|消息|social|chat|message/, 'message'],
      [/旅行|出行|航班|旅游|travel|trip|flight/, 'plane'],
      [/国际|全球|网站|网络|global|world|web/, 'globe'],
      [/健康|医疗|爱心|health|medical|care/, 'heart'],
      [/健身|运动|训练|fitness|sport|workout/, 'dumbbell'],
      [/金融|财务|理财|银行|finance|money|bank/, 'wallet'],
      [/美食|餐饮|食谱|food|recipe|restaurant/, 'food'],
      [/收藏|喜欢|favorite|favourite|star/, 'star'],
      [/想法|知识|学习|idea|learn|knowledge/, 'lightbulb'],
      [/归档|备份|archive|backup/, 'archive'],
    ];
    return rules.find(([pattern]) => pattern.test(value))?.[1] || 'folder';
  }

  function normalizeBookmarkFolderIcon(icon, name = '') {
    return typeof icon === 'string' && BOOKMARK_FOLDER_ICON_IDS.includes(icon)
      ? icon
      : suggestBookmarkFolderIcon(name);
  }

  function systemBookmarkCategory(system, order) {
    const home = system === 'home';
    return {
      id: home ? HOME_CATEGORY_ID : UNFILED_CATEGORY_ID,
      name: home ? 'Home' : 'Unfiled',
      icon: home ? 'home' : 'archive',
      system: home ? 'home' : 'unfiled',
      order,
      itemOrder: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  function normalizeBookmarkCategory(category, index) {
    const source = isPlainObject(category) ? category : {};
    const id = typeof source.id === 'string' && source.id && ![HOME_CATEGORY_ID, UNFILED_CATEGORY_ID].includes(source.id)
      ? source.id
      : `category-${index + 1}`;
    return {
      id,
      name: typeof source.name === 'string' && source.name.trim()
        ? source.name.trim().slice(0, 80)
        : `Category ${index + 1}`,
      icon: normalizeBookmarkFolderIcon(source.icon, source.name),
      system: '',
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index + 1,
      itemOrder: Array.isArray(source.itemOrder) ? source.itemOrder.filter(item => typeof item === 'string') : [],
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : nowIso(),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : nowIso(),
    };
  }

  function normalizeBookmarkFolder(folder, index, categoryIds) {
    const source = isPlainObject(folder) ? folder : {};
    const id = typeof source.id === 'string' && source.id
      ? source.id
      : `folder-${index + 1}`;
    const layout = ['1x1', '2x1', '2x2'].includes(source.layout) ? source.layout : '1x1';
    return {
      id,
      name: typeof source.name === 'string' && source.name.trim()
        ? source.name.trim().slice(0, 80)
        : `Folder ${index + 1}`,
      icon: normalizeBookmarkFolderIcon(source.icon, source.name),
      categoryId: typeof source.categoryId === 'string' && categoryIds.has(source.categoryId)
        ? source.categoryId
        : HOME_CATEGORY_ID,
      layout,
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : nowIso(),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : nowIso(),
    };
  }

  function normalizeBookmarkItem(bookmark, index, folderById, categoryIds) {
    const source = isPlainObject(bookmark) ? bookmark : {};
    const url = normalizeRestorableUrl(source.url);
    if (!url) return null;
    const id = typeof source.id === 'string' && source.id
      ? source.id
      : `bookmark-${index + 1}`;
    const title = typeof source.title === 'string' && source.title.trim()
      ? source.title.trim().slice(0, 160)
      : url;
    const folder = typeof source.folderId === 'string' ? folderById.get(source.folderId) : null;
    const folderId = folder?.id
      ? folder.id
      : null;
    const categoryId = folder?.categoryId || (typeof source.categoryId === 'string' && categoryIds.has(source.categoryId)
      ? source.categoryId
      : UNFILED_CATEGORY_ID);
    return {
      id,
      title,
      url,
      note: typeof source.note === 'string' ? source.note.trim().slice(0, 500) : '',
      categoryId,
      folderId,
      icon: normalizeBookmarkIcon(source.icon, title),
      order: Number.isFinite(Number(source.order)) ? Number(source.order) : index,
      openCount: Math.max(0, Number(source.openCount) || 0),
      lastOpenedAt: typeof source.lastOpenedAt === 'string' ? source.lastOpenedAt : '',
      createdAt: typeof source.createdAt === 'string' ? source.createdAt : nowIso(),
      updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : nowIso(),
    };
  }

  function migrateLegacyBookmarkLibrary(value) {
    const source = isPlainObject(value) ? value : {};
    const rawFolders = Array.isArray(source.folders) ? source.folders.filter(isPlainObject) : [];
    const categoryFolders = rawFolders.filter(folder => folder.pinnedToHome === false);
    const homeFolders = rawFolders.filter(folder => folder.pinnedToHome !== false);
    const categoryIds = new Set([HOME_CATEGORY_ID, UNFILED_CATEGORY_ID, ...categoryFolders.map(folder => folder.id).filter(Boolean)]);
    const categories = [
      systemBookmarkCategory('home', 0),
      ...categoryFolders.map((folder, index) => normalizeBookmarkCategory({ ...folder, itemOrder: [] }, index)),
      systemBookmarkCategory('unfiled', categoryFolders.length + 1),
    ];
    const folders = homeFolders.map((folder, index) => normalizeBookmarkFolder({ ...folder, categoryId: HOME_CATEGORY_ID }, index, categoryIds));
    const folderById = new Map(folders.map(folder => [folder.id, folder]));
    const legacyCategoryIds = new Set(categoryFolders.map(folder => folder.id));
    const seenBookmarks = new Set();
    const bookmarks = (Array.isArray(source.bookmarks) ? source.bookmarks : [])
      .map((bookmark, index) => {
        const raw = isPlainObject(bookmark) ? bookmark : {};
        const legacyCategoryId = legacyCategoryIds.has(raw.folderId) ? raw.folderId : '';
        const legacyFolder = folderById.get(raw.folderId);
        const categoryId = legacyCategoryId || legacyFolder?.categoryId || (raw.pinnedToHome !== false ? HOME_CATEGORY_ID : UNFILED_CATEGORY_ID);
        return normalizeBookmarkItem({
          ...raw,
          categoryId,
          folderId: legacyFolder?.id || null,
        }, index, folderById, categoryIds);
      })
      .filter(bookmark => {
        if (!bookmark || seenBookmarks.has(bookmark.id)) return false;
        seenBookmarks.add(bookmark.id);
        return true;
      });

    const rootKeysByCategory = new Map(categories.map(category => [category.id, []]));
    for (const folder of folders) rootKeysByCategory.get(folder.categoryId)?.push(`folder:${folder.id}`);
    for (const bookmark of bookmarks) {
      if (!bookmark.folderId) rootKeysByCategory.get(bookmark.categoryId)?.push(`bookmark:${bookmark.id}`);
    }
    const homeKeys = rootKeysByCategory.get(HOME_CATEGORY_ID) || [];
    const legacyHomeOrder = Array.isArray(source.homeOrder) ? source.homeOrder : [];
    const orderedHomeKeys = legacyHomeOrder.filter((key, index) => homeKeys.includes(key) && legacyHomeOrder.indexOf(key) === index);
    for (const key of homeKeys) if (!orderedHomeKeys.includes(key)) orderedHomeKeys.push(key);
    for (const category of categories) {
      category.itemOrder = category.id === HOME_CATEGORY_ID ? orderedHomeKeys : (rootKeysByCategory.get(category.id) || []);
    }
    return { version: 3, viewMode: source.viewMode === 'list' ? 'list' : 'grid', categories, folders, bookmarks };
  }

  function normalizeBookmarkLibrary(value) {
    const source = isPlainObject(value) ? value : {};
    if (source.version !== 3 || !Array.isArray(source.categories)) return migrateLegacyBookmarkLibrary(source);

    const homeSource = source.categories.find(category => category?.id === HOME_CATEGORY_ID || category?.system === 'home');
    const unfiledSource = source.categories.find(category => category?.id === UNFILED_CATEGORY_ID || category?.system === 'unfiled');
    const seenCategories = new Set([HOME_CATEGORY_ID, UNFILED_CATEGORY_ID]);
    const customCategories = source.categories
      .filter(category => category?.system !== 'home' && category?.system !== 'unfiled' && ![HOME_CATEGORY_ID, UNFILED_CATEGORY_ID].includes(category?.id))
      .map(normalizeBookmarkCategory)
      .filter(category => {
        if (seenCategories.has(category.id)) return false;
        seenCategories.add(category.id);
        return true;
      })
      .sort((a, b) => a.order - b.order);
    const home = { ...systemBookmarkCategory('home', 0), ...homeSource, id: HOME_CATEGORY_ID, name: 'Home', icon: 'home', system: 'home', order: 0 };
    const unfiled = { ...systemBookmarkCategory('unfiled', customCategories.length + 1), ...unfiledSource, id: UNFILED_CATEGORY_ID, name: 'Unfiled', icon: 'archive', system: 'unfiled', order: customCategories.length + 1 };
    const categories = [home, ...customCategories.map((category, index) => ({ ...category, order: index + 1 })), unfiled];
    const categoryIds = new Set(categories.map(category => category.id));
    const rawFolders = Array.isArray(source.folders) ? source.folders : [];
    const seenFolders = new Set();
    const folders = rawFolders
      .map((folder, index) => normalizeBookmarkFolder(folder, index, categoryIds))
      .filter(folder => {
        if (seenFolders.has(folder.id)) return false;
        seenFolders.add(folder.id);
        return true;
      })
      .sort((a, b) => a.order - b.order);
    const folderById = new Map(folders.map(folder => [folder.id, folder]));
    const seenBookmarks = new Set();
    const bookmarks = (Array.isArray(source.bookmarks) ? source.bookmarks : [])
      .map((bookmark, index) => normalizeBookmarkItem(bookmark, index, folderById, categoryIds))
      .filter(bookmark => {
        if (!bookmark || seenBookmarks.has(bookmark.id)) return false;
        seenBookmarks.add(bookmark.id);
        return true;
      });
    for (const folder of folders) {
      const items = bookmarks.filter(bookmark => bookmark.folderId === folder.id).sort((a, b) => a.order - b.order);
      items.forEach((bookmark, index) => { bookmark.order = index; });
    }
    for (const category of categories) {
      const validKeys = new Set([
        ...folders.filter(folder => folder.categoryId === category.id).map(folder => `folder:${folder.id}`),
        ...bookmarks.filter(bookmark => bookmark.categoryId === category.id && !bookmark.folderId).map(bookmark => `bookmark:${bookmark.id}`),
      ]);
      const itemOrder = [];
      for (const key of Array.isArray(category.itemOrder) ? category.itemOrder : []) {
        if (!validKeys.has(key) || itemOrder.includes(key)) continue;
        itemOrder.push(key);
      }
      for (const key of validKeys) if (!itemOrder.includes(key)) itemOrder.push(key);
      category.itemOrder = itemOrder;
    }
    return {
      version: 3,
      viewMode: source.viewMode === 'list' ? 'list' : 'grid',
      categories,
      folders,
      bookmarks,
    };
  }

  async function migrateStorage() {
    const area = getStorageArea();
    if (!area) return { from: 0, to: CURRENT_SCHEMA_VERSION, changed: false };

    const data = await getRaw(null);
    const rawVersion = Number(data[STORAGE_SCHEMA_KEY] || 0);
    const from = Number.isFinite(rawVersion) ? rawVersion : 0;
    if (from > CURRENT_SCHEMA_VERSION) {
      return { from, to: CURRENT_SCHEMA_VERSION, changed: false, forwardVersion: true };
    }

    const updates = {};

    if (from < 1) {
      updates[DEFERRED_KEY] = normalizeDeferred(data[DEFERRED_KEY]);
      updates[VIEW_MODE_KEY] = normalizeViewMode(data[VIEW_MODE_KEY]);
      updates[PRIVACY_MODE_KEY] = data[PRIVACY_MODE_KEY] === true;
      updates[PRIVACY_SETTINGS_KEY] = normalizePrivacySettings(data[PRIVACY_SETTINGS_KEY]);
    }

    if (from < 2) {
      updates[SAVED_SESSIONS_KEY] = normalizeSavedSessions(data[SAVED_SESSIONS_KEY]);
      updates[ACTIVITY_STATS_KEY] = normalizeActivityStats(data[ACTIVITY_STATS_KEY]);
      updates[ACHIEVEMENTS_KEY] = normalizeAchievements(data[ACHIEVEMENTS_KEY]);
    }

    if (from < 3) {
      updates[DOMAIN_CARD_PREFERENCES_KEY] = normalizeDomainCardPreferences(data[DOMAIN_CARD_PREFERENCES_KEY]);
    }

    if (from < 6) {
      updates[BOOKMARK_LIBRARY_KEY] = normalizeBookmarkLibrary(data[BOOKMARK_LIBRARY_KEY]);
    }

    if (from < 7) {
      const legacyDeferred = Array.isArray(data[DEFERRED_KEY])
        ? data[DEFERRED_KEY].filter(item => !isPlainObject(item) || item.dismissed !== true)
        : [];
      updates[DEFERRED_KEY] = normalizeDeferred(legacyDeferred);
      updates[SAVED_SESSIONS_KEY] = normalizeSavedSessions(data[SAVED_SESSIONS_KEY]);
    }

    if (from < 8) {
      updates[PRIVACY_SETTINGS_KEY] = {
        ...normalizePrivacySettings(data[PRIVACY_SETTINGS_KEY]),
        externalFavicons: false,
      };
    }

    if (from !== CURRENT_SCHEMA_VERSION) {
      updates[STORAGE_SCHEMA_KEY] = CURRENT_SCHEMA_VERSION;
      updates[STORAGE_LAST_MIGRATED_KEY] = nowIso();
    }

    if (Object.keys(updates).length > 0) {
      await setRaw(updates);
      return { from, to: CURRENT_SCHEMA_VERSION, changed: true };
    }

    return { from, to: CURRENT_SCHEMA_VERSION, changed: false };
  }

  async function getDeferred() {
    const data = await get(DEFERRED_KEY);
    return normalizeDeferred(data[DEFERRED_KEY]);
  }

  async function setDeferred(deferred) {
    await set({ [DEFERRED_KEY]: normalizeDeferred(deferred) });
  }

  async function getSavedSessions() {
    const data = await get(SAVED_SESSIONS_KEY);
    return normalizeSavedSessions(data[SAVED_SESSIONS_KEY]);
  }

  async function setSavedSessions(sessions) {
    await set({ [SAVED_SESSIONS_KEY]: normalizeSavedSessions(sessions) });
  }

  async function addSavedSession(session) {
    const mutation = await mutateStoredValue(SAVED_SESSIONS_KEY, normalizeSavedSessions, sessions => {
      const normalized = normalizeSavedSession(session, sessions.length);
      if (!normalized.windows.some(window => window.tabs.length > 0)) return false;
      sessions.unshift(normalized);
      return true;
    });
    return mutation.result;
  }

  async function removeSavedSession(id) {
    const mutation = await mutateStoredValue(SAVED_SESSIONS_KEY, normalizeSavedSessions, sessions => {
      const index = sessions.findIndex(session => session.id === id);
      if (index === -1) return false;
      sessions.splice(index, 1);
      return true;
    });
    return mutation.result;
  }

  async function restoreSavedSession(session, index = 0) {
    if (!session?.id) return false;
    const mutation = await mutateStoredValue(SAVED_SESSIONS_KEY, normalizeSavedSessions, sessions => {
      if (sessions.some(item => item.id === session.id)) return false;
      const normalized = normalizeSavedSession(session, sessions.length);
      if (!normalized.windows.some(window => window.tabs.length > 0)) return false;
      const insertIndex = Math.max(0, Math.min(Number(index) || 0, sessions.length));
      sessions.splice(insertIndex, 0, normalized);
      return true;
    });
    return mutation.result;
  }

  async function getActivityStats() {
    const data = await get(ACTIVITY_STATS_KEY);
    return normalizeActivityStats(data[ACTIVITY_STATS_KEY]);
  }

  async function recordActivity(event) {
    const mutation = await mutateStoredValue(ACTIVITY_STATS_KEY, normalizeActivityStats, stats => {
      const currentWeek = weekKey();
      if (!stats.weekly[currentWeek]) {
        stats.weekly[currentWeek] = { closed: 0, saved: 0, duplicateClosed: 0, sessionsSaved: 0 };
      }
      const count = Math.max(1, Number(event?.count) || 1);
      const domain = typeof event?.domain === 'string' ? event.domain : '';
      if (event?.type === 'closed') {
        stats.closedTotal += count;
        stats.weekly[currentWeek].closed += count;
      } else if (event?.type === 'saved') {
        stats.savedTotal += count;
        stats.weekly[currentWeek].saved += count;
      } else if (event?.type === 'duplicateClosed') {
        stats.duplicateClosedTotal += count;
        stats.weekly[currentWeek].duplicateClosed += count;
      } else if (event?.type === 'sessionSaved') {
        stats.sessionsSavedTotal += count;
        stats.weekly[currentWeek].sessionsSaved += count;
      }
      if (domain) stats.domains[domain] = (Number(stats.domains[domain]) || 0) + count;
    });
    return mutation.value;
  }

  async function getAchievements() {
    const data = await get(ACHIEVEMENTS_KEY);
    return normalizeAchievements(data[ACHIEVEMENTS_KEY]);
  }

  async function unlockAchievements(ids) {
    const mutation = await mutateStoredValue(ACHIEVEMENTS_KEY, normalizeAchievements, achievements => {
      const current = new Set(achievements);
      for (const id of ids || []) current.add(id);
      achievements.splice(0, achievements.length, ...current);
    });
    return mutation.value;
  }

  async function addDeferredTab(tab) {
    const url = normalizeRestorableUrl(tab?.url);
    if (!url) return false;
    await mutateStoredValue(DEFERRED_KEY, normalizeDeferred, deferred => {
      deferred.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        title: tab.title || url,
        savedAt: nowIso(),
        completed: false,
      });
    });
    return true;
  }

  async function updateDeferredTab(id, patch) {
    const mutation = await mutateStoredValue(DEFERRED_KEY, normalizeDeferred, deferred => {
      const item = deferred.find(tab => tab.id === id);
      if (!item) return false;
      Object.assign(item, patch);
      return true;
    });
    return mutation.result;
  }

  async function removeDeferredTab(id) {
    const mutation = await mutateStoredValue(DEFERRED_KEY, normalizeDeferred, deferred => {
      const index = deferred.findIndex(tab => tab.id === id);
      if (index === -1) return null;
      return deferred.splice(index, 1)[0];
    });
    return mutation.result;
  }

  async function restoreDeferredTabs(items) {
    const candidates = normalizeDeferred(items);
    if (candidates.length === 0) return 0;
    const mutation = await mutateStoredValue(DEFERRED_KEY, normalizeDeferred, deferred => {
      const ids = new Set(deferred.map(tab => tab.id));
      const restored = candidates.filter(tab => !ids.has(tab.id));
      deferred.push(...restored);
      return restored.length;
    });
    return mutation.result;
  }

  async function clearArchivedDeferredTabs() {
    const mutation = await mutateStoredValue(DEFERRED_KEY, normalizeDeferred, deferred => {
      const next = deferred.filter(tab => !tab.completed);
      const removed = deferred.length - next.length;
      deferred.splice(0, deferred.length, ...next);
      return removed;
    });
    return mutation.result;
  }

  async function getSavedTabs() {
    const visible = await getDeferred();
    return {
      active: visible.filter(tab => !tab.completed),
      archived: visible.filter(tab => tab.completed),
    };
  }

  async function getViewMode() {
    const data = await get(VIEW_MODE_KEY);
    return normalizeViewMode(data[VIEW_MODE_KEY]);
  }

  async function setViewMode(mode) {
    await set({ [VIEW_MODE_KEY]: normalizeViewMode(mode) });
  }

  async function getDomainCardPreferences() {
    const data = await get(DOMAIN_CARD_PREFERENCES_KEY);
    return normalizeDomainCardPreferences(data[DOMAIN_CARD_PREFERENCES_KEY]);
  }

  async function setDomainCardPreferences(preferences) {
    const normalized = normalizeDomainCardPreferences(preferences);
    await set({ [DOMAIN_CARD_PREFERENCES_KEY]: normalized });
    return normalized;
  }

  async function getPrivacyMode() {
    const data = await get(PRIVACY_MODE_KEY);
    return data[PRIVACY_MODE_KEY] === true;
  }

  async function setPrivacyMode(enabled) {
    await set({ [PRIVACY_MODE_KEY]: enabled === true });
  }

  async function getPrivacySettings() {
    const data = await get(PRIVACY_SETTINGS_KEY);
    return normalizePrivacySettings(data[PRIVACY_SETTINGS_KEY]);
  }

  async function setPrivacySettings(settings) {
    await set({ [PRIVACY_SETTINGS_KEY]: normalizePrivacySettings(settings) });
  }

  async function getBookmarkLibrary() {
    const data = await get(BOOKMARK_LIBRARY_KEY);
    return normalizeBookmarkLibrary(data[BOOKMARK_LIBRARY_KEY]);
  }

  async function setBookmarkLibrary(library) {
    const normalized = normalizeBookmarkLibrary(library);
    await set({ [BOOKMARK_LIBRARY_KEY]: normalized });
    return normalized;
  }

  async function mutateBookmarkLibrary(updater) {
    if (typeof updater !== 'function') throw new TypeError('bookmark-updater-required');
    const mutation = await mutateStoredValue(BOOKMARK_LIBRARY_KEY, normalizeBookmarkLibrary, updater);
    return { library: mutation.value, result: mutation.result, previous: mutation.previous };
  }

  const api = {
    CURRENT_SCHEMA_VERSION,
    STORAGE_SCHEMA_KEY,
    SAVED_SESSIONS_KEY,
    ACTIVITY_STATS_KEY,
    ACHIEVEMENTS_KEY,
    DOMAIN_CARD_PREFERENCES_KEY,
    BOOKMARK_LIBRARY_KEY,
    HOME_CATEGORY_ID,
    UNFILED_CATEGORY_ID,
    BOOKMARK_FOLDER_ICON_IDS,
    PRIVACY_DEFAULTS,
    get,
    set,
    getBytesInUse,
    onStorageError,
    isQuotaError,
    normalizeDeferred,
    normalizeSavedSessions,
    normalizeActivityStats,
    normalizeViewMode,
    normalizeDomainCardPreferences,
    normalizePrivacySettings,
    normalizeBookmarkLibrary,
    normalizeBookmarkFolderIcon,
    suggestBookmarkFolderIcon,
    migrateStorage,
    getDeferred,
    setDeferred,
    getSavedSessions,
    setSavedSessions,
    addSavedSession,
    removeSavedSession,
    restoreSavedSession,
    getActivityStats,
    recordActivity,
    getAchievements,
    unlockAchievements,
    addDeferredTab,
    updateDeferredTab,
    removeDeferredTab,
    restoreDeferredTabs,
    clearArchivedDeferredTabs,
    getSavedTabs,
    getViewMode,
    setViewMode,
    getDomainCardPreferences,
    setDomainCardPreferences,
    getPrivacyMode,
    setPrivacyMode,
    getPrivacySettings,
    setPrivacySettings,
    getBookmarkLibrary,
    setBookmarkLibrary,
    mutateBookmarkLibrary,
  };

  global.SuperTabOutStorage = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
