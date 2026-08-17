import {
  BACKGROUND_REGISTRY,
  DEFAULT_BACKGROUND_ID,
  getBackgroundDefinition,
  normalizeBackgroundId,
} from "./background-registry.mjs";

export const BACKGROUND_STORAGE_KEY = "tab-out-background";

function readSavedBackground() {
  try {
    return normalizeBackgroundId(localStorage.getItem(BACKGROUND_STORAGE_KEY));
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

export function createBackgroundController({ container, root = document.documentElement } = {}) {
  if (!container) throw new Error("Background controller requires a container.");

  let activeId = null;
  let activeBackground = { dispose() {} };
  let disposed = false;

  const syncControls = () => {
    document.querySelectorAll("[data-background-id]").forEach(control => {
      const selected = control.dataset.backgroundId === activeId;
      control.classList.toggle("active", selected);
      control.setAttribute("aria-checked", selected ? "true" : "false");
      control.tabIndex = selected ? 0 : -1;
    });
  };

  const mount = (requestedId, { persist = false } = {}) => {
    if (disposed) return activeId;
    const id = normalizeBackgroundId(requestedId);
    if (id === activeId) {
      if (persist) saveBackground(id);
      syncControls();
      return activeId;
    }

    const definition = getBackgroundDefinition(id);
    activeBackground.dispose();
    activeBackground = { dispose() {} };
    container.replaceChildren();

    let mountedId = id;
    try {
      activeBackground = normalizeMountedBackground(definition.mount(container));
    } catch (error) {
      console.warn(`[super-tab-out] Could not mount background "${id}". Falling back to static.`, error);
      mountedId = "static";
      container.replaceChildren();
      activeBackground = normalizeMountedBackground(getBackgroundDefinition("static").mount(container));
    }

    activeId = mountedId;
    root.dataset.background = mountedId;
    container.dataset.background = mountedId;
    if (persist) saveBackground(mountedId);
    syncControls();
    document.dispatchEvent(new CustomEvent("super-tab-out:background-change", {
      detail: { id: mountedId },
    }));
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
    const controls = [...document.querySelectorAll('[data-action="set-background"][data-background-id]')];
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

  document.addEventListener("click", onClick);
  document.addEventListener("keydown", onKeyDown);
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
      themeObserver.disconnect();
      activeBackground.dispose();
      activeBackground = { dispose() {} };
      container.replaceChildren();
    },
  };
}
