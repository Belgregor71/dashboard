/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { on } from "./eventBus.js";
import { get as getContext } from "./contextStore.js";
import { pickMemory, toSurface, moodOf } from "../services/memoryEngine.js";
import { seasonOf, dayCharacterOf } from "../services/houseModel.js";
import { buildOnThisDayMemory, memoryPhotoSrc } from "../services/photoMemory.js";

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
let entries = [];         // authored memory entries (from /api/memories)
let onThisDayEntry = null; // Phase 9.5: a photo-backed "N years ago today" entry from Immich

// Phase 9.5 (docs/vision/photo-source-immich.md) — the Immich photo source is its
// own flag on top of the memory engine.
function immichEnabled() {
  try {
    return Boolean(window.CONFIG?.features?.immichPhotos);
  } catch {
    return false;
  }
}

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

// Phase 9.5: fold today's Immich on-this-day photos into a single photo-backed
// memory entry, so the awake hero can surface "N years ago today" with a face.
// Fail-soft: Immich down → onThisDayEntry stays null and nothing changes.
async function loadOnThisDay() {
  if (!immichEnabled()) { onThisDayEntry = null; return; }
  try {
    const res = await fetch("/api/immich/on-this-day", { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return;
    const data = await res.json();
    onThisDayEntry = buildOnThisDayMemory(data?.assets ?? [], new Date());
  } catch {
    /* keep the last-known entry */
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

// The one selection both lanes share — the text hero (collectMemory) and the
// ambient frame (collectAmbientMemory). pickMemory returns at most one surface
// per day, so the two lanes are mutually exclusive by construction: whichever the
// day's best-fit memory is, it goes to exactly one of them.
function selectMemory(briefingCtx, now) {
  const all = [
    ...entries,
    ...anchorEntries(briefingCtx.anniversaries, now),
    ...(onThisDayEntry ? [onThisDayEntry] : []) // Phase 9.5 Immich photo memory
  ];
  const ctx = buildCtx(briefingCtx, now);
  const history = {
    lastSurfacedDay: readJson(HISTORY_KEY, {}).lastSurfacedDay ?? null,
    cooldowns: readJson(COOLDOWN_KEY, {})
  };
  return pickMemory(all, ctx, history, now);
}

// The memory's own picture rides with it as `image`, which focusHero renders in
// the glyph slot (the thumb path media/Plex candidates already use). Without it
// the card is words only over whatever random photo the awake ground drew that
// day, which reads as a mismatched memory. Photo-less entries keep the 🕰 glyph.
function withPhoto(surface) {
  const image = memoryPhotoSrc(surface.photos?.[0]);
  return image ? { ...surface, image } : surface;
}

/**
 * The attention engine calls this each refresh (behind the flag). Returns [] or a
 * single-element array with the chosen Low-band, non-interrupt memory candidate —
 * the exact shape of the Phase 3 predictive concat.
 */
export function collectMemory(briefingCtx = {}, now = new Date()) {
  if (!enabled) return [];
  const surface = selectMemory(briefingCtx, now);
  // Tender (ambient-only) memories belong to the quiet ambient photo frame
  // (collectAmbientMemory / the screensaver, study 01 WP4) — never the text hero.
  // When unsure, silence: a grief anchor stays out of a passing text line by
  // construction.
  if (!surface || surface.ambientOnly) return [];
  return [withPhoto(surface)];
}

/**
 * The screensaver's Mode-0 tender lane (study 01 WP4) calls this. Returns the
 * chosen memory ONLY when it's ambient-only (tender) — the wordless surface the
 * text hero refuses — or null. The tender-gating (ambientOnly/caption:null/longer
 * hold) is already applied in memoryEngine.toSurface; this just routes it.
 */
export function collectAmbientMemory(briefingCtx = {}, now = new Date()) {
  if (!enabled) return null;
  const surface = selectMemory(briefingCtx, now);
  return surface && surface.ambientOnly ? surface : null;
}

// A surfaced memory (text hero OR the ambient tender frame) spends the day's
// budget, so no second memory surfaces today. Persisted so a same-day reload
// (e.g. a deploy) doesn't re-spend.
export function spendMemoryBudget(now = new Date()) {
  writeJson(HISTORY_KEY, { lastSurfacedDay: dateKey(now) });
}

function onHero({ hero }) {
  if (hero?.source !== "memory") return;
  spendMemoryBudget(new Date());
}

export function initMemoryRuntime(options = {}) {
  enabled = options.enabled === true;

  // Read-only debug hook in both states so CDP can confirm the flag + inspect
  // budget/cooldowns/entries without waiting for the right day.
  window.__memoryState = () => ({
    enabled,
    immich: immichEnabled(),
    onThisDay: onThisDayEntry ? { id: onThisDayEntry.id, title: onThisDayEntry.title, photos: onThisDayEntry.photos.length } : null,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, sensitivity: e.sensitivity ?? "normal" })),
    lastSurfacedDay: readJson(HISTORY_KEY, {}).lastSurfacedDay ?? null,
    cooldowns: readJson(COOLDOWN_KEY, {})
  });

  if (!enabled) return; // flag off → no load, no candidate, Phase 3 path unchanged

  loadEntries();
  loadOnThisDay(); // Phase 9.5 — Immich on-this-day photo memory (no-op when that flag is off)
  setInterval(() => { loadEntries(); loadOnThisDay(); }, ENTRIES_RELOAD_MS);
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
    const pool = [...entries, ...(onThisDayEntry ? [onThisDayEntry] : [])];
    const entry = pool.find((e) => e.id === id);
    if (!entry) return { error: `no memory entry "${id}"`, ids: pool.map((e) => e.id) };
    const surface = toSurface(entry, new Date());
    // A tender surface is ambient-only (no text hero) — return it for inspection
    // (caption:null, ambientOnly:true) but do not inject it into the text queue.
    if (!surface.ambientOnly) window.__forceCandidate?.(withPhoto(surface));
    return surface;
  };
}
