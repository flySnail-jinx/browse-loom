import { mountLiquidEther } from "./liquid-ether.mjs";
import { mountLightRays } from "./light-rays.mjs";
import { mountPrism } from "./prism.mjs";

export const DEFAULT_BACKGROUND_ID = "mountain";

export const BACKGROUND_REGISTRY = Object.freeze([
  Object.freeze({
    id: "mountain",
    labelKey: "backgroundMountain",
    mount() {
      return { dispose() {} };
    },
  }),
  Object.freeze({
    id: "liquid-ether",
    labelKey: "backgroundLiquidEther",
    mount(container) {
      const dispose = mountLiquidEther(container, {
        mouseForce: 20,
        cursorSize: 108,
        isViscous: true,
        viscous: 30,
        iterationsViscous: 32,
        iterationsPoisson: 32,
        resolution: 0.5,
        BFECC: true,
        autoDemo: true,
        autoSpeed: 0.5,
        autoIntensity: 2.2,
      });
      return { dispose };
    },
  }),
  Object.freeze({
    id: "light-rays",
    labelKey: "backgroundLightRays",
    mount(container) {
      return mountLightRays(container);
    },
  }),
  Object.freeze({
    id: "prism",
    labelKey: "backgroundPrism",
    mount(container) {
      return mountPrism(container);
    },
  }),
  Object.freeze({
    id: "static",
    labelKey: "backgroundStatic",
    mount() {
      return { dispose() {} };
    },
  }),
]);

export function getBackgroundDefinition(id) {
  return BACKGROUND_REGISTRY.find(background => background.id === id) || null;
}

export function normalizeBackgroundId(id) {
  return getBackgroundDefinition(id)?.id || DEFAULT_BACKGROUND_ID;
}
