import { setFuelActive } from "./middleSlot.js";

const REFRESH_MS = 2 * 60 * 60 * 1000;
const SHOW_MS    = 60 * 60 * 1000; // hide 1 hour after last detected change

let lastPriceKey = null;
let hideTimer    = null;

function priceKey(sites) {
  return sites.map(s => `${s.name}:${s.price}`).join("|");
}

function renderList(sites) {
  const list = document.getElementById("fuel-panel-list");
  if (!list) return;
  list.innerHTML = sites.map(s => `
    <div class="fuel-row">
      <span class="fuel-price">${s.price.toFixed(1)}<span class="fuel-unit">¢</span></span>
      <span class="fuel-name">${s.name}</span>
      <span class="fuel-dist">${s.distanceKm}km</span>
    </div>`).join("");
}

export function initFuelPrices() {
  async function refresh() {
    try {
      const r = await fetch("/api/fuel");
      if (!r.ok) return;
      const data = await r.json();
      if (data.configured === false) return;
      const sites = data.sites ?? [];
      if (!sites.length) return;

      const key = priceKey(sites);
      if (key === lastPriceKey) return;

      lastPriceKey = key;
      renderList(sites);

      clearTimeout(hideTimer);
      setFuelActive(true);
      hideTimer = setTimeout(() => setFuelActive(false), SHOW_MS);
    } catch { /* stay hidden on error */ }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}
