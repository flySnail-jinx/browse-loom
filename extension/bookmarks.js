/* Native bookmark workspace with explicitly confirmed legacy import. */
(function () {
  'use strict';
  const Native = window.SuperTabOutNativeBookmarks;
  const Storage = window.SuperTabOutStorage;
  const escapeHtml = window.SuperTabOutHtml.escapeHtml;
  const PREF_KEY = 'nativeBookmarkPreferences';
  const reader = Native?.createReader();
  const state = {
    status: 'idle', index: Native?.indexTree([]), permissionGranted: false, folderId: null, query: '',
    expanded: new Set(), restoreExpanded: false, view: 'list', defaultFolderId: null, startupMode: 'last', sort: 'native',
    legacy: null, busy: false, message: '', visibleLimit: 120, externalFavicons: false,
  };
  let workspaceSwipeDelta = 0;
  let workspaceSwipeTimer = null;
  let workspaceSwipeLockedUntil = 0;
  let searchTimer;
  let prefQueue = Promise.resolve();
  const COPY = {
    en: {
      addBookmark: 'Add bookmark', addFolder: 'New folder', edit: 'Edit', rename: 'Rename', name: 'Name', url: 'URL (https://…)', save: 'Save', dragHint: 'Drag edges to reorder in Browser order; drop in the center of a folder to move inside.',
      actions: 'Manage', move: 'Move to…', delete: 'Delete', cancel: 'Cancel', confirm: 'Confirm', current: 'Current location', destination: 'Destination folder', done: 'Bookmarks updated.', failed: 'Could not complete the operation. The item or destination may have changed, or access was removed. Refresh and try again.', deleteWarning: 'This deletes the item and, for folders, all bookmarks and subfolders inside it from your browser. Browser sync may apply the deletion to other devices. This page cannot undo it.',
      bookmarks: 'Bookmarks', tabs: 'Tabs', workspaces: 'Switch pages', folders: 'Folders', all: 'Browser bookmarks',
      search: 'Search all bookmarks by title or URL', results: 'Search results', grid: 'Grid', list: 'List',
      connect: 'Connect browser bookmarks', connected: 'Bookmarks connected', disconnect: 'Remove access',
      intro: 'Your browser bookmarks, in one place',
      access: 'Browse, move and delete browser bookmarks here. Changes also apply to your browser.',
      disclosure: 'The browser permission says “read and change bookmarks”. Browsing only reads bookmarks. Moving, deleting and importing write to browser bookmarks only when you confirm.',
      upgrade: 'This page now shows browser bookmarks directly. Your old extension bookmarks remain stored locally.',
      syncing: 'Account bookmarks', local: 'This device', managed: 'Managed by your organization',
      untitled: 'Untitled bookmark', untitledFolder: 'Untitled folder', empty: 'This folder is empty',
      emptyBody: 'Right-click here or use the actions menu to add a bookmark or folder.',
      noResults: 'No matching bookmarks', noResultsBody: 'Try a title or part of a URL.', clear: 'Clear search',
      loading: 'Reading browser bookmarks…', error: 'Could not read browser bookmarks',
      errorBody: 'Check bookmark access, then try again.', retry: 'Try again', refresh: 'Refresh',
      unsupported: 'Browser bookmark access is unavailable', denied: 'Access was not granted. You can connect again when ready.',
      manager: 'Manage in browser', readOnly: 'Changes apply directly to browser bookmarks. In Browser order, drag edges to reorder or a folder center to move inside.',
      bookmarkView: 'Bookmark layout', path: 'Location', locate: 'Show in folder',
      legacy: 'Old extension bookmarks', legacyBody: 'Import titles, addresses and folders directly into Chrome. Notes and custom icons stay in the old library; exporting a backup is optional.',
      importLegacy: 'Import into Chrome', export: 'Export backup', exported: 'Backup download started. Keep the JSON file in a safe place.',
      startup: 'When opening bookmarks', startupLast: 'Restore last state', startupRoot: 'Open first top-level folder',
      defaultFolder: 'Use this as start folder', defaultSaved: 'Start folder saved.', prefsError: 'Could not save your view preference. Try again.',
      removed: 'The previous folder is no longer available. Showing its nearest available parent.',
      restricted: 'This address cannot be opened here. Use your browser bookmark manager.',
      native: 'Browser order', title: 'Name', added: 'Date added', sort: 'Display order',
      more: 'Show more', copy: 'Copy address', copied: 'Address copied.', copyError: 'Could not copy. Try again.',
      capture: 'Saving bookmarks here is coming next. Open the original page and use the browser’s bookmark star to save it.',
      count: n => `${n} items`, showCount: (n, total) => `Showing ${n} of ${total}`, expand: 'Expand folder', collapse: 'Collapse folder',
    },
    zh: {
      addBookmark: '新增书签', addFolder: '新增文件夹', edit: '编辑', rename: '重命名', name: '名称', url: '网址（https://…）', save: '保存', dragHint: '浏览器顺序下拖到边缘可排序；拖到文件夹中央可移入。',
      actions: '管理', move: '移动到…', delete: '删除', cancel: '取消', confirm: '确认', current: '当前位置', destination: '目标文件夹', done: '已更新浏览器书签。', failed: '操作未完成：项目或目标目录可能已变更，或授权已取消。请刷新后重试。', deleteWarning: '将从浏览器删除此项目；如果是文件夹，其中所有书签和子文件夹也会删除。浏览器同步可能将删除同步到其他设备。本页面不支持撤销。',
      bookmarks: '书签', tabs: '标签页', workspaces: '页面切换', folders: '文件夹', all: '浏览器书签',
      search: '搜索全部书签的名称或网址', results: '搜索结果', grid: '网格', list: '列表',
      connect: '连接浏览器书签', connected: '已连接浏览器书签', disconnect: '取消授权',
      intro: '直接浏览你的浏览器书签',
      access: '在这里浏览、移动和删除浏览器书签，操作也会同步影响浏览器。',
      disclosure: '浏览器权限提示会写“读取和修改书签”。日常浏览只读取；确认移动、删除或导入后，才修改浏览器书签。',
      upgrade: '这里现在直接显示浏览器书签。原有插件书签仍保存在本地。',
      syncing: '账户书签', local: '此设备', managed: '由组织管理',
      untitled: '未命名书签', untitledFolder: '未命名文件夹', empty: '此文件夹还没有书签',
      emptyBody: '右键此处，或打开操作菜单，新增书签和文件夹。',
      noResults: '没有找到匹配的书签', noResultsBody: '试试名称或网址中的一部分。', clear: '清除搜索',
      loading: '正在读取浏览器书签…', error: '暂时无法读取浏览器书签',
      errorBody: '请检查书签授权，然后重试。', retry: '重试', refresh: '刷新',
      unsupported: '当前无法访问浏览器书签', denied: '未获授权。你可以稍后再次连接。',
      manager: '在浏览器中管理', readOnly: '操作直接修改浏览器书签。浏览器顺序下拖到边缘可排序，拖到文件夹中央可移入。',
      bookmarkView: '书签排列', path: '所在位置', locate: '所在文件夹',
      legacy: '旧插件书签', legacyBody: '可直接把名称、网址和文件夹导入 Chrome。备注与自定义图标仍保留在旧库，导出备份是可选操作。',
      importLegacy: '直接导入 Chrome', export: '导出备份', exported: '已发起备份下载，请妥善保存 JSON 文件。',
      startup: '打开书签时', startupLast: '恢复上次状态', startupRoot: '打开首个顶层文件夹',
      defaultFolder: '设为默认文件夹', defaultSaved: '已设置默认文件夹。', prefsError: '展示偏好保存失败，请重试。',
      removed: '原文件夹已不存在，已返回最近仍存在的上级。',
      restricted: '暂不支持在这里打开此类网址，请在浏览器书签管理器中操作。',
      native: '浏览器顺序', title: '名称', added: '添加时间', sort: '展示顺序',
      more: '显示更多', copy: '复制网址', copied: '已复制网址。', copyError: '复制失败，请重试。',
      capture: '页面内收藏将在下一阶段提供。请回到原网页，使用浏览器的收藏星标保存。',
      count: n => `${n} 项`, showCount: (n, total) => `已显示 ${n} / ${total} 项`, expand: '展开文件夹', collapse: '收起文件夹',
    },
  };
  const $ = id => document.getElementById(id);
  const language = () => document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
  function t(key, ...args) { const value = COPY[language()][key]; return typeof value === 'function' ? value(...args) : value || key; }
  function title(node) { return node?.title || t(node?.url === undefined ? 'untitledFolder' : 'untitled'); }
  function showToast(message) { window.SuperTabOutToast?.show?.(message); }
  function scope(node) {
    if (node.unmodifiable) return t('managed');
    return typeof node.syncing === 'boolean' ? t(node.syncing ? 'syncing' : 'local') : '';
  }
  function path(id) { return Native.pathFor(state.index, id); }
  function folderIcon() { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><path d="M3 8h18"/></svg>'; }
  function folderButton(id, label, extra = '') {
    return `<button type="button" data-native-folder="${escapeHtml(id || '')}" ${extra}>${escapeHtml(label)}</button>`;
  }
  function renderNavigation() {
    const rows = [];
    function visit(id, depth) {
      const node = state.index.nodes.get(id);
      if (!node || node.url !== undefined) return;
      const children = node.children.filter(child => state.index.nodes.get(child)?.url === undefined);
      const expanded = state.expanded.has(id);
      const source = depth === 0 ? scope(node) : '';
      const accessibleTitle = source ? `${title(node)} · ${source}` : title(node);
      rows.push(`<div class="native-tree-row" style="--depth:${Math.min(depth, 12)}">
        ${children.length ? `<button class="native-tree-toggle" type="button" data-native-expand="${escapeHtml(id)}" aria-expanded="${expanded}" aria-label="${escapeHtml(t(expanded ? 'collapse' : 'expand') + ': ' + title(node))}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true" style="transform:rotate(${expanded ? 90 : 0}deg)"><path d="m6 4 4 4-4 4"/></svg></button>` : '<span class="native-tree-spacer"></span>'}
        <button type="button" class="native-tree-folder" draggable="${Native.canModify(state.index, id)}" data-native-folder="${escapeHtml(id)}" title="${escapeHtml(accessibleTitle)}" aria-label="${escapeHtml(accessibleTitle)}" ${children.length ? `aria-expanded="${expanded}"` : ''} ${state.folderId === id ? 'aria-current="page"' : ''}>${folderIcon()}<span>${escapeHtml(title(node))}</span><span class="native-tree-count">${node.children.length}</span></button>
      </div>`);
      if (expanded) children.forEach(child => visit(child, depth + 1));
    }
    if (state.status === 'ready') state.index.roots.forEach(id => visit(id, 0));
    const nav = $('bookmarkLibraryNav');
    const scroll = nav.scrollTop;
    const focused = document.activeElement;
    const hadFocus = nav.contains(focused);
    const focusId = focused?.dataset.nativeExpand ?? focused?.dataset.nativeFolder;
    const focusKind = focused?.hasAttribute('data-native-expand') ? 'data-native-expand' : 'data-native-folder';
    nav.innerHTML = rows.join('');
    nav.scrollTop = scroll;
    if (focusId !== undefined && hadFocus) {
      nav.querySelector(`[${focusKind}="${CSS.escape(focusId)}"]`)?.focus({ preventScroll: true });
    }
  }
  function renderCopy() {
    document.querySelectorAll('[data-bookmark-copy]').forEach(el => { el.textContent = t(el.dataset.bookmarkCopy); });
    $('bookmarkWorkspace').setAttribute('aria-label', t('bookmarks'));
    $('bookmarkLibraryNav').setAttribute('aria-label', t('folders'));
    $('nativeBreadcrumbs').setAttribute('aria-label', t('path'));
    document.querySelector('[data-native-action="context"]')?.setAttribute('aria-label', t('actions'));
    $('bookmarkViewToggle').setAttribute('aria-label', t('bookmarkView'));
    if ($('bookmarkSearch').dataset.searchMode !== 'external') $('bookmarkSearch').placeholder = t('search');
    if ($('bookmarkSearch').dataset.searchMode !== 'external') $('bookmarkSearch').setAttribute('aria-label', t('search'));
    $('workspaceSwitcher').setAttribute('aria-label', t('workspaces'));
    for (const workspace of ['tabs', 'bookmarks']) {
      const button = document.querySelector(`[data-workspace-switch="${workspace}"]`);
      button.setAttribute('aria-label', t(workspace));
      button.querySelector('span').textContent = t(workspace);
    }
    document.querySelectorAll('[data-bookmark-view]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.bookmarkView === state.view));
      button.setAttribute('aria-label', t(button.dataset.bookmarkView));
      button.title = t(button.dataset.bookmarkView);
    });
  }
  function itemMarkup(node) {
    const isFolder = node.url === undefined;
    const allowed = !isFolder && Native.canOpen(node.url);
    const label = escapeHtml(title(node));
    let favicon = '';
    if (allowed) {
      const browserIcon = new URL(chrome.runtime.getURL('/_favicon/'));
      browserIcon.searchParams.set('pageUrl', node.url);
      browserIcon.searchParams.set('size', '64');
      favicon = browserIcon.href;
    }
    const icon = isFolder ? folderIcon() : `<svg class="native-site-placeholder" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>${favicon ? `<img src="${escapeHtml(favicon)}" alt="" loading="lazy" data-native-favicon data-native-icon-source="browser" data-native-icon-domain="${escapeHtml(new URL(node.url).hostname)}">` : ''}`;
    let address = node.url;
    if (allowed) address = new URL(node.url).hostname || node.url;
    const content = `<span class="native-item-icon ${isFolder ? 'is-folder' : ''}">${icon}</span><span class="native-item-label"><strong>${label}</strong><small>${escapeHtml(isFolder ? t('count', node.children.length) : address)}</small></span>`;
    const primary = isFolder
      ? `<button class="native-item-primary" type="button" data-native-folder="${escapeHtml(node.id)}" title="${label}">${content}</button>`
      : allowed
        ? `<a class="native-item-primary" href="${escapeHtml(node.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(node.url)}">${content}</a>`
        : `<button class="native-item-primary" type="button" data-native-action="restricted" title="${escapeHtml(node.url)}">${content}</button>`;
    const location = state.query ? `<div class="native-item-path">${escapeHtml(path(node.parentId).map(title).join(' / ') || t('all'))}${folderButton(node.parentId === state.index.rootId ? '' : node.parentId, t('locate'))}</div>` : '';
    return `<article class="native-item${isFolder ? ' native-folder-item' : ''}" data-native-id="${escapeHtml(node.id)}" draggable="${Native.canModify(state.index, node.id)}">${primary}${Native.canModify(state.index, node.id) ? `<button type="button" class="native-manage" data-native-manage="${escapeHtml(node.id)}" aria-label="${escapeHtml(t('actions') + ': ' + title(node))}" title="${escapeHtml(t('actions'))}">…</button>` : ''}${!isFolder ? `<button class="native-copy" type="button" data-native-copy="${escapeHtml(node.id)}" aria-label="${escapeHtml(t('copy') + ': ' + title(node))}" title="${escapeHtml(t('copy'))}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V4H4v12h4"/></svg></button>` : ''}${location}</article>`;
  }
  function renderMain() {
    const focused = document.activeElement;
    const inMain = $('bookmarkMain').contains(focused);
    const itemId = focused?.closest?.('[data-native-id]')?.dataset.nativeId;
    const folderId = focused?.dataset.nativeFolder;
    const action = focused?.dataset.nativeAction;
    const copy = focused?.hasAttribute('data-native-copy');
    renderMainContents();
    if (inMain && !focused.isConnected) {
      const selector = itemId
        ? `[data-native-id="${CSS.escape(itemId)}"] ${copy ? '.native-copy' : '.native-item-primary'}`
        : folderId !== undefined ? `[data-native-folder="${CSS.escape(folderId)}"]`
        : action ? `[data-native-action="${CSS.escape(action)}"]` : null;
      const replacement = selector && $('bookmarkMain').querySelector(selector);
      (replacement || $('nativeFolderTitle')).focus({ preventScroll: true });
    }
  }
  function renderMainContents() {
    const ready = state.status === 'ready';
    const crumbs = [];
    if (ready) path(state.folderId).forEach(node => crumbs.push(crumbs.length ? '<span aria-hidden="true">/</span>' : '', folderButton(node.id, title(node), `title="${escapeHtml(title(node))}"`)));
    $('nativeBreadcrumbs').innerHTML = crumbs.join('');
    $('nativeFolderTitle').textContent = state.query ? t('results') : state.folderId ? title(state.index.nodes.get(state.folderId)) : t('all');
    $('nativeFolderTools').hidden = !ready;

    $('nativeStartupMode').value = state.startupMode;
    $('nativeSort').value = state.sort;
    $('bookmarkGrid').hidden = true;
    $('bookmarkList').hidden = true;
    $('bookmarkGrid').replaceChildren();
    $('bookmarkList').replaceChildren();
    $('nativeMore').hidden = true;
    $('nativeItemCount').textContent = '';
    const empty = $('bookmarkEmpty');
    empty.hidden = false;
    empty.replaceChildren();
    $('bookmarkMain').setAttribute('aria-busy', String(state.status === 'loading' || state.status === 'idle'));
    function status(heading, body, action, button) {
      empty.innerHTML = `<h2>${escapeHtml(t(heading))}</h2><p>${escapeHtml(t(body))}</p>${action ? `<button type="button" data-native-action="${action}">${escapeHtml(t(button))}</button>` : ''}`;
    }
    if (!ready) {
      if (state.status === 'idle' || state.status === 'loading') {
        empty.innerHTML = `<p role="status">${escapeHtml(t('loading'))}</p><div class="native-skeleton" aria-hidden="true"><i></i><i></i><i></i></div>`;
      } else if (state.status === 'denied') status('intro', 'access', 'connect', 'connect');
      else if (state.status === 'unsupported') status('unsupported', 'readOnly', 'manager', 'manager');
      else status('error', 'errorBody', 'refresh', 'retry');
      return;
    }
    let items = state.query ? Native.search(state.index, state.query) : (state.folderId ? state.index.nodes.get(state.folderId)?.children || [] : state.index.roots).map(id => state.index.nodes.get(id));
    if (state.sort === 'title') items = [...items].sort((a, b) => title(a).localeCompare(title(b), language()));
    if (state.sort === 'added') items = [...items].sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
    $('nativeItemCount').textContent = t('count', items.length);
    if (!items.length) {
      status(state.query ? 'noResults' : 'empty', state.query ? 'noResultsBody' : 'emptyBody', state.query ? 'clear' : 'context', state.query ? 'clear' : 'actions');
      return;
    }
    empty.hidden = true;
    const list = state.query || state.view === 'list';
    const host = $(list ? 'bookmarkList' : 'bookmarkGrid');
    host.hidden = false;
    const visible = items.slice(0, state.visibleLimit);
    if (list && !state.query && state.sort !== 'native') {
      const folders = visible.filter(node => node.url === undefined);
      const links = visible.filter(node => node.url !== undefined);
      host.innerHTML = (folders.length ? `<div class="native-folder-strip">${folders.map(itemMarkup).join('')}</div>` : '') + links.map(itemMarkup).join('');
    } else host.innerHTML = visible.map(itemMarkup).join('');
    $('nativeMore').hidden = items.length <= state.visibleLimit;
    $('nativeMore').textContent = `${t('more')} · ${t('showCount', Math.min(state.visibleLimit, items.length), items.length)}`;
  }
  function renderAll() {
    renderCopy();
    renderNavigation();
    renderMain();
    $('bookmarkImportButton').hidden = state.permissionGranted;
    $('bookmarkImportButton').disabled = state.busy;
    $('bookmarkPermissionRemove').hidden = !state.permissionGranted;
    $('bookmarkPermissionRemove').disabled = state.busy;
    $('bookmarkImportStatus').textContent = state.message ? t(state.message) : '';
    $('nativeStatus').textContent = state.message ? t(state.message) : '';
    $('nativeLegacy').hidden = !state.legacy;
    $('nativeUpgrade').hidden = !state.legacy;
    document.querySelectorAll('[data-native-action="connect"]').forEach(button => { button.disabled = state.busy; });
  }
  async function refreshLibrary() { await reader?.refresh(); }
  function navigate(id) {
    state.folderId = id && id !== state.index.rootId && state.index.nodes.get(id)?.url === undefined ? id : state.index.roots[0] || null;
    state.query = '';
    state.visibleLimit = 120;
    clearTimeout(searchTimer);
    if ($('bookmarkSearch').dataset.searchMode !== 'external') $('bookmarkSearch').value = '';
    path(state.folderId).forEach(node => state.expanded.add(node.id));
    renderAll();
    savePreferences().catch(() => showToast(t('prefsError')));
  }
  function savePreferences() {
    const value = { version: 2, viewMode: state.view, defaultFolderId: state.defaultFolderId, startupMode: state.startupMode, lastFolderId: state.folderId, expandedFolderIds: [...state.expanded], sort: state.sort };
    const result = prefQueue.catch(() => {}).then(() => Storage.set({ [PREF_KEY]: value }));
    prefQueue = result;
    return result;
  }
  async function connect() {
    if (state.busy) return;
    state.busy = true;
    try {
      // Call directly from the click handler to retain the user gesture.
      const permission = chrome.permissions.request({ permissions: ['bookmarks'] });
      renderAll();
      const granted = await permission;
      state.message = granted ? '' : 'denied';
      await refreshLibrary();
    } catch { state.message = 'errorBody'; }
    finally { state.busy = false; renderAll(); }
  }
  let closeContextMenu = () => {};
  function openContext(id, anchor, x, y) {
    if (state.status !== 'ready' || document.querySelector('dialog[open]')) return;
    closeContextMenu();
    const node = state.index.nodes.get(id);
    const parentId = node?.url === undefined ? (node?.id || state.folderId) : node.parentId;
    const menu = document.createElement('div');
    menu.id = 'nativeContextMenu'; menu.className = 'native-context-menu';
    menu.setAttribute('popover', 'manual'); menu.setAttribute('role', 'menu');
    menu.innerHTML = `${Native.canReceive(state.index, parentId) ? `<button role="menuitem" data-native-action="add-bookmark">${escapeHtml(t('addBookmark'))}</button><button role="menuitem" data-native-action="add-folder">${escapeHtml(t('addFolder'))}</button>` : ''}${Native.canModify(state.index, id) ? `<button role="menuitem" data-choice="edit">${escapeHtml(t(node.url === undefined ? 'rename' : 'edit'))}</button><button role="menuitem" data-choice="move">${escapeHtml(t('move'))}</button><button role="menuitem" data-choice="delete" class="native-danger">${escapeHtml(t('delete'))}</button>` : ''}`;
    if (!menu.childElementCount) return;
    const dismiss = new AbortController();
    const close = (restoreFocus = false) => {
      if (menu.matches(':popover-open')) menu.hidePopover();
      menu.remove(); dismiss.abort();
      if (restoreFocus && anchor.isConnected) anchor.focus?.();
    };
    closeContextMenu = close;
    menu.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      event.stopPropagation(); close();
      if (button.dataset.choice === 'edit') openEditor(node);
      else if (button.dataset.choice) openBookmarkAction(id, button.dataset.choice);
      else openEditor(null, button.dataset.nativeAction === 'add-folder', parentId);
    });
    document.addEventListener('pointerdown', event => { if (!menu.contains(event.target)) { close(); } }, { signal: dismiss.signal });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(true); } }, { signal: dismiss.signal });
    menu.addEventListener('keydown', event => {
      if (event.key === 'Tab') { close(true); return; }
      if (!['ArrowDown','ArrowUp','Home','End'].includes(event.key)) return;
      event.preventDefault(); const buttons = [...menu.querySelectorAll('button')];
      const index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length-1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    });
    document.body.append(menu); menu.showPopover();
    const rect = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(x ?? rect.left, innerWidth-menu.offsetWidth-8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y ?? rect.bottom, innerHeight-menu.offsetHeight-8))}px`;
    menu.querySelector('button').focus();
    menu.addEventListener('toggle', event => { if (event.newState === 'closed') close(); });
  }
  function openEditor(node = null, folder = false, parentId = state.folderId) {
    if (document.querySelector('dialog[open]')) return;
    folder = node ? node.url === undefined : folder;
    const dialog = document.createElement('dialog');
    dialog.className = 'native-import-dialog native-management-dialog';
    dialog.setAttribute('aria-labelledby', 'nativeEditorTitle');
    const options = [...state.index.nodes.values()].filter(item => Native.canReceive(state.index, item.id));
    dialog.innerHTML = `<form><h2 id="nativeEditorTitle">${escapeHtml(t(node ? (folder ? 'rename' : 'edit') : (folder ? 'addFolder' : 'addBookmark')))}</h2>
      <label>${escapeHtml(t('name'))}<input name="title" required value="${escapeHtml(node?.title || '')}"></label>
      ${folder ? '' : `<label>${escapeHtml(t('url'))}<input name="url" type="url" required pattern="https?://.*" value="${escapeHtml(node?.url || '')}"></label>`}
      ${node ? '' : `<label>${escapeHtml(t('destination'))}<select name="parentId" required>${options.map(item => `<option value="${escapeHtml(item.id)}" ${item.id === parentId ? 'selected' : ''}>${escapeHtml(path(item.id).map(title).join(' / '))}</option>`).join('')}</select></label>`}
      <p role="alert"></p><div class="native-import-actions"><button type="button" data-editor-cancel>${escapeHtml(t('cancel'))}</button><button type="submit" class="native-import-primary">${escapeHtml(t('save'))}</button></div></form>`;
    dialog.querySelector('input[name="title"]').addEventListener('input', event => event.target.setCustomValidity(''));
    let pending = false;
    dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); $('nativeFolderTitle').focus(); });
    dialog.querySelector('[data-editor-cancel]').onclick = () => { if (!pending) dialog.close(); };
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault();
      if (pending) return;
      const data = Object.fromEntries(new FormData(event.target));
      const name = dialog.querySelector('input[name="title"]');
      name.setCustomValidity(data.title.trim() ? '' : t('name'));
      if (!name.reportValidity()) return;
      pending = true;
      dialog.querySelectorAll('button, input, select').forEach(el => { el.disabled = true; });
      try {
        await Native.mutate(node ? 'update' : 'create', node?.id, data);
        await refreshLibrary(); dialog.close(); showToast(t('done'));
      } catch { dialog.querySelector('[role="alert"]').textContent = t('failed'); }
      finally { pending = false; dialog.querySelectorAll('button, input, select').forEach(el => { el.disabled = false; }); }
    };
    document.body.append(dialog); dialog.showModal();
    dialog.querySelector('input[name="title"]').select();
  }
  let draggingId = null;
  let dropBusy = false;
  function clearDrop() { document.querySelectorAll('[data-drop-position]').forEach(el => el.removeAttribute('data-drop-position')); }
  function dropTarget(event) {
    const item = event.target.closest('[data-native-id]');
    const nav = event.target.closest('[data-native-folder]');
    const targetId = item?.dataset.nativeId || nav?.dataset.nativeFolder;
    const target = state.index.nodes.get(targetId);
    if (!target || !draggingId || targetId === draggingId) return null;
    let position = 'inside';
    const treeFolder = nav?.classList.contains('native-tree-folder') ? nav : null;
    if (item || treeFolder) {
      const rect = (item || treeFolder).getBoundingClientRect();
      const ratio = (event.clientY - rect.top) / rect.height;
      position = target.url === undefined && ratio > .25 && ratio < .75 ? 'inside' : ratio < .5 ? 'before' : 'after';
    }
    if (item && position !== 'inside' && (state.sort !== 'native' || state.query)) return null;
    if (!Native.canReceive(state.index, position === 'inside' ? targetId : target.parentId, draggingId)) return null;
    return { targetId, position, element: item || nav };
  }
  function bindDrag() {
    document.addEventListener('dragstart', event => {
      const id = event.target.closest('[data-native-id]')?.dataset.nativeId
        || event.target.closest('.native-tree-folder')?.dataset.nativeFolder;
      if (dropBusy || !Native.canModify(state.index, id)) { if (event.target.closest('#bookmarkWorkspace')) event.preventDefault(); return; }
      draggingId = id; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', id);
    });
    document.addEventListener('dragover', event => {
      clearDrop(); const target = dropTarget(event);
      if (!target) return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; target.element.dataset.dropPosition = target.position;
    });
    document.addEventListener('dragend', () => { draggingId = null; clearDrop(); });
    document.addEventListener('drop', async event => {
      const target = dropTarget(event); const id = draggingId; draggingId = null; clearDrop();
      if (!target || dropBusy) return;
      event.preventDefault(); dropBusy = true;
      try { await Native.mutate('move', id, { targetId: target.targetId, position: target.position }); await refreshLibrary(); showToast(t('done')); }
      catch { showToast(t('failed')); }
      finally { dropBusy = false; }
    });
  }
  function openBookmarkAction(id, mode) {
    if (!Native.canModify(state.index, id) || document.querySelector('dialog[open]')) return;
    const node = state.index.nodes.get(id);
    const dialog = document.createElement('dialog');
    dialog.className = 'native-import-dialog native-management-dialog';
    dialog.setAttribute('aria-labelledby', 'nativeManagementTitle');
    let pending = false;
    if (!['move', 'delete'].includes(mode)) return;
    function render() {
      dialog.innerHTML = `<h2 id="nativeManagementTitle">${escapeHtml(title(node))}</h2>
        <p>${escapeHtml(t('current'))}: ${escapeHtml(path(node.parentId).map(title).join(' / '))}</p>
        <div class="native-management-body"></div><p role="alert" class="native-management-error"></p>
        <div class="native-import-actions"><button type="button" data-choice="cancel">${escapeHtml(t('cancel'))}</button>
        <button type="button" data-choice="confirm" class="native-import-primary ${mode === 'delete' ? 'native-danger' : ''}">${escapeHtml(t(mode === 'delete' ? 'delete' : 'confirm'))}</button></div>`;
      const body = dialog.querySelector('.native-management-body');
      if (mode === 'delete') body.textContent = t('deleteWarning');
      if (mode === 'move') {
        body.innerHTML = `<fieldset><legend>${escapeHtml(t('destination'))}</legend><div class="native-destination-tree"></div></fieldset>`;
        function branch(parent) {
          return parent.children.map(childId => {
            const child = state.index.nodes.get(childId);
            if (!Native.canReceive(state.index, childId, id)) return '';
            const descendants = branch(child);
            const choice = `<label><input type="radio" name="destination" value="${escapeHtml(childId)}" ${childId === node.parentId ? 'checked' : ''}> ${escapeHtml(title(child))}</label>`;
            return descendants ? `<details ${path(node.parentId).some(item => item.id === childId) ? 'open' : ''}><summary>${choice}</summary><div>${descendants}</div></details>` : `<div>${choice}</div>`;
          }).join('');
        }
        body.querySelector('.native-destination-tree').innerHTML = branch(state.index.nodes.get(state.index.rootId) || { children: state.index.roots });
      }
    }
    function updateMoveButton() {
      if (mode === 'move') dialog.querySelector('[data-choice="confirm"]').disabled = pending || !dialog.querySelector('input:checked') || dialog.querySelector('input:checked').value === node.parentId;
    }
    dialog.addEventListener('change', updateMoveButton);
    dialog.addEventListener('cancel', event => { if (pending) event.preventDefault(); });
    dialog.addEventListener('close', () => { dialog.remove(); $('nativeFolderTitle').focus(); });
    dialog.addEventListener('click', async event => {
      const action = event.target.closest('[data-choice]')?.dataset.choice;
      if (!action || pending) return;
      if (action === 'cancel') return dialog.close();
      if (action !== 'confirm') return;
      const destination = dialog.querySelector('input:checked')?.value;
      if (mode === 'move' && (!destination || destination === node.parentId)) return;
      pending = true;
      dialog.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
      dialog.setAttribute('aria-busy', 'true');
      try {
        await Native.mutate(mode, id, destination);
        await refreshLibrary();
        showToast(t('done'));
        dialog.close();
      } catch {
        dialog.querySelector('.native-management-error').textContent = t('failed');
      } finally {
        pending = false;
        dialog.removeAttribute('aria-busy');
        dialog.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
        updateMoveButton();
      }
    });
    render(); updateMoveButton(); document.body.append(dialog); dialog.showModal();
  }
  async function handleClick(event) {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.nativeManage) return openContext(button.dataset.nativeManage, button);
    if (button.hasAttribute('data-native-folder')) {
      const id = button.dataset.nativeFolder;
      const hasFolders = state.index.nodes.get(id)?.children.some(child => state.index.nodes.get(child)?.url === undefined);
      if (button.classList.contains('native-tree-folder') && id === state.folderId && !state.query && hasFolders) {
        state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
        renderNavigation();
        savePreferences().catch(() => showToast(t('prefsError')));
        $('bookmarkLibraryNav').querySelector(`[data-native-folder="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      } else navigate(id);
      return;
    }
    if (button.hasAttribute('data-native-expand')) {
      const id = button.dataset.nativeExpand;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
      renderNavigation();
      savePreferences().catch(() => showToast(t('prefsError')));
      $('bookmarkLibraryNav').querySelector(`[data-native-expand="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
      return;
    }
    if (button.dataset.bookmarkView) {
      state.view = button.dataset.bookmarkView;
      renderAll();
      try { await savePreferences(); } catch { showToast(t('prefsError')); }
      return;
    }
    if (button.dataset.nativeCopy) {
      const node = state.index.nodes.get(button.dataset.nativeCopy);
      if (!node) return;
      try { await navigator.clipboard.writeText(node.url); showToast(t('copied')); }
      catch { showToast(t('copyError')); }
      return;
    }
    const action = button.dataset.nativeAction;
    if (!action) return;
    if (action === 'context') return openContext(state.folderId, button);
    if (action === 'add-bookmark') return openEditor();
    if (action === 'add-folder') return openEditor(null, true);
    if (action === 'connect') return connect();
    if (action === 'refresh') { state.message = ''; await refreshLibrary(); }
    if (action === 'clear') navigate(state.folderId);
    if (action === 'restricted') showToast(t('restricted'));
    if (action === 'more') { state.visibleLimit += 120; renderMain(); }
    if (action === 'folders') {
      const expanded = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(expanded));
      $('nativeSidebar').classList.toggle('is-open', expanded);
    }
    if (action === 'manager') {
      try { await chrome.tabs.create({ url: navigator.userAgent.includes('Edg/') ? 'edge://favorites/' : 'chrome://bookmarks/' }); }
      catch { showToast(t('errorBody')); }
    }
    if (action === 'disconnect') {
      try { await chrome.permissions.remove({ permissions: ['bookmarks'] }); await refreshLibrary(); }
      catch { showToast(t('errorBody')); }
    }
    if (action === 'import-legacy') return window.SuperTabOutLegacyImportUI.open();
    if (action === 'export' && state.legacy) {
      const blob = new Blob([JSON.stringify({ format: 'browseloom-legacy-bookmarks', version: 1, exportedAt: new Date().toISOString(), bookmarkLibrary: state.legacy }, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `browseloom-old-bookmarks-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      showToast(t('exported'));
    }
  }
  function setQuery(query) {
    state.query = String(query || '').trim();
    state.visibleLimit = 120;
    renderMain();
  }
  window.SuperTabOutBookmarkSearch = { setQuery };
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
      transition.ready.catch(() => {});
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
    const workspaceUpdated = transitionWorkspace(next);
    if (next === 'bookmarks') {
      workspaceUpdated.then(() => refreshLibrary()).catch(() => {});
    }
  }

  function handleWorkspaceSwitchClick(event) {
    const switcher = event.target.closest('[data-workspace-switch]');
    if (!switcher) return;
    if (!reader) {
      applyWorkspaceShell(switcher.dataset.workspaceSwitch);
      return;
    }
    setWorkspace(switcher.dataset.workspaceSwitch);
  }

  function shouldIgnoreWorkspaceWheel(event) {
    const target = event.target;
    if (!(target instanceof Element)) return true;
    return Boolean(target.closest('dialog[open], input, textarea, select, [contenteditable="true"], [role="textbox"], .native-breadcrumbs, .native-folder-nav'));
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


  function handleKeydown(event) {
    const editing = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
    if (editing || document.querySelector('dialog[open]')) return;
    const bookmarkOpen = document.body.dataset.workspace === 'bookmarks';
    const focusedControl = document.activeElement?.closest?.('button, a, [role="button"], [role="tab"]');
    if (!focusedControl && event.key === 'ArrowLeft' && !bookmarkOpen) { event.preventDefault(); setWorkspace('bookmarks'); }
    if (!focusedControl && event.key === 'ArrowRight' && bookmarkOpen) { event.preventDefault(); setWorkspace('tabs'); }
    if (event.key === '/' && bookmarkOpen) { event.preventDefault(); $('bookmarkSearch').focus(); }
  }
  async function init() {
    const defaultWorkspace = document.documentElement.dataset.defaultWorkspace === 'bookmarks' ? 'bookmarks' : 'tabs';
    applyWorkspaceShell(defaultWorkspace);
    try {
      const stored = await Storage.get([PREF_KEY, 'bookmarkLibrary', 'privacySettings']);
      const prefs = stored[PREF_KEY] || {};
      state.externalFavicons = stored.privacySettings?.externalFavicons === true;
      state.view = prefs.viewMode === 'grid' ? 'grid' : 'list';
      state.sort = ['title', 'added'].includes(prefs.sort) ? prefs.sort : 'native';
      state.defaultFolderId = typeof prefs.defaultFolderId === 'string' ? prefs.defaultFolderId : null;
      state.startupMode = prefs.startupMode === 'root' ? 'root' : 'last';
      state.folderId = state.startupMode === 'root' ? null : (typeof prefs.lastFolderId === 'string' ? prefs.lastFolderId : prefs.lastFolderId === null ? null : state.defaultFolderId);
      state.restoreExpanded = state.startupMode === 'last' && Array.isArray(prefs.expandedFolderIds);
      if (state.restoreExpanded) state.expanded = new Set(prefs.expandedFolderIds.filter(id => typeof id === 'string'));
      const legacy = stored.bookmarkLibrary;
      if (legacy?.bookmarks?.length || legacy?.folders?.length || legacy?.categories?.some(category => !category.system)) state.legacy = legacy;
    } catch { state.message = 'prefsError'; }
    if (!reader) { state.status = 'unsupported'; renderAll(); return; }
    reader.subscribe(snapshot => {
      const revealSelection = state.status !== 'ready' || (state.folderId && !snapshot.index.nodes.has(state.folderId));
      if (snapshot.status === 'ready' && state.folderId && !snapshot.index.nodes.has(state.folderId)) {
        const previousPath = path(state.folderId);
        state.folderId = previousPath.reverse().find(node => snapshot.index.nodes.has(node.id))?.id || null;
        state.message = 'removed';
      }
      state.status = snapshot.status;
      state.permissionGranted = snapshot.permissionGranted;
      state.index = snapshot.index;
      if (state.status === 'ready' && !state.folderId) state.folderId = state.index.roots[0] || null;
      if (state.status === 'ready' && revealSelection && !state.restoreExpanded) path(state.folderId).forEach(node => state.expanded.add(node.id));
      if (state.status === 'ready') state.restoreExpanded = false;
      if (state.status === 'denied') {
        state.folderId = null;
        state.query = '';
        state.expanded.clear();
        if ($('bookmarkSearch').dataset.searchMode !== 'external') $('bookmarkSearch').value = '';
      }
      renderAll();
    });
    bindDrag();
    document.addEventListener('click', handleClick);
    document.addEventListener('contextmenu', event => {
      const id = event.target.closest('[data-native-id]')?.dataset.nativeId || event.target.closest('[data-native-folder]')?.dataset.nativeFolder;
      if (event.target.closest('#bookmarkMain, #bookmarkLibraryNav')) {
        event.preventDefault(); openContext(id || state.folderId, event.target.closest('button, a') || $('nativeFolderTitle'), event.clientX, event.clientY);
      }
    });
    document.addEventListener('keydown', handleKeydown);
    document.addEventListener('wheel', handleWorkspaceWheel, { passive: false });
    $('bookmarkSearch').addEventListener('input', event => {
      if (event.target.dataset.searchMode === 'external') return;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => setQuery(event.target.value), 80);
    });
    $('nativeStartupMode').addEventListener('change', async event => {
      state.startupMode = event.target.value === 'root' ? 'root' : 'last';
      try { await savePreferences(); } catch { showToast(t('prefsError')); }
    });
    $('nativeSort').addEventListener('change', async event => {
      state.sort = event.target.value;
      renderMain();
      try { await savePreferences(); } catch { showToast(t('prefsError')); }
    });
    document.addEventListener('super-tab-out-language-change', renderAll);
    document.addEventListener('browseloom-native-import-complete', async event => {
      await refreshLibrary();
      if (event.detail?.folderId) navigate(event.detail.folderId);
    });
    document.addEventListener('error', event => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-native-favicon')) return;
      // Browser icons stay local. Only use the optional external fallback if enabled.
      const domain = image.dataset.nativeIconDomain;
      const fallback = image.dataset.nativeIconSource === 'browser'
        ? window.readCachedFavicon?.(domain) || (state.externalFavicons ? window.faviconUrlFor?.(domain) : '')
        : '';
      if (fallback) {
        image.dataset.nativeIconSource = 'fallback';
        image.style.removeProperty('display');
        image.src = fallback;
      } else image.remove();
    }, true);
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes[PREF_KEY]?.newValue) {
        state.startupMode = changes[PREF_KEY].newValue.startupMode === 'root' ? 'root' : 'last';
        $('nativeStartupMode').value = state.startupMode;
      }
      if (area === 'local' && changes.privacySettings) {
        state.externalFavicons = changes.privacySettings.newValue?.externalFavicons === true;
        renderMain();
      }
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshLibrary(); });
    window.addEventListener('focus', refreshLibrary);
    window.addEventListener('pagehide', event => { if (!event.persisted) reader.dispose(); });
    window.addEventListener('pageshow', event => { if (event.persisted) refreshLibrary(); });
    chrome.runtime.onMessage.addListener(message => {
      if (message?.type !== 'toggle-workspace') return;
      chrome.tabs.getCurrent().then(tab => {
        if (tab?.id === message.targetTabId) setWorkspace(document.body.dataset.workspace === 'bookmarks' ? 'tabs' : 'bookmarks');
      }).catch(() => {});
    });
    const currentUrl = new URL(location.href);
    const captureToken = currentUrl.searchParams.get('bookmarkCapture');
    if (captureToken) {
      applyWorkspaceShell('bookmarks');
      state.message = 'capture';
      // Consume the one-time draft even while editing is deferred to phase B.
      // Otherwise repeated shortcuts leave unused entries in session storage.
      try { await chrome.runtime.sendMessage({ type: 'consume-bookmark-capture', token: captureToken }); } catch {}
      currentUrl.searchParams.delete('bookmarkCapture');
      history.replaceState(null, '', currentUrl.href);
    }
    await refreshLibrary();
  }
  // Workspace switching is independent of the bookmark permission and load state.
  document.addEventListener('click', handleWorkspaceSwitchClick);
  init();
})();
