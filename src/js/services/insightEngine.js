import { gatherBriefingContext } from "../modules/briefingData.js";
import {
  evaluateInsights,
  pickInsight,
  claimCooldown,
  recordFuelPrice
} from "./insightRules.js";

// Runtime for the ambient insight line: refreshes the shared briefing
// context every few minutes, runs the pure rules over it, and keeps the
// best current insight available synchronously for focusHero's tick.
// The deterministic template IS the house voice (docs/design/VOICE.md) —
// the old AI rewrite pass (/api/ai/brief type=insight) was retired when the
// voice unified; it only added latency to produce a near-identity transform.

const REFRESH_MS = 5 * 60 * 1000;
const QUIET_START_HOUR = 21;
const QUIET_END_HOUR = 6;
const COOLDOWN_KEY = "dashboard:insight-cooldowns";
const FUEL_HISTORY_KEY = "dashboard:fuel-history";

let current = null; // { id, icon, text, display }

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage full/blocked — cooldowns just won't persist */ }
}

function inQuietHours(now = new Date()) {
  const hour = now.getHours();
  return hour >= QUIET_START_HOUR || hour < QUIET_END_HOUR;
}

async function refresh() {
  if (inQuietHours()) {
    current = null;
    return;
  }

  const type = new Date().getHours() < 12 ? "morning" : "evening";
  const ctx = await gatherBriefingContext(type);
  const now = new Date();

  let fuelHistory = readJson(FUEL_HISTORY_KEY, {});
  if (ctx.fuel?.price != null) {
    fuelHistory = recordFuelPrice(fuelHistory, ctx.fuel.price, now);
    writeJson(FUEL_HISTORY_KEY, fuelHistory);
  }

  const candidates = evaluateInsights(ctx, now, { fuelHistory });
  const cooldowns = readJson(COOLDOWN_KEY, {});
  const picked = pickInsight(candidates, { cooldowns, now, currentId: current?.id });

  if (!picked) {
    current = null;
    return;
  }
  if (picked.id === current?.id) return; // already showing; keep its phrasing

  writeJson(COOLDOWN_KEY, claimCooldown(picked, { cooldowns, now }));
  current = { ...picked, display: picked.text };
  console.log(`[insight] ${picked.id}: ${picked.text}`);
}

/** Synchronous read for focusHero's tick. */
export function getCurrentInsight() {
  return current;
}

export function initInsightEngine() {
  refresh().catch((e) => console.warn("Insight refresh failed:", e?.message));
  setInterval(() => {
    refresh().catch((e) => console.warn("Insight refresh failed:", e?.message));
  }, REFRESH_MS);
}

// Debug hook (same spirit as __switchView): force a demo insight so the
// focus-hero tier can be verified on the live kiosk via CDP.
window.__forceInsight = (text) => {
  current = text
    ? { id: "debug", icon: "💡", text, display: text }
    : null;
  return current;
};
