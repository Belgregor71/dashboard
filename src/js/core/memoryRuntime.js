import { on } from "./eventBus.js";
import { get as getContext } from "./contextStore.js";
import { pickMemory, toSurface, moodOf } from "../services/memoryEngine.js";
import { seasonOf, dayCharacterOf } from "../services/houseModel.js";

// The memory runtime — Phase 9 (docs/vision/phase-9-remember.md). It owns every
// side effect the pure selector (memoryEngine.js) refuses to touch: it loads the
// authored entries once, builds today's context, tracks the daily-budget history,
// and hands the attention engine at most one Low-band memory candidate. It adds
// NO new render path — the memory rides the Phase 2 queue the engine already
// ranks, decays (expiresAt) and cools down (the shared insight-cooldown store).
//
// Leak discipline (CLAUDE.md 24/7 kiosk): every listener is registered once at
// init behind the flag. There is no per-event surface; the only timer is the
// init-once entry reload.
//
// Off by default → collectMemory() returns [] and the Phase 3 on-this-day path is
// untouched, so flag-off is byte-identical.

const ENTRIES_RELOAD_MS = 6 * 60 * 60 * 1000; // authored data changes rarely; reload a few times a day
const HISTORY_KEY = "dashboard:memory-history";
// The attention engine's own cooldown store (attentionEngine.COOLDOWN_KEY) — read
// here so pickMemory can skip an entry still inside its months-long window and
// choose a different eligible one instead of surfacing nothing.
const COOLDOWN_KEY = "dashboard:insight-cooldowns";

let enabled = false;
let entries = [];       // authored memory entries (from /api/memories)

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
  } catch { /* storage full/blocked — the budget just won't persist across reloads */ }
}

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

// ── Loading authored entries (the only IO; fail-soft) ──────────

async function loadEntries() {
  try {
    const res = await fetch("/api/memories", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data?.memories)) entries = data.memories;
  } catch {
    /* keep whatever we had — a memory not showing is the safe failure */
  }
}

// Today's calendar anniversary/occasion markers, lifted into ephemeral memory
// entries so the structured selector subsumes Phase 3's on-this-day regex (the
// "Replace" row in the phase table). Anchored to today so they always fit.
function anchorEntries(anniversaries, now) {
  return (anniversaries || [])
    .map((a) => String(a?.title ?? "").trim())
    .filter(Boolean)
    .map((title) => ({
      id: `anniv:${dateKey(now)}:${title}`,
      kind: "occasion",
      recurring: { month: now.getMonth() + 1, day: now.getDate() },
      title,
      tags: [seasonOf(now)],
      sensitivity: "normal",
      cooldownMonths: 6
    }));
}

// Build today's character for context-matching from the store + the briefing ctx.
function buildCtx(briefingCtx, now) {
  const store = getContext();
  const condition = briefingCtx?.weather?.condition ?? store.condition ?? null;
  return {
    season: seasonOf(now),
    dayCharacter: dayCharacterOf(now),
    condition,
    mood: moodOf(condition)
  };
}

/**
 * The attention engine calls this each refresh (behind the flag). Returns [] or a
 * single-element array with the chosen Low-band, non-interrupt memory candidate —
 * the exact shape of the Phase 3 predictive concat.
 */
export function collectMemory(briefingCtx = {}, now = new Date()) {
  if (!enabled) return [];
  const all = [...entries, ...anchorEntries(briefingCtx.anniversaries, now)];
  const ctx = buildCtx(briefingCtx, now);
  const history = {
    lastSurfacedDay: readJson(HISTORY_KEY, {}).lastSurfacedDay ?? null,
    cooldowns: readJson(COOLDOWN_KEY, {})
  };
  const surface = pickMemory(all, ctx, history, now);
  // Tender (ambient-only) memories belong to the quiet ambient photo frame, which
  // is not wired to the text hero — so they never reach it. When unsure, silence:
  // a grief anchor stays out of a passing text line by construction. (Surfacing
  // tender memories through the ambient frame is the documented follow-up.)
  if (!surface || surface.ambientOnly) return [];
  return [surface];
}

// A memory reaching the glass spends the day's budget — so no second memory
// surfaces today. Persisted so a same-day reload (e.g. a deploy) doesn't re-spend.
function onHero({ hero }) {
  if (hero?.source !== "memory") return;
  writeJson(HISTORY_KEY, { lastSurfacedDay: dateKey(new Date()) });
}

export function initMemoryRuntime(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hook in both states so CDP can confirm the flag + inspect
  // budget/cooldowns/entries without waiting for the right day.
  window.__memoryState = () => ({
    enabled,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, sensitivity: e.sensitivity ?? "normal" })),
    lastSurfacedDay: readJson(HISTORY_KEY, {}).lastSurfacedDay ?? null,
    cooldowns: readJson(COOLDOWN_KEY, {})
  });

  if (!enabled) return; // flag off → no load, no candidate, Phase 3 path unchanged

  loadEntries();
  setInterval(loadEntries, ENTRIES_RELOAD_MS);
  on("attention:hero", onHero);

  // Force a specific authored entry (by id) onto the queue for verification,
  // bypassing the budget/context gates but STILL applying tender-gating (forcing
  // a tender memory must still be gentle). Injects via the attention engine's
  // __forceCandidate seam so it rides the real queue. Pass null to clear.
  window.__forceMemory = (id) => {
    if (id == null) {
      window.__forceCandidate?.(null);
      return null;
    }
    const entry = entries.find((e) => e.id === id);
    if (!entry) return { error: `no memory entry "${id}"`, ids: entries.map((e) => e.id) };
    const surface = toSurface(entry, new Date());
    // A tender surface is ambient-only (no text hero) — return it for inspection
    // (caption:null, ambientOnly:true) but do not inject it into the text queue.
    if (!surface.ambientOnly) window.__forceCandidate?.(surface);
    return surface;
  };
}
