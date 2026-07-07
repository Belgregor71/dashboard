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

  // These header weather icons render a single STATIC frame, never animated.
  // Continuously rendering the animated art costs ~50ms/frame of Pi GPU and
  // pinned the GPU process at a full core 24/7 — and that held regardless of
  // renderer (svg or canvas), frame rate (even 15fps), or CSS containment
  // (all measured on the live Pi 2026-07-07). Only a static frame is free.
  // autoplay stays false; we goToAndStop once the JSON has loaded.
  const anim = window.lottie.loadAnimation({
    container: wrapper,
    renderer: "svg",
    loop: false,
    autoplay: false,
    path: `/icons/weather/lottie/${fileName}`
  });

  container.dataset.lottieFile = fileName;
  container._lottieInstance = anim;

  anim.addEventListener("DOMLoaded", () => {
    // A mid-animation frame reliably shows the icon fully drawn (frame 0 can
    // be a pre-build/empty state on some icons).
    anim.goToAndStop(Math.floor(anim.totalFrames / 2), true);
    requestAnimationFrame(() => {
      wrapper.classList.add("visible");
    });
  });

  return anim;
}

/**
 * The weather icons are static (see loadLottieAnimation), so there is nothing
 * to resume — this only guarantees none are left ticking (e.g. a debug hook
 * or a future change that calls play()). Cheap and idempotent; safe on every
 * view change.
 */
export function syncLottiePlayback() {
  document.querySelectorAll("[data-lottie-file]").forEach((el) => {
    const anim = el._lottieInstance;
    if (!anim || anim.isDestroyed || anim.isPaused) return;
    anim.pause();
  });
}
