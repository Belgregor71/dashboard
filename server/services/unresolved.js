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

   ⚠ AN OPEN QUESTION IS ANSWERED, NEVER ANNOUNCED. Nothing open here becomes
   an attention candidate or a glance line. The house mentions an open question
   when someone asks; the wall stays quiet.

   ── The one exception, added 2026-09-05: RESOLUTIONS GET AN AMBIENT VOICE ───

   ⚠⚠ **THE ASYMMETRY IS THE WHOLE DESIGN. Read it before widening it.**

   The rule above was written as though open and resolved were the same kind of
   thing said at two different times. They are not, and the difference is
   exactly what makes one unpleasant to live with and the other worth having:

     ⛔ "The kitchen camera has gone quiet and I can't account for it",
        unprompted, at 11pm, is a horror film. It hands the room a problem it
        cannot act on and then leaves. It stays answer-only, forever.
     ✅ "The kitchen camera's reporting again" is the END of a story. It costs
        the room nothing, it closes something rather than opening it, and
        CHARACTER.md:196 already licenses it: *"When it is told the answer, it
        takes it — and remembers being told."* character.js:104 says the same
        to the model: *"When it clears up, you may say so."*

   So the voice is the half the house was already allowed to have and had no
   way to use — a resolution reached the model's prompt and nothing else, which
   meant it existed only for someone who happened to ask a question that
   touched it in the fortnight before it aged out.

   ⚠ **AMBIENT MEANS LOW-BAND AND SILENT, NOT "QUIETLY LOUD".** This file owns
   the WORDS; `src/v3/core/resolutions.js` owns how loudly they are said, and
   it scores them 41 — the Low band (40-49), the ordinary readout traffic.
   (The score is not exported from here on purpose: it is a position on the
   attention engine's ladder, which is a fact about the surface and not about
   the observation, and a copy of it on this side would be a second answer
   waiting to disagree with the first.) Under `attentionRank.selectForMode`
   that band has three consequences worth stating, because they are the safety
   of this feature and none of them is enforced here:
     1. An EMPTY ROOM sees nothing. MODE.AMBIENT is interrupt-only, so a
        resolution to nobody is not shown to nobody — it is not shown at all.
     2. It can NEVER take the glance. Depth 1 needs `interrupt` or score 70,
        and this carries neither. It reaches the wall only at depth 2, i.e.
        after someone has stood there for thirty seconds.
     3. It NEVER SPEAKS. No `speak()` call exists on this path, deliberately —
        core/health.js's rule, that a wall running for weeks teaches the room
        to stop listening if it talks about its own plumbing, is about
        FREQUENCY and applies here whichever direction the news points.

   ⚠ And it is still ONE-SHOT. `markAired()` burns a resolution the first time
   the wall takes it, and `AMBIENT_WINDOW_MS` refuses one that has gone stale —
   a resolution the kiosk was off for is simply missed, not queued up to be
   announced at breakfast. Both bounds exist because the failure mode of a
   feature like this is not being wrong, it is being repetitive.
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

/* ── The ambient half ───────────────────────────────────────────────────────
   How fresh a resolution has to be to still be worth saying out on the wall.

   This is a FLOOR ON RELEVANCE, not a retry budget. A camera that came back at
   3am is not news at 8am — it is a thing that happened while nobody was here,
   and the honest handling of that is to let it pass. The prompt still has it
   for a fortnight (RESOLVED_TTL_MS) if anyone asks. */
export const AMBIENT_WINDOW_MS = 30 * 60 * 1000;

/* At most this many in one pass. Two cameras coming back together is one
   event's worth of news and the spread has one slot for it; a list of four
   would be the wall doing maintenance paperwork in front of the room. */
export const MAX_AMBIENT = 1;

/* The marker `observe()` writes when a thing explains itself by stopping.
   ⚠ A FIELD, NOT A STRING MATCH. The ambient line reads differently for
   something that came back on its own than for something the house was TOLD
   the answer to, and deciding that by comparing `resolution` against the
   sentence below would break silently the first time the wording is edited —
   which is a thing this file expects to happen, since the wording is the part
   that matters. */
