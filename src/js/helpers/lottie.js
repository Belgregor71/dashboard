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

  const anim = window.lottie.loadAnimation({
    container: wrapper,
    renderer: "svg",
    loop: true,
    autoplay: true,
    path: `/icons/weather/lottie/${fileName}`
  });

  // Subframe interpolation re-rasterizes the SVG at 60fps and pegged the
  // Pi's GPU process at a full core (measured 2026-07-06: 99.6% → 4.4%
  // after this + pausing hidden instances). Native frame rate looks
  // identical on a weather icon.
  anim.setSubframe(false);
  // Created while the container's view is hidden — don't tick invisibly;
  // syncLottiePlayback() resumes it when the view actually shows.
  if (!container.offsetParent) anim.pause();

  container.dataset.lottieFile = fileName;
  container._lottieInstance = anim;

  anim.addEventListener("DOMLoaded", () => {
    requestAnimationFrame(() => {
      wrapper.classList.add("visible");
    });
  });

  return anim;
}

/**
 * Pause every lottie whose container isn't currently rendered (hidden view,
 * or screensaver covering everything) and resume the visible ones. Cheap —
 * safe to call on every view change.
 */
export function syncLottiePlayback() {
  const saverActive = document.body.classList.contains("screensaver-active");
  document.querySelectorAll("[data-lottie-file]").forEach((el) => {
    const anim = el._lottieInstance;
    if (!anim || anim.isDestroyed) return;
    const shouldPlay = !saverActive && el.offsetParent !== null;
    if (shouldPlay && anim.isPaused) anim.play();
    else if (!shouldPlay && !anim.isPaused) anim.pause();
  });
}
