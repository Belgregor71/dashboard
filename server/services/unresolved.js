/* ═══════════════════════════════════════════════════════════════════════════
   UNRESOLVED OBSERVATIONS — the things the house saw and cannot explain.

   The house could recite what is true right now and recall facts about the
   household, but it had no experiences of its own: nothing it had noticed,
   nothing it was unsure about, nothing it had been wrong about. A character
   that cannot be surprised and cannot revise anything is a point of view, not
   a resident.

   This is the smallest mechanism that fixes that. The house holds a claim
   ("the kitchen camera has gone quiet and I can't account for it"), keeps it
   open while it stands, and RESOLVES it when the world explains it. The
   resolution is the point — being able to say "that one sorted itself out"
   is the difference between a log and a memory.

   ── Where the observations come from ────────────────────────────────────────

   Nothing new detects anything. `motionCoverage.js` already finds exactly this
   shape of thing — a camera silent while the rest of the house is demonstrably
   busy — and it is careful in ways worth inheriting rather than rebuilding:
   the rule is DIVERGENCE not staleness (so an empty house never generates
   one), and the kitchen is gated on occupancy. Its warn bar is already 12
   events over 90 minutes, so anything reaching here has been true for a while
   and is genuinely notable. No extra hysteresis is needed on this side.

   What motionCoverage lacks, and this adds: a memory, and a way back. Today a
   fault re-evaluates to "ok" on the next event and is silently gone — the
   house never knew it happened and could never mention that it had cleared.

   ⚠⚠ WHAT MAY AND MAY NOT BE RECORDED HERE — read `docs/vision/phase-8-learn.md:81`
   before extending this. That file states as an absolute rule that LEARNING IS
   NEVER ANNOUNCED ("a half-learned routine that announces itself would be worse
   than silence"), and `personality.js:39-48` enforces it by stripping "I
   noticed…" from every candidate's text.

   The line this file stays on the right side of:
     ✅ observations about the HOUSE and its devices — a camera that stopped
        reporting, a light that ran with nothing to trigger it. The house
        witnessed these.
     ⛔ inferences about the RESIDENTS' habits — "you usually leave at 7:20".
        That is what phase-8 bans, and it stays banned. It lives in
        routineStore's confidence machinery and is answered only when asked.

   The distinction is not convenient, it is the actual difference between
   something seen and something concluded about a person.

   ⚠ These are ANSWERED, not announced. Nothing here becomes an attention
   candidate or a glance line. The house mentions an open question when someone
   asks; the wall stays quiet.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { formatAge } from "./motionCoverage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "unresolved.json");

/* A test-only redirect, NOT an env var — deliberately.
 *
 * The spec has to write somewhere that is not the real store: Playwright runs
 * specs in parallel workers, so two of them sharing one file would collide and
 * present as an unreproducible flake rather than the shared-state bug it is.
 * Worse, load() is lazy — a stale file left behind by a test would be read at
 * the NEXT boot and the house would open believing a camera is down.
 *
 * An env var would have solved that and then had to be documented in
 * .env.example as a knob nobody should ever turn (tests/env-example.spec.js
 * correctly insists every env read is documented). A `__`-prefixed setter says
 * "test seam" without pretending to be configuration. */
let overrideFile = null;
function storeFile() {
  return overrideFile || DEFAULT_FILE;
}

/* Bounds, because this runs for weeks on an SD card and feeds a prompt.
   OPEN is small on purpose: a house with a dozen simultaneous unexplained
   things is a house with one broken integration, and listing all twelve to the
   model would bury the one that matters. */
export const MAX_OPEN = 8;
/* Resolved ones are kept only so the house can say "that cleared up" — they
   are the shorter half of the story and expire out of their own accord. */
export const MAX_RESOLVED = 20;
export const RESOLVED_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** How many open items may reach the prompt. The rest exist but stay quiet. */
export const MAX_PROMPTED = 3;

/** @type {{ items: object[] } | null} */
let state = null;

/* Lazy and synchronous, matching photoVeto.js: one small file, read at most
   once per process. */
function load() {
  if (state) return state;
  try {
    const raw = JSON.parse(readFileSync(storeFile(), "utf8"));
    state = { items: Array.isArray(raw?.items) ? raw.items.filter(valid) : [] };
  } catch {
    // No file, unreadable, malformed — an empty list is the correct reading.
    // The house simply has nothing on its mind yet.
    state = { items: [] };
  }
  return state;
}

function valid(item) {
  return item
    && typeof item.key === "string" && item.key
    && typeof item.what === "string" && item.what
    && (item.status === "open" || item.status === "resolved");
}

function persist() {
  try {
    const file = storeFile();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(state, null, 2));
    return true;
  } catch {
    /* In-memory state stands; the house just forgets at the next restart.
       Losing a mystery is a far smaller failure than throwing into the health
       evaluation that produced it. */
    return false;
  }
}

