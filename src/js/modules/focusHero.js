import { computeFocus } from "../services/focusEngine.js";
import { getBomWarnings } from "../services/weather/bom.js";
import { getAllEntities } from "../services/homeAssistant/state.js";
import { getCurrentInsight, initInsightEngine } from "../services/insightEngine.js";
import { initAttentionEngine, getSelection } from "../services/attentionEngine.js";
import { collectSources } from "../services/candidateSources.js";
import { getMode } from "../core/presence.js";
import { on } from "../core/eventBus.js";
import { attentionWeights } from "../core/routineRuntime.js";

const TICK_MS = 30_000;
const CONCIERGE_MIN_INTERVAL_MS = 20 * 60 * 1000;
const STACK_FADE_MS = 700; // > CSS opacity transition; never clear on transitionend (hidden node)

const HERO_TIER_A_MAX = 16; // ≤16 chars → headline
const HERO_TIER_B_MAX = 40; // 17–40 chars → standard (the default)

let conciergeText = null;
let conciergeFetchedAt = 0;
let attentionOn = false;
let heroTypeOn = false;
let leanInOn = false;
let bareHeroOn = false;
let stackClearTimer = null;
let lastSelection = { hero: null, stack: [], queue: [] };

// Study 02 — length-responsive hero type. Character count picks the tier:
// short lines go big, long lines step down. 41+ chars all land on tier C
// (the legibility floor) — the temperament trims copy before it reaches here.
function heroTier(text) {
  const n = (text || "").trim().length;
  if (n <= HERO_TIER_A_MAX) return "a";
  if (n <= HERO_TIER_B_MAX) return "b";
  return "c";
}

function applyHeroTier(hero, text) {
  const tier = heroTier(text);
  hero.classList.remove("focus-hero--tier-a", "focus-hero--tier-b", "focus-hero--tier-c");
  hero.classList.add(`focus-hero--tier-${tier}`);
}

function isPanelActive(panelId) {
  const panel = document.getElementById(panelId);
  return Boolean(panel) && !panel.classList.contains("is-collapsed") && !panel.classList.contains("is-hidden");
}

function readState() {
  return {
    bomWarning: getBomWarnings(getAllEntities()).summary || null,
    insight: getCurrentInsight(),
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

// Real weather for the concierge line — the DOM condition label alone
// ("Clear") gave the model so little that it invented forecasts.
async function fetchWeatherLine() {
  try {
    const res = await fetch("/api/weather/now", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    const data  = await res.json();
    const parts = [];
    if (data?.now?.temp_c != null) parts.push(`${Math.round(data.now.temp_c)}°`);
    const label = data?.now?.condition?.label;
    if (label && label !== "Unavailable") parts.push(label);
    if (data?.day?.low_c != null && data?.day?.high_c != null) {
      parts.push(`${Math.round(data.day.low_c)}° to ${Math.round(data.day.high_c)}° today`);
    }
    return parts.length ? parts.join(", ") : null;
  } catch { return null; }
}

async function maybeFetchConcierge(weatherCondition) {
  if (Date.now() - conciergeFetchedAt < CONCIERGE_MIN_INTERVAL_MS) return;
  conciergeFetchedAt = Date.now(); // claim the slot before awaiting, avoids overlapping fetches
  try {
    const weather = (await fetchWeatherLine()) ?? weatherCondition ?? null;
    const res = await fetch("/api/ai/brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "concierge",
        time: new Date().toLocaleString("en-AU", { weekday: "long", hour: "numeric", minute: "2-digit", hour12: true }),
        weather
      }),
      signal: AbortSignal.timeout(8_000)
    });
    if (res.ok) {
      const data = await res.json();
      if (data.summary) conciergeText = data.summary;
    }
  } catch { /* non-fatal — hero just stays hidden */ }
}

function heroEls() {
  const hero = document.getElementById("focus-hero");
  const iconEl = document.getElementById("focus-hero-icon");
  const textEl = document.getElementById("focus-hero-text");
  if (!hero || !iconEl || !textEl) return null;
  return { hero, iconEl, textEl };
}

function showHero(els, icon, text, { concierge = false } = {}) {
  els.iconEl.textContent = icon;
  els.textEl.textContent = text;
  if (heroTypeOn) applyHeroTier(els.hero, text);
  // WP-C: mark the idle concierge fallback so the un-chromed hero can render it
  // matte (no glyph glow, lower ink). Flag-off adds no class → byte-identical.
  if (bareHeroOn) els.hero.classList.toggle("concierge", concierge === true);
  els.hero.classList.remove("is-hidden");
}

function hideHero(els) {
  els.hero.classList.add("is-hidden");
}

