import { on, emit } from "./eventBus.js";
import { get as getContext } from "./contextStore.js";
import { phrase, timing, celebrate } from "./personality.js";
import {
  DELIGHT_TRIGGERS,
  pickDelight,
  spendBudget,
  isBudgeted,
  budgetKeyFor
} from "../services/delight.js";

// The personality runtime — Phase 10 (docs/vision/phase-10-temperament.md). The
// temperament (personality.js) is PURE and needs no runtime; the surfacing paths
// call it directly. This runtime owns only the two things that need side effects:
//
//   1. TIMING — publishes the atmosphere settle token as a CSS var so the room's
//      motion is sourced from the one authority (byte-identical value → no visual
//      change, just one source of truth).
//   2. DELIGHT — gathers the rare-moment signals into a ctx, fires at most one
//      moment, and persists its budget to disk so it can't repeat after a reboot.
//      A fired moment rides the Phase 2 attention queue as a gentle celebration
//      candidate (collectDelight) — NO new render path.
//
// Leak discipline (CLAUDE.md 24/7 kiosk): every listener + timer is registered
// once at init behind the flag. Off by default → collectDelight() returns [],
// nothing is published, and every surfacing path keeps its current tone.

const TICK_MS = 5 * 60 * 1000;          // re-evaluate the delight signals on a slow timer
const HEARTBEAT_MS = 60 * 1000;         // stamp "still alive" so a reboot can measure downtime
const OUTAGE_MS = 30 * 60 * 1000;       // a gap longer than this reads as a power outage, not a restart
const CAL_REFRESH_MS = 6 * 60 * 60 * 1000; // today's birthday markers change rarely
const CELEBRATION_TTL_MS = 3 * 60 * 60 * 1000; // a fired moment stays offerable for a few hours

const HEARTBEAT_KEY = "dashboard:last-heartbeat";
const DRY_KEY = "dashboard:dry-streak";
const TZ_KEY = "dashboard:last-tz-offset";

let enabled = false;
let budgets = {};                 // { [triggerId]: budgetKey } — persisted to /api/delight
let pendingCelebration = null;    // the current gentle celebration surface (with expiresAt), or null
let birthdayName = null;          // today's birthday person, from the calendar (best-effort)
let awaySignal = null;            // { awayDays, awayReturnKey, awayName } from arrivalGreeting, consumed once
let outageRecovered = false;      // set once at boot if downtime exceeded OUTAGE_MS
let bootKey = null;               // dedupes the power-restored moment to this boot
let dstJustChanged = false;       // set once at boot if the tz offset moved since last run

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
  } catch { /* storage full/blocked — best-effort */ }
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── Budget persistence (the only network IO; both fail-soft) ────

async function loadBudgets() {
  try {
    const res = await fetch("/api/delight", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    if (data?.budgets && typeof data.budgets === "object") budgets = data.budgets;
  } catch {
    /* cold start — keep the empty budgets */
  }
}

async function saveBudgets() {
  try {
    await fetch("/api/delight", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budgets }),
      signal: AbortSignal.timeout(8_000)
    });
  } catch {
    /* on-device best-effort; the in-memory budget still blocks a re-fire this run */
  }
}

// ── Signal gathering (best-effort; a missing signal simply never fires) ──

// Power-restored + DST: compared once at boot against what the last run stamped.
function detectBootSignals(now) {
  const last = Number(readJson(HEARTBEAT_KEY, 0));
  if (last && now.getTime() - last > OUTAGE_MS) {
    outageRecovered = true;
    bootKey = String(Math.floor(now.getTime() / OUTAGE_MS)); // one key per outage window
  }
  const offset = now.getTimezoneOffset();
  const lastOffset = readJson(TZ_KEY, null);
  if (lastOffset != null && lastOffset !== offset) dstJustChanged = true;
  writeJson(TZ_KEY, offset);
}

// First-rain-after-dry: a per-day dry counter driven off the shared weather
// condition. Approximate by design (day-granular, not hourly) — the moment is
// rare and the budget makes an over-count harmless.
function updateDryStreak(now) {
  const cond = getContext().condition;
  const raining = cond === "rain" || cond === "storm";
  const today = dateKey(now);
  let st = readJson(DRY_KEY, { day: null, dryDays: 0 });
  if (st.day !== today) {
    st = { day: today, dryDays: raining ? 0 : st.dryDays + 1 };
    writeJson(DRY_KEY, st);
  }
  return { rainNow: raining, dryStreakDays: st.dryDays, dryBreakKey: today };
}

