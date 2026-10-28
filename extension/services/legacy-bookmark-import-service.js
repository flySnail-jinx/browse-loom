/* One background-owned writer for explicitly confirmed legacy bookmark imports.
   The old library is never mutated. A persisted intent precedes every native write. */
(function (global) {
  'use strict';
  const KEY = 'legacyBookmarkImport';
  const validUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
  const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0);
  function flatten(tree) {
    const result = [];
    function visit(node, path, blocked) {
      const nextPath = node.title ? [...path, node.title] : path;
      const readonly = blocked || Boolean(node.unmodifiable);
      result.push({ ...node, path: nextPath.join(' / '), readonly });
      (node.children || []).forEach(child => visit(child, nextPath, readonly));
    }
    tree.forEach(node => visit(node, [], false));
    return result;
  }
  function buildPlan(library, tree, lang) {
    const zh = lang === 'zh';
    const existing = flatten(tree);
    const categories = (library.categories || []).map((node, i) => ({ ...node, key: `c:${i}` })).sort(byOrder);
    const folders = (library.folders || []).map((node, i) => ({ ...node, key: `f:${i}` })).sort(byOrder);
    const bookmarks = (library.bookmarks || []).map((node, i) => ({ ...node, key: `b:${i}` })).sort(byOrder);
    const recovered = { id: '__recovered__', key: 'c:recovered', name: zh ? '未分类' : 'Unfiled', itemOrder: [] };
    const categoryFor = id => categories.find(node => node.id === id) || recovered;
    const folderFor = id => folders.find(node => node.id === id);
    const ops = [];
    const seen = new Set();
    let notes = 0;
    function bookmark(node, parentKey, path) {
      const title = String(node.title || node.url || (zh ? '未命名书签' : 'Untitled bookmark'));
      const url = typeof node.url === 'string' ? node.url : '';
      const exact = existing.filter(item => item.url === url && item.title === title);
      const related = existing.filter(item => item.url !== undefined && (item.url === url || item.title === title));
      const signature = JSON.stringify([title, url]);
      const duplicateInSource = seen.has(signature);
      const kind = !validUrl(url) ? 'unsupported' : exact.length || duplicateInSource ? 'duplicate' : related.length ? 'conflict' : 'new';
      ops.push({ key: node.key, parentKey, title, url, path, kind, matches: (exact.length ? exact : related).map(item => ({ id: item.id, path: item.path, title: item.title, url: item.url })), duplicateInSource });
      seen.add(signature);
      if (node.note) notes++;
    }
    for (const category of [...categories, recovered]) {
      const children = folders.filter(folder => categoryFor(folder.categoryId).key === category.key);
      const direct = bookmarks.filter(node => !folderFor(node.folderId) && categoryFor(node.categoryId).key === category.key);
      const nestedCount = bookmarks.filter(node => children.some(folder => folder.id === node.folderId)).length;
      if (!children.length && !direct.length && !nestedCount && (category.system || category === recovered)) continue;
      const title = String(category.name || (zh ? '未命名分类' : 'Untitled category'));
      ops.push({ key: category.key, parentKey: 'root', title });
      const order = Array.isArray(category.itemOrder) ? category.itemOrder : [];
      const entries = [...children.map(node => ({ node, type: 'folder', orderKey: `folder:${node.id}` })), ...direct.map(node => ({ node, type: 'bookmark', orderKey: `bookmark:${node.id}` }))];
      entries.sort((a, b) => {
        const ai = order.indexOf(a.orderKey), bi = order.indexOf(b.orderKey);
        return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi) || byOrder(a.node, b.node);
      });
      for (const { node, type } of entries) {
        if (type === 'bookmark') bookmark(node, category.key, title);
        else {
          const name = String(node.name || (zh ? '未命名文件夹' : 'Untitled folder'));
          ops.push({ key: node.key, parentKey: category.key, title: name });
          bookmarks.filter(item => item.folderId === node.id).forEach(item => bookmark(item, node.key, `${title} / ${name}`));
        }
      }
    }
    const targets = existing.filter(node => node.parentId && node.url === undefined && !node.readonly).map(node => ({ id: node.id, path: node.path, folderType: node.folderType, syncing: node.syncing }));
    const defaultTarget = targets.find(node => node.folderType === 'bookmarks-bar') || targets[0];
    return { ops, targets, defaultTargetId: defaultTarget?.id || '', notes };
  }
  async function fingerprint(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value || {}));
    const digest = await global.crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function createImporter(browser) {
    let locked = false;
    async function read() { return (await browser.storage.local.get(KEY))[KEY] || null; }
    async function save(value) { await browser.storage.local.set({ [KEY]: value }); }
    async function tree() {
      if (!await browser.permissions.contains({ permissions: ['bookmarks'] })) throw new Error('permission-required');
      return browser.bookmarks.getTree();
    }
    function summarize(batch) {
      if (!batch || batch.phase === 'preview') return batch;
      const items = batch.ops.filter(op => op.url !== undefined);
      return { ...batch, counts: Object.fromEntries(['done', 'pending', 'failed', 'review', 'skipped'].map(status => [status, items.filter(op => op.status === status).length])) };
    }
    async function recover(batch) {
      if (!batch || batch.phase === 'preview') return batch;
      let changed = false;
      for (const op of batch.ops.filter(item => item.status === 'creating')) {
        op.status = 'review';
        op.error = 'interrupted';
        const nodes = flatten(await tree());
        op.candidates = nodes.filter(node => node.parentId === op.targetParentId && node.title === op.title && node.url === op.url && !(op.beforeIds || []).includes(node.id)).map(node => ({ id: node.id, path: node.path }));
        changed = true;
      }
      if (changed) { batch.phase = 'attention'; await save(batch); }
      return batch;
    }
    async function preview(lang) {
      const nativeTree = await tree();
      const library = (await browser.storage.local.get('bookmarkLibrary')).bookmarkLibrary || {};
      const sourceHash = await fingerprint(library);
      const previous = await recover(await read());
      if (previous && previous.phase !== 'preview' && (previous.phase !== 'complete' || previous.sourceHash === sourceHash)) return summarize(previous);
      const plan = buildPlan(library, nativeTree, lang);
      const draft = { version: 1, phase: 'preview', token: global.crypto.randomUUID(), sourceHash, ...plan, rootTitle: lang === 'zh' ? 'BrowseLoom 旧书签' : 'BrowseLoom old bookmarks' };
      await save(draft);
      return draft;
    }
    async function start(message) {
      const draft = await read();
      if (!draft || draft.phase !== 'preview') return summarize(await recover(draft));
      if (message.token !== draft.token) throw new Error('preview-expired');
      const library = (await browser.storage.local.get('bookmarkLibrary')).bookmarkLibrary || {};
      if (await fingerprint(library) !== draft.sourceHash) throw new Error('source-changed');
      const nodes = flatten(await tree());
      const target = nodes.find(node => node.id === message.targetId && node.parentId && node.url === undefined && !node.readonly);
      if (!target) throw new Error('target-unavailable');
      const importAll = message.mode === 'all';
      const selected = new Set(importAll ? draft.ops.filter(op => op.url !== undefined && op.kind !== 'unsupported').map(op => op.key) : Array.isArray(message.selected) ? message.selected : []);
      if (draft.ops.some(op => selected.has(op.key) && op.kind === 'unsupported')) throw new Error('unsupported-url');
      if (!importAll && draft.ops.some(op => selected.has(op.key) && nodes.some(node => node.url === op.url && node.title === op.title && !op.matches?.some(match => match.id === node.id)))) throw new Error('destination-changed');
      const ops = [{ key: 'root', title: draft.rootTitle, targetParentId: target.id, status: 'pending' }, ...draft.ops.map(op => ({ ...op, status: op.url === undefined || selected.has(op.key) ? 'pending' : 'skipped' }))];
      const batch = { version: 1, mode: importAll ? 'all' : 'selected', batchId: draft.token, sourceHash: draft.sourceHash, rootTitle: draft.rootTitle, targetPath: target.path, phase: 'running', ops, notes: draft.notes };
      await save(batch);
      return summarize(batch);
    }
    async function step(batchId) {
      const batch = await recover(await read());
      if (!batch || batch.batchId !== batchId) throw new Error('batch-unavailable');
      await tree();
      let processed = 0;
      for (const op of batch.ops) {
        if (processed >= 15) break;
        if (op.status !== 'pending') continue;
        const parent = op.key === 'root' ? null : batch.ops.find(item => item.key === op.parentKey);
        if (parent && parent.status !== 'done') continue;
        const parentId = parent?.targetId || op.targetParentId;
        let children;
        try {
          const nodes = flatten(await tree());
          const target = nodes.find(node => node.id === parentId && node.parentId && node.url === undefined && !node.readonly);
          if (!target) throw new Error('target-unavailable');
          children = await browser.bookmarks.getChildren(parentId);
        } catch (error) {
          op.status = 'failed'; op.error = error.message; await save(batch); processed++; continue;
        }
        op.targetParentId = parentId;
        op.beforeIds = children.map(node => node.id);
        op.status = 'creating';
        await save(batch); // If this fails, no browser write is attempted.
        let created;
        try {
          // Insert relative to completed siblings so a later retry preserves source order.
          const siblings = batch.ops.filter(item => item.parentKey === op.parentKey && item.key !== 'root');
          const position = siblings.indexOf(op);
          const previous = siblings.slice(0, position).reverse().find(item => item.status === 'done' && children.some(node => node.id === item.targetId));
          const next = siblings.slice(position + 1).find(item => item.status === 'done' && children.some(node => node.id === item.targetId));
          const index = previous ? children.findIndex(node => node.id === previous.targetId) + 1 : next ? children.findIndex(node => node.id === next.targetId) : children.length;
          created = await browser.bookmarks.create({ parentId, index, title: op.title, ...(op.url === undefined ? {} : { url: op.url }) });
        } catch (error) {
          op.status = 'failed'; op.error = error.message; await save(batch); processed++; continue;
        }
        op.targetId = created.id; op.status = 'done'; delete op.error; delete op.beforeIds;
        await save(batch); // Failure leaves the persisted intent for explicit reconciliation.
        processed++;
      }
      const pending = batch.ops.some(op => op.status === 'pending');
      const runnable = batch.ops.some(op => op.status === 'pending' && (op.key === 'root' || batch.ops.find(parent => parent.key === op.parentKey)?.status === 'done'));
      const problems = batch.ops.some(op => ['failed', 'review'].includes(op.status));
      batch.phase = runnable ? 'running' : problems || pending ? 'attention' : 'complete';
      await save(batch);
      return summarize(batch);
    }
    async function retry(batchId) {
      const batch = await recover(await read());
      if (!batch || batch.batchId !== batchId) throw new Error('batch-unavailable');
      const nodes = flatten(await tree());
      for (const op of batch.ops.filter(item => item.status === 'failed')) {
        const candidates = nodes.filter(node => node.parentId === op.targetParentId && node.title === op.title && node.url === op.url && !(op.beforeIds || []).includes(node.id));
        op.status = candidates.length ? 'review' : 'pending';
        op.candidates = candidates.map(node => ({ id: node.id, path: node.path }));
      }
      batch.phase = 'running'; await save(batch); return summarize(batch);
    }
    async function includeAll(batchId) {
      const batch = await recover(await read());
      if (!batch || batch.batchId !== batchId) throw new Error('batch-unavailable');
      await tree();
      if (batch.mode !== 'all') {
        for (const op of batch.ops) if (op.status === 'skipped' && op.url !== undefined && validUrl(op.url)) op.status = 'pending';
        batch.mode = 'all'; batch.phase = 'running'; await save(batch);
      }
      return summarize(batch);
    }
    async function resolve(message) {
      const batch = await recover(await read());
      if (!batch || batch.batchId !== message.batchId) throw new Error('batch-unavailable');
      const op = batch.ops.find(item => item.key === message.key && item.status === 'review');
      if (!op) throw new Error('review-unavailable');
      if (message.choice === 'skip' && op.url !== undefined) op.status = 'skipped';
      else if (message.choice === 'create') op.status = 'pending';
      else {
        if (!op.candidates?.some(item => item.id === message.choice)) throw new Error('invalid-choice');
        const node = flatten(await tree()).find(item => item.id === message.choice);
        if (!node || node.readonly || node.parentId !== op.targetParentId || node.title !== op.title || node.url !== op.url) throw new Error('target-changed');
        op.targetId = node.id; op.status = 'done';
      }
      delete op.error; batch.phase = 'running'; await save(batch); return summarize(batch);
    }
    async function handle(message) {
      if (locked) throw new Error('import-busy');
      locked = true;
      try {
        switch (message.action) {
          case 'preview': return await preview(message.lang);
          case 'start': return await start(message);
          case 'step': return await step(message.batchId);
          case 'status': return summarize(await recover(await read()));
          case 'retry': return await retry(message.batchId);
          case 'include-all': return await includeAll(message.batchId);
          case 'resolve': return await resolve(message);
          default: throw new Error('unknown-import-action');
        }
      } finally { locked = false; }
    }
    return { handle };
  }
  const api = { KEY, buildPlan, createImporter };
  global.SuperTabOutLegacyImport = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(globalThis);
