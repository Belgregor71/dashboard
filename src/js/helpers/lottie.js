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

  container.dataset.lottieFile = fileName;
  container._lottieInstance = anim;

  anim.addEventListener("DOMLoaded", () => {
    requestAnimationFrame(() => {
      wrapper.classList.add("visible");
    });
  });

  return anim;
}
