/* BrowseLoom bookmark library service.
   Owns the plugin-local shortcut model and keeps mutations serial. */
(function (global) {
  'use strict';

  const StorageService = global.SuperTabOutStorage;
  const HOME_CATEGORY_ID = StorageService?.HOME_CATEGORY_ID || 'category-home';
  const UNFILED_CATEGORY_ID = StorageService?.UNFILED_CATEGORY_ID || 'category-unfiled';

  function nowIso() {
    return new Date().toISOString();
  }

  function clone(value) {
    if (typeof structuredClone === 'function') return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function createId(prefix) {
    const random = global.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${random}`;
  }

  function normalizeUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol)) return '';
      return url.href;
    } catch {
      return '';
    }
  }

  function normalizeTitle(value, fallback = '') {
    const title = typeof value === 'string' ? value.trim() : '';
    return (title || fallback).slice(0, 160);
  }

  function bookmarkKey(id) {
    return `bookmark:${id}`;
  }

  function folderKey(id) {
    return `folder:${id}`;
  }

  function browserImportId(kind, nativeId) {
    return `${kind}-browser-${encodeURIComponent(String(nativeId ?? 'unknown'))}`;
  }

  function browserImportRoots(tree) {
    const nodes = Array.isArray(tree) ? tree.filter(node => node && typeof node === 'object') : [];
    if (nodes.length === 1 && !nodes[0].url && !String(nodes[0].title || '').trim() && Array.isArray(nodes[0].children)) {
      return nodes[0].children;
    }
    return nodes;
  }

  async function getLibrary() {
    if (!StorageService?.getBookmarkLibrary) {
      const timestamp = nowIso();
      return {
        version: 3,
        viewMode: 'grid',
        categories: [
          { id: HOME_CATEGORY_ID, name: 'Home', icon: 'home', system: 'home', order: 0, itemOrder: [], createdAt: timestamp, updatedAt: timestamp },
          { id: UNFILED_CATEGORY_ID, name: 'Unfiled', icon: 'archive', system: 'unfiled', order: 1, itemOrder: [], createdAt: timestamp, updatedAt: timestamp },
        ],
        folders: [],
        bookmarks: [],
      };
    }
    return StorageService.getBookmarkLibrary();
  }

  async function saveLibrary(library) {
    if (!StorageService?.setBookmarkLibrary) return library;
    return StorageService.setBookmarkLibrary(library);
  }

  function mutate(updater) {
    if (StorageService?.mutateBookmarkLibrary) {
      return StorageService.mutateBookmarkLibrary(updater);
    }
    return Promise.resolve().then(async () => {
      const current = await getLibrary();
      const next = clone(current);
      const result = await updater(next, current);
      const library = await saveLibrary(next);
      return { library, result, previous: current };
    });
  }

  function categoryById(library, id) {
    return library.categories.find(category => category.id === id) || null;
  }

  function folderById(library, id) {
    return library.folders.find(folder => folder.id === id) || null;
  }

  function removeCategoryItem(library, categoryId, key) {
    const category = categoryById(library, categoryId);
    if (category) category.itemOrder = category.itemOrder.filter(item => item !== key);
  }

  function appendCategoryItem(library, categoryId, key) {
    const category = categoryById(library, categoryId) || categoryById(library, UNFILED_CATEGORY_ID);
    if (!category) return;
    category.itemOrder = category.itemOrder.filter(item => item !== key);
    category.itemOrder.push(key);
  }

  function reindexFolderBookmarks(library, folderId) {
    library.bookmarks
      .filter(bookmark => bookmark.folderId === folderId)
      .sort((a, b) => a.order - b.order)
      .forEach((bookmark, index) => { bookmark.order = index; });
  }

  async function createCategory(input = {}) {
    const name = normalizeTitle(input.name);
    if (!name) throw new Error('category-name-required');
    return mutate(library => {
      const timestamp = nowIso();
      const unfiledIndex = Math.max(1, library.categories.findIndex(category => category.id === UNFILED_CATEGORY_ID));
      const category = {
        id: createId('category'),
        name,
        icon: StorageService?.normalizeBookmarkFolderIcon?.(input.icon, name) || 'folder',
        system: '',
        order: unfiledIndex,
        itemOrder: [],
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      library.categories.splice(unfiledIndex, 0, category);
      library.categories.forEach((item, index) => { item.order = index; });
      return category;
    });
  }

  async function updateCategory(id, patch = {}) {
    return mutate(library => {
      const category = categoryById(library, id);
      if (!category) throw new Error('category-not-found');
      if (category.system) throw new Error('category-system-readonly');
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        const name = normalizeTitle(patch.name);
        if (!name) throw new Error('category-name-required');
        category.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'icon')) {
        category.icon = StorageService?.normalizeBookmarkFolderIcon?.(patch.icon, category.name) || category.icon || 'folder';
      }
      category.updatedAt = nowIso();
      return category;
    });
  }

  async function createFolder(input = {}) {
    const name = normalizeTitle(input.name);
    if (!name) throw new Error('folder-name-required');
    return mutate(library => {
      const categoryId = categoryById(library, input.categoryId)?.id || HOME_CATEGORY_ID;
      const timestamp = nowIso();
      const folder = {
        id: createId('folder'),
        name,
        icon: StorageService?.normalizeBookmarkFolderIcon?.(input.icon, name) || 'folder',
        categoryId,
        layout: ['1x1', '2x1', '2x2'].includes(input.layout) ? input.layout : '1x1',
        order: library.folders.filter(item => item.categoryId === categoryId).length,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      library.folders.push(folder);
      appendCategoryItem(library, categoryId, folderKey(folder.id));
      return folder;
    });
  }

  async function updateFolder(id, patch = {}) {
    return mutate(library => {
      const folder = library.folders.find(item => item.id === id);
      if (!folder) throw new Error('folder-not-found');
      if (Object.prototype.hasOwnProperty.call(patch, 'name')) {
        const name = normalizeTitle(patch.name);
        if (!name) throw new Error('folder-name-required');
        folder.name = name;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'icon')) {
        folder.icon = StorageService?.normalizeBookmarkFolderIcon?.(patch.icon, folder.name) || folder.icon || 'folder';
      }
      if (['1x1', '2x1', '2x2'].includes(patch.layout)) folder.layout = patch.layout;
      if (Object.prototype.hasOwnProperty.call(patch, 'categoryId')) {
        const nextCategoryId = categoryById(library, patch.categoryId)?.id || UNFILED_CATEGORY_ID;
        if (nextCategoryId !== folder.categoryId) {
          removeCategoryItem(library, folder.categoryId, folderKey(folder.id));
          folder.categoryId = nextCategoryId;
          library.bookmarks.filter(bookmark => bookmark.folderId === folder.id).forEach(bookmark => {
            bookmark.categoryId = nextCategoryId;
            bookmark.updatedAt = nowIso();
          });
          appendCategoryItem(library, nextCategoryId, folderKey(folder.id));
        }
      }
      folder.updatedAt = nowIso();
      return folder;
    });
  }

  async function createBookmark(input = {}) {
    const url = normalizeUrl(input.url);
    if (!url) throw new Error('bookmark-url-invalid');
    let hostname = url;
    try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
    const title = normalizeTitle(input.title, hostname);
    return mutate(library => {
      const folder = folderById(library, input.folderId);
      const folderId = folder?.id || null;
      const categoryId = folder?.categoryId || categoryById(library, input.categoryId)?.id || HOME_CATEGORY_ID;
      const timestamp = nowIso();
      const bookmark = {
        id: createId('bookmark'),
        title,
        url,
        note: typeof input.note === 'string' ? input.note.trim().slice(0, 500) : '',
        categoryId,
        folderId,
        icon: input.icon?.type === 'color'
          ? { type: 'color', color: input.icon.color, text: input.icon.text || title.slice(0, 2) }
          : { type: 'online' },
        order: library.bookmarks.filter(item => item.folderId === folderId).length,
        openCount: 0,
        lastOpenedAt: '',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      library.bookmarks.push(bookmark);
      if (!folderId) appendCategoryItem(library, categoryId, bookmarkKey(bookmark.id));
      return bookmark;
    });
  }

  async function importBrowserTree(tree) {
    const roots = browserImportRoots(tree);
    return mutate(library => {
      const timestamp = nowIso();
      const result = {
        addedCategories: 0,
        addedFolders: 0,
        addedBookmarks: 0,
        existingBookmarks: 0,
        skippedBookmarks: 0,
        totalBookmarks: 0,
      };

      function ensureCategory(node) {
        const id = browserImportId('category', node.id);
        let category = categoryById(library, id);
        if (category) return category;
        const name = normalizeTitle(node.title, 'Browser bookmarks');
        const unfiledIndex = Math.max(1, library.categories.findIndex(item => item.id === UNFILED_CATEGORY_ID));
        category = {
          id,
          name,
          icon: StorageService?.normalizeBookmarkFolderIcon?.('', name) || 'folder',
          system: '',
          order: unfiledIndex,
          itemOrder: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        library.categories.splice(unfiledIndex, 0, category);
        library.categories.forEach((item, index) => { item.order = index; });
        result.addedCategories += 1;
        return category;
      }

      function ensureFolder(node, category) {
        const id = browserImportId('folder', node.id);
        let folder = folderById(library, id);
        if (folder) return folder;
        const name = normalizeTitle(node.title, 'Untitled folder');
        folder = {
          id,
          name,
          icon: StorageService?.normalizeBookmarkFolderIcon?.('', name) || 'folder',
          categoryId: category.id,
          layout: '1x1',
          order: library.folders.filter(item => item.categoryId === category.id).length,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        library.folders.push(folder);
        appendCategoryItem(library, category.id, folderKey(folder.id));
        result.addedFolders += 1;
        return folder;
      }

      function addBookmark(node, category, folder = null) {
        result.totalBookmarks += 1;
        const url = normalizeUrl(node.url);
        if (!url) {
          result.skippedBookmarks += 1;
          return;
        }
        const id = browserImportId('bookmark', node.id);
        if (library.bookmarks.some(bookmark => bookmark.id === id)) {
          result.existingBookmarks += 1;
          return;
        }
        let hostname = url;
        try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}
        const destinationFolder = folder && folderById(library, folder.id);
        const categoryId = destinationFolder?.categoryId || category.id;
        const folderId = destinationFolder?.id || null;
        const bookmark = {
          id,
          title: normalizeTitle(node.title, hostname),
          url,
          note: '',
          categoryId,
          folderId,
          icon: { type: 'online' },
          order: folderId
            ? library.bookmarks.filter(item => item.folderId === folderId).length
            : library.bookmarks.filter(item => item.categoryId === categoryId && !item.folderId).length,
          openCount: 0,
          lastOpenedAt: '',
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        library.bookmarks.push(bookmark);
        if (!folderId) appendCategoryItem(library, categoryId, bookmarkKey(bookmark.id));
        result.addedBookmarks += 1;
      }

      function importChildren(nodes, category, destinationFolder = null) {
        for (const node of Array.isArray(nodes) ? nodes : []) {
          if (!node || typeof node !== 'object') continue;
          if (typeof node.url === 'string' && node.url) {
            addBookmark(node, category, destinationFolder);
            continue;
          }
          const folder = ensureFolder(node, category);
          // Native bookmark trees can be arbitrarily deep. BrowseLoom keeps
          // every imported folder as a direct child of the browser root category,
          // preserving the original folder title without adding a path prefix.
          importChildren(node.children, category, folder);
        }
      }

      for (const root of roots) {
        if (!root || typeof root !== 'object') continue;
        if (typeof root.url === 'string' && root.url) {
          const fallback = categoryById(library, UNFILED_CATEGORY_ID);
          if (fallback) addBookmark(root, fallback);
          continue;
        }
        const category = ensureCategory(root);
        importChildren(root.children, category);
      }

      return result;
    });
  }

  async function updateBookmark(id, patch = {}) {
    return mutate(library => {
      const bookmark = library.bookmarks.find(item => item.id === id);
      if (!bookmark) throw new Error('bookmark-not-found');
      if (Object.prototype.hasOwnProperty.call(patch, 'url')) {
        const url = normalizeUrl(patch.url);
        if (!url) throw new Error('bookmark-url-invalid');
        bookmark.url = url;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'title')) {
        const title = normalizeTitle(patch.title);
        if (!title) throw new Error('bookmark-title-required');
        bookmark.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'note')) {
        bookmark.note = typeof patch.note === 'string' ? patch.note.trim().slice(0, 500) : '';
      }
      if (patch.icon?.type === 'color') {
        bookmark.icon = { type: 'color', color: patch.icon.color, text: patch.icon.text || bookmark.title.slice(0, 2) };
      } else if (patch.icon?.type === 'online') {
        bookmark.icon = { type: 'online' };
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'categoryId') || Object.prototype.hasOwnProperty.call(patch, 'folderId')) {
        const previousCategoryId = bookmark.categoryId;
        const previousFolderId = bookmark.folderId;
        const requestedFolder = Object.prototype.hasOwnProperty.call(patch, 'folderId') ? folderById(library, patch.folderId) : folderById(library, bookmark.folderId);
        const requestedCategoryId = categoryById(library, patch.categoryId)?.id || bookmark.categoryId || HOME_CATEGORY_ID;
        const nextFolderId = requestedFolder?.id || null;
        const nextCategoryId = requestedFolder?.categoryId || requestedCategoryId;
        const destinationChanged = nextCategoryId !== previousCategoryId || nextFolderId !== previousFolderId;
        if (destinationChanged) {
          if (!previousFolderId) removeCategoryItem(library, previousCategoryId, bookmarkKey(bookmark.id));
          bookmark.categoryId = nextCategoryId;
          bookmark.folderId = nextFolderId;
          if (nextFolderId) {
            bookmark.order = library.bookmarks.filter(item => item.id !== bookmark.id && item.folderId === nextFolderId).length;
          } else {
            bookmark.order = library.bookmarks.filter(item => item.id !== bookmark.id && item.categoryId === nextCategoryId && !item.folderId).length;
            appendCategoryItem(library, nextCategoryId, bookmarkKey(bookmark.id));
          }
          if (previousFolderId && previousFolderId !== nextFolderId) reindexFolderBookmarks(library, previousFolderId);
        }
      }
      bookmark.updatedAt = nowIso();
      return bookmark;
    });
  }

  async function deleteBookmark(id) {
    return mutate(library => {
      const index = library.bookmarks.findIndex(item => item.id === id);
      if (index === -1) throw new Error('bookmark-not-found');
      const [bookmark] = library.bookmarks.splice(index, 1);
      if (bookmark.folderId) reindexFolderBookmarks(library, bookmark.folderId);
      else removeCategoryItem(library, bookmark.categoryId, bookmarkKey(id));
      return { kind: 'bookmark', bookmark };
    });
  }

  async function deleteFolder(id) {
    return mutate(library => {
      const index = library.folders.findIndex(item => item.id === id);
      if (index === -1) throw new Error('folder-not-found');
      const [folder] = library.folders.splice(index, 1);
      const bookmarks = library.bookmarks.filter(item => item.folderId === id);
      removeCategoryItem(library, folder.categoryId, folderKey(id));
      bookmarks.sort((a, b) => a.order - b.order).forEach(bookmark => {
        bookmark.folderId = null;
        bookmark.categoryId = folder.categoryId;
        bookmark.updatedAt = nowIso();
        appendCategoryItem(library, folder.categoryId, bookmarkKey(bookmark.id));
      });
      return { kind: 'folder', folder, movedBookmarks: bookmarks };
    });
  }

  async function deleteCategory(id, { contentMode = 'move-to-unfiled' } = {}) {
    const normalizedContentMode = contentMode === 'delete-all' ? 'delete-all' : 'move-to-unfiled';
    return mutate(library => {
      const index = library.categories.findIndex(category => category.id === id);
      if (index === -1) throw new Error('category-not-found');
      const category = library.categories[index];
      if (category.system) throw new Error('category-system-readonly');
      const targetId = UNFILED_CATEGORY_ID;
      const folders = library.folders.filter(folder => folder.categoryId === id);
      const folderIds = new Set(folders.map(folder => folder.id));
      const bookmarks = library.bookmarks.filter(bookmark => bookmark.categoryId === id || folderIds.has(bookmark.folderId));
      if (normalizedContentMode === 'delete-all') {
        const bookmarkIds = new Set(bookmarks.map(bookmark => bookmark.id));
        library.folders = library.folders.filter(folder => !folderIds.has(folder.id));
        library.bookmarks = library.bookmarks.filter(bookmark => !bookmarkIds.has(bookmark.id));
      } else {
        for (const key of category.itemOrder) {
          if (key.startsWith('folder:')) {
            const folder = folders.find(item => item.id === key.slice('folder:'.length));
            if (folder) appendCategoryItem(library, targetId, key);
          } else {
            const bookmark = bookmarks.find(item => item.id === key.slice('bookmark:'.length) && !item.folderId);
            if (bookmark) appendCategoryItem(library, targetId, key);
          }
        }
        folders.forEach(folder => { folder.categoryId = targetId; folder.updatedAt = nowIso(); });
        bookmarks.forEach(bookmark => { bookmark.categoryId = targetId; bookmark.updatedAt = nowIso(); });
      }
      library.categories.splice(index, 1);
      library.categories.forEach((item, order) => { item.order = order; });
      return { kind: 'category', contentMode: normalizedContentMode, category, folders, bookmarks };
    });
  }

  async function restoreLibrary(snapshot) {
    const previous = clone(snapshot);
    return mutate(library => {
      Object.keys(library).forEach(key => delete library[key]);
      Object.assign(library, previous);
      return true;
    });
  }

  async function setViewMode(viewMode) {
    return mutate(library => {
      library.viewMode = viewMode === 'list' ? 'list' : 'grid';
      return library.viewMode;
    });
  }

  async function moveBookmark(id, location = {}) {
    return updateBookmark(id, {
      ...(Object.prototype.hasOwnProperty.call(location, 'categoryId') ? { categoryId: location.categoryId } : {}),
      ...(Object.prototype.hasOwnProperty.call(location, 'folderId') ? { folderId: location.folderId } : {}),
    });
  }

  async function moveFolder(id, categoryId) {
    return updateFolder(id, { categoryId });
  }

  async function reorderHome(sourceKey, targetKey) {
    return reorderCategoryItems(HOME_CATEGORY_ID, sourceKey, targetKey);
  }

  async function reorderCategoryItems(categoryId, sourceKey, targetKey) {
    return mutate(library => {
      const category = categoryById(library, categoryId);
      if (!category) return false;
      const sourceIndex = category.itemOrder.indexOf(sourceKey);
      const targetIndex = category.itemOrder.indexOf(targetKey);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return false;
      const [item] = category.itemOrder.splice(sourceIndex, 1);
      category.itemOrder.splice(targetIndex, 0, item);
      return true;
    });
  }

  async function reorderCategories(sourceId, targetId) {
    return mutate(library => {
      const sourceIndex = library.categories.findIndex(item => item.id === sourceId && !item.system);
      const targetIndex = library.categories.findIndex(item => item.id === targetId && !item.system);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return false;
      const [category] = library.categories.splice(sourceIndex, 1);
      library.categories.splice(targetIndex, 0, category);
      library.categories.forEach((item, order) => { item.order = order; });
      return true;
    });
  }

  async function reorderFolderBookmarks(folderId, sourceId, targetId) {
    return mutate(library => {
      const items = library.bookmarks.filter(bookmark => bookmark.folderId === folderId).sort((a, b) => a.order - b.order);
      const sourceIndex = items.findIndex(bookmark => bookmark.id === sourceId);
      const targetIndex = items.findIndex(bookmark => bookmark.id === targetId);
      if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return false;
      const [bookmark] = items.splice(sourceIndex, 1);
      items.splice(targetIndex, 0, bookmark);
      items.forEach((item, order) => { item.order = order; });
      return true;
    });
  }

  async function recordOpen(id) {
    return mutate(library => {
      const bookmark = library.bookmarks.find(item => item.id === id);
      if (!bookmark) throw new Error('bookmark-not-found');
      bookmark.openCount = Math.max(0, Number(bookmark.openCount) || 0) + 1;
      bookmark.lastOpenedAt = nowIso();
      bookmark.updatedAt = bookmark.updatedAt || bookmark.lastOpenedAt;
      return bookmark;
    });
  }

  function getFolderBookmarks(library, folderId) {
    return library.bookmarks
      .filter(bookmark => bookmark.folderId === folderId)
      .sort((a, b) => a.order - b.order);
  }

  function getCategoryFolders(library, categoryId) {
    return library.folders.filter(folder => folder.categoryId === categoryId);
  }

  function getCategoryBookmarks(library, categoryId, { rootOnly = false } = {}) {
    return library.bookmarks.filter(bookmark => bookmark.categoryId === categoryId && (!rootOnly || !bookmark.folderId));
  }

  function getRecentBookmarks(library, limit = 7) {
    return library.bookmarks
      .filter(bookmark => bookmark.lastOpenedAt)
      .sort((a, b) => String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
      .slice(0, limit);
  }

  function getPopularBookmarks(library, limit = 7) {
    return library.bookmarks
      .filter(bookmark => bookmark.openCount > 0)
      .sort((a, b) => b.openCount - a.openCount || String(b.lastOpenedAt).localeCompare(String(a.lastOpenedAt)))
      .slice(0, limit);
  }

  function searchLibrary(library, query) {
    const normalized = typeof query === 'string' ? query.trim().toLocaleLowerCase() : '';
    if (!normalized) return library.bookmarks.slice();
    return library.bookmarks.filter(bookmark => {
      let domain = '';
      try { domain = new URL(bookmark.url).hostname; } catch {}
      return [bookmark.title, bookmark.url, domain, bookmark.note]
        .some(value => String(value || '').toLocaleLowerCase().includes(normalized));
    });
  }

  const api = {
    normalizeUrl,
    bookmarkKey,
    folderKey,
    getLibrary,
    saveLibrary,
    createCategory,
    updateCategory,
    deleteCategory,
    createFolder,
    updateFolder,
    createBookmark,
    importBrowserTree,
    updateBookmark,
    deleteBookmark,
    deleteFolder,
    restoreLibrary,
    setViewMode,
    moveBookmark,
    moveFolder,
    reorderHome,
    reorderCategoryItems,
    reorderCategories,
    reorderFolderBookmarks,
    recordOpen,
    getFolderBookmarks,
    getCategoryFolders,
    getCategoryBookmarks,
    getRecentBookmarks,
    getPopularBookmarks,
    searchLibrary,
  };

  global.SuperTabOutBookmarks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
