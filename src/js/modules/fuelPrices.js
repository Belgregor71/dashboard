const REFRESH_MS = 2 * 60 * 60 * 1000;

function renderWidget(el, sites) {
  if (!sites?.length) {
    el.hidden = true;
    return;
  }
  el.hidden = false;
  el.innerHTML = `
    <div class="fuel-header">Unleaded</div>
    ${sites.map(s => `
      <div class="fuel-row">
        <span class="fuel-price">${s.price.toFixed(1)}<span class="fuel-unit">¢</span></span>
        <span class="fuel-name">${s.name}</span>
        <span class="fuel-dist">${s.distanceKm}km</span>
      </div>`).join("")}`;
}

export function initFuelPrices() {
  const el = document.createElement("div");
  el.id = "fuel-overlay";
  el.hidden = true;
  document.body.appendChild(el);

  async function refresh() {
    try {
      const r = await fetch("/api/fuel");
      if (!r.ok) return;
      const data = await r.json();
      if (data.configured === false) return;
      renderWidget(el, data.sites ?? []);
    } catch { /* stay hidden on network error */ }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
}
