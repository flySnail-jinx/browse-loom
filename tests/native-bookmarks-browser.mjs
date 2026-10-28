import assert from 'node:assert/strict';
import { mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';

export async function testNativeBookmarksBrowser(page, openPeer, downloadDirectory) {
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  const output = resolve('output/native-bookmarks');
  await mkdir(output, { recursive: true });
  await mkdir(downloadDirectory, { recursive: true });
  await page.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDirectory });
  const peer = await openPeer();
  const peerUrl = await peer.evaluate('location.href');
  const iconBytes = await readFile(resolve('extension/icons/icon128.png'));
  const iconServer = createServer((request, response) => {
    if (request.url === '/favicon.png') {
      response.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' });
      response.end(iconBytes);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/html' });
      response.end('<title>Local icon fixture</title><link rel="icon" href="/favicon.png"><p>Browser icon fixture</p>');
    }
  });
  await new Promise(done => iconServer.listen(0, '127.0.0.1', done));
  const iconPageUrl = `http://127.0.0.1:${iconServer.address().port}/`;
  const iconRequests = [];
  await page.send('Network.enable');
  page.on('Network.requestWillBeSent', event => iconRequests.push(event.request.url));
  try {
    // Real API writes are confined to the harness's fresh, temporary profile.
    const fixture = await peer.evaluate(`(async () => {
      const parent = (await chrome.bookmarks.getTree())[0].children[0];
      const folder = await chrome.bookmarks.create({ parentId: parent.id, title: '工作资料' });
      const child = await chrome.bookmarks.create({ parentId: folder.id, title: '开发文档' });
      const first = await chrome.bookmarks.create({ parentId: folder.id, title: 'GitHub 项目', url: 'https://github.com/example/project?q=1#readme' });
      const duplicate = await chrome.bookmarks.create({ parentId: child.id, title: 'GitHub 项目副本', url: first.url });
      const unsafe = await chrome.bookmarks.create({ parentId: folder.id, title: '<img src=x onerror="window.injected=true">', url: 'javascript:alert(1)' });
      const empty = await chrome.bookmarks.create({ parentId: folder.id, title: '空文件夹' });
      let deep = child;
      for (let i = 0; i < 4; i++) deep = await chrome.bookmarks.create({ parentId: deep.id, title: '第 ' + (i + 1) + ' 层' });
      await chrome.bookmarks.create({ parentId: deep.id, title: 'Deep documentation', url: 'https://example.com/deep' });
      const legacy = (await SuperTabOutBookmarks.createBookmark({ title: '旧资料', url: 'https://legacy.test/', note: '保留这条备注' })).library;
      return { parent, folder, child, first, duplicate, unsafe, empty, deep, legacy };
    })()`);
    // Populate the browser's real favicon cache from a local page, without external services.
    await peer.navigate(iconPageUrl);
    await page.waitFor(`(async () => {
      const url = new URL(chrome.runtime.getURL('/_favicon/'));
      url.searchParams.set('pageUrl', ${JSON.stringify(iconPageUrl)});
      url.searchParams.set('size', '32');
      const blob = await (await fetch(url.href)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0, 32, 32);
      const pixels = ctx.getImageData(0, 0, 32, 32).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i + 3] > 128 && Math.max(pixels[i], pixels[i+1], pixels[i+2]) - Math.min(pixels[i], pixels[i+1], pixels[i+2]) > 30) colored++;
      return colored > 40;
    })()`);
    await peer.navigate(peerUrl);
    await page.send('Page.bringToFront');
    await page.navigate(await page.evaluate('location.href'));
    await page.evaluate(`document.querySelector('[data-workspace-switch="bookmarks"]').click()`);
    await page.waitFor(`document.body.dataset.workspace === 'bookmarks' && document.querySelector('#bookmarkEmpty').hidden`);
    await page.evaluate(`document.querySelector('[data-bookmark-view="grid"]').click(); if(document.querySelector('[data-native-action="folders"]').getAttribute('aria-expanded')==='true') document.querySelector('[data-native-action="folders"]').click()`);
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.parent.id}"]').click()`);
    await page.evaluate(`document.querySelector('#bookmarkGrid [data-native-folder="${fixture.folder.id}"]').click()`);
    await page.waitFor(`document.querySelectorAll('#bookmarkGrid .native-item').length === 4`);
    assert.deepEqual(await page.evaluate(`Array.from(document.querySelectorAll('#bookmarkGrid .native-item')).map(el => el.dataset.nativeId)`), [fixture.child.id, fixture.first.id, fixture.unsafe.id, fixture.empty.id]);
    assert.equal(await page.evaluate('window.injected === undefined'), true);
    // Clicking the selected folder name toggles its subtree without changing the content.
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.child.id}"]') === null`), true);
    assert.equal(await page.evaluate(`document.querySelector('#nativeFolderTitle').textContent`), '工作资料');
    await peer.evaluate(`chrome.bookmarks.update('${fixture.first.id}', { title: 'GitHub 项目更新' })`);
    await page.waitFor(`document.querySelector('[data-native-id="${fixture.first.id}"] strong')?.textContent === 'GitHub 项目更新'`);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').getAttribute('aria-expanded')`), 'false', 'refresh keeps the user-collapsed subtree closed');
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.child.id}"]') !== null`), true);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').getAttribute('aria-expanded')`), 'true');

    const localIconBookmark = await peer.evaluate(`chrome.bookmarks.create({ parentId: '${fixture.folder.id}', title: 'Local icon fixture', url: ${JSON.stringify(iconPageUrl)} }).then(node => node.id)`);
    await page.waitFor(`document.querySelector('[data-native-id="${localIconBookmark}"] img[data-native-favicon]')`);
    await page.evaluate(`document.querySelector('[data-native-id="${localIconBookmark}"] img').loading = 'eager'`);
    await page.waitFor(`document.querySelector('[data-native-id="${localIconBookmark}"] img[data-native-favicon]')?.naturalWidth > 0`);
    assert.equal(await page.evaluate(`new URL(document.querySelector('[data-native-id="${localIconBookmark}"] img').src).pathname`), '/_favicon/', 'bookmark icons use the internal browser endpoint');
    assert.equal(iconRequests.some(url => url.startsWith('https://icons.duckduckgo.com/')), false, 'external icon service remains off');
    await peer.evaluate(`chrome.bookmarks.remove('${localIconBookmark}')`);
    await page.waitFor(`document.querySelectorAll('#bookmarkGrid .native-item').length === 4`);
    assert.equal(await page.evaluate(`document.querySelectorAll('a[href^="javascript:"]').length`), 0);
    assert.equal(await page.evaluate(`document.querySelector('#nativeLegacy').hidden`), false);
    assert.equal(await page.evaluate(`document.querySelectorAll('#bookmarkLibraryNav .native-tree-row small').length`), 0, 'source information does not add repeated navigation rows');
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkLibraryNav').scrollHeight <= document.querySelector('#bookmarkLibraryNav').clientHeight`), true, 'short folder tree does not overflow');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 460, deviceScaleFactor: 1, mobile: false });
    assert.equal(await page.evaluate(`(() => { const nav = document.querySelector('#bookmarkLibraryNav'); nav.scrollTop = nav.scrollHeight; return nav.scrollTop > 0; })()`), true, 'overflowing folder tree remains scrollable');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    assert.equal(await page.evaluate(`document.querySelectorAll('#bookmarkEditorDialog, #recentBookmarks, #popularBookmarks').length`), 0);

    assert.deepEqual(await page.evaluate(`['#nativeSidebar', '#bookmarkMain'].map(selector => getComputedStyle(document.querySelector(selector)).backdropFilter)`), ['none', 'none'], 'bookmark panels use the same unblurred material as tab cards');
    // The real settings slider must control both native-bookmark panel surfaces.
    for (const opacity of [40, 75, 100]) {
      const alphas = await page.evaluate(`(async () => {
        const range = document.querySelector('#cardOpacityRange');
        range.value = '${opacity}'; range.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(done => requestAnimationFrame(done));
        await Promise.allSettled(['#nativeSidebar', '#bookmarkMain'].flatMap(selector => document.querySelector(selector).getAnimations().map(animation => animation.finished)));
        return ['#nativeSidebar', '#bookmarkMain'].map(selector => {
          const ctx = document.createElement('canvas').getContext('2d');
          ctx.fillStyle = getComputedStyle(document.querySelector(selector)).backgroundColor;
          ctx.fillRect(0, 0, 1, 1); return ctx.getImageData(0, 0, 1, 1).data[3];
        });
      })()`);
      for (const alpha of alphas) assert.ok(Math.abs(alpha - 255 * opacity / 100) <= 1, `panel opacity must follow ${opacity}%, got alpha ${alpha}`);
    }
    await page.evaluate(`document.querySelector('#cardOpacityRange').value = '60'; document.querySelector('#cardOpacityRange').dispatchEvent(new Event('input', { bubbles: true }))`);

    // Search is local and preserves duplicate URLs and their different folder paths.
    await page.evaluate(`document.querySelector('#bookmarkSearch').value = 'GitHub'; document.querySelector('#bookmarkSearch').dispatchEvent(new Event('input', { bubbles: true }))`);
    await page.waitFor(`document.querySelectorAll('#bookmarkList .native-item').length === 2`);
    assert.equal(await page.evaluate(`document.querySelectorAll('#bookmarkList .native-item-path').length`), 2);
    await page.evaluate(`document.querySelector('#bookmarkList [data-native-id="${fixture.duplicate.id}"] [data-native-folder]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#nativeFolderTitle').textContent`), '开发文档');
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkSearch').value`), '');
    await page.evaluate(`SuperTabOutBookmarkSearch.setQuery('Deep documentation')`);
    await page.evaluate(`document.querySelector('#bookmarkList .native-item-path button').click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('#nativeBreadcrumbs button').length`), 7);
    const crumbPoint = await page.evaluate(`(() => { const rect = document.querySelector('#nativeBreadcrumbs button').getBoundingClientRect(); return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }; })()`);
    await page.send('Page.bringToFront');
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...crumbPoint });
    await page.waitFor(`document.querySelector('#nativeBreadcrumbs button').matches(':hover')`);
    await page.evaluate(`Promise.allSettled(document.querySelector('#nativeBreadcrumbs button').getAnimations().map(animation => animation.finished))`);
    assert.equal(await page.evaluate(`(() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(document.querySelector('#nativeBreadcrumbs button')).backgroundColor; c.fillRect(0,0,1,1); return c.getImageData(0,0,1,1).data[3]; })()`), 0, 'breadcrumb hover stays transparent');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await page.evaluate(`document.querySelector('#nativeBreadcrumbs').scrollWidth <= document.querySelector('#nativeBreadcrumbs').clientWidth`), true, 'deep breadcrumbs wrap without a horizontal scrollbar');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });


    // Empty folder and normal navigation remain distinct from missing permission.
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').click()`);
    await page.evaluate(`document.querySelector('#bookmarkGrid [data-native-folder="${fixture.empty.id}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkEmpty h2').textContent`), 'This folder is empty');
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').click()`);

    // External changes originate in a second extension page, using real bookmark events.
    await page.evaluate(`document.querySelector('[data-native-id="${fixture.first.id}"] a').focus()`);
    await peer.evaluate(`chrome.bookmarks.update('${fixture.first.id}', { title: 'Updated externally' })`);
    await page.waitFor(`document.querySelector('[data-native-id="${fixture.first.id}"] strong')?.textContent === 'Updated externally'`);
    assert.equal(await page.evaluate(`document.activeElement.closest('[data-native-id]')?.dataset.nativeId`), fixture.first.id, 'refresh preserves keyboard focus');
    const newId = await peer.evaluate(`chrome.bookmarks.create({ parentId: '${fixture.folder.id}', title: 'New externally', url: 'https://example.com/new' }).then(node => node.id)`);
    await page.waitFor(`document.querySelector('[data-native-id="${newId}"]')`);
    await peer.evaluate(`chrome.bookmarks.move('${newId}', { parentId: '${fixture.child.id}' })`);
    await page.waitFor(`!document.querySelector('[data-native-id="${newId}"]')`);
    await peer.evaluate(`chrome.bookmarks.move('${fixture.first.id}', { index: 0 })`);
    await page.waitFor(`document.querySelector('#bookmarkGrid .native-item')?.dataset.nativeId === '${fixture.first.id}'`);
    await page.evaluate(`document.querySelector('#bookmarkGrid [data-native-folder="${fixture.empty.id}"]').click()`);
    await peer.evaluate(`chrome.bookmarks.remove('${fixture.empty.id}')`);
    await page.waitFor(`document.querySelector('#nativeFolderTitle').textContent === '工作资料'`);
    assert.match(await page.evaluate(`document.querySelector('#nativeStatus').textContent`), /no longer available/);

    // View preferences survive reload; neither viewing nor sorting alters either bookmark store.
    const nativeBefore = await page.evaluate(`chrome.bookmarks.getTree()`);
    await page.evaluate(`document.querySelector('[data-bookmark-view="list"]').click(); document.querySelector('#nativeStartupMode').value='last'; document.querySelector('#nativeStartupMode').dispatchEvent(new Event('change'))`);
    await page.waitFor(`document.querySelector('[data-bookmark-view="list"]').getAttribute('aria-pressed') === 'true'`);
    await page.waitFor(`!document.querySelector('#bookmarkList').hidden`);
    await page.evaluate(`document.querySelector('#nativeSort').value = 'title'; document.querySelector('#nativeSort').dispatchEvent(new Event('change'))`);
    await page.waitFor(`document.querySelector('#nativeSort').value === 'title'`);
    // A separate storage read observes queued preference writes before reload.
    await page.waitFor(`chrome.storage.local.get('nativeBookmarkPreferences').then(d=>d.nativeBookmarkPreferences?.sort==='title' && d.nativeBookmarkPreferences?.lastFolderId==='${fixture.folder.id}')`);
    await page.navigate(await page.evaluate('location.href'));
    await page.evaluate(`document.querySelector('[data-workspace-switch="bookmarks"]').click()`);
    await page.waitFor(`document.querySelector('#nativeFolderTitle').textContent === '工作资料'`);
    assert.equal(await page.evaluate(`document.querySelector('[data-bookmark-view="list"]').getAttribute('aria-pressed')`), 'true');
    assert.deepEqual(await page.evaluate(`chrome.bookmarks.getTree()`), nativeBefore);
    assert.deepEqual(await page.evaluate(`chrome.storage.local.get('bookmarkLibrary').then(data => data.bookmarkLibrary)`), fixture.legacy);

    assert.equal(await page.evaluate(`document.querySelector('#settingsPaneGeneral #nativeStartupMode') !== null`),true);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkWorkspace #nativeStartupMode, #bookmarkLibraryNav [data-native-folder=""]') === null`),true);
    // Startup mode affects new tabs, not the current browsing location.
    await page.evaluate(`document.querySelector('#nativeStartupMode').value='root'; document.querySelector('#nativeStartupMode').dispatchEvent(new Event('change'))`);
    await page.waitFor(`chrome.storage.local.get('nativeBookmarkPreferences').then(d=>d.nativeBookmarkPreferences?.startupMode==='root')`);
    const startupPeer = await openPeer();
    try {
      await startupPeer.waitFor(`document.querySelector('#nativeFolderTitle').textContent === ${JSON.stringify(fixture.parent.title)}`);
      assert.equal(await startupPeer.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.parent.id}"]').getAttribute('aria-current')`),'page');
    } finally { startupPeer.close(); }
    assert.equal(await page.evaluate(`document.querySelector('#nativeFolderTitle').textContent`),'工作资料');
    await page.evaluate(`document.querySelector('#nativeStartupMode').value='last'; document.querySelector('#nativeStartupMode').dispatchEvent(new Event('change'))`);
    await page.waitFor(`chrome.storage.local.get('nativeBookmarkPreferences').then(d=>d.nativeBookmarkPreferences?.startupMode==='last')`);
    const restoredPeer = await openPeer();
    try {
      await restoredPeer.waitFor(`document.querySelector('#nativeFolderTitle').textContent === '工作资料'`);
      assert.equal(await restoredPeer.evaluate(`document.querySelector('#nativeSort').value`),'title');
    } finally { restoredPeer.close(); }

    // Export includes the original note and uses the unmodified legacy data.
    await page.evaluate(`document.querySelector('[data-native-action="export"]').click()`);
    let backup;
    for (let attempt = 0; attempt < 100; attempt++) {
      const file = (await readdir(downloadDirectory)).find(name => name.endsWith('.json'));
      if (file) { backup = JSON.parse(await readFile(resolve(downloadDirectory, file), 'utf8')); break; }
      await new Promise(done => setTimeout(done, 50));
    }
    assert.ok(backup, 'backup download must complete inside the isolated test profile');
    assert.deepEqual(backup.bookmarkLibrary, fixture.legacy);
    assert.equal(backup.bookmarkLibrary.bookmarks[0].note, '保留这条备注');

    // Real native reads plus injected permission/error branches; no claim to automate OS prompts.
    await page.evaluate(`window.originalContains = chrome.permissions.contains; window.originalGetTree = chrome.bookmarks.getTree; chrome.permissions.contains = async () => false; document.querySelector('[data-native-action="refresh"]').click()`);
    await page.waitFor(`document.querySelector('#bookmarkEmpty [data-native-action="connect"]')`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.native-item, .native-tree-row').length`), 0);
    await page.evaluate(`window.originalRequest = chrome.permissions.request; chrome.permissions.request = async () => false; document.querySelector('#bookmarkEmpty [data-native-action="connect"]').click()`);
    await page.waitFor(`document.querySelector('#nativeStatus').textContent.includes('not granted')`);
    await page.evaluate(`chrome.permissions.contains = originalContains; chrome.permissions.request = originalRequest; chrome.bookmarks.getTree = async () => { throw new Error('injected'); }; document.querySelector('[data-native-action="refresh"]').click()`);
    await page.waitFor(`document.querySelector('#bookmarkEmpty h2')?.textContent === 'Could not read browser bookmarks'`);
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkPermissionRemove').hidden`), false, 'access remains revocable on a read error');
    await page.evaluate(`chrome.bookmarks.getTree = originalGetTree; document.querySelector('#bookmarkEmpty [data-native-action="refresh"]').click()`);
    await page.waitFor(`document.querySelector('#bookmarkEmpty').hidden`);

    const capture = await page.evaluate(`(async () => {
      const token = crypto.randomUUID();
      await chrome.storage.session.set({ ['bookmarkCapture:' + token]: { title: 'Capture test', url: 'https://example.com/capture', supported: true } });
      return { token, url: location.href + '?bookmarkCapture=' + token };
    })()`);
    await page.navigate(capture.url);
    await page.waitFor(`!location.search.includes('bookmarkCapture') && document.body.dataset.workspace === 'bookmarks'`);
    assert.deepEqual(await page.evaluate(`chrome.storage.session.get('bookmarkCapture:${capture.token}')`), {});
    assert.match(await page.evaluate(`document.querySelector('#nativeStatus').textContent`), /bookmark star/);

    // Large folders use bounded rendering; every matching item remains reachable.
    const large = await peer.evaluate(`(async () => {
      const folder = await chrome.bookmarks.create({ parentId: '${fixture.parent.id}', title: '大量资料' });
      for (let i = 0; i < 125; i++) await chrome.bookmarks.create({ parentId: folder.id, title: 'Batch reference ' + i, url: 'https://example.com/batch/' + i });
      return folder.id;
    })()`);
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.parent.id}"]').click()`);
    await page.waitFor(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${large}"]')`);
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${large}"]').click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.native-item').length`), 120);
    await page.evaluate(`document.querySelector('#nativeMore').click()`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.native-item').length`), 125);
    assert.equal(await page.evaluate(`document.documentElement.scrollHeight <= innerHeight`), true, 'desktop workspace fits one screen');
    assert.equal(await page.evaluate(`document.querySelector('#bookmarkList').scrollHeight > document.querySelector('#bookmarkList').clientHeight`), true, 'long list scrolls inside its panel');

    assert.equal(await page.evaluate(`document.querySelector('#nativeMore').hidden`), true);
    await peer.evaluate(`chrome.bookmarks.removeTree('${large}')`);
    await peer.evaluate(`chrome.bookmarks.remove('${fixture.unsafe.id}')`);
    await peer.evaluate(`(async () => {
      for (const [title, url] of [['MDN Web 文档', 'https://developer.mozilla.org/en-US/'], ['Figma 设计稿', 'https://www.figma.com/'], ['项目需求', 'https://example.com/requirements'], ['接口文档', 'https://example.com/api'], ['发布清单', 'https://example.com/releases']]) await chrome.bookmarks.create({ parentId: '${fixture.folder.id}', title, url });
    })()`);
    await peer.evaluate(`(async () => {
      await chrome.bookmarks.update('${fixture.first.id}', { title: 'GitHub', url: 'https://github.com/' });
      await chrome.bookmarks.create({ parentId: '${fixture.folder.id}', title: '设计资源' });
      await chrome.bookmarks.create({ parentId: '${fixture.folder.id}', title: '项目协作' });
    })()`);
    // Optional visual QA visits public fixture sites to populate this temporary browser's icons.
    // Normal regression remains offline and verifies the native icon API with the local server above.
    if (process.env.BOOKMARK_VISUAL_ICONS === '1') {
      for (const url of ['https://github.com/', 'https://www.figma.com/', 'https://developer.mozilla.org/en-US/']) {
        await peer.send('Page.navigate', { url }, 30000);
        await peer.waitFor('document.readyState === "complete"', 25000);
        await page.waitFor(`chrome.tabs.query({}).then(tabs => tabs.some(tab => tab.url?.startsWith(${JSON.stringify(new URL(url).origin)}) && tab.favIconUrl))`, 15000);
        if (!url.includes('mozilla.org')) await page.waitFor(`(async () => {
          async function iconData(pageUrl) {
            const icon = new URL(chrome.runtime.getURL('/_favicon/'));
            icon.searchParams.set('pageUrl', pageUrl); icon.searchParams.set('size', '32');
            return Array.from(new Uint8Array(await (await fetch(icon, { cache: 'reload' })).arrayBuffer())).join(',');
          }
          return await iconData(${JSON.stringify(url)}) !== await iconData('https://missing-icon.invalid/');
        })()`, 15000);

      }
      // Discard earlier default-icon HTTP responses; keep the browser's populated favicon database.
      await page.send('Network.clearBrowserCache');
      await peer.navigate(peerUrl);
      await page.send('Page.bringToFront');
    }
    // Select the visual fixture before reloading: startup now restores the last location.
    await page.evaluate(`document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.folder.id}"]').click()`);
    await page.waitFor(`chrome.storage.local.get('nativeBookmarkPreferences').then(d=>d.nativeBookmarkPreferences?.lastFolderId==='${fixture.folder.id}')`);
    // New-tab startup checks leave another tab active. Lazy images in a hidden
    // page are not required to load until that page is brought to the foreground.
    await page.send('Page.bringToFront');
    await page.waitFor(`document.visibilityState === 'visible'`);
    // Visual evidence uses the actual extension page and real native bookmark data.
    await page.navigate(await page.evaluate('location.href'));
    await page.evaluate(`document.querySelector('[data-workspace-switch="bookmarks"]').click()`);
    await page.waitFor(`document.querySelector('#nativeFolderTitle').textContent === '工作资料'`);
    await page.evaluate(`document.documentElement.dataset.lang = 'zh'; document.dispatchEvent(new Event('super-tab-out-language-change')); document.querySelector('#bookmarkLibraryNav [data-native-folder="${fixture.parent.id}"]').click()`);
    await page.evaluate(`document.querySelector('[data-native-id="${fixture.folder.id}"] [data-native-folder]').click(); document.querySelector('[data-bookmark-view="list"]').click()`);
    await page.evaluate(`document.querySelector('#toastDismiss').click()`);
    await page.waitFor(`!document.documentElement.dataset.workspaceTransition`);
    for (const width of [1440, 768, 390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`), true, `overflow at ${width}px`);
      if (width === 1440) await page.waitFor(`Array.from(document.querySelectorAll('#bookmarkList img')).filter(img => img.getBoundingClientRect().top < innerHeight).every(img => img.complete)`);
      await page.evaluate(`Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))`);
      const screenshot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
      await writeFile(resolve(output, `zh-${width}.png`), Buffer.from(screenshot.data, 'base64'));
      if (width === 390) {
        await page.evaluate(`document.querySelector('[data-native-action="folders"]').click()`);
        assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#nativeSidebar')).display`), 'flex');
      }
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`document.querySelector('[data-bookmark-view="grid"]').click(); if(document.querySelector('[data-native-action="folders"]').getAttribute('aria-expanded')==='true') document.querySelector('[data-native-action="folders"]').click()`);
    for (const width of [1440,390]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:false });
      await page.evaluate(`Promise.allSettled(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished))`);
      assert.equal(await page.evaluate(`document.documentElement.scrollWidth <= innerWidth`),true);
      const gridShot=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});
      await writeFile(resolve(output,`compact-grid-${width}.png`),Buffer.from(gridShot.data,'base64'));
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width:1440, height:900, deviceScaleFactor:1, mobile:false });
    await page.evaluate(`document.documentElement.dataset.lang = 'en'; document.dispatchEvent(new Event('super-tab-out-language-change')); document.querySelector('[data-bookmark-view="list"]').click()`);
    const shot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    await writeFile(resolve(output, 'en-list-1440.png'), Buffer.from(shot.data, 'base64'));
    await page.evaluate(`document.documentElement.dataset.theme = 'midnight'`);
    await page.evaluate(`Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished))`);
    const darkShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    await writeFile(resolve(output, 'en-list-dark-1440.png'), Buffer.from(darkShot.data, 'base64'));
    // Import confirmation writes real native bookmarks only in this isolated profile.
    const importSource = await peer.evaluate(`(async () => {
      const category = (await SuperTabOutBookmarks.createCategory({ name: '迁移测试' })).result;
      const folder = (await SuperTabOutBookmarks.createFolder({ name: '设计文档', categoryId: category.id })).result;
      await SuperTabOutBookmarks.createBookmark({ title: '原始参数链接', url: 'https://import.test/path?q=1#section', folderId: folder.id, note: '迁移后仍保留备注' });
      await SuperTabOutBookmarks.createBookmark({ title: '分类直属链接', url: 'https://import.test/direct', categoryId: category.id });
      await chrome.bookmarks.create({ parentId: '${fixture.parent.id}', title: '旧资料', url: 'https://legacy.test/' });
      return (await chrome.storage.local.get('bookmarkLibrary')).bookmarkLibrary;
    })()`);
    await page.navigate(await page.evaluate('location.href'));
    await page.send('Page.bringToFront');
    await page.evaluate(`document.documentElement.dataset.lang = 'zh'; document.documentElement.dataset.theme = 'white'; document.dispatchEvent(new Event('super-tab-out-language-change')); document.querySelector('[data-workspace-switch="bookmarks"]').click(); document.querySelector('#nativeLegacy').open = true; document.querySelector('[data-native-action="import-legacy"]').click()`);
    await page.waitFor(`document.querySelector('#legacyImportDialog').open && document.querySelector('#legacyImportTarget')`);
    assert.equal(await page.evaluate(`document.querySelector('#legacyImportTarget').value`), fixture.parent.id);
    assert.equal(await page.evaluate(`document.querySelectorAll('#legacyImportDialog input[type="checkbox"], #legacyImportDialog [data-import-action="more"]').length`), 0);
    assert.equal(await page.evaluate(`document.querySelector('[data-import-action="start"]').textContent`), '全部导入（3 条）');
    assert.match(await page.evaluate(`document.querySelector('#legacyImportContent').textContent`), /相同名称或网址也会按旧库结构保留/);
    assert.equal(await page.evaluate(`document.querySelector('#legacyImportFeedback').textContent`), '');
    const previewShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    await writeFile(resolve(output, 'legacy-import-preview.png'), Buffer.from(previewShot.data, 'base64'));
    await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 1, mobile: false });
    assert.equal(await page.evaluate(`(() => { const rect = document.querySelector('#legacyImportDialog').getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; })()`), true, 'import preview fits a narrow viewport');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await page.evaluate(`document.querySelector('[data-import-action="start"]').click()`);
    await page.waitFor(`document.querySelector('#legacyImportContent h3')?.textContent === '导入完成'`);
    const imported = await page.evaluate(`chrome.storage.local.get('legacyBookmarkImport').then(data => data.legacyBookmarkImport)`);
    const importedRoot = imported.ops.find(op => op.key === 'root').targetId;
    assert.equal(imported.ops.filter(op => op.url !== undefined && op.status === 'done').length, 3);
    assert.deepEqual(await page.evaluate(`chrome.storage.local.get('bookmarkLibrary').then(data => data.bookmarkLibrary)`), importSource);
    const importedTree = await page.evaluate(`chrome.bookmarks.getSubTree('${importedRoot}')`);
    const importedCategory = importedTree[0].children.find(node => node.title === '迁移测试');
    assert.equal(importedCategory.children.find(node => node.title === '设计文档').children[0].url, 'https://import.test/path?q=1#section');
    assert.equal(importedCategory.children.some(node => node.title === '分类直属链接'), true);
    await page.waitFor(`document.querySelector('#nativeFolderTitle').textContent === 'BrowseLoom 旧书签'`);
    const resultShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, 30000);
    await writeFile(resolve(output, 'legacy-import-result.png'), Buffer.from(resultShot.data, 'base64'));
    const afterImport = await page.evaluate(`chrome.bookmarks.getTree()`);
    await page.evaluate(`document.querySelector('#legacyImportClose').click(); document.querySelector('[data-native-action="import-legacy"]').click()`);
    await page.waitFor(`document.querySelector('#legacyImportContent h3')?.textContent === '导入完成'`);
    assert.deepEqual(await page.evaluate(`chrome.bookmarks.getTree()`), afterImport, 'reopening import does not duplicate native bookmarks');
    assert.equal((await peer.evaluate(`chrome.runtime.sendMessage({ type: 'legacy-bookmark-import', action: 'preview', lang: 'zh' })`)).result.phase, 'complete', 'second pages share the same completed batch');
    await page.evaluate(`document.querySelector('#legacyImportClose').click()`);
    const manage = await page.evaluate(`(async () => {
      const parent = (await chrome.bookmarks.getTree())[0].children[0];
      const source = await chrome.bookmarks.create({parentId: parent.id, title: 'Management test'});
      const target = await chrome.bookmarks.create({parentId: parent.id, title: 'Destination test'});
      const link = await chrome.bookmarks.create({parentId: source.id, title: 'Move me', url: 'https://example.com/move'});
      return {source, target, link};
    })()`);
    for (const item of [manage.link, manage.source]) {
      await page.evaluate(`SuperTabOutBookmarkSearch.setQuery(${JSON.stringify(item.title)})`);
      await page.waitFor(`document.querySelector('[data-native-manage="${item.id}"]')`);
      await page.evaluate(`document.querySelector('[data-native-manage="${item.id}"]').click(); document.querySelector('[data-choice="move"]').click(); document.querySelector('input[value="${manage.target.id}"]').click(); document.querySelector('[data-choice="confirm"]').click()`);
      await page.waitFor(`!document.querySelector('.native-management-dialog')`);
      assert.equal((await page.evaluate(`chrome.bookmarks.get('${item.id}')`))[0].parentId, manage.target.id);
    }
    await page.evaluate(`SuperTabOutBookmarkSearch.setQuery('Destination test')`);
    await page.waitFor(`document.querySelector('[data-native-manage="${manage.target.id}"]')`);
    await page.evaluate(`document.querySelector('[data-native-manage="${manage.target.id}"]').click()`);
    const deleteMenuShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(resolve(output, 'delete-menu.png'), Buffer.from(deleteMenuShot.data, 'base64'));
    assert.equal(await page.evaluate(`getComputedStyle(document.querySelector('#nativeContextMenu [data-choice="delete"]')).color !== getComputedStyle(document.querySelector('#nativeContextMenu [data-choice="edit"]')).color`),true);
    await page.evaluate(`document.querySelector('[data-choice="delete"]').click()`);
    assert.equal(await page.evaluate(`document.querySelector('[data-choice="confirm"]').classList.contains('native-danger')`),true);
    assert.equal(await page.evaluate(`document.activeElement.dataset.choice`),'cancel');
    const deleteConfirmShot = await page.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    await writeFile(resolve(output, 'delete-confirm.png'), Buffer.from(deleteConfirmShot.data, 'base64'));
    await page.evaluate(`document.querySelector('[data-choice="cancel"]').click()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    assert.equal((await page.evaluate(`chrome.bookmarks.get('${manage.target.id}')`)).length, 1);
    await page.evaluate(`document.querySelector('[data-native-manage="${manage.target.id}"]').click(); document.querySelector('[data-choice="delete"]').click(); document.querySelector('[data-choice="confirm"]').click()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    assert.equal(await page.evaluate(`chrome.bookmarks.get('${manage.link.id}').then(() => false, () => true)`), true);
    await page.evaluate(`document.querySelector('[data-native-action="context"]').click(); document.querySelector('[data-native-action="add-folder"]').click(); document.querySelector('.native-management-dialog input[name="title"]').value = 'Created in UI'; document.querySelector('.native-management-dialog form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    const created = (await page.evaluate(`chrome.bookmarks.search({title: 'Created in UI'})`))[0];
    assert.ok(created);
    await page.evaluate(`SuperTabOutBookmarkSearch.setQuery('Created in UI')`);
    await page.waitFor(`document.querySelector('[data-native-manage="${created.id}"]')`);
    await page.evaluate(`document.querySelector('[data-native-manage="${created.id}"]').click(); document.querySelector('[data-choice="edit"]').click(); document.querySelector('input[name="title"]').value = 'Renamed in UI'; document.querySelector('.native-management-dialog form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    assert.equal((await page.evaluate(`chrome.bookmarks.get('${created.id}')`))[0].title, 'Renamed in UI');
    await page.evaluate(`document.querySelector('[data-native-action="context"]').click(); document.querySelector('[data-native-action="add-bookmark"]').click(); document.querySelector('input[name="title"]').value = 'Created link'; document.querySelector('input[name="url"]').value = 'https://example.com/new'; document.querySelector('select[name="parentId"]').value = '${created.id}'; document.querySelector('.native-management-dialog form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    const linkCreated = (await page.evaluate(`chrome.bookmarks.search({title: 'Created link'})`))[0];
    assert.equal(linkCreated.parentId, created.id);
    await page.evaluate(`SuperTabOutBookmarkSearch.setQuery('Created link')`);
    await page.waitFor(`document.querySelector('[data-native-manage="${linkCreated.id}"]')`);
    await page.evaluate(`document.querySelector('[data-native-manage="${linkCreated.id}"]').click(); document.querySelector('[data-choice="edit"]').click(); document.querySelector('input[name="url"]').value = 'https://example.com/edited'; document.querySelector('.native-management-dialog form').requestSubmit()`);
    await page.waitFor(`!document.querySelector('.native-management-dialog')`);
    assert.equal((await page.evaluate(`chrome.bookmarks.get('${linkCreated.id}')`))[0].url, 'https://example.com/edited');
    const second = await page.evaluate(`chrome.bookmarks.create({parentId:'${created.id}',title:'Second',url:'https://example.com/second'})`);
    await page.evaluate(`document.querySelector('[data-native-folder="${created.id}"]').click(); document.querySelector('#nativeSort').value='native'; document.querySelector('#nativeSort').dispatchEvent(new Event('change'))`);
    await page.waitFor(`document.querySelector('[data-native-id="${second.id}"]')`);
    await page.evaluate(`(() => {
      const source=document.querySelector('[data-native-id="${second.id}"]');
      const target=document.querySelector('[data-native-id="${linkCreated.id}"]');
      const dataTransfer=new DataTransfer(); const rect=target.getBoundingClientRect();
      source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY:rect.top+2}));
    })()`);
    await page.waitFor(`chrome.bookmarks.getChildren('${created.id}').then(items=>items[0].id==='${second.id}')`);
    await page.waitFor(`document.querySelector('#bookmarkList [data-native-id]')?.dataset.nativeId === '${second.id}'`);
    await page.evaluate(`(() => {
      const source=document.querySelector('[data-native-id="${second.id}"]');
      const target=document.querySelector('#bookmarkLibraryNav [data-native-folder="${created.parentId}"]');
      const dataTransfer=new DataTransfer(); source.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer}));
      const rect=target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer,clientY:rect.top+rect.height/2}));
    })()`);
    await page.waitFor(`chrome.bookmarks.get('${second.id}').then(items=>items[0].parentId==='${created.parentId}')`);
    assert.deepEqual(page.errors.filter(error => !error.includes('config.local.js')), []);
    console.log('Verified native hierarchy, search, duplicate URLs, external mutations, preferences, legacy preservation, permission/error states and responsive layouts.');
  } finally {
    peer.close();
    await new Promise(done => iconServer.close(done));
  }
}