// ── Lean-in stack (Mode 2 DWELL) ──────────────────────────────
// Opacity-fade only (transform breaks fixed descendants) with a setTimeout
// teardown — transitionend never fires while the node is hidden. See the
// 2026-07 leak-audit memory.
function renderStack(items) {
  const stackEl = document.getElementById("focus-stack");
  if (!stackEl) return;

  if (!items.length) {
    stackEl.classList.add("is-hidden");
    clearTimeout(stackClearTimer);
    stackClearTimer = setTimeout(() => stackEl.replaceChildren(), STACK_FADE_MS);
    return;
  }

  clearTimeout(stackClearTimer);
  stackEl.replaceChildren(
    ...items.map((c) => {
      const row = document.createElement("div");
      row.className = "focus-stack__item";
      const icon = document.createElement("span");
      icon.className = "focus-stack__icon";
      icon.textContent = c.icon;
      const text = document.createElement("span");
      text.className = "focus-stack__text";
      text.textContent = c.text;
      row.append(icon, text);
      return row;
    })
  );
  stackEl.classList.remove("is-hidden");
}

function updateAttention(state, els) {
  const mode = getMode();
  const sources = collectSources(state);
  // Phase 8 — learned per-source nudges tilt the ranking ({} when off → unchanged).
  const sel = getSelection({ sources, now: new Date(), mode, weights: attentionWeights() });
  lastSelection = sel;

  if (!sel.hero) {
    // Concierge fallback only when the display is awake — never in AMBIENT/VOICE.
    if (mode === "glance" || mode === "dwell") {
      void maybeFetchConcierge(state.weatherCondition);
      if (conciergeText) showHero(els, "✨", conciergeText, { concierge: true });
      else hideHero(els);
    } else {
      hideHero(els);
    }
    renderStack([]);
    return;
  }

  showHero(els, sel.hero.icon, sel.hero.text);
  renderStack(sel.stack.slice(1)); // items 2..N — the hero already owns slot 1
}

function update() {
  const els = heroEls();
  if (!els) return;

  const state = readState();

  if (attentionOn) {
    updateAttention(state, els);
    return;
  }

  // ── flag-off path: unchanged pre-Phase-2 behaviour ──
  const focus = computeFocus(state);

  if (!focus) {
    void maybeFetchConcierge(state.weatherCondition);
    if (!conciergeText) {
      hideHero(els);
      return;
    }
    showHero(els, "✨", conciergeText, { concierge: true });
    return;
  }

  showHero(els, focus.icon, focus.text);
}

export function initFocusHero({ attentionEnabled = false, heroTypeEnabled = false, leanInStackEnabled = false, bareHeroEnabled = false } = {}) {
  attentionOn = attentionEnabled === true;
  heroTypeOn = heroTypeEnabled === true;
  leanInOn = leanInStackEnabled === true;
  bareHeroOn = bareHeroEnabled === true;

  // Study 02 — mark the feature on so the length-responsive CSS engages, and
  // expose a probe for the on-Pi 3–4 m legibility check. Flag-off: no class,
  // no hook → byte-identical.
  if (heroTypeOn) {
    const els = heroEls();
    if (els) els.hero.classList.add("hero-type");
    window.__heroType = () => {
      const t = document.getElementById("focus-hero-text")?.textContent || "";
      return { enabled: true, len: t.trim().length, tier: heroTier(t), text: t };
    };
  }

  // Study 01 (WP2) — mark the stack so the full-glass CSS engages on DWELL only.
  // Flag-off: no class → flat cards, byte-identical. The reveal/teardown path
  // (renderStack) is unchanged; this only restyles the cards it produces.
  if (leanInOn) {
    const stackEl = document.getElementById("focus-stack");
    if (stackEl) stackEl.classList.add("lean-in-glass");
    window.__leanInStack = () => {
      const item = document.querySelector("#focus-stack .focus-stack__item");
      const cs = item ? getComputedStyle(item) : null;
      return {
        enabled: true,
        marked: Boolean(document.getElementById("focus-stack")?.classList.contains("lean-in-glass")),
        items: document.querySelectorAll("#focus-stack .focus-stack__item").length,
        backdropFilter: cs ? (cs.backdropFilter || cs.webkitBackdropFilter) : null,
        boxShadow: cs ? cs.boxShadow : null
      };
    };
  }

  if (attentionOn) {
    initAttentionEngine();
    on("presence:changed", update); // reveal/collapse the stack immediately on mode change
    window.__attention = () => ({ mode: getMode(), ...lastSelection });
  } else {
    initInsightEngine();
  }

  update();
  setInterval(update, TICK_MS);
}