const RESOLVED_BY_ITSELF = "itself";
const SELF_RESOLUTION = "it started reporting again on its own";

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
 * ── `subject` and `cleared` ─────────────────────────────────────────────────
 *
 * Both optional, both carried from OPEN to RESOLVE untouched, and both exist
 * only so a resolution can be said in a sentence: `what` is the divergence
 * ("the kitchen camera has been silent for 2h") and nothing in it can be
 * turned into "it is fine again" without guessing.
 *
 * ⚠ THEY ARE SUPPLIED BY THE ADAPTER, NOT DERIVED HERE, and that is the point.
 * "is reporting again" is the right clearing verb for a camera and the wrong
 * one for a light that ran with nothing behind it, so the module that knows
 * which kind of thing this is writes the phrase. An entry without them is
 * recorded exactly as before and simply has no ambient line — see
 * ambientResolutions(), which refuses rather than invents.
 *
 * @param {{key: string, what: string, evidence?: string, subject?: string,
 *          cleared?: string}[]} current
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
      if (entry.subject) existing.subject = entry.subject;
      if (entry.cleared) existing.cleared = entry.cleared;
      continue;
    }
    s.items.push({
      key,
      what: entry.what,
      evidence: entry.evidence ?? null,
      subject: entry.subject ?? null,
      cleared: entry.cleared ?? null,
      firstSeen: now,
      lastSeen: now,
      status: "open",
      resolvedAt: null,
      resolution: null,
      resolvedBy: null,
      airedAt: null
    });
    opened.push(key);
  }

  // Anything open that is no longer diverging has explained itself by stopping.
  for (const item of s.items) {
    if (item.status !== "open" || seen.has(item.key)) continue;
    item.status = "resolved";
    item.resolvedAt = now;
    item.resolution = SELF_RESOLUTION;
    item.resolvedBy = RESOLVED_BY_ITSELF;
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
    .map((c) => {
      const name = `the ${String(c.label ?? c.id).toLowerCase()} camera`;
      return {
        key: `camera-silent:${c.id}`,
        // Plain and factual. What it saw, and the thing that makes the silence
        // strange rather than merely quiet — the house being busy elsewhere.
        what: `${name} has been silent for ${formatAge(c.silentMs)}`,
        evidence: `${c.elsewhere} motion events arrived from other cameras in that time`,
        /* The two halves of the sentence this becomes if it ever clears. Same
           reason the wording lives here at all: `cleared` is a claim about what
           NORMAL looks like for this kind of device, and only the adapter knows
           that a camera's normal is reporting motion. */
        subject: name,
        cleared: "is reporting again"
      };
    });
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
  /* ⚠ NOT `RESOLVED_BY_ITSELF`, and the distinction reaches the wall. Being
     told the answer is a different sentence from watching a thing come good —
     "it was unplugged" against "on its own" — and this is the field that
     decides which one gets said. */
  item.resolvedBy = "told";
  persist();
  return true;
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE AMBIENT VOICE — resolutions only. See the header for why only these.

   ⚠⚠ THIS FUNCTION'S JOB IS AS MUCH REFUSAL AS IT IS PHRASING. Three of the
   four things it does are declining to say something:

     · no `subject` or no `cleared`  → no line. The adapter did not say what
       normal looks like for this thing, and a house that fills that in gets
       "the front light is reporting again" about a light. Nothing is invented
       from `what`: it describes the FAULT, and the negation of a fault is not
       a sentence about recovery. Items opened before those fields existed land
       here, which is correct — they stay in the prompt and off the wall.
     · older than AMBIENT_WINDOW_MS → no line. Stale news is not news.
     · already aired               → no line. The one-shot rule.

   The phrasing itself is CHARACTER.md §"Holding an open question": mildly
   interested, entirely unbothered, and it takes the answer when it is given
   one. It does not congratulate itself for having noticed, it does not say
   "strange" a second time, and it does not leave the room holding anything.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The one sentence a resolved observation is worth on the wall, or null.
 *
 * ⚠ Exported for the tests and for nothing else — the wall reads
 * ambientResolutions(), which applies the bounds this does not.
 */
export function ambientLine(item) {
  const subject = typeof item?.subject === "string" ? item.subject.trim() : "";
  const cleared = typeof item?.cleared === "string" ? item.cleared.trim() : "";
  if (!subject || !cleared) return null;

  const opening = `${subject[0].toUpperCase()}${subject.slice(1)} ${cleared}`;

  /* Told: the reason IS the news, so it goes in and the house stops talking.
     An em dash rather than a colon — this is the house finishing a thought,
     not labelling a field. */
  if (item.resolvedBy === "told") {
    const why = typeof item.resolution === "string" ? item.resolution.trim() : "";
    if (why && why !== "explained") return `${opening} — ${why.replace(/[.!?]+$/, "")}.`;
    return `${opening}.`;
  }

  /* Came good by itself: the house says so and does not pretend to more
     mystery than there is (CHARACTER.md — "most unexplained things are a flat
     battery"). "On its own" is the whole editorial; there is no second beat. */
  return `${opening}, on its own.`;
}

/**
 * What the wall may say right now — fresh, unaired, sayable. Newest first.
 *
 * ⚠ PURE. Reading does not burn anything; markAired() does. The split is what
 * lets a curl look at this endpoint without silently consuming the one showing
 * the room said nothing about, and it is what lets the airing mean "the wall
 * actually took it" rather than "someone asked".
 *
 * @param {number} now
 * @returns {{key: string, text: string, resolvedAt: number}[]}
 */
export function ambientResolutions(now = Date.now()) {
  return load().items
    .filter((i) => i.status === "resolved" && !i.airedAt)
    .filter((i) => now - (i.resolvedAt ?? 0) < AMBIENT_WINDOW_MS)
    .sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0))
    .map((i) => ({ key: i.key, text: ambientLine(i), resolvedAt: i.resolvedAt ?? null }))
    .filter((r) => r.text)
    .slice(0, MAX_AMBIENT);
}

/**
 * Burn them. Called once the wall has actually put them in front of the room.
 *
 * ⚠⚠ RESOLVED ITEMS ONLY, AND THAT CLAUSE IS LOAD-BEARING RATHER THAN TIDY.
 * `observe()` keys a re-opening as a NEW item under the SAME key — a camera
 * that goes quiet a second time is a second story, not the first one reopened
 * — so a key here can match both a resolved item and a live open one. Marking
 * by key alone would stamp `airedAt` on the OPEN one, and the wall would then
 * be permanently silent about the resolution it has not had yet: a feature
 * that goes quiet the second time it is used, for a reason nothing would
 * surface. Freshness is deliberately NOT re-checked — a key that reached here
 * has been aired by definition, and re-deriving the bounds would let the two
 * halves disagree about what was said.
 *
 * Unknown keys are ignored rather than an error — the wall replaying a stale
 * list after a restart is a no-op, which is the behaviour that wants no
 * handling.
 *
 * @returns {number} how many were newly marked.
 */
export function markAired(keys, now = Date.now()) {
  const s = load();
  const wanted = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === "string") : []);
  if (!wanted.size) return 0;

  let marked = 0;
  for (const item of s.items) {
    if (item.status !== "resolved" || !wanted.has(item.key) || item.airedAt) continue;
    item.airedAt = now;
    marked += 1;
  }
  if (marked) persist();
  return marked;
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
