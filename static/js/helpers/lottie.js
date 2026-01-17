export function loadLottieAnimation(containerId, fileName) {
  const container = document.getElementById(containerId);
  if (!container || !window.lottie) return;

  const previous = container.querySelector(".lottie-fade");
  if (previous) {
    previous.classList.add("is-exiting");
    previous.addEventListener(
      "transitionend",
      () => {
        previous.remove();
      },
      { once: true }
    );
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

  anim.addEventListener("DOMLoaded", () => {
    requestAnimationFrame(() => {
      wrapper.classList.add("visible");
    });
  });

  return anim;
}
