/* BrowseLoom bookmark workspace UI. */
(function () {
  'use strict';

  const Bookmarks = window.SuperTabOutBookmarks;
  const Storage = window.SuperTabOutStorage;
  const HOME_CATEGORY_ID = Storage?.HOME_CATEGORY_ID || 'category-home';
  const UNFILED_CATEGORY_ID = Storage?.UNFILED_CATEGORY_ID || 'category-unfiled';
  const DIALOG_EXIT_DURATION_MS = 160;
  const dialogCloseTimers = new WeakMap();

  // The global workspace shell must stay usable even when bookmark storage
  // initialization fails. Bind its destination button before that dependency
  // gate so the control can never render without a click handler.
  document.addEventListener('click', handleWorkspaceSwitchClick);
  if (!Bookmarks) return;

  const COPY = {
    en: {
      bookmarks: 'Bookmarks', home: 'Home', unfiled: 'Unfiled', add: 'Add', addBookmark: 'Add bookmark',
      editBookmark: 'Edit bookmark', addFolder: 'Create folder', editFolder: 'Edit folder', addCategory: 'Add category', editCategory: 'Edit category', save: 'Save',
      url: 'URL', name: 'Name', note: 'Note', category: 'Category', folder: 'Folder', noFolder: 'Category root', icon: 'Icon',
      onlineIcon: 'Online icon', colorIcon: 'Solid color', iconText: 'Icon text, 1–2 characters',
      folderName: 'Folder name', categoryName: 'Category name', categoryIcon: 'Category icon', folderSize: 'Folder size',
      recent: 'Recently opened', popular: 'Most opened', emptyActivity: 'Opened bookmarks will appear here.',
      emptyTitle: 'Build your bookmark desk', emptyBody: 'Add a bookmark or folder. Everything stays in this extension.',
      emptyFolderTitle: 'This folder is empty', emptyFolderBody: 'Add a bookmark directly to this folder.',
      searchPlaceholder: 'Search bookmarks', searchResults: 'Search results', noResults: 'No matching bookmarks',
      noResultsBody: 'Try another name, domain, URL, or note.',
      edit: 'Edit', move: 'Move', moveBookmark: 'Move bookmark', open: 'Open', rename: 'Rename', delete: 'Delete', cancel: 'Cancel', undo: 'Undo',
      moveToUnfiled: 'Move to Unfiled', deleteAll: 'Delete all',
      dropToCategory: 'Drop here to move out of the folder',
      deleteBookmarkTitle: 'Delete bookmark?', deleteBookmarkBody: ({ name }) => `“${name}” will be removed from your bookmark library.`,
      deleteFolderTitle: 'Delete folder?', deleteFolderBody: ({ name, count }) => `“${name}” will be removed. Its ${count} bookmark${count === 1 ? '' : 's'} will stay in the category.`,
      deleteCategoryTitle: 'Delete category?',
      deleteCategoryBody: ({ name, bookmarkCount = 0, folderCount = 0 }) => bookmarkCount || folderCount
        ? `“${name}” contains ${bookmarkCount} bookmark${bookmarkCount === 1 ? '' : 's'} and ${folderCount} folder${folderCount === 1 ? '' : 's'}. Choose what should happen to them.`
        : `“${name}” is empty and will be removed.`,
      saved: 'Changes saved', moved: 'Item moved', addedBookmark: 'Bookmark added', addedFolder: 'Folder created', addedCategory: 'Category added', deleted: 'Item deleted', restored: 'Item restored',
      requiredName: 'Enter a name.', invalidUrl: 'Enter a valid http or https URL.', storageError: 'Could not update local storage.',
      unsupportedCurrentPage: 'This browser page cannot be bookmarked. Enter an http or https URL instead.',
      bookmarkSettings: 'Bookmark settings', importBrowserBookmarks: 'Import browser bookmarks',
      importBrowserBookmarksBody: 'Copy bookmarks from this browser into BrowseLoom.',
      importPrivacyTitle: 'Read only during import',
      importPrivacyBody: 'The browser permission says “read and change bookmarks”, but BrowseLoom only reads the bookmark tree and never changes the browser copy.',
      importNow: 'Import current browser bookmarks', importingBookmarks: 'Importing bookmarks…',
      removeBookmarkAccess: 'Remove browser bookmark access', bookmarkAccessRemoved: 'Browser bookmark access removed.',
      bookmarkPermissionDenied: 'Permission was not granted. No bookmarks were read or changed.',
      bookmarkImportUnavailable: 'This browser does not expose the bookmarks import API.',
      bookmarkImportFailed: 'Could not import browser bookmarks. Your existing BrowseLoom bookmarks were not changed.',
      bookmarkImportResult: ({ added, existing, skipped, folders, categories }) => `${added} bookmark${added === 1 ? '' : 's'} added, ${existing} already imported, ${skipped} unsupported. Added ${folders} folder${folders === 1 ? '' : 's'} across ${categories} categor${categories === 1 ? 'y' : 'ies'}.`,
      itemCount: ({ count }) => `${count} item${count === 1 ? '' : 's'}`,
      openedCount: ({ count }) => `${count} open${count === 1 ? '' : 's'}`,
      justNow: 'just now', minutesAgo: ({ count }) => `${count} min`, hoursAgo: ({ count }) => `${count} hr`, daysAgo: ({ count }) => `${count} d`,
      iconView: 'Icon view', listView: 'List view', backTabs: 'Back to tab manager', openBookmarks: 'Open bookmarks', tabs: 'Tabs', workspaces: 'Workspaces', optional: 'Optional',
      page: ({ current, total }) => `Page ${current} of ${total}`,
    },
    zh: {
      bookmarks: '书签', home: '主页', unfiled: '未分类', add: '新增', addBookmark: '新增书签',
      editBookmark: '编辑书签', addFolder: '新建文件夹', editFolder: '编辑文件夹', addCategory: '新增分类', editCategory: '编辑分类', save: '保存',
      url: '链接', name: '名称', note: '备注', category: '分类', folder: '文件夹', noFolder: '分类根目录', icon: '图标',
      onlineIcon: '在线图标', colorIcon: '纯色图标', iconText: '图标文字，建议 1–2 个字符',
      folderName: '文件夹名称', categoryName: '分类名称', categoryIcon: '分类图标', folderSize: '文件夹规格',
      recent: '最近打开', popular: '热门打开', emptyActivity: '打开书签后会显示在这里。',
      emptyTitle: '开始布置你的书签桌面', emptyBody: '新增书签或文件夹，数据只保存在当前扩展中。',
      emptyFolderTitle: '这个文件夹还是空的', emptyFolderBody: '可以直接向当前文件夹添加书签。',
      searchPlaceholder: '搜索所有书签', searchResults: '搜索结果', noResults: '没有匹配的书签',
      noResultsBody: '可以换个名称、域名、链接或备注再试。',
      edit: '编辑', move: '移动', moveBookmark: '移动书签', open: '打开', rename: '重命名', delete: '删除', cancel: '取消', undo: '撤销',
      moveToUnfiled: '移到未分类', deleteAll: '全部删除',
      dropToCategory: '拖到此处，移回当前分类',
      deleteBookmarkTitle: '删除这个书签？', deleteBookmarkBody: ({ name }) => `「${name}」将从书签库中移除。`,
      deleteFolderTitle: '删除这个文件夹？', deleteFolderBody: ({ name, count }) => `「${name}」将被删除，其中 ${count} 个书签会保留在当前分类。`,
      deleteCategoryTitle: '删除这个分类？',
      deleteCategoryBody: ({ name, bookmarkCount = 0, folderCount = 0 }) => bookmarkCount || folderCount
        ? `「${name}」包含 ${bookmarkCount} 个书签和 ${folderCount} 个文件夹，请选择如何处理这些内容。`
        : `「${name}」是空分类，删除后会从侧栏移除。`,
      saved: '已保存修改', moved: '已移动', addedBookmark: '已新增书签', addedFolder: '已创建文件夹', addedCategory: '已新增分类', deleted: '已删除', restored: '已恢复',
      requiredName: '请输入名称。', invalidUrl: '请输入有效的 http 或 https 链接。', storageError: '无法更新本地存储。',
      unsupportedCurrentPage: '当前浏览器页面无法收藏，请改为输入 http 或 https 链接。',
      bookmarkSettings: '书签设置', importBrowserBookmarks: '导入浏览器书签',
      importBrowserBookmarksBody: '把当前浏览器的书签复制到 BrowseLoom。',
      importPrivacyTitle: '仅在导入时读取',
      importPrivacyBody: '浏览器权限会显示“读取和修改书签”，但 BrowseLoom 只读取书签树，不会修改浏览器中的原始书签。',
      importNow: '导入当前浏览器书签', importingBookmarks: '正在导入书签…',
      removeBookmarkAccess: '撤销浏览器书签权限', bookmarkAccessRemoved: '已撤销浏览器书签权限。',
      bookmarkPermissionDenied: '未获得权限，没有读取或修改任何书签。',
      bookmarkImportUnavailable: '当前浏览器不支持书签导入接口。',
      bookmarkImportFailed: '无法导入浏览器书签，BrowseLoom 中原有书签未被修改。',
      bookmarkImportResult: ({ added, existing, skipped, folders, categories }) => `新增 ${added} 个书签，${existing} 个已导入，跳过 ${skipped} 个不支持的地址；新增 ${folders} 个文件夹、${categories} 个分类。`,
      itemCount: ({ count }) => `${count} 项`, openedCount: ({ count }) => `打开 ${count} 次`,
      justNow: '刚刚', minutesAgo: ({ count }) => `${count} 分`, hoursAgo: ({ count }) => `${count} 小时`, daysAgo: ({ count }) => `${count} 天`,
      iconView: '图标视图', listView: '列表视图', backTabs: '返回标签管理', openBookmarks: '打开书签', tabs: '标签管理', workspaces: '工作区', optional: '选填',
      page: ({ current, total }) => `第 ${current} 页，共 ${total} 页`,
    },
  };

  const COLORS = ['#f4a51c', '#46b965', '#26bfa5', '#3f84dd', '#3f63ee', '#7429eb', '#d9478c', '#df4f4f', '#ff5c5c', '#b7a293', '#b58a8a', '#bd9a87', '#708b64', '#79a588', '#9caaae', '#6681b4', '#8d8d8d', '#414141', '#222222'];
  const CATEGORY_ICONS = [
    { id: 'home', en: 'Home', zh: '主页', svg: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9 20v-6h6v6"/>' },
    { id: 'folder', en: 'Folder', zh: '分类', svg: '<path d="M3 7.5h6l2 2h10v8.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 7.5V6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1.5"/>' },
    { id: 'star', en: 'Favorites', zh: '收藏', svg: '<path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>' },
    { id: 'briefcase', en: 'Work', zh: '工作', svg: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/>' },
    { id: 'sparkles', en: 'AI', zh: 'AI', svg: '<path d="m12 3 1.4 3.6L17 8l-3.6 1.4L12 13l-1.4-3.6L7 8l3.6-1.4ZM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8ZM6 14l1 2.5L9.5 18 7 19l-1 2.5L5 19l-2.5-1L5 16.5Z"/>' },
    { id: 'palette', en: 'Design', zh: '设计', svg: '<path d="M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.2-3.2 1.8 1.8 0 0 1 1.2-3.2H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9Z"/><circle cx="7.5" cy="10" r="1"/><circle cx="10" cy="6.5" r="1"/><circle cx="15" cy="7" r="1"/>' },
    { id: 'code', en: 'Code', zh: '编程', svg: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 4l-4 16"/>' },
    { id: 'tools', en: 'Tools', zh: '工具', svg: '<path d="M14 6.5a4 4 0 0 0-5-3.8l2.4 2.4-2.3 2.3-2.4-2.3a4 4 0 0 0 5.2 5.1L20 18.3 18.3 20l-8.1-8.1A4 4 0 0 0 14 6.5Z"/>' },
    { id: 'shopping', en: 'Shopping', zh: '购物', svg: '<path d="M5 8h14l-1 12H6Z"/><path d="M9 10V7a3 3 0 0 1 6 0v3"/>' },
    { id: 'book', en: 'Reading', zh: '阅读', svg: '<path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H11v18H7.5A3.5 3.5 0 0 0 4 23Z"/><path d="M20 5.5A3.5 3.5 0 0 0 16.5 2H13v18h3.5A3.5 3.5 0 0 1 20 23Z"/>' },
    { id: 'newspaper', en: 'News', zh: '新闻', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h6v4H7Zm9 0h2m-2 4h2M7 16h11"/>' },
    { id: 'image', en: 'Images', zh: '图片', svg: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 3.5 3 2.5-2 5 4"/>' },
    { id: 'music', en: 'Music', zh: '音乐', svg: '<path d="M9 18V6l10-2v12M9 9l10-2"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>' },
    { id: 'video', en: 'Video', zh: '视频', svg: '<rect x="3" y="5" width="14" height="14" rx="2"/><path d="m17 10 4-2v8l-4-2Z"/>' },
    { id: 'gamepad', en: 'Games', zh: '游戏', svg: '<path d="M8 7h8a5 5 0 0 1 4.7 6.7l-1 2.8a2.5 2.5 0 0 1-4.1 1l-1.4-1.3H9.8l-1.4 1.3a2.5 2.5 0 0 1-4.1-1l-1-2.8A5 5 0 0 1 8 7Z"/><path d="M8 10v4m-2-2h4m6-1h.01m2 3h.01"/>' },
    { id: 'message', en: 'Social', zh: '社交', svg: '<path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 3v-3a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M7 9h10M7 13h7"/>' },
    { id: 'globe', en: 'Web', zh: '网络', svg: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>' },
    { id: 'plane', en: 'Travel', zh: '旅行', svg: '<path d="M3 11.5 21 4l-6.5 16-3.5-6-8-2.5Z"/><path d="m11 14 4-4"/>' },
    { id: 'heart', en: 'Health', zh: '健康', svg: '<path d="M20.8 5.7a5.2 5.2 0 0 0-7.4 0L12 7.1l-1.4-1.4a5.2 5.2 0 1 0-7.4 7.4L12 21l8.8-7.9a5.2 5.2 0 0 0 0-7.4Z"/>' },
    { id: 'dumbbell', en: 'Fitness', zh: '健身', svg: '<path d="M6 7v10m12-10v10M3 9v6m18-6v6M6 12h12"/>' },
    { id: 'wallet', en: 'Finance', zh: '财务', svg: '<path d="M4 5h14a2 2 0 0 1 2 2v13H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11"/><path d="M14 10h8v5h-8a2.5 2.5 0 0 1 0-5Z"/><circle cx="15" cy="12.5" r=".5"/>' },
    { id: 'food', en: 'Food', zh: '美食', svg: '<path d="M7 3v8m-3-8v5a3 3 0 0 0 6 0V3M7 11v10M16 3c3 2 4 5 4 9h-4v9Z"/>' },
    { id: 'lightbulb', en: 'Ideas', zh: '灵感', svg: '<path d="M9 18h6m-5 3h4M8.5 15.5a7 7 0 1 1 7 0c-.8.6-1.2 1.3-1.3 2.5h-4.4c-.1-1.2-.5-1.9-1.3-2.5Z"/>' },
    { id: 'archive', en: 'Archive', zh: '归档', svg: '<path d="M4 7h16v13H4Z"/><path d="M3 3h18v4H3Zm6 8h6"/>' },
  ];
  const CATEGORY_ICON_BY_ID = new Map(CATEGORY_ICONS.map(icon => [icon.id, icon]));
  const state = {
    library: { version: 3, viewMode: 'grid', categories: [], folders: [], bookmarks: [] },
    activeCategoryId: HOME_CATEGORY_ID,
    query: '',
    iconMode: 'online',
    iconColor: '#6681b4',
    folderLayout: '1x1',
    folderEditorMode: 'folder',
    categoryIcon: 'folder',
    categoryIconTouched: false,
    folderPages: new Map(),
    pendingDelete: null,
    pendingMove: null,
    undoSnapshot: null,
    draggedItem: null,
    submittingForms: new Set(),
    externalFavicons: true,
    importingBookmarks: false,
    bookmarkPermissionGranted: false,
    bookmarkImportStatus: null,
  };
  let toastTimer = null;
  let workspaceSwipeDelta = 0;
  let workspaceSwipeTimer = null;
  let workspaceSwipeLockedUntil = 0;

  function lang() {
    return document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
  }

  function t(key, params = {}) {
    const value = COPY[lang()][key] ?? COPY.en[key] ?? key;
    return typeof value === 'function' ? value(params) : value;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function categoryIconMarkup(iconId, extraClass = '') {
    const icon = CATEGORY_ICON_BY_ID.get(iconId) || CATEGORY_ICON_BY_ID.get('folder');
    return `<svg class="bookmark-category-icon ${escapeHtml(extraClass)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon.svg}</svg>`;
  }

  function normalizedCategoryIcon(item) {
    return Storage?.normalizeBookmarkFolderIcon?.(item?.icon, item?.name) || 'folder';
  }

  function initials(title) {
    const text = String(title || '?').trim();
    const parts = text.split(/\s+/).filter(Boolean);
    if (parts.length > 1 && parts[0][0] && parts[1][0]) return `${parts[0][0]}${parts[1][0]}`.slice(0, 2).toUpperCase();
    return text.slice(0, 2).toUpperCase();
  }

  function domainFor(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
  }

  function onlineIconUrl(url) {
    const domain = domainFor(url);
    if (!state.externalFavicons || !domain || ['localhost', '127.0.0.1', '[::1]'].includes(domain)) return '';
    if (typeof window.faviconUrlFor === 'function') return window.faviconUrlFor(domain);
    return `https://icons.duckduckgo.com/ip3/${encodeURIComponent(domain)}.ico`;
  }

  function iconMarkup(bookmark, extraClass = '') {
    const fallback = initials(bookmark.title);
    if (bookmark.icon?.type === 'color') {
      const color = /^#[0-9a-f]{6}$/i.test(bookmark.icon.color || '') ? bookmark.icon.color : '#6681b4';
      const text = bookmark.icon.text || fallback;
      return `<span class="bookmark-app-icon ${extraClass}" style="background:${escapeHtml(color)}"><span>${escapeHtml(text)}</span></span>`;
    }
    const src = onlineIconUrl(bookmark.url);
    if (!src) return `<span class="bookmark-app-icon icon-online-fallback ${extraClass}" data-fallback="${escapeHtml(fallback)}"></span>`;
    return `<span class="bookmark-app-icon ${extraClass}" data-online-icon><img src="${escapeHtml(src)}" alt="" data-bookmark-fallback="${escapeHtml(fallback)}"></span>`;
  }

  function folderById(id) {
    return state.library.folders.find(folder => folder.id === id) || null;
  }

  function categoryById(id) {
    return state.library.categories.find(category => category.id === id) || null;
  }

  function categoryLabel(category) {
    if (category?.system === 'home') return t('home');
    if (category?.system === 'unfiled') return t('unfiled');
    return category?.name || t('unfiled');
  }

  function categoryItems(categoryId) {
    const category = categoryById(categoryId);
    if (!category) return [];
    return category.itemOrder.map(key => {
      if (key.startsWith('folder:')) return { kind: 'folder', key, value: folderById(key.slice('folder:'.length)) };
      return { kind: 'bookmark', key, value: bookmarkById(key.slice('bookmark:'.length)) };
    }).filter(item => item.value);
  }

  function categoryBookmarks(categoryId) {
    return Bookmarks.getCategoryBookmarks(state.library, categoryId);
  }

  function bookmarkById(id) {
    return state.library.bookmarks.find(bookmark => bookmark.id === id) || null;
  }

  function folderItems(id) {
    return Bookmarks.getFolderBookmarks(state.library, id);
  }

  function timeAgo(iso) {
    const time = new Date(iso).getTime();
    if (!Number.isFinite(time)) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
    if (minutes < 1) return t('justNow');
    if (minutes < 60) return t('minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('hoursAgo', { count: hours });
    return t('daysAgo', { count: Math.floor(hours / 24) });
  }

  function bookmarkTileMarkup(bookmark, options = {}) {
    const itemKey = options.itemKey || '';
    const folderDrop = options.folderView ? ` data-folder-bookmark-drop="${escapeHtml(bookmark.id)}"` : '';
    return `<article class="bookmark-tile" data-bookmark-id="${escapeHtml(bookmark.id)}" data-bookmark-drag="${escapeHtml(bookmark.id)}"${itemKey ? ` data-category-item-key="${escapeHtml(itemKey)}" data-category-id="${escapeHtml(bookmark.categoryId)}"` : ''}${folderDrop} draggable="true">
      <button class="bookmark-tile-open" type="button" data-bookmark-action="open" data-bookmark-id="${escapeHtml(bookmark.id)}" title="${escapeHtml(bookmark.title)}">
        ${iconMarkup(bookmark)}<span class="bookmark-tile-title">${escapeHtml(bookmark.title)}</span>
      </button>
      <button class="bookmark-more-button" type="button" data-bookmark-action="menu" data-kind="bookmark" data-id="${escapeHtml(bookmark.id)}" aria-label="${escapeHtml(t('edit'))}">•••</button>
    </article>`;
  }

  function miniIconMarkup(bookmark) {
    if (!bookmark) return '<i class="bookmark-mini-icon">·</i>';
    if (bookmark.icon?.type === 'color') {
      const color = /^#[0-9a-f]{6}$/i.test(bookmark.icon.color || '') ? bookmark.icon.color : '#6681b4';
      return `<i class="bookmark-mini-icon" style="--mini-color:${escapeHtml(color)}">${escapeHtml(bookmark.icon.text || initials(bookmark.title))}</i>`;
    }
    const src = onlineIconUrl(bookmark.url);
    return src
      ? `<i class="bookmark-mini-icon"><img src="${escapeHtml(src)}" alt="" data-bookmark-fallback="${escapeHtml(initials(bookmark.title))}"></i>`
      : `<i class="bookmark-mini-icon">${escapeHtml(initials(bookmark.title))}</i>`;
  }

  function folderTileMarkup(folder, itemKey = '') {
    const items = folderItems(folder.id);
    return `<article class="bookmark-folder-tile" data-folder-id="${escapeHtml(folder.id)}" data-folder-drag="${escapeHtml(folder.id)}" data-folder-drop="${escapeHtml(folder.id)}" data-category-item-key="${escapeHtml(itemKey)}" data-category-id="${escapeHtml(folder.categoryId)}" draggable="true">
      <button class="bookmark-folder-open" type="button" data-bookmark-action="open-folder" data-folder-id="${escapeHtml(folder.id)}" title="${escapeHtml(folder.name)}">
        <span class="bookmark-folder-icon">${[0,1,2,3].map(index => miniIconMarkup(items[index])).join('')}<span class="bookmark-folder-count">${items.length}</span></span>
        <span class="bookmark-folder-title">${escapeHtml(folder.name)}</span>
      </button>
    </article>`;
  }

  function folderBoardMarkup(folder, itemKey) {
    const items = folderItems(folder.id);
    const capacity = folder.layout === '2x2' ? 4 : 2;
    const pages = Math.max(1, Math.ceil(items.length / capacity));
    const current = Math.min(state.folderPages.get(folder.id) || 0, pages - 1);
    state.folderPages.set(folder.id, current);
    const visible = items.slice(current * capacity, (current + 1) * capacity);
    return `<section class="bookmark-folder-board" data-folder-id="${escapeHtml(folder.id)}" data-folder-drag="${escapeHtml(folder.id)}" data-folder-drop="${escapeHtml(folder.id)}" data-category-item-key="${escapeHtml(itemKey)}" data-category-id="${escapeHtml(folder.categoryId)}" data-layout="${escapeHtml(folder.layout)}" data-page="${current}" data-capacity="${capacity}" tabindex="0" draggable="true">
      <div class="bookmark-folder-board-head">
        <button class="bookmark-folder-board-title" type="button" data-bookmark-action="open-folder" data-folder-id="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</button>
        <span class="bookmark-folder-board-count">${items.length}</span>
      </div>
      <div class="bookmark-folder-board-grid">${visible.map(item => `<button class="bookmark-folder-link" type="button" data-bookmark-action="open" data-bookmark-id="${escapeHtml(item.id)}" data-bookmark-drag="${escapeHtml(item.id)}" draggable="true">${iconMarkup(item)}<span class="bookmark-tile-title">${escapeHtml(item.title)}</span></button>`).join('')}</div>
      ${pages > 1 ? `<span class="bookmark-folder-pager">${Array.from({ length: pages }, (_, index) => `<button type="button" class="${index === current ? 'active' : ''}" data-bookmark-action="folder-page" data-folder-id="${escapeHtml(folder.id)}" data-page="${index}" aria-label="${escapeHtml(t('page', { current: index + 1, total: pages }))}" aria-current="${index === current ? 'page' : 'false'}"><i></i></button>`).join('')}</span>` : ''}
    </section>`;
  }

  function listRowMarkup(bookmark, itemKey = '') {
    return `<article class="bookmark-list-row" data-bookmark-id="${escapeHtml(bookmark.id)}" data-bookmark-drag="${escapeHtml(bookmark.id)}"${itemKey ? ` data-category-item-key="${escapeHtml(itemKey)}" data-category-id="${escapeHtml(bookmark.categoryId)}"` : ''} draggable="true">
      <button class="bookmark-list-primary" type="button" data-bookmark-action="open" data-bookmark-id="${escapeHtml(bookmark.id)}">${iconMarkup(bookmark)}<span class="bookmark-list-copy"><strong>${escapeHtml(bookmark.title)}</strong></span></button>
      <span class="bookmark-list-domain">${escapeHtml(domainFor(bookmark.url))}</span>
      <span class="bookmark-list-note" title="${escapeHtml(bookmark.note)}">${escapeHtml(bookmark.note || '—')}</span>
      <button class="bookmark-more-button" type="button" data-bookmark-action="menu" data-kind="bookmark" data-id="${escapeHtml(bookmark.id)}" aria-label="${escapeHtml(t('edit'))}">•••</button>
    </article>`;
  }

  function folderListRowMarkup(folder, itemKey) {
    const items = folderItems(folder.id);
    return `<article class="bookmark-list-row bookmark-folder-list-row" data-folder-id="${escapeHtml(folder.id)}" data-folder-drag="${escapeHtml(folder.id)}" data-folder-drop="${escapeHtml(folder.id)}" data-category-item-key="${escapeHtml(itemKey)}" data-category-id="${escapeHtml(folder.categoryId)}" draggable="true">
      <button class="bookmark-list-primary" type="button" data-bookmark-action="open-folder" data-folder-id="${escapeHtml(folder.id)}"><span class="bookmark-folder-icon">${[0,1,2,3].map(index => miniIconMarkup(items[index])).join('')}</span><span class="bookmark-list-copy"><strong>${escapeHtml(folder.name)}</strong></span></button>
      <span class="bookmark-list-domain">${escapeHtml(t('folder'))}</span>
      <span class="bookmark-list-note">${escapeHtml(t('itemCount', { count: items.length }))}</span>
      <button class="bookmark-more-button" type="button" data-bookmark-action="menu" data-kind="folder" data-id="${escapeHtml(folder.id)}" aria-label="${escapeHtml(t('edit'))}">•••</button>
    </article>`;
  }

  function addBookmarkMarkup(categoryId, folderId = '', viewMode = 'grid') {
    const categoryAttribute = ` data-category-id="${escapeHtml(categoryId)}"`;
    const folderAttribute = folderId ? ` data-folder-id="${escapeHtml(folderId)}"` : '';
    if (viewMode === 'list') {
      return `<button class="bookmark-list-add" type="button" data-bookmark-action="open-add-menu"${categoryAttribute}${folderAttribute} aria-haspopup="menu" aria-controls="bookmarkAddMenu" aria-expanded="false" aria-label="${escapeHtml(t('add'))}"><span class="bookmark-list-add-icon" aria-hidden="true">＋</span><span>${escapeHtml(t('add'))}</span></button>`;
    }
    return `<button class="bookmark-add-tile" type="button" data-bookmark-action="open-add-menu"${categoryAttribute}${folderAttribute} aria-haspopup="menu" aria-controls="bookmarkAddMenu" aria-expanded="false" aria-label="${escapeHtml(t('add'))}"><span class="bookmark-add-tile-icon" aria-hidden="true">＋</span><span class="bookmark-tile-title">${escapeHtml(t('add'))}</span></button>`;
  }

  function renderNav() {
    const nav = document.getElementById('bookmarkLibraryNav');
    if (!nav) return;
    const row = category => {
      const count = categoryBookmarks(category.id).length;
      const draggable = category.system ? '' : ` data-category-drag="${escapeHtml(category.id)}" draggable="true"`;
      const menu = category.system ? '' : `<button class="bookmark-nav-more" type="button" data-bookmark-action="menu" data-kind="category" data-id="${escapeHtml(category.id)}" aria-label="${escapeHtml(t('edit'))}">•••</button>`;
      return `<div class="bookmark-nav-row" data-category-id="${escapeHtml(category.id)}"${draggable}><button type="button" class="bookmark-nav-select ${state.activeCategoryId === category.id ? 'active' : ''}" data-bookmark-action="select-category" data-category-id="${escapeHtml(category.id)}" data-category-drop="${escapeHtml(category.id)}"><span class="bookmark-nav-symbol">${categoryIconMarkup(normalizedCategoryIcon(category))}</span><span class="bookmark-nav-name">${escapeHtml(categoryLabel(category))}</span><span class="bookmark-nav-count">${count}</span></button>${menu}</div>`;
    };
    const home = state.library.categories.find(category => category.system === 'home');
    const unfiled = state.library.categories.find(category => category.system === 'unfiled');
    const custom = state.library.categories.filter(category => !category.system);
    nav.innerHTML = `${home ? row(home) : ''}<div class="bookmark-nav-separator"></div>${custom.map(row).join('')}${custom.length ? '<div class="bookmark-nav-separator"></div>' : ''}${unfiled ? row(unfiled) : ''}`;
  }

  function renderMain() {
    const grid = document.getElementById('bookmarkGrid');
    const list = document.getElementById('bookmarkList');
    const empty = document.getElementById('bookmarkEmpty');
    const title = document.getElementById('bookmarkSectionTitle');
    const count = document.getElementById('bookmarkSectionCount');
    if (!grid || !list || !empty || !title || !count) return;

    const currentCategory = categoryById(state.activeCategoryId) || categoryById(HOME_CATEGORY_ID);
    const searchResults = state.query ? Bookmarks.searchLibrary(state.library, state.query) : [];
    const rootItems = state.query ? searchResults.map(bookmark => ({ kind: 'bookmark', key: '', value: bookmark })) : categoryItems(currentCategory?.id);
    title.textContent = state.query ? t('searchResults') : categoryLabel(currentCategory);
    count.textContent = t('itemCount', { count: rootItems.length });
    const isGrid = state.library.viewMode !== 'list';
    grid.hidden = !isGrid;
    list.hidden = isGrid;

    const gridMarkup = rootItems.map(item => item.kind === 'bookmark'
      ? bookmarkTileMarkup(item.value, { itemKey: item.key })
      : (item.value.layout === '1x1' ? folderTileMarkup(item.value, item.key) : folderBoardMarkup(item.value, item.key))).join('');
    const listMarkup = rootItems.map(item => item.kind === 'bookmark'
      ? listRowMarkup(item.value, item.key)
      : folderListRowMarkup(item.value, item.key)).join('');
    const hasGridContent = Boolean(gridMarkup);
    const hasListContent = rootItems.length > 0;
    grid.innerHTML = !state.query && hasGridContent
      ? `${gridMarkup}${addBookmarkMarkup(currentCategory?.id || HOME_CATEGORY_ID, '', 'grid')}`
      : gridMarkup;
    list.innerHTML = !state.query && hasListContent
      ? `${listMarkup}${addBookmarkMarkup(currentCategory?.id || HOME_CATEGORY_ID, '', 'list')}`
      : listMarkup;

    const emptyVisible = isGrid
      ? !hasGridContent
      : !hasListContent;
    empty.hidden = !emptyVisible;
    if (emptyVisible) {
      empty.querySelector('h2').textContent = state.query ? t('noResults') : t('emptyTitle');
      empty.querySelector('p').textContent = state.query ? t('noResultsBody') : t('emptyBody');
      const button = empty.querySelector('button');
      button.hidden = Boolean(state.query);
      button.dataset.categoryId = currentCategory?.id || HOME_CATEGORY_ID;
      delete button.dataset.folderId;
    }
  }

  function activityRowMarkup(bookmark, index, type) {
    return `<button class="bookmark-activity-row" type="button" data-bookmark-action="open" data-bookmark-id="${escapeHtml(bookmark.id)}">
      ${type === 'popular' ? `<span class="bookmark-rank">${index + 1}</span>` : iconMarkup(bookmark)}
      <span class="bookmark-activity-copy"><strong>${escapeHtml(bookmark.title)}</strong><span>${escapeHtml(type === 'popular' ? t('openedCount', { count: bookmark.openCount }) : timeAgo(bookmark.lastOpenedAt))}</span></span>
      ${type === 'recent' ? `<span class="bookmark-activity-meta">${escapeHtml(timeAgo(bookmark.lastOpenedAt))}</span>` : ''}
    </button>`;
  }

  function renderActivity() {
    const recent = Bookmarks.getRecentBookmarks(state.library);
    const popular = Bookmarks.getPopularBookmarks(state.library);
    const recentEl = document.getElementById('recentBookmarks');
    const popularEl = document.getElementById('popularBookmarks');
    if (recentEl) recentEl.innerHTML = recent.length ? recent.map((bookmark, index) => activityRowMarkup(bookmark, index, 'recent')).join('') : `<p class="bookmark-activity-empty">${escapeHtml(t('emptyActivity'))}</p>`;
    if (popularEl) popularEl.innerHTML = popular.length ? popular.map((bookmark, index) => activityRowMarkup(bookmark, index, 'popular')).join('') : `<p class="bookmark-activity-empty">${escapeHtml(t('emptyActivity'))}</p>`;
  }

  function applyCopy() {
    document.querySelectorAll('[data-bookmark-copy]').forEach(element => {
      element.textContent = t(element.dataset.bookmarkCopy);
    });
    document.querySelectorAll('[data-bookmark-copy-aria-label]').forEach(element => {
      const label = t(element.dataset.bookmarkCopyAriaLabel);
      element.setAttribute('aria-label', label);
      if (element.hasAttribute('title')) element.title = label;
    });
    if (document.getElementById('categoryIconOptions')?.children.length) renderCategoryIconOptions();
    const search = document.getElementById('bookmarkSearch');
    if (search) {
      search.placeholder = t('searchPlaceholder');
      search.setAttribute('aria-label', t('searchPlaceholder'));
    }
    const gridButton = document.querySelector('[data-bookmark-view="grid"]');
    const listButton = document.querySelector('[data-bookmark-view="list"]');
    for (const [button, label] of [[gridButton, t('iconView')], [listButton, t('listView')]]) {
      if (!button) continue;
      button.title = label;
      button.setAttribute('aria-label', label);
    }
    const workspaceSwitcher = document.getElementById('workspaceSwitcher');
    if (workspaceSwitcher) workspaceSwitcher.setAttribute('aria-label', t('workspaces'));
    for (const [workspace, label] of [['tabs', t('tabs')], ['bookmarks', t('bookmarks')]]) {
      const button = document.querySelector(`[data-workspace-switch="${workspace}"]`);
      if (!button) continue;
      button.setAttribute('aria-label', label);
      button.title = `${label} (${workspace === 'bookmarks' ? '←' : '→'})`;
      const tooltip = button.querySelector('.workspace-switch-label');
      if (tooltip) tooltip.textContent = label;
    }
    const note = document.getElementById('bookmarkNote');
    if (note) note.placeholder = t('optional');
    document.querySelectorAll('[data-close-dialog]').forEach(button => button.setAttribute('aria-label', t('cancel')));
  }

  function renderViewToggle() {
    document.querySelectorAll('[data-bookmark-view]').forEach(button => {
      const selected = button.dataset.bookmarkView === state.library.viewMode;
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
      button.tabIndex = selected ? 0 : -1;
    });
  }

  function renderWorkspaceSwitcher() {
    const current = document.body.dataset.workspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    document.querySelectorAll('[data-workspace-switch]').forEach(button => {
      button.hidden = button.dataset.workspaceSwitch === current;
    });
  }

  function renderAll() {
    applyCopy();
    renderWorkspaceSwitcher();
    renderNav();
    renderViewToggle();
    renderMain();
    renderActivity();
    renderBookmarkImportControls();
  }

  async function refreshLibrary() {
    state.library = await Bookmarks.getLibrary();
    if (!categoryById(state.activeCategoryId)) state.activeCategoryId = HOME_CATEGORY_ID;
    renderAll();
  }

  function showToast(message, { undo = false } = {}) {
    const toast = document.getElementById('bookmarkToast');
    const text = document.getElementById('bookmarkToastText');
    const undoButton = document.getElementById('bookmarkToastUndo');
    if (!toast || !text || !undoButton) return;
    text.textContent = message;
    undoButton.hidden = !undo;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), undo ? 6000 : 2200);
  }

  function renderBookmarkImportControls() {
    const button = document.getElementById('bookmarkImportButton');
    const buttonLabel = button?.querySelector('span');
    const status = document.getElementById('bookmarkImportStatus');
    const removeButton = document.getElementById('bookmarkPermissionRemove');
    if (button) button.disabled = state.importingBookmarks;
    if (buttonLabel) buttonLabel.textContent = t(state.importingBookmarks ? 'importingBookmarks' : 'importNow');
    if (status) {
      status.textContent = state.bookmarkImportStatus
        ? t(state.bookmarkImportStatus.key, state.bookmarkImportStatus.params)
        : '';
      if (state.bookmarkImportStatus?.state) status.dataset.state = state.bookmarkImportStatus.state;
      else delete status.dataset.state;
    }
    if (removeButton) removeButton.hidden = !state.bookmarkPermissionGranted || state.importingBookmarks;
  }

  function setBookmarkImportStatus(key, params = {}, statusState = '') {
    state.bookmarkImportStatus = key ? { key, params, state: statusState } : null;
    renderBookmarkImportControls();
  }

  async function refreshBookmarkPermissionState() {
    try {
      state.bookmarkPermissionGranted = await chrome.permissions?.contains?.({ permissions: ['bookmarks'] }) === true;
    } catch {
      state.bookmarkPermissionGranted = false;
    }
    renderBookmarkImportControls();
  }

  function openBookmarkSettings() {
    const dialog = document.getElementById('bookmarkSettingsDialog');
    if (!dialog) return;
    showBookmarkDialog(dialog);
    refreshBookmarkPermissionState();
  }

  async function importBrowserBookmarks() {
    if (state.importingBookmarks) return;
    if (!chrome?.permissions?.request) {
      setBookmarkImportStatus('bookmarkImportUnavailable', {}, 'error');
      return;
    }
    state.importingBookmarks = true;
    setBookmarkImportStatus('', {}, '');
    renderBookmarkImportControls();
    try {
      // Keep the permission request as the first awaited browser API call so it
      // remains directly tied to the user's Import button gesture.
      const granted = await chrome.permissions.request({ permissions: ['bookmarks'] });
      state.bookmarkPermissionGranted = granted === true;
      if (!granted) {
        setBookmarkImportStatus('bookmarkPermissionDenied', {}, 'error');
        return;
      }
      if (!chrome.bookmarks?.getTree) {
        setBookmarkImportStatus('bookmarkImportUnavailable', {}, 'error');
        return;
      }
      const tree = await chrome.bookmarks.getTree();
      const imported = await Bookmarks.importBrowserTree(tree);
      state.library = imported.library;
      const summary = imported.result;
      setBookmarkImportStatus('bookmarkImportResult', {
        added: summary.addedBookmarks,
        existing: summary.existingBookmarks,
        skipped: summary.skippedBookmarks,
        folders: summary.addedFolders,
        categories: summary.addedCategories,
      }, 'success');
      renderAll();
    } catch {
      setBookmarkImportStatus('bookmarkImportFailed', {}, 'error');
    } finally {
      state.importingBookmarks = false;
      renderBookmarkImportControls();
    }
  }

  async function removeBookmarkPermission() {
    try {
      const removed = await chrome.permissions?.remove?.({ permissions: ['bookmarks'] });
      state.bookmarkPermissionGranted = removed !== true && await chrome.permissions?.contains?.({ permissions: ['bookmarks'] }) === true;
      setBookmarkImportStatus('bookmarkAccessRemoved', {}, 'success');
    } catch {
      setBookmarkImportStatus('bookmarkImportFailed', {}, 'error');
    }
  }

  function applyWorkspaceShell(workspace) {
    const next = workspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    document.body.dataset.workspace = next;
    const bookmarkWorkspace = document.getElementById('bookmarkWorkspace');
    if (bookmarkWorkspace) bookmarkWorkspace.hidden = next !== 'bookmarks';
    document.querySelectorAll('[data-workspace-switch]').forEach(button => {
      button.hidden = button.dataset.workspaceSwitch === next;
    });
    return next;
  }

  function transitionWorkspace(workspace) {
    const next = workspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    const current = document.body.dataset.workspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    if (current === next || reduceMotion) {
      applyWorkspaceShell(next);
      return Promise.resolve();
    }

    const root = document.documentElement;
    root.dataset.workspaceTransition = next === 'bookmarks' ? 'to-bookmarks' : 'to-tabs';
    if (typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(() => applyWorkspaceShell(next));
      return transition.finished
        .catch(() => {})
        .finally(() => { delete root.dataset.workspaceTransition; });
    }

    const source = current === 'bookmarks'
      ? document.getElementById('bookmarkWorkspace')
      : document.querySelector('body > .container');
    if (!source || typeof source.animate !== 'function') {
      delete root.dataset.workspaceTransition;
      applyWorkspaceShell(next);
      return Promise.resolve();
    }

    const distance = Math.min(112, Math.max(48, window.innerWidth * .07));
    const exitX = next === 'bookmarks' ? distance : -distance;
    const enterX = -exitX;
    const timing = { duration: 130, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'both' };

    return (async () => {
      let exitAnimation;
      let enterAnimation;
      try {
        exitAnimation = source.animate([
          { opacity: 1, transform: 'translateX(0)' },
          { opacity: .18, transform: `translateX(${exitX}px)` },
        ], timing);
        await exitAnimation.finished;
        applyWorkspaceShell(next);
        exitAnimation.cancel();

        const destination = next === 'bookmarks'
          ? document.getElementById('bookmarkWorkspace')
          : document.querySelector('body > .container');
        if (!destination) return;
        enterAnimation = destination.animate([
          { opacity: .18, transform: `translateX(${enterX}px)` },
          { opacity: 1, transform: 'translateX(0)' },
        ], { ...timing, duration: 180 });
        await enterAnimation.finished;
      } catch {
        applyWorkspaceShell(next);
      } finally {
        exitAnimation?.cancel();
        enterAnimation?.cancel();
        delete root.dataset.workspaceTransition;
      }
    })();
  }

  function setWorkspace(workspace) {
    const next = workspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    closeFloatingMenus();
    const workspaceUpdated = transitionWorkspace(next);
    if (next === 'bookmarks') {
      workspaceUpdated.then(() => refreshLibrary()).catch(() => {});
    }
  }

  function handleWorkspaceSwitchClick(event) {
    const switcher = event.target.closest('[data-workspace-switch]');
    if (!switcher) return;
    if (!Bookmarks) {
      applyWorkspaceShell(switcher.dataset.workspaceSwitch);
      return;
    }
    setWorkspace(switcher.dataset.workspaceSwitch);
  }

  function closeFloatingMenus() {
    const addMenu = document.getElementById('bookmarkAddMenu');
    const contextMenu = document.getElementById('bookmarkContextMenu');
    if (addMenu) addMenu.hidden = true;
    if (contextMenu) contextMenu.hidden = true;
    document.querySelectorAll('[aria-controls="bookmarkAddMenu"]').forEach(button => button.setAttribute('aria-expanded', 'false'));
  }

  function showBookmarkDialog(dialog) {
    if (!dialog) return;
    const pendingClose = dialogCloseTimers.get(dialog);
    if (pendingClose) window.clearTimeout(pendingClose);
    dialogCloseTimers.delete(dialog);
    dialog.classList.remove('is-closing');
    if (!dialog.open) dialog.showModal();
  }

  function closeBookmarkDialog(dialog, returnValue) {
    if (!dialog?.open || dialog.classList.contains('is-closing')) return;
    closeFloatingMenus();
    const supportsExitMotion = dialog.matches('.bookmark-editor-dialog, .bookmark-folder-dialog');
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const finish = () => {
      dialogCloseTimers.delete(dialog);
      dialog.classList.remove('is-closing');
      if (dialog.open) dialog.close(returnValue);
    };
    if (!supportsExitMotion || reduceMotion) {
      finish();
      return;
    }
    dialog.classList.add('is-closing');
    dialogCloseTimers.set(dialog, window.setTimeout(finish, DIALOG_EXIT_DURATION_MS));
  }

  function closeDialogFromBlankArea(event) {
    const dialog = event.target.closest?.('dialog[open]');
    if (!dialog || event.target !== dialog) return false;
    closeBookmarkDialog(dialog);
    return true;
  }

  function positionFloatingMenu(menu, anchor, pointer = null) {
    const host = anchor.closest('dialog[open]') || document.body;
    if (menu.parentElement !== host) host.append(menu);
    menu.hidden = false;
    const anchorRect = anchor.getBoundingClientRect();
    const rect = menu.getBoundingClientRect();
    const x = pointer?.x ?? anchorRect.left;
    const y = pointer?.y ?? anchorRect.bottom + 8;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - rect.height - 8))}px`;
  }

  function openAddMenu(anchor) {
    const menu = document.getElementById('bookmarkAddMenu');
    if (!menu || !anchor) return;
    const opening = menu.hidden;
    closeFloatingMenus();
    if (!opening) return;
    const categoryId = categoryById(anchor.dataset.categoryId)?.id || state.activeCategoryId;
    const preferredFolderId = folderById(anchor.dataset.folderId)?.id || '';
    menu.querySelectorAll('[data-bookmark-action="add-bookmark"], [data-bookmark-action="add-folder"]').forEach(action => {
      action.dataset.categoryId = categoryId;
      if (preferredFolderId) action.dataset.folderId = preferredFolderId;
      else delete action.dataset.folderId;
    });
    anchor.setAttribute('aria-expanded', 'true');
    const icon = anchor.querySelector('.bookmark-add-tile-icon, .bookmark-list-add-icon') || anchor;
    const rect = icon.getBoundingClientRect();
    positionFloatingMenu(menu, icon, { x: rect.right + 8, y: rect.top });
    menu.querySelector('button')?.focus();
  }

  function contextMenuMarkup(kind, id) {
    if (kind === 'category') {
      return `<button type="button" role="menuitem" data-context-action="edit" data-kind="category" data-id="${escapeHtml(id)}">${escapeHtml(t('editCategory'))}</button>
        <button type="button" role="menuitem" class="danger" data-context-action="delete" data-kind="category" data-id="${escapeHtml(id)}">${escapeHtml(t('delete'))}</button>`;
    }
    if (kind === 'folder') {
      return `<button type="button" role="menuitem" data-context-action="open" data-kind="folder" data-id="${escapeHtml(id)}">${escapeHtml(t('open'))}</button>
        <button type="button" role="menuitem" data-context-action="edit" data-kind="folder" data-id="${escapeHtml(id)}">${escapeHtml(t('editFolder'))}</button>
        <button type="button" role="menuitem" class="danger" data-context-action="delete" data-kind="folder" data-id="${escapeHtml(id)}">${escapeHtml(t('delete'))}</button>`;
    }
    return `<button type="button" role="menuitem" data-context-action="open" data-kind="bookmark" data-id="${escapeHtml(id)}">${escapeHtml(t('open'))}</button>
      <button type="button" role="menuitem" data-context-action="edit" data-kind="bookmark" data-id="${escapeHtml(id)}">${escapeHtml(t('editBookmark'))}</button>
      <button type="button" role="menuitem" data-context-action="move" data-kind="bookmark" data-id="${escapeHtml(id)}">${escapeHtml(t('move'))}</button>
      <button type="button" role="menuitem" class="danger" data-context-action="delete" data-kind="bookmark" data-id="${escapeHtml(id)}">${escapeHtml(t('delete'))}</button>`;
  }

  function openContextMenu(kind, id, anchor, pointer = null) {
    const menu = document.getElementById('bookmarkContextMenu');
    if (!menu) return;
    closeFloatingMenus();
    menu.innerHTML = contextMenuMarkup(kind, id);
    positionFloatingMenu(menu, anchor, pointer);
    menu.querySelector('button')?.focus();
  }

  function updateCategoryOptions(selectId, selectedId = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = state.library.categories.map(category => `<option value="${escapeHtml(category.id)}">${escapeHtml(categoryLabel(category))}</option>`).join('');
    select.value = categoryById(selectedId)?.id || HOME_CATEGORY_ID;
  }

  function updateFolderOptions(selectId, categoryId, selectedId = '') {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = `<option value="">${escapeHtml(t('noFolder'))}</option>` + state.library.folders
      .filter(folder => folder.categoryId === categoryId)
      .map(folder => `<option value="${escapeHtml(folder.id)}">${escapeHtml(folder.name)}</option>`).join('');
    select.value = selectedId || '';
  }

  function setIconMode(mode) {
    state.iconMode = mode === 'color' ? 'color' : 'online';
    document.querySelectorAll('[data-icon-mode]').forEach(button => button.classList.toggle('active', button.dataset.iconMode === state.iconMode));
    const controls = document.getElementById('bookmarkColorControls');
    if (controls) controls.hidden = state.iconMode !== 'color';
    renderIconPreview();
  }

  function renderIconPreview() {
    const preview = document.getElementById('bookmarkIconPreview');
    if (!preview) return;
    const title = document.getElementById('bookmarkName')?.value || domainFor(document.getElementById('bookmarkUrl')?.value) || '?';
    const bookmark = {
      title,
      url: document.getElementById('bookmarkUrl')?.value || '',
      icon: state.iconMode === 'color'
        ? { type: 'color', color: state.iconColor, text: document.getElementById('bookmarkIconText')?.value || initials(title) }
        : { type: 'online' },
    };
    preview.innerHTML = iconMarkup(bookmark);
  }

  function renderColorPalette() {
    const palette = document.getElementById('bookmarkColorPalette');
    if (!palette) return;
    palette.innerHTML = COLORS.map(color => `<button type="button" data-icon-color="${color}" style="--swatch:${color}" class="${color === state.iconColor ? 'active' : ''}" aria-label="${color}"></button>`).join('');
  }

  function openBookmarkEditor(bookmark = null, options = {}) {
    const dialog = document.getElementById('bookmarkEditorDialog');
    const form = document.getElementById('bookmarkEditorForm');
    if (!dialog || !form) return;
    const prefill = options.prefill || {};
    form.reset();
    document.getElementById('bookmarkEditorId').value = bookmark?.id || '';
    document.getElementById('bookmarkEditorTitle').textContent = t(bookmark ? 'editBookmark' : 'addBookmark');
    document.getElementById('bookmarkUrl').value = bookmark?.url || prefill.url || '';
    document.getElementById('bookmarkName').value = bookmark?.title || prefill.title || '';
    document.getElementById('bookmarkNote').value = bookmark?.note || prefill.note || '';
    const preferredFolder = folderById(bookmark?.folderId || options.folderId);
    const categoryId = preferredFolder?.categoryId || categoryById(bookmark?.categoryId || options.categoryId)?.id || state.activeCategoryId;
    updateCategoryOptions('bookmarkCategory', categoryId);
    updateFolderOptions('bookmarkFolder', categoryId, preferredFolder?.id || '');
    document.getElementById('bookmarkFormError').textContent = options.errorKey ? t(options.errorKey) : '';
    state.iconColor = bookmark?.icon?.color || '#6681b4';
    document.getElementById('bookmarkIconText').value = bookmark?.icon?.text || '';
    renderColorPalette();
    setIconMode(bookmark?.icon?.type || 'online');
    showBookmarkDialog(dialog);
    setTimeout(() => document.getElementById(options.focusField || 'bookmarkUrl')?.focus(), 60);
  }

  async function openCapturedBookmarkDraft() {
    const currentUrl = new URL(window.location.href);
    const token = currentUrl.searchParams.get('bookmarkCapture');
    if (!token) return;
    currentUrl.searchParams.delete('bookmarkCapture');
    history.replaceState(null, '', currentUrl.href);
    try {
      const response = await chrome.runtime.sendMessage({ type: 'consume-bookmark-capture', token });
      if (!response?.draft) return;
      applyWorkspaceShell('bookmarks');
      openBookmarkEditor(null, {
        categoryId: UNFILED_CATEGORY_ID,
        prefill: response.draft,
        focusField: response.draft.supported ? 'bookmarkNote' : 'bookmarkUrl',
        errorKey: response.draft.supported ? '' : 'unsupportedCurrentPage',
      });
    } catch {
      showToast(t('storageError'));
    }
  }

  function setFolderLayout(layout) {
    state.folderLayout = ['1x1', '2x1', '2x2'].includes(layout) ? layout : '1x1';
    document.querySelectorAll('[data-folder-layout]').forEach(button => button.classList.toggle('active', button.dataset.folderLayout === state.folderLayout));
  }

  function categoryIconLabel(icon) {
    return lang() === 'zh' ? icon.zh : icon.en;
  }

  function renderCategoryIconOptions() {
    const options = document.getElementById('categoryIconOptions');
    if (!options) return;
    options.setAttribute('aria-label', t('categoryIcon'));
    options.innerHTML = CATEGORY_ICONS.map(icon => {
      const selected = icon.id === state.categoryIcon;
      const label = categoryIconLabel(icon);
      return `<button type="button" data-category-icon="${escapeHtml(icon.id)}" role="radio" aria-checked="${selected ? 'true' : 'false'}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}" class="${selected ? 'active' : ''}">${categoryIconMarkup(icon.id)}</button>`;
    }).join('');
  }

  function setCategoryIcon(iconId, { touched = true } = {}) {
    state.categoryIcon = Storage?.normalizeBookmarkFolderIcon?.(iconId, document.getElementById('folderName')?.value) || 'folder';
    if (touched) state.categoryIconTouched = true;
    renderCategoryIconOptions();
  }

  function openFolderEditor(folder = null, options = {}) {
    const dialog = document.getElementById('folderEditorDialog');
    const form = document.getElementById('folderEditorForm');
    if (!dialog || !form) return;
    const categoryMode = options.category === true;
    state.folderEditorMode = categoryMode ? 'category' : 'folder';
    state.categoryIconTouched = Boolean(folder?.icon);
    form.reset();
    document.getElementById('folderEditorId').value = folder?.id || '';
    document.getElementById('folderEditorTitle').textContent = t(categoryMode ? (folder ? 'editCategory' : 'addCategory') : (folder ? 'editFolder' : 'addFolder'));
    const nameLabel = document.getElementById('folderNameLabel');
    nameLabel.dataset.bookmarkCopy = categoryMode ? 'categoryName' : 'folderName';
    nameLabel.textContent = t(nameLabel.dataset.bookmarkCopy);
    document.getElementById('folderName').value = folder?.name || '';
    const categoryId = categoryMode ? '' : (categoryById(folder?.categoryId || options.categoryId)?.id || state.activeCategoryId);
    updateCategoryOptions('folderCategory', categoryId);
    document.getElementById('categoryIconFieldset').hidden = !categoryMode;
    document.getElementById('folderLayoutFieldset').hidden = categoryMode;
    document.getElementById('folderCategoryField').hidden = categoryMode;
    document.getElementById('folderFormError').textContent = '';
    setFolderLayout(folder?.layout || '1x1');
    if (categoryMode) setCategoryIcon(folder?.icon || Storage?.suggestBookmarkFolderIcon?.(folder?.name || '') || 'folder', { touched: false });
    showBookmarkDialog(dialog);
    setTimeout(() => document.getElementById('folderName')?.focus(), 60);
  }

  function openFolderViewer(folderId) {
    const folder = folderById(folderId);
    const dialog = document.getElementById('bookmarkFolderDialog');
    const grid = document.getElementById('bookmarkFolderDialogGrid');
    if (!folder || !dialog || !grid) return;
    const title = document.getElementById('bookmarkFolderDialogTitle');
    const titleInput = document.getElementById('bookmarkFolderDialogTitleInput');
    title.textContent = folder.name;
    title.hidden = false;
    titleInput.value = folder.name;
    titleInput.hidden = true;
    dialog.dataset.folderId = folder.id;
    const items = folderItems(folder.id);
    const visibleColumns = Math.min(Math.max(items.length, 1), 7);
    const preferredWidth = Math.max(360, 64 + (visibleColumns * 112) + ((visibleColumns - 1) * 20));
    dialog.style.setProperty('--bookmark-folder-width', `${preferredWidth}px`);
    grid.innerHTML = items.length
      ? `${items.map(bookmark => bookmarkTileMarkup(bookmark, { folderView: true })).join('')}${addBookmarkMarkup(folder.categoryId, folder.id)}`
      : `<div class="bookmark-empty"><button class="bookmark-empty-icon" type="button" data-bookmark-action="add-bookmark" data-category-id="${escapeHtml(folder.categoryId)}" data-folder-id="${escapeHtml(folder.id)}" aria-label="${escapeHtml(t('addBookmark'))}">＋</button><h2>${escapeHtml(t('emptyFolderTitle'))}</h2><p>${escapeHtml(t('emptyFolderBody'))}</p></div>`;
    showBookmarkDialog(dialog);
  }

  function beginFolderViewerRename() {
    const dialog = document.getElementById('bookmarkFolderDialog');
    const folder = folderById(dialog?.dataset.folderId);
    const title = document.getElementById('bookmarkFolderDialogTitle');
    const input = document.getElementById('bookmarkFolderDialogTitleInput');
    if (!dialog?.open || !folder || !title || !input) return;
    input.value = folder.name;
    title.hidden = true;
    input.hidden = false;
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function endFolderViewerRename(name) {
    const title = document.getElementById('bookmarkFolderDialogTitle');
    const input = document.getElementById('bookmarkFolderDialogTitleInput');
    if (!title || !input) return;
    title.textContent = name;
    title.hidden = false;
    input.hidden = true;
  }

  async function saveFolderViewerName(event) {
    event?.preventDefault();
    const dialog = document.getElementById('bookmarkFolderDialog');
    const form = document.getElementById('bookmarkFolderRenameForm');
    const input = document.getElementById('bookmarkFolderDialogTitleInput');
    const folder = folderById(dialog?.dataset.folderId);
    if (!dialog?.open || !form || !input || !folder) return;
    const name = input.value.trim();
    if (!name) {
      input.value = folder.name;
      showToast(t('requiredName'));
      return;
    }
    if (name === folder.name) {
      endFolderViewerRename(folder.name);
      return;
    }
    await withFormSubmission(form, async () => {
      try {
        const result = await Bookmarks.updateFolder(folder.id, { name });
        state.library = result.library;
        input.value = result.result.name;
        endFolderViewerRename(result.result.name);
        renderMain();
        showToast(t('saved'));
      } catch {
        input.value = folder.name;
        endFolderViewerRename(folder.name);
        showToast(t('storageError'));
      }
    });
  }

  function openDeleteConfirm(kind, id) {
    const target = kind === 'category' ? categoryById(id) : (kind === 'folder' ? folderById(id) : bookmarkById(id));
    const dialog = document.getElementById('bookmarkConfirmDialog');
    if (!target || target.system || !dialog) return;
    const categoryFolders = kind === 'category' ? state.library.folders.filter(folder => folder.categoryId === id) : [];
    const categoryBookmarkCount = kind === 'category' ? categoryBookmarks(id).length : 0;
    const categoryHasContents = categoryFolders.length > 0 || categoryBookmarkCount > 0;
    const moveToUnfiledButton = document.getElementById('bookmarkConfirmMoveToUnfiled');
    const deleteButton = document.getElementById('bookmarkConfirmDelete');
    state.pendingDelete = { kind, id, hasContents: categoryHasContents };
    const copyKey = kind === 'category' ? 'deleteCategory' : (kind === 'folder' ? 'deleteFolder' : 'deleteBookmark');
    document.getElementById('bookmarkConfirmTitle').textContent = t(`${copyKey}Title`);
    document.getElementById('bookmarkConfirmText').textContent = t(`${copyKey}Body`, {
      name: kind === 'bookmark' ? target.title : target.name,
      count: kind === 'category' ? categoryItems(id).length : (kind === 'folder' ? folderItems(id).length : 0),
      bookmarkCount: categoryBookmarkCount,
      folderCount: categoryFolders.length,
    });
    if (moveToUnfiledButton) {
      moveToUnfiledButton.hidden = !categoryHasContents;
      moveToUnfiledButton.textContent = t('moveToUnfiled');
    }
    if (deleteButton) deleteButton.textContent = t(categoryHasContents ? 'deleteAll' : 'delete');
    showBookmarkDialog(dialog);
  }

  function openMoveDialog(bookmarkId) {
    const bookmark = bookmarkById(bookmarkId);
    const dialog = document.getElementById('bookmarkMoveDialog');
    if (!bookmark || !dialog) return;
    state.pendingMove = { kind: 'bookmark', id: bookmark.id };
    updateCategoryOptions('bookmarkMoveCategory', bookmark.categoryId);
    updateFolderOptions('bookmarkMoveFolder', bookmark.categoryId, bookmark.folderId || '');
    document.getElementById('bookmarkMoveError').textContent = '';
    showBookmarkDialog(dialog);
    setTimeout(() => document.getElementById('bookmarkMoveCategory')?.focus(), 60);
  }

  async function withFormSubmission(form, work) {
    if (state.submittingForms.has(form.id)) return;
    state.submittingForms.add(form.id);
    form.setAttribute('aria-busy', 'true');
    form.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; });
    try { await work(); }
    finally {
      state.submittingForms.delete(form.id);
      form.removeAttribute('aria-busy');
      form.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = false; });
    }
  }

  async function openBookmark(id) {
    const bookmark = bookmarkById(id);
    if (!bookmark) return;
    try {
      const result = await Bookmarks.recordOpen(id);
      state.library = result.library;
      renderAll();
    } catch {}
    try {
      await chrome.tabs.create({ url: bookmark.url, active: true });
    } catch {
      window.open(bookmark.url, '_blank', 'noopener');
    }
  }

  async function saveBookmark(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = document.getElementById('bookmarkEditorId').value;
    const title = document.getElementById('bookmarkName').value.trim();
    const url = Bookmarks.normalizeUrl(document.getElementById('bookmarkUrl').value);
    const error = document.getElementById('bookmarkFormError');
    if (!title) { error.textContent = t('requiredName'); return; }
    if (!url) { error.textContent = t('invalidUrl'); return; }
    const payload = {
      title,
      url,
      note: document.getElementById('bookmarkNote').value,
      categoryId: document.getElementById('bookmarkCategory').value,
      folderId: document.getElementById('bookmarkFolder').value || null,
      icon: state.iconMode === 'color'
        ? { type: 'color', color: state.iconColor, text: document.getElementById('bookmarkIconText').value.trim() || initials(title) }
        : { type: 'online' },
    };
    await withFormSubmission(form, async () => {
      try {
        const result = id ? await Bookmarks.updateBookmark(id, payload) : await Bookmarks.createBookmark(payload);
        state.library = result.library;
        if (!id) state.activeCategoryId = result.result.categoryId;
        closeBookmarkDialog(document.getElementById('bookmarkEditorDialog'));
        renderAll();
        showToast(t(id ? 'saved' : 'addedBookmark'));
      } catch (saveError) {
        error.textContent = saveError?.message === 'bookmark-url-invalid' ? t('invalidUrl') : t('storageError');
      }
    });
  }

  async function saveFolder(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const id = document.getElementById('folderEditorId').value;
    const name = document.getElementById('folderName').value.trim();
    const error = document.getElementById('folderFormError');
    if (!name) { error.textContent = t('requiredName'); return; }
    await withFormSubmission(form, async () => {
      try {
        const categoryMode = state.folderEditorMode === 'category';
        const payload = {
          name,
          ...(categoryMode
            ? { icon: state.categoryIcon }
            : { layout: state.folderLayout, categoryId: document.getElementById('folderCategory').value }),
        };
        const result = categoryMode
          ? (id ? await Bookmarks.updateCategory(id, payload) : await Bookmarks.createCategory(payload))
          : (id ? await Bookmarks.updateFolder(id, payload) : await Bookmarks.createFolder(payload));
        state.library = result.library;
        if (categoryMode && !id) state.activeCategoryId = result.result.id;
        closeBookmarkDialog(document.getElementById('folderEditorDialog'));
        renderAll();
        showToast(t(id ? 'saved' : (categoryMode ? 'addedCategory' : 'addedFolder')));
      } catch {
        error.textContent = t('storageError');
      }
    });
  }

  async function saveMove(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const pending = state.pendingMove;
    if (!pending || pending.kind !== 'bookmark') return;
    await withFormSubmission(form, async () => {
      try {
        const result = await Bookmarks.moveBookmark(pending.id, {
          categoryId: document.getElementById('bookmarkMoveCategory').value,
          folderId: document.getElementById('bookmarkMoveFolder').value || null,
        });
        state.library = result.library;
        state.pendingMove = null;
        closeBookmarkDialog(document.getElementById('bookmarkMoveDialog'));
        closeBookmarkDialog(document.getElementById('bookmarkFolderDialog'));
        renderAll();
        showToast(t('moved'));
      } catch {
        document.getElementById('bookmarkMoveError').textContent = t('storageError');
      }
    });
  }

  async function confirmDelete(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const pending = state.pendingDelete;
    if (!pending) return;
    const deletingActiveCategory = pending.kind === 'category' && state.activeCategoryId === pending.id;
    const categoryContentMode = pending.kind === 'category' && pending.hasContents
      ? (event.submitter?.dataset.categoryDeleteMode || 'move-to-unfiled')
      : 'move-to-unfiled';
    await withFormSubmission(form, async () => {
      try {
        const result = pending.kind === 'category'
          ? await Bookmarks.deleteCategory(pending.id, { contentMode: categoryContentMode })
          : (pending.kind === 'folder' ? await Bookmarks.deleteFolder(pending.id) : await Bookmarks.deleteBookmark(pending.id));
        state.undoSnapshot = result.previous;
        state.library = result.library;
        state.pendingDelete = null;
        if (deletingActiveCategory) state.activeCategoryId = UNFILED_CATEGORY_ID;
        closeBookmarkDialog(document.getElementById('bookmarkConfirmDialog'));
        closeBookmarkDialog(document.getElementById('bookmarkFolderDialog'));
        renderAll();
        showToast(t('deleted'), { undo: true });
      } catch {
        showToast(t('storageError'));
      }
    });
  }

  async function undoDelete() {
    if (!state.undoSnapshot) return;
    try {
      const result = await Bookmarks.restoreLibrary(state.undoSnapshot);
      state.library = result.library;
      state.undoSnapshot = null;
      renderAll();
      showToast(t('restored'));
    } catch {
      showToast(t('storageError'));
    }
  }

  async function changeView(viewMode) {
    const result = await Bookmarks.setViewMode(viewMode);
    state.library = result.library;
    renderViewToggle();
    renderMain();
  }

  async function handleContextAction(button) {
    const { contextAction, kind, id } = button.dataset;
    closeFloatingMenus();
    if (contextAction === 'open') {
      if (kind === 'folder') openFolderViewer(id);
      else await openBookmark(id);
      return;
    }
    if (contextAction === 'edit') {
      if (kind === 'category') openFolderEditor(categoryById(id), { category: true });
      else if (kind === 'folder') openFolderEditor(folderById(id), { category: false });
      else openBookmarkEditor(bookmarkById(id));
      return;
    }
    if (contextAction === 'move' && kind === 'bookmark') { openMoveDialog(id); return; }
    if (contextAction === 'delete') openDeleteConfirm(kind, id);
  }

  async function handleClick(event) {
    if (closeDialogFromBlankArea(event)) return;

    const floatingMenu = event.target.closest('#bookmarkAddMenu, #bookmarkContextMenu');
    const floatingMenuTrigger = event.target.closest('[data-bookmark-action="open-add-menu"], [data-bookmark-action="menu"]');
    if (!floatingMenu && !floatingMenuTrigger) closeFloatingMenus();

    const closeButton = event.target.closest('[data-close-dialog]');
    if (closeButton) { closeBookmarkDialog(document.getElementById(closeButton.dataset.closeDialog)); return; }
    const contextAction = event.target.closest('[data-context-action]');
    if (contextAction) { await handleContextAction(contextAction); return; }
    const color = event.target.closest('[data-icon-color]');
    if (color) {
      state.iconColor = color.dataset.iconColor;
      renderColorPalette();
      renderIconPreview();
      return;
    }
    const categoryIcon = event.target.closest('[data-category-icon]');
    if (categoryIcon) { setCategoryIcon(categoryIcon.dataset.categoryIcon); return; }
    const iconMode = event.target.closest('[data-icon-mode]');
    if (iconMode) { setIconMode(iconMode.dataset.iconMode); return; }
    const layout = event.target.closest('[data-folder-layout]');
    if (layout) { setFolderLayout(layout.dataset.folderLayout); return; }
    const view = event.target.closest('[data-bookmark-view]');
    if (view) { await changeView(view.dataset.bookmarkView); return; }
    const actionElement = event.target.closest('[data-bookmark-action]');
    if (!actionElement) return;
    const action = actionElement.dataset.bookmarkAction;
    if (action === 'open-add-menu') {
      openAddMenu(actionElement);
    } else if (action === 'add-bookmark') {
      closeFloatingMenus();
      document.getElementById('bookmarkFolderDialog')?.close();
      openBookmarkEditor(null, { categoryId: actionElement.dataset.categoryId || state.activeCategoryId, folderId: actionElement.dataset.folderId || '' });
    } else if (action === 'add-folder') {
      closeFloatingMenus();
      openFolderEditor(null, { category: false, categoryId: actionElement.dataset.categoryId || state.activeCategoryId });
    } else if (action === 'add-category') {
      closeFloatingMenus();
      openFolderEditor(null, { category: true });
    } else if (action === 'open-settings') {
      closeFloatingMenus();
      openBookmarkSettings();
    } else if (action === 'import-browser-bookmarks') {
      await importBrowserBookmarks();
    } else if (action === 'remove-bookmark-permission') {
      await removeBookmarkPermission();
    } else if (action === 'select-category') {
      state.activeCategoryId = actionElement.dataset.categoryId;
      state.query = '';
      const search = document.getElementById('bookmarkSearch');
      if (search) search.value = '';
      renderAll();
    } else if (action === 'open') {
      await openBookmark(actionElement.dataset.bookmarkId);
    } else if (action === 'open-folder') {
      openFolderViewer(actionElement.dataset.folderId);
    } else if (action === 'edit-folder-name') {
      beginFolderViewerRename();
    } else if (action === 'folder-page') {
      state.folderPages.set(actionElement.dataset.folderId, Number(actionElement.dataset.page) || 0);
      renderMain();
      document.querySelector(`[data-bookmark-action="folder-page"][data-folder-id="${CSS.escape(actionElement.dataset.folderId)}"][data-page="${Number(actionElement.dataset.page) || 0}"]`)?.focus();
    } else if (action === 'menu') {
      openContextMenu(actionElement.dataset.kind, actionElement.dataset.id, actionElement);
    }
  }

  function handleContextMenu(event) {
    const bookmark = event.target.closest('[data-bookmark-id]');
    const folder = event.target.closest('[data-folder-id]');
    const category = event.target.closest('[data-category-id]');
    if (!bookmark && !folder && !category) return;
    event.preventDefault();
    if (bookmark) openContextMenu('bookmark', bookmark.dataset.bookmarkId, bookmark, { x: event.clientX, y: event.clientY });
    else if (folder) openContextMenu('folder', folder.dataset.folderId, folder, { x: event.clientX, y: event.clientY });
    else if (category && !categoryById(category.dataset.categoryId)?.system) {
      openContextMenu('category', category.dataset.categoryId, category, { x: event.clientX, y: event.clientY });
    }
  }

  function handleWheel(event) {
    const board = event.target.closest('.bookmark-folder-board');
    if (!board) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX) || Math.abs(event.deltaY) < 2) return;
    const folderId = board.dataset.folderId;
    const capacity = Number(board.dataset.capacity) || 2;
    const pages = Math.max(1, Math.ceil(folderItems(folderId).length / capacity));
    const current = state.folderPages.get(folderId) || 0;
    const next = event.deltaY > 0 ? current + 1 : current - 1;
    if (next < 0 || next >= pages) return;
    event.preventDefault();
    state.folderPages.set(folderId, next);
    renderMain();
    document.querySelector(`.bookmark-folder-board[data-folder-id="${CSS.escape(folderId)}"]`)?.focus({ preventScroll: true });
  }

  function shouldIgnoreWorkspaceWheel(event) {
    const target = event.target;
    if (!(target instanceof Element)) return true;
    return Boolean(target.closest('dialog[open], input, textarea, select, [contenteditable="true"], [role="textbox"]'));
  }

  function handleWorkspaceWheel(event) {
    if (shouldIgnoreWorkspaceWheel(event)) return;
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 2) return;
    event.preventDefault();
    if (Date.now() < workspaceSwipeLockedUntil) return;
    if (workspaceSwipeDelta && Math.sign(workspaceSwipeDelta) !== Math.sign(event.deltaX)) {
      workspaceSwipeDelta = 0;
    }
    workspaceSwipeDelta += event.deltaX;
    clearTimeout(workspaceSwipeTimer);
    workspaceSwipeTimer = setTimeout(() => { workspaceSwipeDelta = 0; }, 180);
    if (Math.abs(workspaceSwipeDelta) < 64) return;

    const next = workspaceSwipeDelta > 0 ? 'bookmarks' : 'tabs';
    workspaceSwipeDelta = 0;
    if (document.body.dataset.workspace === next) return;
    workspaceSwipeLockedUntil = Date.now() + 420;
    setWorkspace(next);
  }

  function handleDragStart(event) {
    const bookmarkElement = event.target.closest('[data-bookmark-drag]');
    const categoryElement = event.target.closest('[data-category-drag]');
    const folderElement = event.target.closest('[data-folder-drag]');
    const bookmark = bookmarkElement && bookmarkById(bookmarkElement.dataset.bookmarkDrag);
    const folder = folderElement && folderById(folderElement.dataset.folderDrag);
    const category = categoryElement && categoryById(categoryElement.dataset.categoryDrag);
    if (bookmark) {
      state.draggedItem = {
        kind: 'bookmark', id: bookmark.id, categoryId: bookmark.categoryId,
        folderId: bookmark.folderId || '', itemKey: bookmarkElement.dataset.categoryItemKey || '',
      };
    } else if (category && !category.system) {
      state.draggedItem = { kind: 'category', id: category.id };
    } else if (folder) {
      state.draggedItem = {
        kind: 'folder', id: folder.id, categoryId: folder.categoryId,
        itemKey: folderElement.dataset.categoryItemKey || Bookmarks.folderKey(folder.id),
      };
    } else return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', `${state.draggedItem.kind}:${state.draggedItem.id}`);
    if (state.draggedItem.kind === 'bookmark' && document.getElementById('bookmarkFolderDialog')?.open) {
      document.getElementById('bookmarkFolderDialog').classList.add('dragging-bookmark');
    }
  }

  function dragTargetFromEvent(event) {
    const direct = event.target.closest?.('[data-folder-bookmark-drop], [data-folder-drop], [data-category-drop], [data-category-item-key]');
    if (direct) return direct;
    const dialog = event.target.closest?.('[data-folder-exit-drop]');
    return dialog && event.target === dialog ? dialog : null;
  }

  function handleDragOver(event) {
    const target = dragTargetFromEvent(event);
    if (!target || !state.draggedItem) return;
    event.preventDefault();
    document.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
    target.classList.add('drag-over');
  }

  async function handleDrop(event) {
    const target = dragTargetFromEvent(event);
    const dragged = state.draggedItem;
    const openFolderDialog = document.getElementById('bookmarkFolderDialog');
    const openFolderId = openFolderDialog?.open ? openFolderDialog.dataset.folderId : '';
    document.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
    if (!target || !dragged) return;
    event.preventDefault();
    try {
      let result = null;
      if (target.matches('[data-folder-exit-drop]') && dragged.kind === 'bookmark') {
        const sourceFolder = folderById(target.dataset.folderId);
        if (sourceFolder && dragged.folderId === sourceFolder.id) {
          result = await Bookmarks.moveBookmark(dragged.id, { categoryId: sourceFolder.categoryId, folderId: null });
          target.close();
        }
      } else if (target.dataset.folderBookmarkDrop && dragged.kind === 'bookmark') {
        const targetBookmark = bookmarkById(target.dataset.folderBookmarkDrop);
        if (targetBookmark?.folderId && dragged.folderId === targetBookmark.folderId) {
          result = await Bookmarks.reorderFolderBookmarks(targetBookmark.folderId, dragged.id, targetBookmark.id);
        }
      } else if (target.dataset.folderDrop && dragged.kind === 'bookmark') {
        const targetFolder = folderById(target.dataset.folderDrop);
        if (targetFolder && dragged.folderId !== targetFolder.id) {
          result = await Bookmarks.moveBookmark(dragged.id, { categoryId: targetFolder.categoryId, folderId: targetFolder.id });
        }
      } else if (target.dataset.categoryDrop) {
        const categoryId = target.dataset.categoryDrop;
        if (dragged.kind === 'bookmark' && (dragged.categoryId !== categoryId || dragged.folderId)) {
          result = await Bookmarks.moveBookmark(dragged.id, { categoryId, folderId: null });
        } else if (dragged.kind === 'folder' && dragged.categoryId !== categoryId) {
          result = await Bookmarks.moveFolder(dragged.id, categoryId);
        } else if (dragged.kind === 'category' && dragged.id !== categoryId) {
          result = await Bookmarks.reorderCategories(dragged.id, categoryId);
        }
      } else if (target.dataset.categoryItemKey && dragged.itemKey && dragged.categoryId === target.dataset.categoryId) {
        result = await Bookmarks.reorderCategoryItems(target.dataset.categoryId, dragged.itemKey, target.dataset.categoryItemKey);
      }
      if (result) state.library = result.library;
      renderAll();
      if (result && openFolderId && openFolderDialog?.open) {
        openFolderDialog.close();
        openFolderViewer(openFolderId);
      }
      if (result) showToast(t('moved'));
    } catch {
      showToast(t('storageError'));
    } finally {
      state.draggedItem = null;
      document.getElementById('bookmarkFolderDialog')?.classList.remove('dragging-bookmark');
    }
  }

  function handleKeydown(event) {
    const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || event.target.isContentEditable;
    const bookmarkOpen = document.body.dataset.workspace === 'bookmarks';
    if (!editing && !document.querySelector('dialog[open]')) {
      const focusedControl = document.activeElement?.closest?.('button, a, [role="button"], [role="tab"], [role="slider"]');
      if (!focusedControl && event.key === 'ArrowLeft' && !bookmarkOpen) {
        event.preventDefault();
        setWorkspace('bookmarks');
        return;
      }
      if (!focusedControl && event.key === 'ArrowRight' && bookmarkOpen) {
        event.preventDefault();
        setWorkspace('tabs');
        return;
      }
      if (event.key === '/' && bookmarkOpen) {
        event.preventDefault();
        document.getElementById('bookmarkSearch')?.focus();
      }
    }
    if (event.key === 'Escape') closeFloatingMenus();
  }

  function handleDialogEscape(event) {
    if (event.key !== 'Escape') return;
    const dialog = document.querySelector('.bookmark-editor-dialog[open], .bookmark-folder-dialog[open], .bookmark-confirm-dialog[open]');
    if (!dialog) return;
    if (event.target.id === 'bookmarkFolderDialogTitleInput' && dialog.id === 'bookmarkFolderDialog') {
      const folder = folderById(dialog.dataset.folderId);
      if (folder) endFolderViewerRename(folder.name);
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    closeBookmarkDialog(dialog);
  }

  async function init() {
    document.body.dataset.workspace = 'tabs';
    try {
      await Storage?.migrateStorage?.();
      const privacy = await Storage?.getPrivacySettings?.();
      state.externalFavicons = privacy?.externalFavicons !== false;
      state.library = await Bookmarks.getLibrary();
    } catch {
      showToast(t('storageError'));
    }
    renderAll();

    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('keydown', handleDialogEscape, true);
    document.addEventListener('wheel', handleWheel, { passive: false });
    document.addEventListener('dragstart', handleDragStart);
    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('drop', handleDrop);
    document.addEventListener('dragend', () => {
      state.draggedItem = null;
      document.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
      document.getElementById('bookmarkFolderDialog')?.classList.remove('dragging-bookmark');
    });
    document.addEventListener('input', event => {
      if (event.target.id === 'bookmarkSearch') {
        state.query = event.target.value.trim();
        renderMain();
      }
      if (['bookmarkUrl', 'bookmarkName', 'bookmarkIconText'].includes(event.target.id)) renderIconPreview();
      if (event.target.id === 'folderName' && state.folderEditorMode === 'category' && !state.categoryIconTouched) {
        setCategoryIcon(Storage?.suggestBookmarkFolderIcon?.(event.target.value) || 'folder', { touched: false });
      }
    });
    document.addEventListener('change', event => {
      if (event.target.id === 'bookmarkCategory') {
        updateFolderOptions('bookmarkFolder', event.target.value);
      }
      if (event.target.id === 'bookmarkMoveCategory') {
        updateFolderOptions('bookmarkMoveFolder', event.target.value);
      }
    });
    document.addEventListener('error', event => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.dataset.bookmarkFallback) return;
      const icon = image.closest('.bookmark-app-icon');
      if (icon) {
        icon.classList.add('icon-online-fallback');
        icon.dataset.fallback = image.dataset.bookmarkFallback;
        image.remove();
      } else {
        const mini = image.closest('.bookmark-mini-icon');
        if (mini) { mini.textContent = image.dataset.bookmarkFallback; mini.style.setProperty('--mini-color', '#6681b4'); }
      }
    }, true);
    document.addEventListener('super-tab-out-language-change', renderAll);
    document.addEventListener('wheel', handleWorkspaceWheel, { passive: false });
    document.getElementById('bookmarkEditorForm')?.addEventListener('submit', saveBookmark);
    document.getElementById('folderEditorForm')?.addEventListener('submit', saveFolder);
    document.getElementById('bookmarkFolderRenameForm')?.addEventListener('submit', async event => {
      await saveFolderViewerName(event);
    });
    document.getElementById('bookmarkFolderDialogTitleInput')?.addEventListener('change', saveFolderViewerName);
    document.getElementById('bookmarkMoveForm')?.addEventListener('submit', saveMove);
    document.getElementById('bookmarkConfirmForm')?.addEventListener('submit', confirmDelete);
    document.getElementById('bookmarkToastUndo')?.addEventListener('click', undoDelete);
    await openCapturedBookmarkDraft();

    if (chrome?.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.bookmarkLibrary) refreshLibrary();
        if (changes.privacySettings) {
          state.externalFavicons = changes.privacySettings.newValue?.externalFavicons !== false;
          renderAll();
        }
      });
    }
    if (chrome?.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(message => {
        if (message?.type !== 'toggle-workspace') return;
        chrome.tabs.getCurrent().then(currentTab => {
          if (currentTab?.id !== message.targetTabId) return;
          setWorkspace(document.body.dataset.workspace === 'bookmarks' ? 'tabs' : 'bookmarks');
        }).catch(() => {});
      });
    }
  }

  init();
})();
