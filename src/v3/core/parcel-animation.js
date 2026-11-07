import { on } from "../../js/core/eventBus.js";

let active = null;
let timer = null;
let unsubscribe = null;

export function clearParcelAnimation() {
  clearTimeout(timer);
  active?.remove();
  active = null;
  timer = null;
}

export function showParcelAnimation({ kind, count } = {}) {
  if (!window.CONFIG?.features?.v3Parcels) return;
  if (!["delivering", "delivered"].includes(kind) || !Number.isInteger(count) || count < 1) return;
  clearParcelAnimation();
  const delivered = kind === "delivered";
  active = document.createElement("aside");
  active.className = `parcel-moment parcel-moment--${kind}`;
  active.setAttribute("role", "status");
  active.setAttribute("aria-live", "polite");
  active.innerHTML = `<svg viewBox="0 0 440 190" aria-hidden="true">
    <path class="parcel-road" d="M20 160H420"/>
    <g class="parcel-van">
      <path class="parcel-van-body" d="M30 61Q30 49 42 49H180V130H30Z M180 76H225L258 111V130H180Z"/>
      <path class="parcel-window" d="M194 87H220L239 108H194Z"/>
      <path class="parcel-detail" d="M52 72H140M52 86H117M188 117H204"/>
      <g class="parcel-wheel"><circle cx="75" cy="133" r="23"/><circle class="parcel-hub" cx="75" cy="133" r="9"/></g>
      <g class="parcel-wheel"><circle cx="218" cy="133" r="23"/><circle class="parcel-hub" cx="218" cy="133" r="9"/></g>
    </g>
    <g class="parcel-box">
      <path class="parcel-box-top" d="M284 88L330 65L378 88L331 112Z"/>
      <path class="parcel-box-left" d="M284 88L331 112V163L284 137Z"/>
      <path class="parcel-box-right" d="M331 112L378 88V137L331 163Z"/>
      <path class="parcel-tape" d="M305 77L353 100V120L340 127V106L294 83Z"/>
    </g>
    <g class="parcel-confirm"><circle cx="375" cy="65" r="27"/><path d="M362 65L371 74L388 56"/></g>
  </svg><div class="parcel-copy"><strong></strong><span></span></div>`;
  active.querySelector("strong").textContent = delivered ? "Parcel delivered" : "Parcel on its way";
  active.querySelector("span").textContent = `${count} ${count === 1 ? "parcel" : "parcels"} ${delivered ? "delivered today" : "out for delivery"}`;
  document.body.append(active);
  // Timed teardown also runs while the page or its ancestors are hidden.
  timer = setTimeout(clearParcelAnimation, 8000);
}

export function initParcelAnimation() {
  if (!unsubscribe) unsubscribe = on("parcel:moment", showParcelAnimation);
  return unsubscribe;
}
