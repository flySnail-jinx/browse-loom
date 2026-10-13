/* User wallpaper settings UI. Keeps uploads, editing, and deletion outside
   the main dashboard controller so the no-build extension stays modular. */
(function () {
  'use strict';

  const Wallpapers = window.SuperTabOutWallpapers;
  if (!Wallpapers) return;

  const BACKGROUND_STORAGE_KEY = 'tab-out-background';
  const PERSIST_WARNING_KEY = 'tab-out-wallpaper-persist-warning-seen';
  const COPY = {
    en: {
      systemBackgrounds: "Built-in backgrounds",
      myWallpapers: 'My wallpapers',
      wallpaperDescription: "Images stay in this browser's current profile.",
      uploadWallpapers: "Add wallpapers",
      emptyTitle: "Choose a local image",
      emptyBody: "Save up to 10 images.\nSupports JPEG, PNG, and WebP.",
      cancelPending: "Stop adding",
      adjustWallpaper: 'Adjust wallpaper',
      dragToPosition: "Drag the image to position it.",
      horizontalPosition: "Left / right",
      verticalPosition: "Up / down",
      overlayStrength: "Dimming",
      resetCenter: 'Reset center',
      cancel: 'Cancel',
      saveChanges: 'Save changes',
      deleteWallpaperTitle: 'Delete wallpaper?',
      deleteWallpaper: 'Delete wallpaper',
      adjust: 'Adjust',
      remove: 'Delete',
      selectWallpaper: name => `Use “${name}”`,
      adjustWallpaperNamed: name => `Adjust “${name}”`,
      deleteWallpaperNamed: name => `Delete “${name}”`,
      deleteBody: name => `Delete wallpaper “${name}” from this browser.\nThis cannot be undone.`,
      count: count => `${count} / ${Wallpapers.MAX_WALLPAPERS}`,
      capacity: remaining => `Room for ${remaining} more images. Choose fewer images.`,
      processing: ({ current, total, name }) => `Adding image ${current}/${total}.\nImage: ${name}`,
      cancelling: "Stopping after the current image is added.",
      imported: count => `${count} wallpaper${count === 1 ? '' : 's'} added.`,
      importedWithFailures: ({ imported, failed }) => `${imported} added.\n${failed} could not be added.`,
      importCancelled: count => `Stopped. ${count} images added.`,
      persistWarning: "Wallpapers are stored on this device.\nThe browser may clear them if space runs very low.",
      importFailed: "Could not add wallpapers. Try again.",
      saveFailed: "Could not save wallpaper changes. Try again.",
      saved: "Wallpaper changes saved.",
      deleted: "Wallpaper deleted.",
      deleteFailed: "Could not delete the wallpaper. Try again.",
      backgroundRecovered: "Wallpaper could not be displayed. Switched to Snow peaks.",
      storageUnavailable: "This browser's current profile cannot store wallpapers.",
    },
    zh: {
      systemBackgrounds: "自带背景",
      myWallpapers: '我的壁纸',
      wallpaperDescription: "图片仅存于当前浏览器的用户空间。",
      uploadWallpapers: "添加壁纸",
      emptyTitle: "选择本机图片",
      emptyBody: "最多保存 10 张图片。\n支持 JPEG、PNG、WebP。",
      cancelPending: "停止添加",
      adjustWallpaper: '调整壁纸',
      dragToPosition: "拖动图片，调整位置。",
      horizontalPosition: "左右位置",
      verticalPosition: "上下位置",
      overlayStrength: "压暗程度",
      resetCenter: '恢复居中',
      cancel: '取消',
      saveChanges: '保存调整',
      deleteWallpaperTitle: '删除壁纸？',
      deleteWallpaper: '删除壁纸',
      adjust: '调整',
      remove: '删除',
      selectWallpaper: name => `使用「${name}」`,
      adjustWallpaperNamed: name => `调整「${name}」`,
      deleteWallpaperNamed: name => `删除「${name}」`,
      deleteBody: name => `将从此浏览器删除壁纸「${name}」。\n删除后无法恢复。`,
      count: count => `${count} / ${Wallpapers.MAX_WALLPAPERS}`,
      capacity: remaining => `还可添加 ${remaining} 张，请少选一些。`,
      processing: ({ current, total, name }) => `正在添加第 ${current}/${total} 张。\n图片：${name}`,
      cancelling: "当前图片添加完成后停止。",
      imported: count => `已添加 ${count} 张壁纸。`,
      importedWithFailures: ({ imported, failed }) => `已添加 ${imported} 张。\n${failed} 张添加失败。`,
      importCancelled: count => `已停止添加，共添加 ${count} 张。`,
      persistWarning: "壁纸只保存在本机。\n空间严重不足时，浏览器可能清除壁纸。",
      importFailed: "壁纸添加失败，请重试。",
      saveFailed: "壁纸调整保存失败，请重试。",
      saved: "已保存壁纸调整。",
      deleted: "已删除壁纸。",
      deleteFailed: "壁纸删除失败，请重试。",
      backgroundRecovered: "壁纸无法显示，已改用雪峰背景。",
      storageUnavailable: "当前浏览器的用户空间无法保存壁纸。",
    },
  };

  const elements = {
    upload: document.getElementById('userWallpaperUpload'),
    input: document.getElementById('userWallpaperInput'),
    count: document.getElementById('userWallpaperCount'),
    grid: document.getElementById('userWallpaperGrid'),
    empty: document.getElementById('userWallpaperEmpty'),
    persistence: document.getElementById('userWallpaperPersistence'),
    progress: document.getElementById('userWallpaperProgress'),
    progressBar: document.getElementById('userWallpaperProgressBar'),
    progressCopy: document.getElementById('userWallpaperProgressCopy'),
    cancelImport: document.getElementById('userWallpaperCancelImport'),
    editorDialog: document.getElementById('wallpaperEditorDialog'),
    editorForm: document.getElementById('wallpaperEditorForm'),
    editorName: document.getElementById('wallpaperEditorName'),
    editorPreview: document.getElementById('wallpaperEditorPreview'),
    editorImage: document.getElementById('wallpaperEditorImage'),
    editorOverlay: document.getElementById('wallpaperEditorOverlay'),
    focalX: document.getElementById('wallpaperFocalX'),
    focalY: document.getElementById('wallpaperFocalY'),
    overlay: document.getElementById('wallpaperOverlay'),
    overlayValue: document.getElementById('wallpaperOverlayValue'),
    resetPosition: document.getElementById('wallpaperResetPosition'),
    editorCancel: document.getElementById('wallpaperEditorCancel'),
    editorClose: document.getElementById('wallpaperEditorClose'),
    deleteDialog: document.getElementById('wallpaperDeleteDialog'),
    deleteForm: document.getElementById('wallpaperDeleteForm'),
    deletePreview: document.getElementById('wallpaperDeletePreview'),
    deleteText: document.getElementById('wallpaperDeleteText'),
    deleteCancel: document.getElementById('wallpaperDeleteCancel'),
  };

  let records = [];
  let thumbnailUrls = [];
  let editorUrl = '';
  let deleteUrl = '';
  let editingRecord = null;
  let deletingRecord = null;
  let importBusy = false;
  let cancelImportRequested = false;
  let dragState = null;

  function language() {
    return document.documentElement.dataset.lang === 'zh' ? 'zh' : 'en';
  }

  function copy(key, params) {
    const value = COPY[language()][key] ?? COPY.en[key] ?? key;
    return typeof value === 'function' ? value(params) : value;
  }

  function showToast(message, options) {
    window.SuperTabOutToast?.show?.(message, options);
  }

  function escapeHtml(value) {
    const span = document.createElement('span');
    span.textContent = String(value ?? '');
    return span.innerHTML;
  }

  function currentBackgroundId() {
    try { return localStorage.getItem(BACKGROUND_STORAGE_KEY) || 'mountain'; } catch { return 'mountain'; }
  }

  function applyCopy() {
    document.querySelectorAll('[data-wallpaper-copy]').forEach(element => {
      element.textContent = copy(element.dataset.wallpaperCopy);
    });
    document.querySelectorAll('[data-wallpaper-copy-aria-label]').forEach(element => {
      element.setAttribute('aria-label', copy(element.dataset.wallpaperCopyAriaLabel));
    });
    if (deletingRecord) elements.deleteText.textContent = copy('deleteBody', deletingRecord.originalName);
    renderCards();
  }

  function revokeThumbnailUrls() {
    thumbnailUrls.forEach(url => URL.revokeObjectURL(url));
    thumbnailUrls = [];
  }

  function actionIcon(type) {
    if (type === 'adjust') {
      return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"></path><circle cx="16" cy="7" r="2"></circle><circle cx="8" cy="17" r="2"></circle></svg>';
    }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path></svg>';
  }

  function renderCards() {
    if (!elements.grid) return;
    revokeThumbnailUrls();
    const activeId = currentBackgroundId();
    elements.grid.replaceChildren();
    records.forEach(record => {
      const thumbnailUrl = URL.createObjectURL(record.thumbnailBlob || record.blob);
      thumbnailUrls.push(thumbnailUrl);
      const wrap = document.createElement('div');
      wrap.className = 'user-wallpaper-card-wrap';
      const selected = activeId === record.id;
      wrap.innerHTML = `
        <button class="user-wallpaper-card" type="button" role="radio" aria-checked="${selected ? 'true' : 'false'}"
                data-action="set-background" data-background-id="${escapeHtml(record.id)}"
                aria-label="${escapeHtml(copy('selectWallpaper', record.originalName))}">
          <img class="user-wallpaper-thumbnail" src="${thumbnailUrl}" alt="" draggable="false"
               style="object-position:${Number(record.focalX ?? 50)}% ${Number(record.focalY ?? 50)}%">
          <span class="user-wallpaper-name" title="${escapeHtml(record.originalName)}">${escapeHtml(record.originalName)}</span>
        </button>
        <span class="user-wallpaper-card-actions">
          <button class="user-wallpaper-card-action" type="button" data-wallpaper-action="adjust" data-wallpaper-id="${escapeHtml(record.id)}"
                  title="${escapeHtml(copy('adjust'))}" aria-label="${escapeHtml(copy('adjustWallpaperNamed', record.originalName))}">${actionIcon('adjust')}</button>
          <button class="user-wallpaper-card-action danger" type="button" data-wallpaper-action="delete" data-wallpaper-id="${escapeHtml(record.id)}"
                  title="${escapeHtml(copy('remove'))}" aria-label="${escapeHtml(copy('deleteWallpaperNamed', record.originalName))}">${actionIcon('delete')}</button>
        </span>`;
      elements.grid.append(wrap);
    });
  }

  async function renderLibrary() {
    try {
      records = await Wallpapers.listWallpapers();
      const count = records.length;
      elements.count.textContent = copy('count', count);
      elements.upload.disabled = importBusy || count >= Wallpapers.MAX_WALLPAPERS;
      elements.empty.hidden = count > 0;
      elements.grid.hidden = count === 0;
      renderCards();
    } catch (error) {
      records = [];
      elements.count.textContent = copy('count', 0);
      elements.upload.disabled = true;
      elements.empty.hidden = false;
      elements.grid.hidden = true;
      elements.empty.querySelector('strong').textContent = copy('storageUnavailable');
      console.warn('[BrowseLoom] Could not load user wallpapers.', error);
    }
  }

  function setProgress({ current = 0, total = 1, name = '', cancelling = false } = {}) {
    elements.progress.hidden = false;
    elements.progressBar.style.width = `${Math.max(0, Math.min(100, (current / total) * 100))}%`;
    elements.progressCopy.textContent = cancelling
      ? copy('cancelling')
      : copy('processing', { current, total, name });
    elements.cancelImport.disabled = cancelling;
  }

  function hideProgress() {
    elements.progress.hidden = true;
    elements.progressBar.style.width = '0%';
    elements.progressCopy.textContent = '';
  }

  async function importSelectedFiles(fileList) {
    const files = [...fileList];
    if (!files.length || importBusy) return;
    const remaining = Wallpapers.MAX_WALLPAPERS - records.length;
    if (files.length > remaining) {
      showToast(copy('capacity', remaining));
      return;
    }
    importBusy = true;
    cancelImportRequested = false;
    elements.upload.disabled = true;
    setProgress({ current: 1, total: files.length, name: files[0].name });
    try {
      const result = await Wallpapers.importFiles(files, {
        shouldCancel: () => cancelImportRequested,
        onProgress(detail) {
          if (detail.state === 'processing') {
            setProgress({ current: detail.index + 1, total: detail.total, name: detail.file?.name || '' });
          }
        },
      });
      if (result.persisted === false) {
        let seen = false;
        try { seen = localStorage.getItem(PERSIST_WARNING_KEY) === '1'; } catch {}
        if (!seen) {
          elements.persistence.textContent = copy('persistWarning');
          elements.persistence.hidden = false;
          try { localStorage.setItem(PERSIST_WARNING_KEY, '1'); } catch {}
        }
      }
      if (result.cancelled) showToast(copy('importCancelled', result.imported.length));
      else if (result.failed.length) showToast(copy('importedWithFailures', { imported: result.imported.length, failed: result.failed.length }), { duration: 5000 });
      else showToast(copy('imported', result.imported.length));
    } catch (error) {
      if (error?.code === 'capacity') showToast(copy('capacity', Math.max(0, Wallpapers.MAX_WALLPAPERS - records.length)));
      else showToast(copy('importFailed'));
      console.warn('[BrowseLoom] Wallpaper import failed.', error);
    } finally {
      importBusy = false;
      cancelImportRequested = false;
      hideProgress();
      elements.input.value = '';
      await renderLibrary();
    }
  }

  function closeEditor() {
    if (elements.editorDialog.open) elements.editorDialog.close('cancel');
    if (editorUrl) URL.revokeObjectURL(editorUrl);
    editorUrl = '';
    editingRecord = null;
    dragState = null;
  }

  function syncEditorPreview() {
    const focalX = Number(elements.focalX.value);
    const focalY = Number(elements.focalY.value);
    const overlay = Number(elements.overlay.value);
    elements.editorImage.style.objectPosition = `${focalX}% ${focalY}%`;
    elements.editorOverlay.style.opacity = String(overlay / 100);
    elements.overlayValue.value = `${overlay}%`;
    elements.overlayValue.textContent = `${overlay}%`;
  }

  function openEditor(record) {
    editingRecord = record;
    if (editorUrl) URL.revokeObjectURL(editorUrl);
    editorUrl = URL.createObjectURL(record.blob);
    elements.editorName.textContent = record.originalName;
    elements.editorImage.src = editorUrl;
    elements.focalX.value = String(record.focalX ?? Wallpapers.DEFAULT_FOCAL_POINT);
    elements.focalY.value = String(record.focalY ?? Wallpapers.DEFAULT_FOCAL_POINT);
    elements.overlay.value = String(record.overlay ?? Wallpapers.DEFAULT_OVERLAY);
    syncEditorPreview();
    elements.editorDialog.showModal();
    elements.editorPreview.focus({ preventScroll: true });
  }

  function closeDeleteDialog() {
    if (elements.deleteDialog.open) elements.deleteDialog.close('cancel');
    if (deleteUrl) URL.revokeObjectURL(deleteUrl);
    deleteUrl = '';
    deletingRecord = null;
  }

  function openDeleteDialog(record) {
    deletingRecord = record;
    if (deleteUrl) URL.revokeObjectURL(deleteUrl);
    deleteUrl = URL.createObjectURL(record.thumbnailBlob || record.blob);
    elements.deletePreview.src = deleteUrl;
    elements.deletePreview.style.objectPosition = `${record.focalX ?? 50}% ${record.focalY ?? 50}%`;
    elements.deleteText.textContent = copy('deleteBody', record.originalName);
    elements.deleteDialog.showModal();
    elements.deleteCancel.focus({ preventScroll: true });
  }

  elements.upload?.addEventListener('click', () => elements.input.click());
  elements.input?.addEventListener('change', () => importSelectedFiles(elements.input.files));
  elements.cancelImport?.addEventListener('click', () => {
    cancelImportRequested = true;
    setProgress({ cancelling: true });
  });

  elements.grid?.addEventListener('click', event => {
    const action = event.target instanceof Element ? event.target.closest('[data-wallpaper-action]') : null;
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    const record = records.find(item => item.id === action.dataset.wallpaperId);
    if (!record) return;
    if (action.dataset.wallpaperAction === 'adjust') openEditor(record);
    if (action.dataset.wallpaperAction === 'delete') openDeleteDialog(record);
  });

  [elements.focalX, elements.focalY, elements.overlay].forEach(input => input?.addEventListener('input', syncEditorPreview));
  elements.resetPosition?.addEventListener('click', () => {
    elements.focalX.value = String(Wallpapers.DEFAULT_FOCAL_POINT);
    elements.focalY.value = String(Wallpapers.DEFAULT_FOCAL_POINT);
    syncEditorPreview();
  });
  elements.editorCancel?.addEventListener('click', closeEditor);
  elements.editorClose?.addEventListener('click', closeEditor);
  elements.editorDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeEditor();
  });
  elements.editorDialog?.addEventListener('close', () => {
    if (editorUrl) URL.revokeObjectURL(editorUrl);
    editorUrl = '';
    editingRecord = null;
  });
  elements.editorForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!editingRecord) return;
    const submit = elements.editorForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await Wallpapers.updateWallpaper(editingRecord.id, {
        focalX: Number(elements.focalX.value),
        focalY: Number(elements.focalY.value),
        overlay: Number(elements.overlay.value),
      });
      closeEditor();
      await renderLibrary();
      showToast(copy('saved'));
    } catch (error) {
      showToast(copy('saveFailed'));
      console.warn('[BrowseLoom] Could not update wallpaper.', error);
    } finally {
      submit.disabled = false;
    }
  });

  elements.editorPreview?.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      focalX: Number(elements.focalX.value),
      focalY: Number(elements.focalY.value),
    };
    elements.editorPreview.setPointerCapture(event.pointerId);
  });
  elements.editorPreview?.addEventListener('pointermove', event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const rect = elements.editorPreview.getBoundingClientRect();
    const nextX = Math.max(0, Math.min(100, dragState.focalX - ((event.clientX - dragState.startX) / rect.width) * 100));
    const nextY = Math.max(0, Math.min(100, dragState.focalY - ((event.clientY - dragState.startY) / rect.height) * 100));
    elements.focalX.value = String(Math.round(nextX));
    elements.focalY.value = String(Math.round(nextY));
    syncEditorPreview();
  });
  const endDrag = event => {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    dragState = null;
    elements.editorPreview.releasePointerCapture?.(event.pointerId);
  };
  elements.editorPreview?.addEventListener('pointerup', endDrag);
  elements.editorPreview?.addEventListener('pointercancel', endDrag);
  elements.editorPreview?.addEventListener('keydown', event => {
    const changes = { ArrowLeft: [-2, 0], ArrowRight: [2, 0], ArrowUp: [0, -2], ArrowDown: [0, 2] };
    if (event.key === 'Home') {
      event.preventDefault();
      elements.focalX.value = '50';
      elements.focalY.value = '50';
      syncEditorPreview();
      return;
    }
    if (!changes[event.key]) return;
    event.preventDefault();
    elements.focalX.value = String(Math.max(0, Math.min(100, Number(elements.focalX.value) + changes[event.key][0])));
    elements.focalY.value = String(Math.max(0, Math.min(100, Number(elements.focalY.value) + changes[event.key][1])));
    syncEditorPreview();
  });

  elements.deleteCancel?.addEventListener('click', closeDeleteDialog);
  elements.deleteDialog?.addEventListener('cancel', event => {
    event.preventDefault();
    closeDeleteDialog();
  });
  elements.deleteDialog?.addEventListener('close', () => {
    if (deleteUrl) URL.revokeObjectURL(deleteUrl);
    deleteUrl = '';
    deletingRecord = null;
  });
  elements.deleteForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (!deletingRecord) return;
    const record = deletingRecord;
    const submit = elements.deleteForm.querySelector('[type="submit"]');
    submit.disabled = true;
    try {
      await Wallpapers.deleteWallpaper(record.id);
      closeDeleteDialog();
      await renderLibrary();
      showToast(copy('deleted'));
    } catch (error) {
      showToast(copy('deleteFailed'));
      console.warn('[BrowseLoom] Could not delete wallpaper.', error);
    } finally {
      submit.disabled = false;
    }
  });

  document.addEventListener('super-tab-out:background-change', renderCards);
  document.addEventListener('super-tab-out:background-error', () => {
    showToast(copy('backgroundRecovered'), { duration: 5000 });
    renderCards();
  });
  document.addEventListener('super-tab-out-language-change', applyCopy);
  document.addEventListener('browseloom-settings-view-change', event => {
    if (event.detail?.view === 'appearance') renderLibrary();
  });
  window.addEventListener('super-tab-out:wallpaper-library-change', renderLibrary);
  window.addEventListener('storage', event => {
    if (event.key === Wallpapers.REVISION_STORAGE_KEY || event.key === BACKGROUND_STORAGE_KEY) renderLibrary();
  });
  window.addEventListener('pagehide', () => {
    revokeThumbnailUrls();
    if (editorUrl) URL.revokeObjectURL(editorUrl);
    if (deleteUrl) URL.revokeObjectURL(deleteUrl);
  }, { once: true });

  applyCopy();
  renderLibrary();
})();
