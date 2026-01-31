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

  const previous = container.querySelector(".lottie-fade");
  const previousInstance = container._lottieInstance;
  if (previous) {
    previous.classList.add("is-exiting");
    previous.addEventListener(
      "transitionend",
      () => {
        previous.remove();
        previousInstance?.destroy?.();
      },
      { once: true }
    );
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
