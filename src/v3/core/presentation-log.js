/* ═══════════════════════════════════════════════════════════════════════════
   THE WALL'S LOG — HOUSE-MIND S6a (docs/design/HOUSE-MIND.md §S6).

   One row per presentation: what the wall showed, where, from when to when, on
   what evidence, and what the arbiter decided. It exists so "why was X on the
   wall at 07:12?" has an answer. Nothing reads it back into ranking.

   ── What a row is, and what it is NOT ───────────────────────────────────────
     surface      glance | spread | stage | voice
     id           the candidate id (glance/spread), the subject id (stage), or
                  null (voice). ⚠ SCRUBBED: an id that names a person entity
                  (`arrival:person.x`) is logged as its source alone. The rows
                  are about the MACHINE; phase-8's "aggregates-not-logs" rule
                  forbids a per-event log about the residents, and an arrival
                  id is exactly that (HOUSE-MIND §S6, the 09-25 amendment).
     source       the candidate's source, or the arbiter author
     evidenceKey  the S5a `evidence.key` the candidate stood on, or null
     decision     the arbiter's call, `{action, over}`, or null
     shown        false for a decision that put nothing up (dropped/refused/
                  superseded) — those rows have start === end
     start, end   epoch ms
   No presence, no person, no home field. The server whitelists the same
   fields and scrubs the same ids (server/routes/presentations.js), so a page
   that regressed would still not write a name to disk.

   ── On the glass means VISIBLE ──────────────────────────────────────────────
   Only one depth layer is painted at a time (compose.css: depth 1 shows
   `.depth--glance`, depth 2 `.depth--spread`). The glance cell keeps its text
   while the spread is up, and the spread's lead line is written into it too,
   so "what was rendered" over-reports. A glance row is open only while the
   depth IS 1, a spread row only while it IS 2. Under-reporting is the chosen
   failure: a line re-shown by a depth step without a fresh render is missed,
   never invented.

   ── Excluded ────────────────────────────────────────────────────────────────
   A __forceCandidate hero is a probe, not the house (S6-0's lesson — probes
   taught the live aggregates `test` and `spec`). It is never written.

   ── Cost ────────────────────────────────────────────────────────────────────
   A row is posted once, when it closes, fire-and-forget. Nothing is kept here
   past the close; the open set is bounded by what can be on the glass at once.
   Flag `v3PresentationLog`, read once at boot. Off: init never runs, every
   hook below returns on `!armed`, and /api/presentations is never called.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DEPTH, getDepth, onDepth } from "./depth.js";
import { isInjectedId } from "../../js/services/attentionEngine.js";
import { setArbiterObserver } from "../../js/core/arbiter.js";
import { initPeopleCounters, noteShown, noteClosed } from "./people-counters.js";

const ENDPOINT = "/api/presentations";
const ID_MAX = 160;

let armed = false;
let glance = null;      // the candidate in #glance-cell, or null
let spread = [];        // the candidates in the lattice
const open = new Map(); // slot key → row (end unset)
const pending = { stage: null }; // an arbiter "took" awaiting its row
let posted = 0;         // for __v3(): how many rows this page has sent
let lastRow = null;

/** An evidence key on one person entity (`ha:person.x`) says only that it
 *  stood on a person: `ha:person`. Exported for the spec. */
export function scrubEvidence(key) {
  if (key == null) return null;
  const s = String(key).slice(0, 64);
  return /person\./i.test(s) ? "ha:person" : s;
}

/** An id that names a person is logged as its source. Exported for the spec. */
export function scrubId(id, source) {
  if (id == null) return null;
  const s = String(id);
  if (/person\./i.test(s)) return source ?? null;
  return s.length > ID_MAX ? s.slice(0, ID_MAX) : s;
}

function post(row) {
  posted += 1;
  lastRow = row;
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ row }),
      keepalive: true
    }).then(() => {}, () => {});
  } catch {
    /* fire-and-forget: a log that fails must never cost the wall anything */
  }
}

function openRow(key, fields) {
  if (open.has(key)) return;           // still up: one presentation, one row
  open.set(key, {
    surface: fields.surface,
    id: scrubId(fields.id, fields.source),
    source: fields.source ?? null,
    evidenceKey: scrubEvidence(fields.evidenceKey),
    decision: fields.decision ?? null,
    shown: true,
    start: Date.now()
  });
  // S6b: counts only, never on the row (people-counters.js).
  noteShown(fields.surface, fields.source ?? null);
}

