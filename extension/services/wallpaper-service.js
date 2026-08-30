/* BrowseLoom user wallpaper repository.
   Image bytes stay in this browser profile. Small settings remain in each
   wallpaper record so the image and its presentation share one lifecycle. */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SuperTabOutWallpapers = api;
})(typeof self !== 'undefined' ? self : globalThis, function (root) {
  'use strict';

  const DB_NAME = 'browse-loom-wallpapers';
  const DB_VERSION = 1;
  const STORE_NAME = 'wallpapers';
  const BACKGROUND_PREFIX = 'user:';
  const REVISION_STORAGE_KEY = 'tab-out-wallpaper-revision';
  const MAX_WALLPAPERS = 10;
  const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
  const MAX_STORED_BYTES = 8 * 1024 * 1024;
  const MAX_LONG_EDGE = 3840;
  const THUMBNAIL_LONG_EDGE = 480;
  const DEFAULT_FOCAL_POINT = 50;
  const DEFAULT_OVERLAY = 20;
  const ACCEPTED_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

  class WallpaperError extends Error {
    constructor(code, message, cause) {
      super(message);
      this.name = 'WallpaperError';
      this.code = code;
      if (cause) this.cause = cause;
    }
  }

  let databasePromise = null;

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return min;
    return Math.min(max, Math.max(min, numeric));
  }

  function isWallpaperId(value) {
    return typeof value === 'string' && value.startsWith(BACKGROUND_PREFIX) && value.length > BACKGROUND_PREFIX.length;
  }

  function createWallpaperId() {
    const randomId = root.crypto?.randomUUID?.()
      || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    return `${BACKGROUND_PREFIX}${randomId}`;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.addEventListener('success', () => resolve(request.result), { once: true });
      request.addEventListener('error', () => reject(request.error), { once: true });
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('Wallpaper transaction aborted.')), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error || new Error('Wallpaper transaction failed.')), { once: true });
    });
  }

  function openDatabase() {
    if (databasePromise) return databasePromise;
    if (!root.indexedDB) {
      return Promise.reject(new WallpaperError('storage-unavailable', 'IndexedDB is unavailable.'));
    }

    databasePromise = new Promise((resolve, reject) => {
      const request = root.indexedDB.open(DB_NAME, DB_VERSION);
      request.addEventListener('upgradeneeded', () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          database.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      });
      request.addEventListener('success', () => {
        const database = request.result;
        database.addEventListener('versionchange', () => database.close());
        resolve(database);
      }, { once: true });
      request.addEventListener('blocked', () => {
        reject(new WallpaperError('storage-blocked', 'Wallpaper storage is open in another version.'));
      }, { once: true });
      request.addEventListener('error', () => {
        databasePromise = null;
        reject(new WallpaperError('storage-unavailable', 'Could not open wallpaper storage.', request.error));
      }, { once: true });
    });
    return databasePromise;
  }

  async function listWallpapers() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const records = await requestResult(transaction.objectStore(STORE_NAME).getAll());
    await transactionDone(transaction);
    return records.sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  }

  async function getWallpaper(id) {
    if (!isWallpaperId(id)) return null;
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const record = await requestResult(transaction.objectStore(STORE_NAME).get(id));
    await transactionDone(transaction);
    return record || null;
  }

  async function countWallpapers() {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const count = await requestResult(transaction.objectStore(STORE_NAME).count());
    await transactionDone(transaction);
    return count;
  }

  function announceChange(reason, id) {
    const detail = `${Date.now()}:${root.crypto?.randomUUID?.() || Math.random().toString(36).slice(2)}`;
    try { root.localStorage?.setItem(REVISION_STORAGE_KEY, detail); } catch {}
    root.dispatchEvent?.(new CustomEvent('super-tab-out:wallpaper-library-change', {
      detail: { reason, id, revision: detail },
    }));
  }

  async function estimateStorage() {
    if (!root.navigator?.storage?.estimate) return { usage: null, quota: null, remaining: null };
    const estimate = await root.navigator.storage.estimate();
    const usage = Number.isFinite(estimate.usage) ? estimate.usage : null;
    const quota = Number.isFinite(estimate.quota) ? estimate.quota : null;
    return {
      usage,
      quota,
      remaining: usage !== null && quota !== null ? Math.max(0, quota - usage) : null,
    };
  }

  async function requestPersistentStorage() {
    if (!root.navigator?.storage?.persist) return false;
    try {
      if (await root.navigator.storage.persisted?.()) return true;
      return Boolean(await root.navigator.storage.persist());
    } catch {
      return false;
    }
  }

  async function readHeader(file, length = 64 * 1024) {
    return new Uint8Array(await file.slice(0, Math.min(file.size, length)).arrayBuffer());
  }

  function detectImageType(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 8
      && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
      && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'image/png';
    if (bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return 'image/webp';
    return '';
  }

  function containsAscii(bytes, text) {
    const pattern = [...text].map(character => character.charCodeAt(0));
    outer: for (let index = 0; index <= bytes.length - pattern.length; index += 1) {
      for (let offset = 0; offset < pattern.length; offset += 1) {
        if (bytes[index + offset] !== pattern[offset]) continue outer;
      }
      return true;
    }
    return false;
  }

  function isAnimatedImage(bytes, type) {
    if (type === 'image/png') return containsAscii(bytes, 'acTL');
    if (type === 'image/webp') return containsAscii(bytes, 'ANIM');
    return false;
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new WallpaperError('processing-failed', 'Could not encode the wallpaper.'));
      }, type, quality);
    });
  }

  function bitmapDimensions(bitmap) {
    const width = Number(bitmap.width) || 0;
    const height = Number(bitmap.height) || 0;
    if (width < 1 || height < 1 || width * height > 100_000_000) {
      throw new WallpaperError('dimensions-unsupported', 'Image dimensions are not supported.');
    }
    return { width, height };
  }

  async function decodeImage(blob, resize = null) {
    if (!root.createImageBitmap) throw new WallpaperError('processing-unavailable', 'Image processing is unavailable.');
    const options = { imageOrientation: 'from-image' };
    if (resize) Object.assign(options, resize, { resizeQuality: 'high' });
    try {
      return await root.createImageBitmap(blob, options);
    } catch (error) {
      throw new WallpaperError('decode-failed', 'The image could not be decoded.', error);
    }
  }

  async function createThumbnail(blob) {
    const source = await decodeImage(blob);
    try {
      const { width, height } = bitmapDimensions(source);
      const scale = Math.min(1, THUMBNAIL_LONG_EDGE / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));
      const canvas = root.document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      canvas.getContext('2d', { alpha: true }).drawImage(source, 0, 0, targetWidth, targetHeight);
      return await canvasToBlob(canvas, 'image/webp', 0.82);
    } finally {
      source.close?.();
    }
  }

  async function optimizeImage(file, originalType, originalWidth, originalHeight) {
    let scale = Math.min(1, MAX_LONG_EDGE / Math.max(originalWidth, originalHeight));
    let quality = 0.9;
    let blob = null;
    let width = originalWidth;
    let height = originalHeight;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      width = Math.max(1, Math.round(originalWidth * scale));
      height = Math.max(1, Math.round(originalHeight * scale));
      const bitmap = await decodeImage(file, { resizeWidth: width, resizeHeight: height });
      try {
        const canvas = root.document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d', { alpha: true }).drawImage(bitmap, 0, 0, width, height);
        blob = await canvasToBlob(canvas, 'image/webp', quality);
      } finally {
        bitmap.close?.();
      }
      if (blob.size <= MAX_STORED_BYTES) break;
      if (quality > 0.72) quality -= 0.08;
      else scale *= 0.82;
    }

    if (!blob || blob.size > MAX_STORED_BYTES) {
      throw new WallpaperError('optimized-too-large', 'The optimized wallpaper is still too large.');
    }
    return { blob, type: 'image/webp', width, height, optimized: true, originalType };
  }

  async function prepareWallpaper(file) {
    if (!(file instanceof Blob)) throw new WallpaperError('invalid-file', 'Select an image file.');
    if (file.size <= 0) throw new WallpaperError('empty-file', 'The image file is empty.');
    if (file.size > MAX_SOURCE_BYTES) throw new WallpaperError('source-too-large', 'The source image is larger than 20 MB.');

    const header = await readHeader(file);
    const detectedType = detectImageType(header);
    if (!ACCEPTED_TYPES.includes(detectedType)) {
      throw new WallpaperError('unsupported-type', 'Only JPEG, PNG, and WebP images are supported.');
    }
    const animationBytes = detectedType === 'image/jpeg'
      ? header
      : new Uint8Array(await file.arrayBuffer());
    if (isAnimatedImage(animationBytes, detectedType)) {
      throw new WallpaperError('animated-image', 'Animated images are not supported.');
    }

    const decoded = await decodeImage(file);
    let dimensions;
    try { dimensions = bitmapDimensions(decoded); } finally { decoded.close?.(); }
    const shouldOptimize = file.size > MAX_STORED_BYTES || Math.max(dimensions.width, dimensions.height) > MAX_LONG_EDGE;
    const prepared = shouldOptimize
      ? await optimizeImage(file, detectedType, dimensions.width, dimensions.height)
      : {
          blob: file.slice(0, file.size, detectedType),
          type: detectedType,
          width: dimensions.width,
          height: dimensions.height,
          optimized: false,
          originalType: detectedType,
        };
    const thumbnailBlob = await createThumbnail(prepared.blob);
    const now = Date.now();
    return {
      id: createWallpaperId(),
      originalName: String(file.name || 'Wallpaper').slice(0, 240),
      type: prepared.type,
      originalType: prepared.originalType,
      blob: prepared.blob,
      thumbnailBlob,
      width: prepared.width,
      height: prepared.height,
      byteSize: prepared.blob.size,
      optimized: prepared.optimized,
      createdAt: now,
      updatedAt: now,
      focalX: DEFAULT_FOCAL_POINT,
      focalY: DEFAULT_FOCAL_POINT,
      overlay: DEFAULT_OVERLAY,
    };
  }

  async function savePreparedWallpapers(records) {
    if (!records.length) return [];
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const currentCount = await requestResult(store.count());
    if (currentCount + records.length > MAX_WALLPAPERS) {
      transaction.abort();
      throw new WallpaperError('capacity', `Only ${MAX_WALLPAPERS - currentCount} wallpaper slots are available.`);
    }
    records.forEach(record => store.add(record));
    try {
      await transactionDone(transaction);
    } catch (error) {
      const quota = error?.name === 'QuotaExceededError' || /quota/i.test(String(error?.message || ''));
      throw new WallpaperError(quota ? 'quota' : 'storage-failed', 'Could not save the wallpapers.', error);
    }
    announceChange('import', records.map(record => record.id));
    return records;
  }

  async function importFiles(files, { onProgress, shouldCancel } = {}) {
    const selected = [...(files || [])];
    if (!selected.length) return { imported: [], failed: [], persisted: null };
    if (selected.length > MAX_WALLPAPERS) {
      throw new WallpaperError('batch-too-large', 'Select no more than 10 images at once.');
    }

    const currentCount = await countWallpapers();
    if (currentCount + selected.length > MAX_WALLPAPERS) {
      throw new WallpaperError('capacity', `Only ${MAX_WALLPAPERS - currentCount} wallpaper slots are available.`);
    }

    const persisted = await requestPersistentStorage();
    const prepared = [];
    const failed = [];
    let cancelled = false;
    for (let index = 0; index < selected.length; index += 1) {
      if (shouldCancel?.()) {
        cancelled = true;
        break;
      }
      const file = selected[index];
      onProgress?.({ index, total: selected.length, file, state: 'processing' });
      try {
        const record = await prepareWallpaper(file);
        prepared.push(record);
        onProgress?.({ index, total: selected.length, file, state: 'prepared', record });
      } catch (error) {
        const failure = {
          name: String(file?.name || 'Wallpaper'),
          code: error?.code || 'processing-failed',
          message: error?.message || 'Could not process the image.',
        };
        failed.push(failure);
        onProgress?.({ index, total: selected.length, file, state: 'failed', error: failure });
      }
    }

    const imported = await savePreparedWallpapers(prepared);
    imported.forEach((record, index) => onProgress?.({
      index,
      total: selected.length,
      file: selected.find(file => file.name === record.originalName),
      state: 'saved',
      record,
    }));
    return { imported, failed, persisted, cancelled };
  }

  async function updateWallpaper(id, changes) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const record = await requestResult(store.get(id));
    if (!record) {
      transaction.abort();
      throw new WallpaperError('not-found', 'Wallpaper not found.');
    }
    const updated = {
      ...record,
      focalX: clamp(changes?.focalX ?? record.focalX, 0, 100),
      focalY: clamp(changes?.focalY ?? record.focalY, 0, 100),
      overlay: clamp(changes?.overlay ?? record.overlay, 0, 60),
      updatedAt: Date.now(),
    };
    store.put(updated);
    await transactionDone(transaction);
    announceChange('update', id);
    return updated;
  }

  async function deleteWallpaper(id) {
    const database = await openDatabase();
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    await transactionDone(transaction);
    announceChange('delete', id);
  }

  return Object.freeze({
    DB_NAME,
    STORE_NAME,
    BACKGROUND_PREFIX,
    REVISION_STORAGE_KEY,
    MAX_WALLPAPERS,
    MAX_SOURCE_BYTES,
    MAX_STORED_BYTES,
    MAX_LONG_EDGE,
    DEFAULT_FOCAL_POINT,
    DEFAULT_OVERLAY,
    ACCEPTED_TYPES,
    WallpaperError,
    isWallpaperId,
    detectImageType,
    isAnimatedImage,
    estimateStorage,
    requestPersistentStorage,
    listWallpapers,
    getWallpaper,
    countWallpapers,
    prepareWallpaper,
    importFiles,
    updateWallpaper,
    deleteWallpaper,
  });
});
