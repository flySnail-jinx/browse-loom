/* Native bookmarks. Snapshots are disposable, never persisted. */
(function (global) {
  'use strict';

  function indexTree(tree) {
    const nodes = new Map();
    const roots = [];
    const stack = (Array.isArray(tree) ? tree : []).map(node => ({ node, parentId: null })).reverse();
    while (stack.length) {
      const { node, parentId } = stack.pop();
      if (!node || typeof node.id !== 'string' || nodes.has(node.id)) continue;
      const item = { ...node, parentId, children: [], searchText: `${node.title || ''}\n${node.url || ''}`.toLocaleLowerCase() };
      nodes.set(item.id, item);
      if (parentId === null) roots.push(item.id);
      else nodes.get(parentId)?.children.push(item.id);
      for (const child of [...(node.children || [])].reverse()) stack.push({ node: child, parentId: item.id });
    }
    // The API supplies one invisible root. Do not infer special folder IDs/names.
    const rootId = roots.length === 1 && !nodes.get(roots[0]).url ? roots[0] : null;
    return { nodes, roots: rootId === null ? roots : nodes.get(rootId).children, rootId };
  }

  function pathFor(index, id) {
    const path = [];
    const seen = new Set();
    let item = index.nodes.get(id);
    while (item && !seen.has(item.id)) {
      seen.add(item.id);
      if (item.id !== index.rootId) path.unshift(item);
      item = index.nodes.get(item.parentId);
    }
    return path;
  }

  function search(index, query) {
    const terms = String(query).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return [...index.nodes.values()].filter(node => node.id !== index.rootId && terms.every(term => node.searchText.includes(term)));
  }

  function canOpen(url) {
    try { return ['http:', 'https:'].includes(new URL(url).protocol); } catch { return false; }
  }

  function createReader(browser = global.chrome) {
    let state = { status: 'idle', index: indexTree([]), permissionGranted: false };
    let permissionGranted = false;
    let revision = 0;
    let running = null;
    let timer = null;
    let disposed = false;
    const subscribers = new Set();
    const bindings = new Map();

    function publish(status, index = indexTree([])) {
      state = { status, index, permissionGranted };
      for (const subscriber of subscribers) subscriber(state);
    }
    function bind(event, handler) {
      if (!event?.addListener || bindings.has(event)) return;
      event.addListener(handler);
      bindings.set(event, handler);
    }
    function bindBookmarkEvents() {
      for (const name of ['onCreated', 'onChanged', 'onMoved', 'onRemoved', 'onChildrenReordered', 'onImportBegan', 'onImportEnded']) {
        bind(browser?.bookmarks?.[name], schedule);
      }
    }
    function schedule() {
      if (disposed) return;
      revision += 1; // invalidate an in-flight snapshot immediately
      clearTimeout(timer);
      timer = setTimeout(refresh, 80);
    }
    async function read() {
      let observed;
      do {
        observed = revision;
        try {
          if (!browser?.permissions?.contains) {
            publish('unsupported');
            return;
          }
          const granted = await browser.permissions.contains({ permissions: ['bookmarks'] });
          if (disposed) return;
          if (observed !== revision) continue;
          permissionGranted = granted;
          if (!granted) { publish('denied'); return; }
          if (!browser.bookmarks?.getTree) { publish('unsupported'); return; }
          bindBookmarkEvents();
          if (state.status !== 'ready') publish('loading');
          const tree = await browser.bookmarks.getTree();
          // Permission may have been revoked while the API request was running.
          const stillGranted = await browser.permissions.contains({ permissions: ['bookmarks'] });
          if (disposed) return;
          if (observed !== revision) continue;
          permissionGranted = stillGranted;
          publish(stillGranted ? 'ready' : 'denied', stillGranted ? indexTree(tree) : indexTree([]));
        } catch {
          if (!disposed && observed === revision) publish('error');
        }
      } while (!disposed && observed !== revision);
    }
    function refresh() {
      if (disposed) return Promise.resolve();
      clearTimeout(timer);
      revision += 1;
      if (!running) running = read().finally(() => { running = null; });
      return running;
    }
    bind(browser?.permissions?.onAdded, permissions => {
      if (permissions.permissions?.includes('bookmarks')) { bindBookmarkEvents(); schedule(); }
    });
    bind(browser?.permissions?.onRemoved, permissions => {
      if (!permissions.permissions?.includes('bookmarks')) return;
      revision += 1;
      clearTimeout(timer);
      permissionGranted = false;
      publish('denied');
    });
    bindBookmarkEvents();
    return {
      refresh,
      subscribe(listener) { subscribers.add(listener); listener(state); return () => subscribers.delete(listener); },
      getState: () => state,
      dispose() {
        disposed = true;
        revision += 1;
        clearTimeout(timer);
        for (const [event, handler] of bindings) event.removeListener(handler);
        subscribers.clear();
      },
    };
  }

  function canModify(index, id) {
    const node = index.nodes.get(id);
    return Boolean(node && id !== index.rootId && !index.roots.includes(id) && !node.folderType
      && !pathFor(index, id).some(item => item.unmodifiable));
  }
  function canReceive(index, id, sourceId) {
    const node = index.nodes.get(id);
    return Boolean(node && node.url === undefined && id !== index.rootId
      && !pathFor(index, id).some(item => item.unmodifiable || item.id === sourceId));
  }
  function validateFields(value) {
    const title = typeof value.title === 'string' ? value.title.trim() : '';
    if (!title) throw new Error('A name is required.');
    const fields = { title };
    if (value.url !== undefined) {
      if (!canOpen(value.url)) throw new Error('Use an http or https address.');
      fields.url = new URL(value.url).href;
    }
    return fields;
  }
  async function mutate(kind, id, destination, browser = global.chrome) {
    if (!await browser.permissions.contains({ permissions: ['bookmarks'] })) throw new Error('Bookmark access is required.');
    // Revalidate against the current browser tree, not a stale rendered snapshot.
    const index = indexTree(await browser.bookmarks.getTree());
    if (kind === 'create') {
      if (!canReceive(index, destination.parentId)) throw new Error('Invalid destination.');
      return browser.bookmarks.create({ parentId: destination.parentId, ...validateFields(destination) });
    }
    if (!canModify(index, id)) throw new Error('This item is unavailable or protected.');
    if (kind === 'update') {
      const fields = validateFields(destination);
      if (index.nodes.get(id).url === undefined && fields.url !== undefined) throw new Error('Cannot convert a folder.');
      return browser.bookmarks.update(id, fields);
    }
    if (kind === 'move') {
      if (typeof destination === 'object') {
        const { targetId, position } = destination;
        const target = index.nodes.get(targetId);
        if (!target || !['before', 'after', 'inside'].includes(position) || targetId === id) throw new Error('Invalid drop target.');
        const parentId = position === 'inside' ? targetId : target.parentId;
        if (!canReceive(index, parentId, id)) throw new Error('Invalid destination.');
        if (position === 'inside') return browser.bookmarks.move(id, { parentId });
        const siblings = index.nodes.get(parentId).children;
        // Chrome adjusts same-parent indices when it removes the source node.
        const insertion = siblings.indexOf(targetId) + (position === 'after' ? 1 : 0);
        return browser.bookmarks.move(id, { parentId, index: insertion });
      }
      if (!canReceive(index, destination, id)) throw new Error('This destination is unavailable or protected.');
      return browser.bookmarks.move(id, { parentId: destination });
    }
    if (kind !== 'delete') throw new Error('Unknown bookmark operation.');
    const node = index.nodes.get(id);
    if (node.url === undefined) return browser.bookmarks.removeTree(id);
    return browser.bookmarks.remove(id);
  }

  const api = { indexTree, pathFor, search, canOpen, createReader, canModify, canReceive, mutate };
  global.SuperTabOutNativeBookmarks = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