function closeRow(key) {
  const row = open.get(key);
  if (!row) return;
  open.delete(key);
  noteClosed(row.source);
  post({ ...row, end: Math.max(row.start, Date.now()) });
}

/* ── Glance and spread: diff what is visible against what is open ─────────── */

function candidateFields(surface, c) {
  return { surface, id: c.id, source: c.source, evidenceKey: c.evidence?.key ?? null };
}

function visible() {
  const depth = getDepth();
  const out = new Map();
  const add = (surface, c) => {
    if (!c?.id) return;
    out.set(`${surface}:${c.id}`, candidateFields(surface, c));
  };
  if (depth === DEPTH.GLANCE) add("glance", glance);
  if (depth === DEPTH.SPREAD) for (const c of spread) add("spread", c);
  return out;
}

/* Coalesced to a microtask. A tick that composes a spread writes its lead line
   into the glance cell a moment BEFORE it deepens to 2, so a synchronous sync
   would open (and at once close) a glance row for a line nobody saw at depth 1.
   By the microtask the tick's own depth change has already landed. */
let queued = false;
function schedule() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => {
    queued = false;
    sync();
  });
}

function sync() {
  if (!armed) return;
  const now = visible();
  for (const key of [...open.keys()]) {
    if ((key.startsWith("glance:") || key.startsWith("spread:")) && !now.has(key)) closeRow(key);
  }
  for (const [key, fields] of now) openRow(key, fields);
}

/** attention.js: the glance cell now holds `candidate` (null = cleared). */
export function logGlance(candidate) {
  if (!armed) return;
  // Probes are filtered HERE, when the line is written: `__forceCandidate(null)`
  // clears the injected list while the probe line can still be on the glass.
  glance = candidate && !isInjectedId(candidate.id) ? candidate : null;
  schedule();
}

/** spread.js: the lattice now holds these candidates ([] = cleared). */
export function logSpread(candidates) {
  if (!armed) return;
  spread = Array.isArray(candidates) ? candidates.filter((c) => c && !isInjectedId(c.id)) : [];
  schedule();
}

/* ── Stage: the subject mount, with the arbiter's call attached ───────────── */

function takePending(cap, author) {
  const p = pending[cap];
  pending[cap] = null;
  return p && p.author === author ? { action: p.action, over: p.over } : null;
}

/** subjects/index.js: `subjectId` is now mounted, by `author`. */
export function logStageOpen(subjectId, author) {
  if (!armed) return;
  closeRow("stage");
  openRow("stage", {
    surface: "stage",
    id: subjectId,
    source: author ?? null,
    decision: takePending("stage", author ?? null)
  });
}

/** subjects/index.js: the stage was cleared. */
export function logStageClose() {
  if (!armed) return;
  closeRow("stage");
}

/* ── The arbiter: voice rows, and the decisions that put nothing up ───────── */

function onArbiter({ cap, author, action, over }) {
  if (!armed) return;
  const surface = cap === "speech" ? "voice" : "stage";
  if (action === "took") {
    if (cap === "speech") {
      closeRow("voice");
      openRow("voice", { surface, id: null, source: author, decision: { action, over: over ?? null } });
    } else {
      pending.stage = { author, action, over: over ?? null };
    }
    return;
  }
  if (action === "released") {
    if (cap === "speech") closeRow("voice");
    return;
  }
  // dropped / refused / superseded: nothing went up, but the call was made.
  const at = Date.now();
  post({
    surface, id: null, source: author ?? null, evidenceKey: null,
    decision: { action, over: over ?? null }, shown: false, start: at, end: at
  });
}

/** Read-only, for __v3(). */
export function presentationLogState() {
  return {
    armed,
    open: [...open.values()].map((r) => ({ surface: r.surface, id: r.id, source: r.source })),
    posted,
    last: lastRow
  };
}

export function initPresentationLog() {
  if (armed) return;
  armed = true;
  initPeopleCounters();
  onDepth(() => schedule());
  setArbiterObserver(onArbiter);
  // A reload (every deploy) closes what was up rather than losing it.
  window.addEventListener("pagehide", () => {
    for (const key of [...open.keys()]) closeRow(key);
  });
  sync();
}