/**
 * Reconcile the currently-diverging set against what is already open.
 *
 * This is the whole lifecycle in one call, and it is written as a
 * reconciliation rather than as separate open/close calls for one reason: the
 * caller knows what is wrong RIGHT NOW, and anything open that is not in that
 * set has, by definition, stopped being wrong. Making the caller remember to
 * close things is how a mystery file fills up with stale ghosts.
 *
 * @param {{key: string, what: string, evidence?: string}[]} current
 * @param {number} now
 * @returns {{ opened: string[], resolved: string[] }}
 */
export function observe(current, now = Date.now()) {
  const s = load();
  const seen = new Map();
  for (const entry of Array.isArray(current) ? current : []) {
    if (entry && typeof entry.key === "string" && entry.key && typeof entry.what === "string" && entry.what) {
      seen.set(entry.key, entry);
    }
  }

  const opened = [];
  const resolved = [];

  // Anything still diverging: refresh it. `firstSeen` is deliberately NOT
  // touched — how long this has been going on is the most interesting thing
  // about it, and re-stamping it would erase exactly that.
  for (const [key, entry] of seen) {
    const existing = s.items.find((i) => i.key === key && i.status === "open");
    if (existing) {
      existing.lastSeen = now;
      existing.what = entry.what;
      if (entry.evidence) existing.evidence = entry.evidence;
      continue;
    }
    s.items.push({
      key,
      what: entry.what,
      evidence: entry.evidence ?? null,
      firstSeen: now,
      lastSeen: now,
      status: "open",
      resolvedAt: null,
      resolution: null
    });
    opened.push(key);
  }

  // Anything open that is no longer diverging has explained itself by stopping.
  for (const item of s.items) {
    if (item.status !== "open" || seen.has(item.key)) continue;
    item.status = "resolved";
    item.resolvedAt = now;
    item.resolution = "it started reporting again on its own";
    resolved.push(item.key);
  }

  prune(now);
  if (opened.length || resolved.length) persist();
  return { opened, resolved };
}

function prune(now) {
  const s = state;
  const open = s.items.filter((i) => i.status === "open");
  const done = s.items
    .filter((i) => i.status === "resolved" && now - (i.resolvedAt ?? 0) < RESOLVED_TTL_MS)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .slice(0, MAX_RESOLVED);

  // Oldest open go first if we somehow exceed the ceiling: a thing that has
  // been unexplained for a week is less news than one that started today.
  s.items = [...open.sort((a, b) => b.firstSeen - a.firstSeen).slice(0, MAX_OPEN), ...done];
}

/**
 * Adapter: motionCoverage's per-camera table → observations.
 *
 * Lives here rather than in healthService because the WORDING is the part that
 * matters — these strings reach the model and are read aloud, so they belong
 * next to the thing that stores them, not next to the thing that ticks.
 *
 * Only warn/error cameras open anything. `skipped` cameras already report
 * level "ok" (the occupancy gate — an empty house explains a quiet kitchen),
 * so they fall out here for free rather than needing a second check.
 */
export function noteCoverage(cameras, now = Date.now()) {
  const diverging = (Array.isArray(cameras) ? cameras : [])
    .filter((c) => c && (c.level === "warn" || c.level === "error"))
    .map((c) => ({
      key: `camera-silent:${c.id}`,
      // Plain and factual. What it saw, and the thing that makes the silence
      // strange rather than merely quiet — the house being busy elsewhere.
      what: `the ${String(c.label ?? c.id).toLowerCase()} camera has been silent for ${formatAge(c.silentMs)}`,
      evidence: `${c.elsewhere} motion events arrived from other cameras in that time`
    }));
  return observe(diverging, now);
}

/** Everything the house is currently wondering about, newest first. */
export function openItems() {
  return load().items
    .filter((i) => i.status === "open")
    .sort((a, b) => b.firstSeen - a.firstSeen);
}

/** Recently explained, newest first — the "that cleared up" half. */
export function resolvedItems() {
  return load().items
    .filter((i) => i.status === "resolved")
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
}

/**
 * Mark something resolved with a stated reason — the house being told, or
 * telling itself, what the answer was.
 */
export function resolve(key, resolution, now = Date.now()) {
  const s = load();
  const item = s.items.find((i) => i.key === key && i.status === "open");
  if (!item) return false;
  item.status = "resolved";
  item.resolvedAt = now;
  item.resolution = typeof resolution === "string" && resolution.trim()
    ? resolution.trim().slice(0, 200)
    : "explained";
  persist();
  return true;
}

/** Forget one outright — the review surface's delete. */
export function forget(key) {
  const s = load();
  const before = s.items.length;
  s.items = s.items.filter((i) => i.key !== key);
  if (s.items.length === before) return false;
  persist();
  return true;
}

/**
 * Tests only — this module holds process-lifetime state.
 *
 * @param {{file?: string}} [opts] redirect the store away from data/ so a spec
 *   never writes real state. See storeFile().
 */
export function __reset({ file = null } = {}) {
  state = { items: [] };
  if (file !== null) overrideFile = file;
}
