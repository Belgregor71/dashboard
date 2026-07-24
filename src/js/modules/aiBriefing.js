import { gatherBriefingContext } from "./briefingData.js";
import { isFuelCycleLow } from "../services/insightRules.js";

// Same rolling price map the insight engine records (attentionEngine /
// insightEngine keep it fresh); read-only here.
const FUEL_HISTORY_KEY = "dashboard:fuel-history";

function readFuelHistory() {
  try { return JSON.parse(localStorage.getItem(FUEL_HISTORY_KEY)) || {}; }
  catch { return {}; }
}

// Builds the AI prompt payload from the shared briefing context and calls
// /api/ai/brief. Summaries are cached so the scheduled speech, the view's
// headline, and voice commands all say the same thing — and the model is
// only called once per window, not on every view refresh.

const SUMMARY_TTL_MS = 30 * 60 * 1000;
let summaryCache = null; // { type, summary, at }
let inFlight = null;     // { type, promise }

export function currentBriefingType() {
  return new Date().getHours() < 12 ? "morning" : "evening";
}

// ── Context → prompt strings ───────────────────────────────────

function weatherText(ctx) {
  const w = ctx.weather;
  const parts = [];
  if (w) {
    if (w.tempC != null && w.condition) parts.push(`${w.tempC}°, ${w.condition}`);
    if (w.lowC != null && w.highC != null) parts.push(`${w.lowC}° to ${w.highC}°`);
    if (w.feelsLikeC != null) parts.push(`feels like ${w.feelsLikeC}°`);
    if (w.rainChancePct != null) parts.push(`${w.rainChancePct}% chance of rain`);
    if (w.uv != null) parts.push(`UV ${w.uv}`);
  }
  if (ctx.type === "evening" && ctx.tomorrowWeather) {
    const t = ctx.tomorrowWeather;
    const bits = [];
    if (t.lowC != null && t.highC != null) bits.push(`${t.lowC}° to ${t.highC}°`);
    if (t.condition) bits.push(t.condition);
    if (t.rainChancePct != null) bits.push(`${t.rainChancePct}% rain chance`);
    if (bits.length) parts.push(`Tomorrow: ${bits.join(", ")}`);
  }
  return parts.length ? parts.join(". ") : null;
}

function fmtEvent(ev) {
  return ev.allDay ? ev.title : `${ev.title} at ${ev.time}`;
}

function eventsText(ctx) {
  const now = new Date();
  if (ctx.type === "evening") {
    const tonight = ctx.calendar.today
      .filter(ev => ev.allDay || ev.start > now)
      .slice(0, 2)
      .map(fmtEvent);
    const tomorrow = ctx.calendar.tomorrow.slice(0, 3).map(fmtEvent);
    const parts = [];
    if (tonight.length)  parts.push(`Tonight: ${tonight.join("; ")}`);
    if (tomorrow.length) parts.push(`Tomorrow: ${tomorrow.join("; ")}`);
    return parts.length ? parts.join(". ") : "Nothing on tonight or tomorrow";
  }
  const today = ctx.calendar.today.slice(0, 4).map(fmtEvent);
  return today.length ? today.join("; ") : "Nothing scheduled today";
}

function binsText(ctx) {
  if (!ctx.bins?.due) return null;
  return `${ctx.bins.eve ? "tonight" : "today"}: ${ctx.bins.colours.join(" + ")}`;
}

function commuteText(ctx) {
  if (!ctx.commute) return null;
  const parts = [];
  if (ctx.commute.greg)  parts.push(`Greg's drive ${ctx.commute.greg.mins} min`);
  if (ctx.commute.brett) parts.push(`Brett's drive ${ctx.commute.brett.mins} min`);
  const delay = Math.max(ctx.commute.greg?.delayMin ?? 0, ctx.commute.brett?.delayMin ?? 0);
  if (delay >= 5) parts.push(`traffic adding ~${delay} min`);
  return parts.length ? parts.join(", ") : null;
}

function fuelText(ctx) {
  if (!ctx.fuel) return null;
  // Only worth a mention at the bottom of the cycle — otherwise the price is
  // just noise the briefing would repeat every day.
  if (!isFuelCycleLow(ctx.fuel.price, readFuelHistory())) return null;
  return `cheapest unleaded ${ctx.fuel.price}c/L at ${ctx.fuel.name} (${ctx.fuel.distanceKm} km away), near the bottom of the cycle`;
}

function homeText(ctx) {
  const people = ctx.people.map(p => `${p.name} is ${p.home ? "home" : "away"}`);
  return people.length ? people.join(", ") : null;
}

export function buildBriefPayload(ctx) {
  const time = ctx.generatedAt.toLocaleString("en-AU", {
    weekday: "long", hour: "numeric", minute: "2-digit", hour12: true,
  });
  return {
    type:    ctx.type,
    time,
    weather: weatherText(ctx),
    events:  eventsText(ctx),
    bins:    binsText(ctx),
    commute: commuteText(ctx),
    fuel:    fuelText(ctx),
    news:    ctx.news.length ? ctx.news.join(" | ") : null,
    home:    homeText(ctx),
  };
}

// ── Generate (cached) ──────────────────────────────────────────

export async function generateBriefing({ type = currentBriefingType(), force = false } = {}) {
  if (
    !force &&
    summaryCache &&
    summaryCache.type === type &&
    Date.now() - summaryCache.at < SUMMARY_TTL_MS
  ) {
    return summaryCache.summary;
  }

  if (!force && inFlight?.type === type) return inFlight.promise;

  const promise = (async () => {
    const ctx = await gatherBriefingContext(type);

    const res = await fetch("/api/ai/brief", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(buildBriefPayload(ctx)),
      signal:  AbortSignal.timeout(28_000),
    });

    if (!res.ok) throw new Error(`AI brief HTTP ${res.status}`);
    const data    = await res.json();
    const summary = data.summary?.trim() || null;

    if (summary) summaryCache = { type, summary, at: Date.now() };
    return summary;
  })();

  inFlight = { type, promise };
  // Not .finally(): that chains a new promise which re-throws the rejection
  // with no handler attached — an unhandled rejection on every failed brief
  // even though callers catch the promise returned below.
  const clear = () => { if (inFlight?.promise === promise) inFlight = null; };
  promise.then(clear, clear);
  return promise;
}
