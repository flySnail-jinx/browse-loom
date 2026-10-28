/* Explicit preview/confirm UI for the background-owned legacy import. */
(function () {
  'use strict';
  const escape = window.SuperTabOutHtml.escapeHtml;
  const dialog = document.getElementById('legacyImportDialog');
  const content = document.getElementById('legacyImportContent');
  const actions = document.getElementById('legacyImportActions');
  const feedback = document.getElementById('legacyImportFeedback');
  let state = null;
  let running = false;
  let announcedBatch = '';
  const zh = () => document.documentElement.dataset.lang === 'zh';
  const t = (cn, en) => zh() ? cn : en;
  function button(action, label, extra = '') { return `<button type="button" data-import-action="${action}" ${extra}>${escape(label)}</button>`; }
  async function request(action, extra = {}) {
    const response = await chrome.runtime.sendMessage({ type: 'legacy-bookmark-import', action, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'request-failed');
    return response.result;
  }
  function explain(error) {
    const code = error?.message || error;
    const messages = {
      'permission-required': t('请先连接浏览器书签，再重新打开导入。', 'Connect browser bookmarks before importing.'),
      'preview-expired': t('预览已更新，请关闭后重新打开导入。', 'The preview changed. Close and reopen the import.'),
      'destination-changed': t('Chrome 中出现了新的相同书签，请关闭后重新核对预览。', 'New matching Chrome bookmarks appeared. Close and reopen the preview.'),
      'source-changed': t('旧书签已变化，请关闭后重新预览。', 'Old bookmarks changed. Close and reopen the preview.'),
      'target-unavailable': t('目标文件夹已不存在或不可写，请检查浏览器书签。', 'The destination is missing or read-only. Check your browser bookmarks.'),
      'import-busy': t('另一个页面正在处理导入，请稍后重新打开。', 'Another page is processing this import. Reopen it shortly.'),
      'target-changed': t('待核对的目标已变化，请重新打开导入核对。', 'The matching destination changed. Reopen the import to review it.'),
      'interrupted': t('上次写入结果未能保存，请核对后继续。', 'The previous write could not be confirmed. Review it before continuing.'),
    };
    return messages[code] || t('操作未完成。进度已保留，请重新打开导入查看结果。', 'The operation did not finish. Reopen the import to check saved progress.');
  }
  function renderPreview() {
    const items = state.ops.filter(op => op.url !== undefined);
    const folders = state.ops.length - items.length;
    const unsupported = items.filter(op => op.kind === 'unsupported');
    const total = items.length - unsupported.length;
    content.innerHTML = `<p>${escape(t('将全部旧书签按原有分类和文件夹结构导入专用文件夹，无需逐条勾选。', 'Import all old bookmarks into a dedicated folder, preserving categories and folders. No individual selection is needed.'))}</p>
      <label class="native-import-destination">${escape(t('导入到', 'Destination'))}<select id="legacyImportTarget">${state.targets.map(target => `<option value="${escape(target.id)}" ${target.id === state.defaultTargetId ? 'selected' : ''}>${escape(target.path)}${typeof target.syncing === 'boolean' ? escape(target.syncing ? t('（账户）', ' (account)') : t('（此设备）', ' (this device)')) : ''}</option>`).join('')}</select></label>
      <p class="native-import-summary">${escape(state.rootTitle)} · ${folders} ${escape(t('个文件夹', 'folders'))} · ${total} ${escape(t('条书签将全部导入', 'bookmarks to import'))}</p>
      <p>${escape(t('相同名称或网址也会按旧库结构保留，不覆盖 Chrome 已有书签。重复点击不会重新导入已完成的条目。', 'Repeated titles and URLs are preserved in the imported structure. Existing Chrome bookmarks are not overwritten, and repeating this action will not recreate completed entries.'))}</p>
      <p class="native-import-note">${escape(t(`备注（${state.notes} 条）、自定义图标和颜色仍保留在旧库。无需先导出。`, `Notes (${state.notes} entries), custom icons and colors remain in the old library. No export is required.`))}</p>
      ${unsupported.length ? `<details><summary>${escape(t(`${unsupported.length} 条网址无法导入，仍保留在旧库`, `${unsupported.length} unsupported addresses will remain in the old library`))}</summary><div class="native-import-items">${unsupported.map(op => `<p><strong>${escape(op.title)}</strong><br>${escape(op.url)}</p>`).join('')}</div></details>` : ''}`;
    actions.innerHTML = button('close', t('暂不导入', 'Not now')) + button('start', t(`全部导入（${total} 条）`, `Import all (${total})`), `class="native-import-primary" ${!state.targets.length || !state.ops.length || (!total && items.length) ? 'disabled' : ''}`);
  }
  function renderBatch() {
    const counts = state.counts || {};
    const root = state.ops.find(op => op.key === 'root');
    const remaining = state.mode !== 'all' ? state.ops.filter(op => op.url !== undefined && op.kind !== 'unsupported' && op.status === 'skipped').length : 0;
    const issues = state.ops.filter(op => ['failed', 'review'].includes(op.status));
    const done = state.ops.filter(op => ['done', 'skipped'].includes(op.status)).length;
    const title = state.phase === 'complete' ? t('导入完成', 'Import complete') : state.phase === 'attention' ? t('部分条目需要处理', 'Some entries need attention') : t('导入进度已保存', 'Import progress is saved');
    content.innerHTML = `<h3>${escape(title)}</h3><p>${escape(state.targetPath)} / ${escape(state.rootTitle)}</p>
      <progress max="${state.ops.length}" value="${done}"></progress>
      <p>${escape(t(`已导入 ${counts.done || 0} 条书签，跳过 ${counts.skipped || 0} 条，待处理 ${counts.pending || 0} 条。`, `${counts.done || 0} bookmarks imported, ${counts.skipped || 0} skipped, ${counts.pending || 0} pending.`))}</p>
      <p class="native-import-note">${escape(state.phase === 'complete' ? t('旧书签及备注仍保留，可直接查看新建的 Chrome 文件夹。', 'Old bookmarks and notes are kept. You can now view the new Chrome folder.') : t('旧书签及备注仍保留。关闭窗口会在当前小批次结束后暂停，再次打开可继续。', 'Old bookmarks and notes are kept. Closing pauses after the current small batch; reopen to continue.'))}</p>
      <div class="native-import-items">${issues.map(op => `<div class="native-import-issue"><strong>${escape(op.title)}</strong><small>${escape(op.path || state.targetPath)}${op.url ? ` · ${escape(op.url)}` : ''}</small><p>${escape(explain(op.error))}</p>${op.status === 'review' ? `<label>${escape(t('核对这项', 'Review this entry'))}<select data-import-review="${escape(op.key)}"><option value="">${escape(t('请选择处理方式', 'Choose an action'))}</option>${(op.candidates || []).map(candidate => `<option value="${escape(candidate.id)}">${escape(t('使用已找到的条目：', 'Use matching entry: ') + candidate.path)}</option>`).join('')}${op.url !== undefined ? `<option value="skip">${escape(t('跳过这项', 'Skip this entry'))}</option>` : ''}<option value="create">${escape(t('重新新建（可能产生重复）', 'Create again (may duplicate)'))}</option></select></label>${button('resolve', t('确认处理', 'Confirm choice'), `data-import-key="${escape(op.key)}"`)}` : ''}</div>`).join('')}</div>`;
    actions.innerHTML = button('close', t('关闭', 'Close')) + (remaining ? button('include-all', t(`导入之前未勾选的 ${remaining} 条`, `Import ${remaining} previously unselected entries`), 'class="native-import-primary"') : '') + (root?.targetId ? button('locate', t('查看导入文件夹', 'View imported folder')) : '') + (state.phase !== 'complete' ? button('continue', issues.some(op => op.status === 'failed') ? t('重试失败项并继续', 'Retry failures and continue') : t('继续导入', 'Continue import'), 'class="native-import-primary"') : '');
    if (state.phase === 'complete' && announcedBatch !== state.batchId) {
      announcedBatch = state.batchId;
      document.dispatchEvent(new CustomEvent('browseloom-native-import-complete', { detail: { folderId: root?.targetId } }));
    }
  }
  function render() {
    if (!dialog.open || !state) return;
    document.getElementById('legacyImportTitle').textContent = t('旧书签导入 Chrome', 'Import old bookmarks into Chrome');
    document.getElementById('legacyImportClose').textContent = t('关闭', 'Close');
    state.phase === 'preview' ? renderPreview() : renderBatch();
    if (running) {
      actions.querySelectorAll('button:not([data-import-action="close"])').forEach(button => { button.disabled = true; });
      content.querySelectorAll('button, select, input').forEach(element => { element.disabled = true; });
    }
  }
  async function run() {
    while (dialog.open && state?.phase === 'running') {
      state = await request('step', { batchId: state.batchId });
      render();
    }
  }
  async function open() {
    if (dialog.open) return;
    state = null;
    document.getElementById('legacyImportTitle').textContent = t('旧书签导入 Chrome', 'Import old bookmarks into Chrome');
    document.getElementById('legacyImportClose').textContent = t('关闭', 'Close');
    content.textContent = t('正在核对旧书签与 Chrome 书签…', 'Checking old and Chrome bookmarks…'); actions.replaceChildren(); feedback.textContent = '';
    dialog.showModal();
    try {
      state = await request('preview', { lang: zh() ? 'zh' : 'en' });
      render();
    } catch (error) { feedback.textContent = explain(error); }
  }
  document.getElementById('legacyImportClose').addEventListener('click', () => dialog.close());
  dialog.addEventListener('change', event => {
    if (event.target.id === 'legacyImportTarget') state.defaultTargetId = event.target.value;
  });
  dialog.addEventListener('click', async event => {
    const target = event.target.closest('[data-import-action]');
    if (!target) return;
    const action = target.dataset.importAction;
    if (action === 'close') { dialog.close(); return; }
    if (running) return;
    if (action === 'locate') {
      dialog.close();
      document.dispatchEvent(new CustomEvent('browseloom-native-import-complete', { detail: { folderId: state.ops.find(op => op.key === 'root')?.targetId } })); return;
    }
    const targetId = document.getElementById('legacyImportTarget')?.value;
    const choice = action === 'resolve' ? content.querySelector(`[data-import-review="${CSS.escape(target.dataset.importKey)}"]`)?.value : '';
    if (action === 'resolve' && !choice) { feedback.textContent = t('请先选择这项的处理方式。', 'Choose how to handle this entry first.'); return; }
    running = true; feedback.textContent = ''; render();
    try {
      if (action === 'start') state = await request('start', { token: state.token, targetId, mode: 'all' });
      if (action === 'include-all') state = await request('include-all', { batchId: state.batchId });
      if (action === 'continue') state = await request('retry', { batchId: state.batchId });
      if (action === 'resolve') state = await request('resolve', { batchId: state.batchId, key: target.dataset.importKey, choice });
      render(); await run();
    } catch (error) { feedback.textContent = explain(error); }
    finally { running = false; render(); }
  });
  window.SuperTabOutLegacyImportUI = { open };
})();
