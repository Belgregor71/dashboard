import { gatherBriefingContext } from "../modules/briefingData.js";
import { generateBriefing, currentBriefingType } from "../modules/aiBriefing.js";
import { switchView } from "../core/viewManager.js";

const REFRESH_MS    = 10 * 60 * 1000;
const AUTO_CLOSE_MS = 5 * 60 * 1000;  // return to home if no interaction

// ── Headline fallback (shown while the AI generates) ───────────

function buildHeadline() {
  const hour = new Date().getHours();
  const day  = new Date().toLocaleDateString("en-AU", { weekday: "long" });
  if (hour >= 5  && hour < 12) return `Good morning. Here's your ${day}.`;
  if (hour >= 12 && hour < 17) return "Good afternoon. Here's where things stand.";
  if (hour >= 17 && hour < 21) return "Good evening. Here's tonight.";
  return "Here's the overnight rundown.";
}

// ── Fact tiles ─────────────────────────────────────────────────
// Each tile is evidence for the narrative. A tile with nothing to
// say is simply absent — never rendered blank or as "not due".

function tile(label, value, meta) {
  const el = document.createElement("article");
  el.className = "panel briefing-tile";

  const labelEl = document.createElement("div");
  labelEl.className   = "bt-label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className   = "bt-value";
  valueEl.textContent = value;

  el.append(labelEl, valueEl);
  if (meta) {
    const metaEl = document.createElement("div");
    metaEl.className   = "bt-meta";
    metaEl.textContent = meta;
    el.append(metaEl);
  }
  return el;
}

function weatherTile(ctx) {
  const w = ctx.weather;
  if (!w || w.tempC == null) return null;

  const value = [`${Math.round(w.tempC)}°`, w.condition].filter(Boolean).join(" ");

  let meta = null;
  if (ctx.type === "evening" && ctx.tomorrowWeather?.highC != null) {
    const t    = ctx.tomorrowWeather;
    const bits = [`${Math.round(t.lowC)}°–${Math.round(t.highC)}°`, t.condition].filter(Boolean);
    meta = `Tomorrow ${bits.join(" ")}`;
  } else if (w.lowC != null && w.highC != null) {
    const bits = [`${Math.round(w.lowC)}°–${Math.round(w.highC)}°`];
    if (w.uv != null && w.uv >= 3) bits.push(`UV ${Math.round(w.uv)}`);
    if (w.rainChancePct != null && w.rainChancePct >= 20) bits.push(`rain ${w.rainChancePct}%`);
    meta = bits.join(" · ");
  }

  return tile("Weather", value, meta);
}

function nextUpTile(ctx) {
  const now = new Date();
  const upcoming = ctx.calendar.today.find(ev => ev.allDay || ev.start > now);

  if (upcoming) {
    return tile(ctx.type === "evening" ? "Tonight" : "Next up", upcoming.time, upcoming.title);
  }
  const tomorrow = ctx.calendar.tomorrow[0];
  if (tomorrow) {
    return tile("Tomorrow", tomorrow.time, tomorrow.title);
  }
  return null;
}

function binsTile(ctx) {
  if (!ctx.bins?.due) return null;
  return tile("Bins", ctx.bins.colours.join(" + "), ctx.bins.eve ? "Out tonight" : "Today");
}

function fuelTile(ctx) {
  if (!ctx.fuel) return null;
  return tile("Fuel", `${ctx.fuel.price}c`, `${ctx.fuel.name} · ${ctx.fuel.distanceKm} km`);
}

function commuteTile(ctx) {
  const c = ctx.commute;
  if (!c) return null;
  const first  = c.greg  ? { name: "Greg",  ...c.greg }  : null;
  const second = c.brett ? { name: "Brett", ...c.brett } : null;
  const lead   = first ?? second;
  if (!lead) return null;

  const metaBits = [];
  if (first && second) metaBits.push(`${second.name} ${second.mins} min`);
  const delay = Math.max(c.greg?.delayMin ?? 0, c.brett?.delayMin ?? 0);
  if (delay >= 5) metaBits.push(`+${delay} traffic`);

  return tile(
    "Commute",
    `${lead.name} ${lead.mins} min`,
    metaBits.length ? metaBits.join(" · ") : null
  );
}

function homeTile(ctx) {
  if (!ctx.people.length) return null;
  const home = ctx.people.filter(p => p.home).map(p => p.name);
  const away = ctx.people.filter(p => !p.home).map(p => p.name);
  const value = home.length ? home.join(" & ") : "Empty";
  const meta  = away.length ? `${away.join(" & ")} away` : "Everyone home";
  return tile("Home", value, meta);
}

function renderTiles(ctx, container) {
  container.replaceChildren(
    ...[
      weatherTile(ctx),
      nextUpTile(ctx),
      binsTile(ctx),
      commuteTile(ctx),
      fuelTile(ctx),
      homeTile(ctx),
    ].filter(Boolean)
  );
}

// ── View factory ───────────────────────────────────────────────

export function createBriefingView() {
  const root          = document.getElementById("briefing-view");
  const generatedAtEl = document.getElementById("briefing-generated-at");
  const headlineEl    = document.getElementById("briefing-headline");
  const tilesEl       = document.getElementById("briefing-tiles");

  if (!root || !headlineEl || !tilesEl) {
    return { render: () => {}, onEnter: () => {}, onLeave: () => {} };
  }

  let refreshTimer   = null;
  let autoCloseTimer = null;

  function setLoading() {
    headlineEl.textContent = "Loading briefing…";
    headlineEl.className   = "";
    tilesEl.replaceChildren();
  }

  async function loadBrief() {
    const type = currentBriefingType();

    // Fallback narrative + pulse while data and AI arrive
    headlineEl.textContent = buildHeadline();
    headlineEl.className   = "is-generating";

    try {
      const ctx = await gatherBriefingContext(type);
      renderTiles(ctx, tilesEl);
      generatedAtEl.textContent = `Updated ${new Date().toLocaleTimeString("en-AU", {
        hour: "numeric", minute: "2-digit", hour12: true
      })}`;
    } catch { /* tiles stay empty; narrative still renders */ }

    // AI narrative — served from the shared cache when fresh, so the
    // spoken briefing and this text are always the same words.
    generateBriefing({ type })
      .then(summary => {
        if (!summary) { headlineEl.className = ""; return; }
        headlineEl.textContent = summary;
        headlineEl.className   = "is-ai-summary";
      })
      .catch(() => { headlineEl.className = ""; });
  }

  function render() {
    generatedAtEl.textContent = "";
    setLoading();
  }

  function onEnter() {
    loadBrief();
    if (!refreshTimer) refreshTimer = setInterval(loadBrief, REFRESH_MS);
    clearTimeout(autoCloseTimer);
    autoCloseTimer = setTimeout(() => switchView("home"), AUTO_CLOSE_MS);
  }

  function onLeave() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  return { render, onEnter, onLeave };
}
