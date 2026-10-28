import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { createImporter, KEY } = require('../extension/services/legacy-bookmark-import-service.js');
const copy = value => structuredClone(value);
function fixture() {
  const library = {
    categories: [{ id: 'c', name: 'Work', order: 0, itemOrder: ['bookmark:a', 'folder:f', 'bookmark:b', 'bookmark:bad'] }],
    folders: [{ id: 'f', name: 'Docs', categoryId: 'c', order: 0 }],
    bookmarks: [
      { id: 'a', title: 'Existing', url: 'https://example.com/?a=1#x', categoryId: 'c', order: 0 },
      { id: 'b', title: 'New', url: 'https://new.test/?q=2#anchor', categoryId: 'c', order: 1, note: 'Keep this note', icon: { type: 'text', value: 'N' } },
      { id: 'd', title: 'Child', url: 'https://child.test/', folderId: 'f', categoryId: 'c', order: 0 },
      { id: 'bad', title: 'Unsafe', url: 'javascript:alert(1)', categoryId: 'c', order: 3 },
    ],
  };
  const nodes = new Map([
    ['0', { id: '0', title: '' }],
    ['1', { id: '1', parentId: '0', title: 'Bookmarks bar', folderType: 'bookmarks-bar' }],
    ['2', { id: '2', parentId: '1', title: 'Existing', url: library.bookmarks[0].url }],
    ['3', { id: '3', parentId: '0', title: 'Managed', unmodifiable: 'managed' }],
  ]);
  const store = { bookmarkLibrary: copy(library) };
  let serial = 10;
  const controls = { permission: true, failTitle: '', failSaveAfterCreate: false, failNextSave: false, gate: null };
  const writes = [];
  function children(id) { return [...nodes.values()].filter(node => node.parentId === id).sort((a, b) => (a.index || 0) - (b.index || 0)).map(copy); }
  function subtree(node) { return { ...copy(node), ...(node.url === undefined ? { children: children(node.id).map(subtree) } : {}) }; }
  const browser = {
    permissions: { async contains() { return controls.permission; } },
    storage: { local: {
      async get(key) { return { [key]: copy(store[key]) }; },
      async set(data) { if (controls.failNextSave) { controls.failNextSave = false; throw new Error('disk-full'); } Object.assign(store, copy(data)); },
    } },
    bookmarks: {
      async getTree() { return [subtree(nodes.get('0'))]; },
      async getChildren(id) { if (!nodes.has(id)) throw new Error('missing'); return children(id); },
      async create(input) {
        if (controls.gate) await controls.gate;
        if (input.title === controls.failTitle) throw new Error('create-failed');
        for (const sibling of children(input.parentId)) if ((sibling.index || 0) >= input.index) nodes.get(sibling.id).index = (sibling.index || 0) + 1;
        const node = { id: String(serial++), ...copy(input) };
        nodes.set(node.id, node); writes.push(copy(node));
        if (controls.failSaveAfterCreate) { controls.failSaveAfterCreate = false; controls.failNextSave = true; }
        return copy(node);
      },
    },
  };
  return { browser, nodes, store, controls, writes, library };
}
async function start(importer, draft, selected = draft.ops.filter(op => op.kind === 'new').map(op => op.key)) {
  return importer.handle({ action: 'start', token: draft.token, targetId: '1', selected });
}
async function finish(importer, batch) {
  while (batch.phase === 'running') batch = await importer.handle({ action: 'step', batchId: batch.batchId });
  return batch;
}
export async function testLegacyBookmarkImport() {
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview', lang: 'zh' });
    assert.equal(f.writes.length, 0, 'preview never writes browser bookmarks');
    assert.equal(draft.defaultTargetId, '1');
    assert.equal(draft.targets.some(node => node.id === '3'), false);
    assert.equal(draft.ops.find(op => op.title === 'Existing').kind, 'duplicate');
    assert.equal(draft.ops.find(op => op.title === 'Unsafe').kind, 'unsupported');
    assert.equal(draft.notes, 1);
    assert.equal(draft.ops.find(op => op.title === 'New').url, 'https://new.test/?q=2#anchor');
    const batch = await finish(importer, await start(importer, draft));
    assert.equal(batch.phase, 'complete');
    assert.equal(batch.counts.done, 2);
    assert.equal(batch.counts.skipped, 2);
    assert.deepEqual(f.writes.map(node => node.title), ['BrowseLoom 旧书签', 'Work', 'Docs', 'Child', 'New']);
    assert.deepEqual(f.store.bookmarkLibrary, f.library, 'legacy data, notes and icons are untouched');
    assert.deepEqual(f.nodes.get('2'), { id: '2', parentId: '1', title: 'Existing', url: f.library.bookmarks[0].url });
    assert.equal((await importer.handle({ action: 'preview' })).phase, 'complete');
    await importer.handle({ action: 'step', batchId: batch.batchId });
    assert.equal(f.writes.length, 5, 'repeated imports do not create more entries');
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    let draft = await importer.handle({ action: 'preview' });
    f.store.bookmarkLibrary.bookmarks[1].title = 'Changed';
    await assert.rejects(start(importer, draft), /source-changed/);
    draft = await importer.handle({ action: 'preview' });
    await assert.rejects(importer.handle({ action: 'start', token: draft.token, targetId: '3', selected: [] }), /target-unavailable/);
    await assert.rejects(start(importer, draft, [draft.ops.find(op => op.kind === 'unsupported').key]), /unsupported-url/);
    f.controls.permission = false;
    await assert.rejects(start(importer, draft), /permission-required/);
    assert.equal(f.writes.length, 0);
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    f.controls.failTitle = 'Child';
    let batch = await finish(importer, await start(importer, draft));
    assert.equal(batch.phase, 'attention');
    assert.equal(batch.counts.failed, 1);
    assert.equal(batch.counts.done, 1);
    f.controls.failTitle = '';
    batch = await finish(importer, await importer.handle({ action: 'retry', batchId: batch.batchId }));
    assert.equal(batch.phase, 'complete');
    assert.equal(f.writes.filter(node => node.title === 'New').length, 1);
    assert.equal(f.writes.filter(node => node.title === 'Child').length, 1);
  }
  {
    const f = fixture();
    let importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    let batch = await start(importer, draft);
    f.controls.failSaveAfterCreate = true;
    await assert.rejects(importer.handle({ action: 'step', batchId: batch.batchId }), /disk-full/);
    assert.equal(f.writes.length, 1);
    assert.equal(f.store[KEY].ops[0].status, 'creating');
    importer = createImporter(f.browser); // Simulate a terminated/restarted worker.
    batch = await importer.handle({ action: 'preview' });
    assert.equal(batch.ops[0].status, 'review');
    assert.equal(batch.ops[0].candidates[0].id, f.writes[0].id);
    await importer.handle({ action: 'step', batchId: batch.batchId });
    assert.equal(f.writes.length, 1, 'uncertain writes are never silently repeated');
    batch = await importer.handle({ action: 'resolve', batchId: batch.batchId, key: 'root', choice: f.writes[0].id });
    await finish(importer, batch);
    assert.equal(f.writes.filter(node => node.title === 'BrowseLoom old bookmarks').length, 1);
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    const batch = await start(importer, draft);
    let release;
    f.controls.gate = new Promise(done => { release = done; });
    const executing = importer.handle({ action: 'step', batchId: batch.batchId });
    await assert.rejects(importer.handle({ action: 'step', batchId: batch.batchId }), /import-busy/);
    release(); await executing;
    assert.equal(f.writes.filter(node => node.title === 'New').length, 1);
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    f.nodes.set('late', { id: 'late', parentId: '1', title: 'New', url: 'https://new.test/?q=2#anchor' });
    await assert.rejects(start(importer, draft), /destination-changed/);
    assert.equal(f.writes.length, 0, 'new duplicates invalidate confirmation preview');
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    const batch = await start(importer, draft);
    f.controls.failNextSave = true;
    await assert.rejects(importer.handle({ action: 'step', batchId: batch.batchId }), /disk-full/);
    assert.equal(f.writes.length, 0, 'failed intent persistence prevents a native write');
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    f.controls.failTitle = 'Docs';
    let batch = await finish(importer, await start(importer, draft));
    assert.equal(batch.counts.pending, 1, 'children wait for their failed parent');
    f.controls.failTitle = '';
    batch = await finish(importer, await importer.handle({ action: 'retry', batchId: batch.batchId }));
    const work = f.writes.find(node => node.title === 'Work');
    assert.deepEqual((await f.browser.bookmarks.getChildren(work.id)).map(node => node.title), ['Docs', 'New'], 'retry preserves relative folder order');
    assert.equal(batch.phase, 'complete');
  }
  {
    const f = fixture();
    for (let i = 0; i < 30; i++) f.store.bookmarkLibrary.bookmarks.push({ id: `bulk-${i}`, title: `Bulk ${i}`, url: `https://bulk.test/${i}`, categoryId: 'c', order: i + 10 });
    let importer = createImporter(f.browser);
    const draft = await importer.handle({ action: 'preview' });
    let batch = await start(importer, draft);
    batch = await importer.handle({ action: 'step', batchId: batch.batchId });
    assert.equal(batch.phase, 'running');
    assert.equal(f.writes.length, 15, 'writes are bounded per message');
    importer = createImporter(f.browser);
    batch = await finish(importer, await importer.handle({ action: 'preview' }));
    assert.equal(batch.counts.done, 32);
    assert.equal(f.writes.length, 35, 'continuation does not recreate completed directories');
  }

  {
    const f = fixture(), importer = createImporter(f.browser);
    for (let i = 0; i < 900; i++) f.store.bookmarkLibrary.bookmarks.push({ id: `all-${i}`, title: `Repeated ${i % 10}`, url: `https://all.test/${i % 10}`, categoryId: 'c', order: i + 10 });
    const draft = await importer.handle({ action: 'preview' });
    const batch = await finish(importer, await importer.handle({ action: 'start', token: draft.token, targetId: '1', mode: 'all', selected: [] }));
    assert.equal(batch.counts.done, 903, 'all supported entries import regardless of preview limits or duplicates');
    assert.equal(batch.counts.skipped, 1, 'unsupported address remains in old library');
    assert.equal(f.writes.filter(node => node.title === 'Repeated 0').length, 90, 'source duplicates are retained');
    await importer.handle({ action: 'step', batchId: batch.batchId });
    assert.equal(f.writes.filter(node => node.url !== undefined).length, 903, 'repeated confirmation does not duplicate this batch');
  }
  {
    const f = fixture(), importer = createImporter(f.browser);
    let batch = await finish(importer, await start(importer, await importer.handle({ action: 'preview' })));
    assert.equal(batch.counts.done, 2);
    batch = await finish(importer, await importer.handle({ action: 'include-all', batchId: batch.batchId }));
    assert.equal(batch.counts.done, 3, 'previously unchecked entries can be added without restarting the batch');
    assert.equal(f.writes.filter(node => node.title === 'New').length, 1);
    assert.equal(f.writes.filter(node => node.title === 'Existing').length, 1);
    await importer.handle({ action: 'include-all', batchId: batch.batchId });
    assert.equal(f.writes.length, 6);
  }

}
