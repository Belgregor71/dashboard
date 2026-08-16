/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js

   ⚠ V3 joined 2026-08-16 with the week-ahead strip (v3/subjects/forecast.js).
   Until then `window.lottie` was set in exactly one place — js/core/app.js —
   which V3 does not import, so every function here returned immediately on that
   surface. V3 now sets the global in main.js's "lottie" stage. The guard on
   line 1 of loadLottieAnimation is what made that four-month gap harmless, and
   it is what keeps this safe to call from anywhere.
   ════════════════════════════════════════════════════════════════════════ */

export function loadLottieAnimation(containerId, fileName) {
  const container = document.getElementById(containerId);
  if (!container || !window.lottie) return;

  const currentFile = container.dataset.lottieFile;
  const currentInstance = container._lottieInstance;
  if (currentFile === fileName && currentInstance) {
    const hasRenderer = container.querySelector("svg, canvas");
    if (currentInstance.isDestroyed || !hasRenderer) {
      container._lottieInstance = null;
      container.dataset.lottieFile = "";
    } else {
      return currentInstance;
    }
  }

  // Remove every previous wrapper, not just the newest: transitionend never
  // fires on hidden elements (display:none ancestors), so without the timer
  // fallback the exiting wrappers pile up forever (observed: 700+ zombie
  // divs after a day of kiosk uptime).
  const previousWrappers = Array.from(container.querySelectorAll(".lottie-fade"));
  const previousInstance = container._lottieInstance;
  if (previousWrappers.length) {
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      previousWrappers.forEach((el) => el.remove());
      previousInstance?.destroy?.();
    };
    previousWrappers.forEach((el) => el.classList.add("is-exiting"));
    previousWrappers[previousWrappers.length - 1].addEventListener(
      "transitionend",
      cleanup,
      { once: true }
    );
    setTimeout(cleanup, 1000); // fade transition is 0.8s
  } else if (previousInstance) {
    previousInstance.destroy?.();
  }

  const wrapper = document.createElement("div");
  wrapper.className = "lottie-fade";
  container.appendChild(wrapper);

  // autoplay must stay false: lottie loads the JSON async and an autoplay
  // instance calls play() itself when the data arrives, overriding any
  // pause() issued at creation. Playback starts explicitly below, gated on
  // visibility and (globally) frozen under the screensaver — see freezeLotties.
  const anim = window.lottie.loadAnimation({
    container: wrapper,
    renderer: "svg",
    loop: true,
    autoplay: false,
    path: `/icons/weather/lottie/${fileName}`
  });

  // Native frame rate looks identical on a weather icon and halves the raster.
  anim.setSubframe(false);

  container.dataset.lottieFile = fileName;
  container._lottieInstance = anim;

  anim.addEventListener("DOMLoaded", () => {
    if (container.offsetParent && !lottiesFrozen) anim.play();
    requestAnimationFrame(() => {
      wrapper.classList.add("visible");
    });
  });

  return anim;
}

let lottiesFrozen = false;

/**
 * Freeze/unfreeze EVERY lottie on the page in one call (lottie-web's global
 * player timer). The kiosk composites the whole dashboard at 60fps whenever
 * any animation runs, which costs ~1 GPU core on the Pi; when the screensaver
 * engages (nobody watching) there is no reason to pay that. Verified on the
 * live Pi: freezing all lotties drops the GPU process to ~0%.
 */
export function freezeLotties() {
  lottiesFrozen = true;
  window.lottie?.freeze?.();
}

export function unfreezeLotties() {
  lottiesFrozen = false;
  window.lottie?.unfreeze?.();
}

/**
 * Pause every lottie whose container isn't currently rendered (hidden view)
 * and resume the visible ones — unless globally frozen by the screensaver.
 * Cheap; safe to call on every view change.
 */
export function syncLottiePlayback() {
  if (lottiesFrozen) return;
  const saverActive = document.body.classList.contains("screensaver-active");
  document.querySelectorAll("[data-lottie-file]").forEach((el) => {
    const anim = el._lottieInstance;
    if (!anim || anim.isDestroyed) return;
    const shouldPlay = !saverActive && el.offsetParent !== null;
    if (shouldPlay && anim.isPaused) anim.play();
    else if (!shouldPlay && !anim.isPaused) anim.pause();
  });
}
