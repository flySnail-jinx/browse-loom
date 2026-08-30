import {
  BACKGROUND_REGISTRY,
  DEFAULT_BACKGROUND_ID,
  getBackgroundDefinition,
  normalizeBackgroundId,
} from "./background-registry.mjs";

export const BACKGROUND_STORAGE_KEY = "tab-out-background";

const WallpaperService = globalThis.SuperTabOutWallpapers;

function normalizeRequestedBackground(id) {
  if (WallpaperService?.isWallpaperId?.(id)) return id;
  return normalizeBackgroundId(id);
}

function readSavedBackground() {
  try {
    return normalizeRequestedBackground(localStorage.getItem(BACKGROUND_STORAGE_KEY));
  } catch {
    return DEFAULT_BACKGROUND_ID;
  }
}

function saveBackground(id) {
  try {
    localStorage.setItem(BACKGROUND_STORAGE_KEY, id);
  } catch {
    // A private or quota-restricted profile can still use the selection for this page.
  }
}

function normalizeMountedBackground(value) {
  if (typeof value === "function") return { dispose: value };
  if (value && typeof value.dispose === "function") return value;
  return { dispose() {} };
}

async function prepareUserWallpaper(record) {
  const objectUrl = URL.createObjectURL(record.blob);
  const layer = document.createElement("div");
  layer.className = "user-wallpaper-layer";
  const image = document.createElement("img");
  image.alt = "";
  image.draggable = false;
  image.src = objectUrl;
  image.style.objectPosition = `${record.focalX ?? 50}% ${record.focalY ?? 50}%`;
  const overlay = document.createElement("span");
  overlay.className = "user-wallpaper-overlay";
  overlay.style.opacity = String(Math.max(0, Math.min(60, Number(record.overlay) || 0)) / 100);
  layer.append(image, overlay);
  try {
    await image.decode();
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
  return {
    element: layer,
    reveal() {
      requestAnimationFrame(() => {
        if (layer.isConnected) layer.classList.add("is-ready");
      });
    },
    dispose() {
      layer.remove();
      URL.revokeObjectURL(objectUrl);
    },
  };
}

export function createBackgroundController({ container, root = document.documentElement } = {}) {
  if (!container) throw new Error("Background controller requires a container.");

  let activeId = null;
  let activeBackground = { dispose() {} };
  let disposed = false;
  let mountSequence = 0;

  const syncControls = () => {
    document.querySelectorAll("[data-background-id]").forEach(control => {
      const selected = control.dataset.backgroundId === activeId;
      control.classList.toggle("active", selected);
      control.setAttribute("aria-checked", selected ? "true" : "false");
      control.tabIndex = selected ? 0 : -1;
    });
  };

  const emitChange = id => {
    document.dispatchEvent(new CustomEvent("super-tab-out:background-change", {
      detail: { id },
    }));
  };

  const mount = async (requestedId, { persist = false, force = false } = {}) => {
    if (disposed) return activeId;
    const id = normalizeRequestedBackground(requestedId);
    if (id === activeId && !force) {
      if (persist) saveBackground(id);
      syncControls();
      return activeId;
    }

    const sequence = ++mountSequence;
    activeBackground.dispose();
    activeBackground = { dispose() {} };
    container.replaceChildren();

    let mountedId = id;
    try {
      if (WallpaperService?.isWallpaperId?.(id)) {
        root.dataset.background = "user-wallpaper-loading";
        container.dataset.background = "user-wallpaper-loading";
        const record = await WallpaperService.getWallpaper(id);
        if (!record) throw new Error("Wallpaper record is missing.");
        const mounted = await prepareUserWallpaper(record);
        if (disposed || sequence !== mountSequence) {
          mounted.dispose();
          return activeId;
        }
        container.replaceChildren(mounted.element);
        activeBackground = normalizeMountedBackground(mounted);
        mounted.reveal();
      } else {
        const definition = getBackgroundDefinition(id);
        activeBackground = normalizeMountedBackground(definition.mount(container));
      }
    } catch (error) {
      if (disposed || sequence !== mountSequence) return activeId;
      console.warn(`[super-tab-out] Could not mount background "${id}". Falling back to mountain.`, error);
      mountedId = DEFAULT_BACKGROUND_ID;
      container.replaceChildren();
      activeBackground = normalizeMountedBackground(getBackgroundDefinition(DEFAULT_BACKGROUND_ID).mount(container));
      saveBackground(mountedId);
      document.dispatchEvent(new CustomEvent("super-tab-out:background-error", {
        detail: { id, fallbackId: mountedId, error },
      }));
    }

    activeId = mountedId;
    const presentationId = WallpaperService?.isWallpaperId?.(mountedId) ? "user-wallpaper" : mountedId;
    root.dataset.background = presentationId;
    root.dataset.backgroundId = mountedId;
    container.dataset.background = presentationId;
    if (persist) saveBackground(mountedId);
    syncControls();
    emitChange(mountedId);
    return activeId;
  };

  const onClick = event => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-action="set-background"][data-background-id]')
      : null;
    if (!target) return;
    mount(target.dataset.backgroundId, { persist: true });
  };

  const onKeyDown = event => {
    const target = event.target instanceof Element
      ? event.target.closest('[data-action="set-background"][data-background-id]')
      : null;
    if (!target) return;
    const group = target.closest('[role="radiogroup"]');
    const controls = [...(group || document).querySelectorAll('[data-action="set-background"][data-background-id]')];
    const currentIndex = controls.indexOf(target);
    if (currentIndex === -1) return;

    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % controls.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + controls.length) % controls.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = controls.length - 1;
    else return;

    event.preventDefault();
    const nextControl = controls[nextIndex];
    nextControl.focus();
    mount(nextControl.dataset.backgroundId, { persist: true });
  };

  const themeObserver = new MutationObserver(records => {
    if (!records.some(record => record.attributeName === "data-theme")) return;
    activeBackground.updateTheme?.();
  });

  const onStorage = event => {
    if (event.key === BACKGROUND_STORAGE_KEY) {
      mount(event.newValue || DEFAULT_BACKGROUND_ID, { persist: false });
      return;
    }
    if (event.key === WallpaperService?.REVISION_STORAGE_KEY && WallpaperService?.isWallpaperId?.(activeId)) {
      mount(activeId, { persist: false, force: true });
    }
  };

  const onLibraryChange = event => {
    if (!WallpaperService?.isWallpaperId?.(activeId)) return;
    const changed = Array.isArray(event.detail?.id)
      ? event.detail.id.includes(activeId)
      : event.detail?.id === activeId;
    if (changed) mount(activeId, { persist: false, force: true });
  };

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
  window.addEventListener("storage", onStorage);
  window.addEventListener("super-tab-out:wallpaper-library-change", onLibraryChange);
  themeObserver.observe(root, { attributes: true, attributeFilter: ["data-theme"] });

  return {
    start() {
      return mount(readSavedBackground());
    },
    setBackground(id, options) {
      return mount(id, options);
    },
    getActiveBackground() {
      return activeId;
    },
    getAvailableBackgrounds() {
      return BACKGROUND_REGISTRY.map(({ id, labelKey }) => ({ id, labelKey }));
    },
    syncControls,
    dispose() {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("super-tab-out:wallpaper-library-change", onLibraryChange);
      themeObserver.disconnect();
      mountSequence += 1;
      activeBackground.dispose();
      activeBackground = { dispose() {} };
      container.replaceChildren();
    },
  };
}
