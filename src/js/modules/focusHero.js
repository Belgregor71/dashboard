import { computeFocus } from "../services/focusEngine.js";

const TICK_MS = 30_000;
const CONCIERGE_MIN_INTERVAL_MS = 20 * 60 * 1000;

let conciergeText = null;
let conciergeFetchedAt = 0;

function isPanelActive(panelId) {
  const panel = document.getElementById(panelId);
  return Boolean(panel) && !panel.classList.contains("is-collapsed") && !panel.classList.contains("is-hidden");
}

function readState() {
  return {
    weatherCondition: document.getElementById("current-conditions")?.textContent?.trim() || "",
    weatherTemp: document.getElementById("current-temp")?.textContent?.trim() || "",
    commuteActive: isPanelActive("commute-panel"),
    commuteText: [
      document.getElementById("commute-greg")?.textContent?.trim(),
      document.getElementById("commute-brett")?.textContent?.trim()
    ].filter(Boolean).join(" · "),
    nextEventActive: isPanelActive("next-event-panel"),
    nextEventText: [
      document.getElementById("next-event-name")?.textContent?.trim(),
      document.getElementById("next-event-meta")?.textContent?.trim()
    ].filter(Boolean).join(" · ")
  };
}

async function maybeFetchConcierge(weatherCondition) {
  if (Date.now() - conciergeFetchedAt < CONCIERGE_MIN_INTERVAL_MS) return;
  conciergeFetchedAt = Date.now(); // claim the slot before awaiting, avoids overlapping fetches
  try {
    const res = await fetch("/api/ai/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "concierge",
        time: new Date().toLocaleString("en-AU", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }),
        weather: weatherCondition || null
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.summary) conciergeText = data.summary;
    }
  } catch { /* non-fatal — hero just stays hidden */ }
}

function update() {
  const hero = document.getElementById("focus-hero");
  const iconEl = document.getElementById("focus-hero-icon");
  const textEl = document.getElementById("focus-hero-text");
  if (!hero || !iconEl || !textEl) return;

  const state = readState();
  const focus = computeFocus(state);

  if (!focus) {
    void maybeFetchConcierge(state.weatherCondition);
    if (!conciergeText) {
      hero.classList.add("is-hidden");
      return;
    }
    iconEl.textContent = "✨";
    textEl.textContent = conciergeText;
    hero.classList.remove("is-hidden");
    return;
  }

  iconEl.textContent = focus.icon;
  textEl.textContent = focus.text;
  hero.classList.remove("is-hidden");
}

export function initFocusHero() {
  update();
  setInterval(update, TICK_MS);
}
