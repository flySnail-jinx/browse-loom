import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Native = require('../extension/services/native-bookmarks-service.js');

function event() {
  const listeners = new Set();
  return {
    addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn),
    emit: (...args) => [...listeners].forEach(fn => fn(...args)),
    size: () => listeners.size,
  };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const fixture = () => [{ id: 'root-random', title: '', children: [
  { id: 'account', title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: true, children: [
    { id: 'folder', title: '工作', children: [
      { id: 'one', title: '<img onerror=alert(1)>', url: 'https://example.com/path?q=a#part' },
      { id: 'nested', title: 'Docs', children: [
        { id: 'two', title: 'Reference', url: 'https://example.com/path?q=a#part' },
        { id: 'script', title: '', url: 'javascript:alert(1)' },
      ] },
    ] },
  ] },
  { id: 'local', title: 'Bookmarks bar', folderType: 'bookmarks-bar', syncing: false, children: [] },
] }];

export async function testNativeBookmarks() {
  const tree = fixture();
  const before = JSON.stringify(tree);
  const index = Native.indexTree(tree);
  assert.equal(Native.canModify(index, 'account'), false);
  assert.equal(Native.canModify(index, 'one'), true);
  assert.equal(Native.canReceive(index, 'nested', 'folder'), false);
  assert.equal(Native.canReceive(index, 'folder', 'folder'), false);
  assert.equal(Native.canReceive(index, 'local', 'folder'), true);
  const writes = [];
  const writer = { permissions: { contains: async () => true }, bookmarks: {
    getTree: async () => tree, move: async (...args) => writes.push(['move', ...args]),
    remove: async id => writes.push(['remove', id]), removeTree: async id => writes.push(['removeTree', id]),
  } };
  await assert.rejects(Native.mutate('move', 'folder', 'nested', writer));
  await assert.rejects(Native.mutate('delete', 'account', null, writer));
  await Native.mutate('move', 'one', 'local', writer);
  await Native.mutate('delete', 'folder', null, writer);
  await Native.mutate('delete', 'one', null, writer);
  assert.deepEqual(writes, [['move', 'one', { parentId: 'local' }], ['removeTree', 'folder'], ['remove', 'one']]);
  tree[0].children[0].unmodifiable = 'managed';
  await assert.rejects(Native.mutate('delete', 'one', null, writer));
  delete tree[0].children[0].unmodifiable;
  writer.bookmarks.create = async value => value;
  writer.bookmarks.update = async (id, value) => ({ id, ...value });
  assert.deepEqual(await Native.mutate('create', null, { parentId: 'local', title: 'New', url: 'https://example.com' }, writer), { parentId: 'local', title: 'New', url: 'https://example.com/' });
  await assert.rejects(Native.mutate('create', null, { parentId: 'one', title: 'Bad' }, writer));
  await assert.rejects(Native.mutate('update', 'one', { title: 'Bad', url: 'javascript:alert(1)' }, writer));
  await assert.rejects(Native.mutate('update', 'one', { title: ' ' }, writer));
  await assert.rejects(Native.mutate('move', 'folder', { targetId: 'nested', position: 'inside' }, writer));
  await Native.mutate('move', 'one', { targetId: 'nested', position: 'after' }, writer);
  assert.deepEqual(writes.at(-1), ['move', 'one', { parentId: 'folder', index: 2 }]);
  writer.permissions.contains = async () => false;
  await assert.rejects(Native.mutate('delete', 'one', null, writer));

  assert.deepEqual(index.roots, ['account', 'local']);
  assert.deepEqual(index.nodes.get('folder').children, ['one', 'nested']);
  assert.deepEqual(Native.pathFor(index, 'two').map(node => node.id), ['account', 'folder', 'nested', 'two']);
  assert.equal(index.nodes.get('script').url, 'javascript:alert(1)');
  assert.equal(Native.search(index, 'EXAMPLE.com').length, 2, 'duplicate URLs remain distinct');
  assert.deepEqual(Native.search(index, 'reference example').map(node => node.id), ['two']);
  assert.deepEqual(Native.search(index, '工作').map(node => node.id), ['folder']);
  assert.equal(JSON.stringify(tree), before, 'indexing must not mutate source nodes');
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/a', 'chrome://settings', 'httpsx://example.com', 'invalid']) assert.equal(Native.canOpen(url), false);
  assert.equal(Native.canOpen('https://example.com?q=x#y'), true);
  assert.equal(Native.canOpen('http://localhost:8080'), true);

  let granted = false;
  let reads = 0;
  let getTree = async () => { reads += 1; return fixture(); };
  const browser = {
    permissions: { contains: async () => granted, onAdded: event(), onRemoved: event() },
    bookmarks: { getTree: () => getTree(), onCreated: event(), onChanged: event(), onMoved: event(), onRemoved: event(), onChildrenReordered: event(), onImportBegan: event(), onImportEnded: event() },
  };
  const reader = Native.createReader(browser);
  await reader.refresh();
  assert.equal(reader.getState().status, 'denied');
  assert.equal(reads, 0, 'never read without permission');
  granted = true;
  await reader.refresh();
  assert.equal(reader.getState().status, 'ready');
  assert.equal(reader.getState().index.nodes.size, 8);

  // Revoke while getTree is pending: no snapshot may resurrect the data.
  const pending = deferred();
  const started = deferred();
  getTree = () => { started.resolve(); return pending.promise; };
  const refresh = reader.refresh();
  await started.promise;
  granted = false;
  browser.permissions.onRemoved.emit({ permissions: ['bookmarks'] });
  assert.equal(reader.getState().status, 'denied');
  assert.equal(reader.getState().index.nodes.size, 0);
  pending.resolve(fixture());
  await refresh;
  assert.equal(reader.getState().status, 'denied');

  // Event during an in-flight snapshot forces a second read; stale tree is never published.
  granted = true;
  const slow = deferred();
  const slowStarted = deferred();
  let calls = 0;
  const newTree = fixture();
  newTree[0].children[0].title = 'Updated';
  getTree = () => ++calls === 1 ? (slowStarted.resolve(), slow.promise) : Promise.resolve(newTree);
  const published = [];
  const unsubscribe = reader.subscribe(snapshot => {
    if (snapshot.status === 'ready') published.push(snapshot.index.nodes.get('account').title);
  });
  const racing = reader.refresh();
  await slowStarted.promise;
  browser.bookmarks.onChanged.emit('account', { title: 'Updated' });
  slow.resolve(fixture());
  await racing;
  assert.deepEqual(published, ['Updated']);
  assert.equal(reader.getState().index.nodes.get('account').title, 'Updated');
  unsubscribe();

  getTree = async () => { throw new Error('API failure'); };
  await reader.refresh();
  assert.equal(reader.getState().status, 'error');
  assert.equal(reader.getState().index.nodes.size, 0);
  getTree = async () => fixture();
  await reader.refresh();
  assert.equal(reader.getState().status, 'ready');
  reader.dispose();
  assert.equal(browser.bookmarks.onChanged.size(), 0);
  assert.equal(browser.permissions.onRemoved.size(), 0);

  // The bookmarks namespace may become available only after optional permission is granted.
  granted = false;
  const lateBrowser = { permissions: browser.permissions };
  const late = Native.createReader(lateBrowser);
  await late.refresh();
  lateBrowser.bookmarks = browser.bookmarks;
  granted = true;
  browser.permissions.onAdded.emit({ permissions: ['bookmarks'] });
  await late.refresh();
  assert.equal(late.getState().status, 'ready');
  assert.equal(browser.bookmarks.onChanged.size(), 1);
  late.dispose();
  const unavailable = Native.createReader({});
  await unavailable.refresh();
  assert.equal(unavailable.getState().status, 'unsupported');
  unavailable.dispose();
}
