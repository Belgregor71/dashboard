import { getAllEntities } from "../services/homeAssistant/state.js";
import { getBomWarnings } from "../services/weather/bom.js";

const REFRESH_MS = 5 * 60 * 1000;

function render() {
  const bar = document.getElementById("bom-warning-bar");
  if (!bar) return;

  const warnings = getBomWarnings(getAllEntities());
  if (!warnings.summary) {
    bar.classList.add("is-hidden");
    return;
  }

  document.getElementById("bom-warning-title").textContent = warnings.summary;
  document.getElementById("bom-warning-detail").textContent =
    warnings.count > 1 ? warnings.messages.slice(1).join(" · ") : "";
  bar.classList.remove("is-hidden");
}

export function initBomWarningBanner() {
  render();
  setInterval(render, REFRESH_MS);
}