// Birthday-morning: one bounded read of today's calendar for a birthday marker,
// mirroring intentEngine's event read. Fail-soft — no calendar → no moment.
async function refreshBirthday() {
  try {
    const res = await fetch("/api/calendar/all", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    const now = new Date();
    const dayStr = now.toDateString();
    const match = (data.events ?? data ?? []).find((ev) => {
      const d = new Date(ev.start ?? ev.startDate ?? ev.date);
      if (Number.isNaN(d.getTime()) || d.toDateString() !== dayStr) return false;
      return /birthday|\bbday\b|🎂/i.test(String(ev.title ?? ev.summary ?? ""));
    });
    if (!match) { birthdayName = null; return; }
    const raw = String(match.title ?? match.summary ?? "").trim();
    // "Greg's birthday" / "Birthday: Greg" → "Greg"; fall back to the raw title.
    const name = raw
      .replace(/'s\s+birthday/i, "")
      .replace(/birthday\s*[:-]?\s*/i, "")
      .replace(/🎂/g, "")
      .trim();
    birthdayName = name || null;
  } catch {
    /* keep the last-known value */
  }
}

// Arrival tells us someone came home after a real absence (Phase 1 seam). The
// eventBus passes the payload directly (see core/eventBus.js).
function onArrivalHome(payload) {
  const awayMs = Number(payload?.awayMs);
  if (!Number.isFinite(awayMs) || awayMs <= 0) return;
  const now = new Date();
  awaySignal = {
    awayDays: awayMs / 86_400_000,
    awayReturnKey: dateKey(now),
    awayName: payload?.name ?? null
  };
  evaluate(); // an arrival is a live signal — check immediately, don't wait for the tick
}

function buildCtx(now) {
  const dry = updateDryStreak(now);
  return {
    outageRecovered,
    bootKey,
    dstJustChanged,
    birthdayName,
    rainNow: dry.rainNow,
    dryStreakDays: dry.dryStreakDays,
    dryBreakKey: dry.dryBreakKey,
    awayDays: awaySignal?.awayDays,
    awayReturnKey: awaySignal?.awayReturnKey,
    awayName: awaySignal?.awayName
  };
}

// ── Fire ───────────────────────────────────────────────────────

function fire(fired, now) {
  budgets = spendBudget(budgets, fired);
  saveBudgets();
  outageRecovered = false; // a boot-scoped signal fires at most once per run
  pendingCelebration = celebrate({ ...fired.occasion, expiresAt: now.getTime() + CELEBRATION_TTL_MS });
  emit("delight:fired", { id: fired.id });
  console.log(`[delight] ${fired.id}: ${pendingCelebration.text}`);
  return pendingCelebration;
}

function evaluate() {
  if (!enabled) return null;
  const now = new Date();
  const fired = pickDelight(buildCtx(now), budgets, now);
  if (!fired) return null;
  return fire(fired, now);
}

/**
 * The attention engine calls this each refresh (behind the flag). Returns [] or a
 * single-element array with the current gentle celebration candidate — the exact
 * shape of the Phase 3/9 collect concat. Drops the surface once it expires.
 */
export function collectDelight(now = new Date()) {
  if (!enabled || !pendingCelebration) return [];
  if (pendingCelebration.expiresAt && pendingCelebration.expiresAt <= now.getTime()) {
    pendingCelebration = null;
    return [];
  }
  return [pendingCelebration];
}

export function initPersonalityRuntime(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hooks exist in both states so CDP can confirm the flag.
  // __voice previews the phrasing register + timing tokens without waiting for a
  // real line; __forceDelight fires a moment on demand and proves the budget then
  // blocks a second fire.
  window.__voice = (kind = "default") => {
    const intent = getContext().intent;
    const samples = [
      "I noticed rain is likely in about 15 min.",
      "Don't forget the bins go out tonight, again.",
      "Sorry — the 8:20 bus is running late."
    ];
    return {
      enabled,
      kind,
      timing: timing(kind),
      voiced: samples.map((text) => ({ raw: text, voiced: phrase(intent, kind, { text }) }))
    };
  };

  window.__forceDelight = (id) => {
    if (!enabled) return { error: "personality flag off" };
    const now = new Date();
    const ctx = buildCtx(now);
    const key = budgetKeyFor(id, ctx, now);
    if (key == null) return { error: `no delight trigger "${id}"`, ids: DELIGHT_TRIGGERS.map((t) => t.id) };
    if (isBudgeted(budgets, id, key)) return { id, budgetKey: key, blocked: true }; // already spent → can't fire twice
    const trigger = DELIGHT_TRIGGERS.find((t) => t.id === id);
    const surface = fire({ id, occasion: trigger.occasion(ctx, now), budgetKey: key }, now);
    return { id, budgetKey: key, blocked: false, surface };
  };

  window.__personality = () => ({ enabled, budgets, pending: pendingCelebration?.id ?? null, birthdayName });

  if (!enabled) return; // flag off → no timing var, no delight, every path keeps its tone

  // 1. TIMING — source the atmosphere settle duration from the authority.
  document.documentElement.style.setProperty("--atmo-settle", `${timing("atmosphere").settleMs}ms`);

  // 2. DELIGHT — boot signals are measured once against the last run's stamp.
  const now = new Date();
  detectBootSignals(now);
  writeJson(HEARTBEAT_KEY, now.getTime());
  setInterval(() => writeJson(HEARTBEAT_KEY, Date.now()), HEARTBEAT_MS);

  loadBudgets().then(() => evaluate());
  refreshBirthday();
  setInterval(refreshBirthday, CAL_REFRESH_MS);
  setInterval(evaluate, TICK_MS);
  on("arrival:home", onArrivalHome);
}
