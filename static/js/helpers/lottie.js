export function loadLottieAnimation(containerId, fileName) {
  const container = document.getElementById(containerId);
  if (!container || !window.lottie) return;

  container.innerHTML = "";

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
