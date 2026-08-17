import { createBackgroundController } from "./backgrounds/background-controller.mjs";

function setupMotionFeedback() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const closestFromEvent = (event, selector) => event.target instanceof Element
    ? event.target.closest(selector)
    : null;
  const magneticSelector = ["button", ".command-dock-tool"].join(",");
  let magneticTarget = null;
  let magneticFrame = 0;
  let pointerX = 0;
  let pointerY = 0;

  const clearMagneticTarget = () => {
    if (!magneticTarget) return;
    magneticTarget.style.removeProperty("--magnet-x");
    magneticTarget.style.removeProperty("--magnet-y");
    magneticTarget.classList.remove("is-magnetic");
    magneticTarget = null;
  };

  const onPointerMove = event => {
    if (reducedMotion.matches || event.pointerType === "touch") return;
    const target = closestFromEvent(event, magneticSelector);
    if (!target || target.disabled) return;
    if (magneticTarget && magneticTarget !== target) clearMagneticTarget();
    magneticTarget = target;
    pointerX = event.clientX;
    pointerY = event.clientY;
    target.classList.add("is-magnetic");
    if (magneticFrame) return;
    magneticFrame = requestAnimationFrame(() => {
      if (!magneticTarget) return;
      const rect = magneticTarget.getBoundingClientRect();
      const distance = Math.hypot(
        pointerX - (rect.left + rect.width / 2),
        pointerY - (rect.top + rect.height / 2),
      );
      const reach = Math.max(rect.width, rect.height) * 0.85;
      if (distance <= reach) {
        const clamp = value => Math.max(-4.5, Math.min(4.5, value));
        magneticTarget.style.setProperty("--magnet-x", `${clamp((pointerX - rect.left - rect.width / 2) / 7)}px`);
        magneticTarget.style.setProperty("--magnet-y", `${clamp((pointerY - rect.top - rect.height / 2) / 7)}px`);
      }
      magneticFrame = 0;
    });
  };

  const onPointerOut = event => {
    if (!magneticTarget || event.relatedTarget?.closest?.(magneticSelector) === magneticTarget) return;
    clearMagneticTarget();
  };

  const onPointerDown = event => {
    if (reducedMotion.matches || event.button !== 0 || !closestFromEvent(event, "button, .page-chip, .saved-session-item")) return;
    const danger = Boolean(closestFromEvent(event, ".danger, .close-all-btn, .page-close, .deferred-dismiss, .saved-session-delete"));
    const color = danger ? "#e06d67" : "#41b5b5";
    for (let index = 0; index < 8; index += 1) {
      const spark = document.createElement("span");
      spark.className = "glass-click-spark";
      spark.style.left = `${event.clientX}px`;
      spark.style.top = `${event.clientY}px`;
      spark.style.background = color;
      spark.style.setProperty("--spark-angle", `${index * 45}deg`);
      document.body.appendChild(spark);
      spark.addEventListener("animationend", () => spark.remove(), { once: true });
    }
  };

  const observer = new MutationObserver(records => {
    if (reducedMotion.matches) return;
    const added = records
      .flatMap(record => [...record.addedNodes])
      .filter(node => node.nodeType === Node.ELEMENT_NODE);
    const cards = added.flatMap(node => [
      ...(node.matches?.(".mission-card, .deferred-item, .saved-session-item") ? [node] : []),
      ...(node.querySelectorAll?.(".mission-card, .deferred-item, .saved-session-item") || []),
    ]).slice(0, 18);
    cards.forEach((card, index) => {
      card.animate([
        { opacity: 0, transform: "translateY(12px) scale(.988)", filter: "blur(4px)" },
        { opacity: 1, transform: "translateY(0) scale(1)", filter: "blur(0)" },
      ], {
        duration: 360,
        delay: Math.min(index * 24, 180),
        easing: "cubic-bezier(.22, 1, .36, 1)",
      });
    });
  });

  document.addEventListener("pointermove", onPointerMove, { passive: true });
  document.addEventListener("pointerout", onPointerOut, { passive: true });
  document.addEventListener("pointerdown", onPointerDown, { capture: true });
  observer.observe(document.body, { childList: true, subtree: true });

  return () => {
    if (magneticFrame) cancelAnimationFrame(magneticFrame);
    clearMagneticTarget();
    observer.disconnect();
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerout", onPointerOut);
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.querySelectorAll(".glass-click-spark").forEach(spark => spark.remove());
  };
}

const backgroundStage = document.querySelector("#backgroundStage");
const backgroundController = createBackgroundController({ container: backgroundStage });
const disposeMotionFeedback = setupMotionFeedback();
backgroundController.start();

window.addEventListener("pagehide", () => {
  backgroundController.dispose();
  disposeMotionFeedback();
}, { once: true });
