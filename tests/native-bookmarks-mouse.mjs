import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

export async function testNativeBookmarksMouse(page) {
  await page.send('Page.bringToFront');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  const root = await page.evaluate(`(async()=>{const parent=(await chrome.bookmarks.getTree())[0].children[0]; return chrome.bookmarks.create({parentId:parent.id,title:'Mouse acceptance'});})()`);
  async function point(selector, ratio = .5) {
    return page.evaluate(`(async()=>{await document.fonts.ready; const el=document.querySelector(${JSON.stringify(selector)}); if(!el) throw Error('Missing target'); el.scrollIntoView({block:'center',behavior:'instant'});await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));const r=el.getBoundingClientRect();return {x:r.left+r.width*.5,y:r.top+r.height*${ratio}};})()`);
  }
  async function click(selector) {
    const p=await point(selector);
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...p});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...p,button:'left',clickCount:1});
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...p,button:'left',clickCount:1});
  }
  async function fill(selector,text) {
    await click(selector);
    await page.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
    await page.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
    await page.send('Input.insertText',{text});
  }
  async function closed(){await page.waitFor(`!document.querySelector('.native-management-dialog')`);}
  async function find(title){return (await page.evaluate(`chrome.bookmarks.search({title:${JSON.stringify(title)}})`))[0];}
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await click('[data-workspace-switch="bookmarks"]');
  await page.waitFor(`document.body.dataset.workspace === 'bookmarks'`);
  await page.waitFor(`document.querySelector('[data-native-folder="${root.parentId}"]')`);
  await click(`#bookmarkLibraryNav [data-native-folder="${root.parentId}"]`);
  await page.waitFor(`document.querySelector('[data-native-folder="${root.id}"]')`);
  await click(`[data-native-folder="${root.id}"]`);
  await page.waitFor(`document.querySelector('#nativeFolderTitle').textContent === 'Mouse acceptance'`);
  const contextPoint=await point('#nativeFolderTitle');
  await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...contextPoint,button:'right',clickCount:1});
  await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...contextPoint,button:'right',clickCount:1});
  await page.waitFor(`document.querySelector('#nativeContextMenu')?.matches(':popover-open')`);
  await click('[data-native-action="add-folder"]');
  await fill('input[name="title"]','Destination');
  await click('.native-management-dialog button[type="submit"]'); await closed();
  const destination=await find('Destination'); assert.equal(destination.parentId,root.id);
  const links=[];
  for(const title of ['Alpha','Bravo','Charlie']) {
    await click('[data-native-action="context"]');
    await click('[data-native-action="add-bookmark"]');
    await fill('input[name="title"]',title); await fill('input[name="url"]',`https://example.com/${title}`);
    await click('.native-management-dialog button[type="submit"]'); await closed(); links.push(await find(title));
  }
  await click(`[data-native-manage="${links[0].id}"]`);
  assert.equal(await page.evaluate(`document.querySelector('dialog[open]') === null && document.querySelectorAll('#nativeContextMenu [data-choice]').length === 3`),true);
  await click('[data-choice="edit"]');
  assert.equal(await page.evaluate(`(()=>{const input=document.querySelector('input[name="title"]');return input.selectionStart===0 && input.selectionEnd===input.value.length})()`),true);
  await fill('input[name="title"]','Alpha edited'); await fill('input[name="url"]','https://example.com/edited');
  await click('.native-management-dialog button[type="submit"]'); await closed();
  assert.equal((await find('Alpha edited')).url,'https://example.com/edited');
  await click(`[data-native-manage="${destination.id}"]`); await click('[data-choice="edit"]');
  await fill('input[name="title"]','Renamed folder'); await click('.native-management-dialog button[type="submit"]'); await closed();
  assert.equal((await find('Renamed folder')).id,destination.id);
  async function drag(id,selector,ratio=.5,fromSidebar=false) {
    const start=await point(fromSidebar ? `#bookmarkLibraryNav .native-tree-folder[data-native-folder="${id}"]` : `[data-native-id="${id}"] .native-item-label`);
    const end=await point(selector,ratio);
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...start});
    await page.send('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
    for(let step=1;step<=16;step++) {
      await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+(end.x-start.x)*step/16,y:start.y+(end.y-start.y)*step/16,button:'left',buttons:1});
    }
    await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await page.send('Input.dispatchMouseEvent',{type:'mouseMoved',...end,button:'left',buttons:1});
    await page.evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await page.send('Input.dispatchMouseEvent',{type:'mouseReleased',...end,button:'left',buttons:0,clickCount:1});
  }
  const children=()=>page.evaluate(`chrome.bookmarks.getChildren('${root.id}').then(items=>items.map(x=>x.id))`);
  await drag(links[2].id,`[data-native-id="${links[0].id}"]`,.08);
  await page.waitFor(`chrome.bookmarks.getChildren('${root.id}').then(a=>a[1].id==='${links[2].id}')`);
  assert.deepEqual(await children(),[destination.id,links[2].id,links[0].id,links[1].id]);
  await drag(links[2].id,`[data-native-id="${links[1].id}"]`,.92);
  await page.waitFor(`chrome.bookmarks.getChildren('${root.id}').then(a=>a[3].id==='${links[2].id}')`);
  await drag(links[0].id,`[data-native-id="${destination.id}"]`);
  await page.waitFor(`chrome.bookmarks.get('${links[0].id}').then(a=>a[0].parentId==='${destination.id}')`);
  await drag(links[1].id,`#bookmarkLibraryNav [data-native-folder="${destination.id}"]`);
  await page.waitFor(`chrome.bookmarks.get('${links[1].id}').then(a=>a[0].parentId==='${destination.id}')`);
  await click(`[data-native-id="${destination.id}"] .native-item-primary`);
  await drag(links[0].id,`#nativeBreadcrumbs [data-native-folder="${root.id}"]`);
  await page.waitFor(`chrome.bookmarks.get('${links[0].id}').then(a=>a[0].parentId==='${root.id}')`);
  assert.deepEqual(await page.evaluate(`chrome.bookmarks.getChildren('${destination.id}').then(a=>a.map(n=>n.id))`),[links[1].id]);
  await page.waitFor(`document.querySelector('[data-native-id="${links[1].id}"]')`);
  await click(`#nativeBreadcrumbs [data-native-folder="${root.id}"]`);
  await click('[data-native-action="context"]');
  await click('[data-native-action="add-folder"]');
  await fill('input[name="title"]','Folder to move');
  await click('.native-management-dialog button[type="submit"]'); await closed();
  const movingFolder=await find('Folder to move');
  await drag(movingFolder.id,`[data-native-id="${destination.id}"]`);
  await page.waitFor(`chrome.bookmarks.get('${movingFolder.id}').then(a=>a[0].parentId==='${destination.id}')`);
  await click(`[data-native-id="${destination.id}"] .native-item-primary`);
  await page.waitFor(`document.querySelector('[data-native-id="${movingFolder.id}"]')`);
  const nav = id => `#bookmarkLibraryNav .native-tree-folder[data-native-folder="${id}"]`;
  // Move out using a sidebar source and a sidebar edge (across parents).
  await drag(movingFolder.id,nav(destination.id),.92,true);
  await page.waitFor(`chrome.bookmarks.get('${movingFolder.id}').then(a=>a[0].parentId==='${root.id}')`);
  await page.waitFor(`document.querySelector(${JSON.stringify(nav(movingFolder.id))})`);
  const folderOrder = () => page.evaluate(`chrome.bookmarks.getChildren('${root.id}').then(a=>a.filter(n=>!n.url).map(n=>n.id))`);
  assert.deepEqual(await folderOrder(),[destination.id,movingFolder.id]);
  // Same-parent reorder in both directions, starting from the navigation.
  await drag(movingFolder.id,nav(destination.id),.08,true);
  await page.waitFor(`chrome.bookmarks.getChildren('${root.id}').then(a=>a.filter(n=>!n.url)[0].id==='${movingFolder.id}')`);
  await page.waitFor(`Array.from(document.querySelectorAll('#bookmarkLibraryNav .native-tree-folder')).findIndex(n=>n.dataset.nativeFolder==='${movingFolder.id}') < Array.from(document.querySelectorAll('#bookmarkLibraryNav .native-tree-folder')).findIndex(n=>n.dataset.nativeFolder==='${destination.id}')`);
  await drag(movingFolder.id,nav(destination.id),.92,true);
  await page.waitFor(`chrome.bookmarks.getChildren('${root.id}').then(a=>a.filter(n=>!n.url)[1].id==='${movingFolder.id}')`);
  // Center drop moves into a folder, not beside it.
  await drag(movingFolder.id,nav(destination.id),.5,true);
  await page.waitFor(`chrome.bookmarks.get('${movingFolder.id}').then(a=>a[0].parentId==='${destination.id}')`);
  await page.waitFor(`document.querySelector('[data-native-id="${movingFolder.id}"]')`);
  const beforeInvalid = await page.evaluate(`chrome.bookmarks.getSubTree('${root.id}')`);
  await drag(destination.id,nav(movingFolder.id),.5,true);
  assert.deepEqual(await page.evaluate(`chrome.bookmarks.getSubTree('${root.id}')`),beforeInvalid,'Cannot move a folder into a descendant');
  assert.equal(await page.evaluate(`document.querySelector(${JSON.stringify(nav(root.parentId))}).draggable`),false,'System folders are not draggable');
  // A sidebar source can also move into the right-hand view via breadcrumbs.
  await drag(movingFolder.id,`#nativeBreadcrumbs [data-native-folder="${root.id}"]`,.5,true);
  await page.waitFor(`chrome.bookmarks.get('${movingFolder.id}').then(a=>a[0].parentId==='${root.id}')`);
  console.log('Sidebar mouse acceptance passed: reorder up/down, cross-parent edge, center move, breadcrumb move, cycle and system-folder protection.');
  await mkdir('output/native-bookmarks',{recursive:true});
  const shot=await page.send('Page.captureScreenshot',{format:'png',fromSurface:true});
  await writeFile('output/native-bookmarks/mouse-acceptance.png',Buffer.from(shot.data,'base64'));
  assert.deepEqual(page.errors.filter(error=>!error.includes('config.local.js')),[]);
  console.log('Headed mouse acceptance passed: UI create/edit/rename; reorder up/down; folder-center, sidebar and breadcrumb moves.');
}
