/* ═══════════════════════════════════════════════════════════════════════════
   OCCUPANCY DAYS — who was home, one day at a time.

   docs/AUGUST-IMPROVEMENTS.md §4.6's fourth signal, and the only one of the
   four that was not already being counted somewhere. The other three ride the
   feature census (see services/houseLately.js); this one needed a writer.

   ── 🔑 WHY THIS IS SERVER-SIDE AND NOT IN THE CLIENT LEDGER ─────────────────

   §4.3 filed "who was home" under BROWSER facts, because core/arrival.js is
   where the repo watches `person.*`. But arrival.js only sees them while the
   page is up, and the whole point of this signal is the hours the house was
   empty — which is exactly when the screen is asleep and the browser is not
   watching. haWs holds the same `person.*` entities continuously, so the
   server is not a worse tap here, it is the only correct one.

   Measured on the live G11: two person entities, person.greg_dee and
   person.brett.

   ── 🔑🔑 IT COUNTS SAMPLES, NEVER DURATIONS ────────────────────────────────

   This is the deliberate answer to the trap that nearly shipped in the weather
   half. weatherHistory.js accumulates a per-day range, so it has to seed itself
   from today's row on every restart — miss that and a redeploy silently writes
   a NARROWER range, last-wins prefers it, and the bug does not look like a bug.
   It looks like a milder day. The kiosk restarts about 7.6 times a day.

   "Minutes home" is that same accumulator with the same failure mode. So this
   file does not integrate anything. An interval samples each person every
   SAMPLE_MS and increments a counter; a restart loses at most one sample, and
   the whole class of bug is gone by construction rather than by remembering to
   seed. `samples` is stored per day as the honest denominator — a day the
   SERVER was down has fewer of them, and services/houseLately.js can see that.

   ⚠ Transitions are counted from the event stream, not derived from samples. A
   five-minute sampler cannot see someone leave and come back inside one
   interval, and inferring arrivals from consecutive samples would report that
   as "never left".

   ── ⛔ THIS IS A RESIDENT FACT ──────────────────────────────────────────────

   docs/vision/phase-8-learn.md:81 bans it from ever being announced, and
   unresolved.js:36-45 states the split it sits on the wrong side of: the house
   may speak about what it WITNESSED, never about what it CONCLUDED about a
   person. So this is read only when somebody asks, through a loopback-gated
   route.

   ⚠ THE FILE NAMES RESIDENTS AND THIS REPO IS PUBLIC. data/occupancy-days.json
   is in .gitignore beside data/unresolved.json. Nothing here is ever written to
   src/js/config.js, which is tracked and shipped in the public bundle.
   ═══════════════════════════════════════════════════════════════════════════ */

import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = path.join(__dirname, "..", "..", "data", "occupancy-days.json");

/* Five minutes. Twelve samples an hour is enough resolution to call a day
   "home" or "away" and coarse enough that a day is 288 integers, not a log —
   the aggregates-not-logs rule phase-8-learn.md's Rollout section makes the
   phase-critical check for a box that runs for weeks. */
export const SAMPLE_MS = 5 * 60 * 1000;

/* Two months. Long enough to answer "was I away much last month", short enough
   that the file cannot grow into a problem: 60 days × a handful of people is a
   few kilobytes. */
export const MAX_DAYS = 60;

/* The house has two residents. The cap exists because `person.*` is HA's to
   define, not ours, and an integration that invents entities must not be able
   to grow this file without bound. */
export const MAX_PEOPLE = 8;

export const PERSON_RE = /^person\.([a-z0-9_]+)$/;

/* A test-only redirect, NOT an env var — the same choice unresolved.js makes
   and for the same reason: a path this file reads from the environment is a
   path a deploy can point somewhere surprising. */
let overrideFile = null;
const storeFile = () => overrideFile ?? DEFAULT_FILE;

let state = null;
let timer = null;
let manager = null;
let writeQueue = Promise.resolve();

export function emptyStore() {
  return { days: {}, since: null, updated: null };
}

/** Brisbane, the way weatherHistory.js and conversationLog.js both do it. The
 *  day this house lives in is not UTC and is not the server's locale. */
export function houseDay(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Australia/Brisbane" });
}

/** `person.greg_dee` → `greg_dee`, and null for anything that is not a person.
 *  Deliberately strict: `person.` is the only domain this file may record, so
 *  an HA integration adding entities cannot widen what is stored here. */
export function personIdOf(entityId) {
  const match = PERSON_RE.exec(String(entityId ?? ""));
  return match ? match[1] : null;
}

function blankPerson() {
  return { home: 0, away: 0, unknown: 0, arrivals: 0, departures: 0 };
}

function dayRow(store, day) {
  if (!store.days[day]) store.days[day] = { samples: 0, blind: 0, people: {} };
  return store.days[day];
}

/* ⚠ `since` IS WRITE-ONCE AND IS NEVER MOVED. routes/censusFeatures.js pays for
   this one directly: a stored `since` wins outright there, because taking the
   earlier of stored-and-derived hands a box with a wrong clock the power to
   re-open an age guard with a single flush dated last January.

   ⚠⚠ AND IT IS SET ONLY BY A REAL OBSERVATION. A day that exists solely because
   HA was down is not the day counting began — pinning `since` to it would date
   the record from an outage. */
function observed(store, day) {
  if (!store.since) store.since = day;
}

function personRow(row, id) {
  if (!row.people[id]) {
    if (Object.keys(row.people).length >= MAX_PEOPLE) return null;
    row.people[id] = blankPerson();
  }
  return row.people[id];
}

/** ISO day strings sort lexicographically, so the prune is a sorted slice —
 *  the same idiom routes/censusFeatures.js uses on `days`. */
function prune(store) {
  const keys = Object.keys(store.days).sort();
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete store.days[stale];
}

/**
 * Fold one round of samples into a day. Pure, so the sampler's arithmetic is
 * testable without a clock, a socket or a disk.
 *
 * @param {object} store    the loaded store, mutated
 * @param {Array}  states   HA states, or anything shaped like them
 * @param {string} day      the day key to credit
 */
export function foldSample(store, states, day) {
  const row = dayRow(store, day);

  /* ⚠⚠⚠ A SAMPLE THAT SAW NOBODY IS NOT A SAMPLE OF AN EMPTY HOUSE. Found on
     the live G11 within two minutes of this shipping: Home Assistant was down,
     every call 504ing and the websocket `disconnected`, so getStates() returned
     [] — and the first version of this function counted that as a sample,
     writing {samples: 1, people: {}}.

     `samples` is the DENOMINATOR services/houseLately.js reads to decide how
     well a day was observed. An hour of HA outage would write samples: 12 with
     nobody in it, and the day would read as well-observed and empty. That is
     precisely the sleeping-wall trap houseLately.js's header is about,
     reproduced inside the writer built to avoid it.

     So a blind round is counted as BLIND, which makes the outage legible, and
     it does not touch `samples`, `since`, or anybody's counters. */
  const present = (Array.isArray(states) ? states : []).filter((e) => personIdOf(e?.entity_id));
  if (!present.length) {
    row.blind = (row.blind ?? 0) + 1;
    return store;
  }

  row.samples += 1;
  observed(store, day);

  for (const entity of present) {
    const id = personIdOf(entity?.entity_id);
    if (!id) continue;
    const person = personRow(row, id);
    if (!person) continue;

    /* Tri-state, matching healthService.occupancyFrom's reasoning: a tracker
       reporting `unavailable` is not an empty house, and recording it as "away"
       would turn an integration outage into a claim about where somebody was. */
    if (entity.state === "home") person.home += 1;
    else if (entity.state === "not_home") person.away += 1;
    else person.unknown += 1;
  }

  return store;
}

/**
 * Fold one state_changed transition.
 *
 * ⚠ Only a real edge counts. HA re-emits state_changed for attribute-only
 * changes, and every entity is re-created with a fresh state on an HA restart —
 * measured on the live box, all 698 entities carried the same `last_changed`
 * half an hour after one. Counting those as arrivals would report the house
 * filling up every time HA bounced.
 */
export function foldTransition(store, { entityId, from, to }, day) {
  const id = personIdOf(entityId);
  if (!id) return store;
  if (from === to) return store;
  if (to !== "home" && to !== "not_home") return store;
  // An entity coming back from unknown/unavailable is a recovery, not a journey.
  if (from !== "home" && from !== "not_home") return store;

  const person = personRow(dayRow(store, day), id);
  if (!person) return store;
  // A real edge IS an observation, so it may date the record.
  observed(store, day);
  if (to === "home") person.arrivals += 1;
  else person.departures += 1;
  return store;
}

export async function loadStore() {
  try {
    const raw = await readFile(storeFile(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      days: parsed?.days && typeof parsed.days === "object" ? parsed.days : {},
      since: typeof parsed?.since === "string" ? parsed.since : null,
      updated: typeof parsed?.updated === "string" ? parsed.updated : null
    };
  } catch {
    // An unreadable store is an empty one. Same call the weather route makes:
    // this is a fact about the house, not an error worth failing a read over.
    return emptyStore();
  }
}

async function persist() {
  if (!state) return;
  state.updated = new Date().toISOString();
  prune(state);
  const snapshot = JSON.stringify(state);
  const task = writeQueue.then(async () => {
    await mkdir(path.dirname(storeFile()), { recursive: true });
    await writeFile(storeFile(), snapshot, "utf8");
  });
  // The queue must survive a failed write, or one ENOSPC ends every later one.
  writeQueue = task.then(() => {}, () => {});
  try {
    await task;
  } catch (error) {
    console.warn("Occupancy store write failed:", error?.message || error);
  }
}

/** What the reader sees. Loads from disk when the sampler is not running, so a
 *  test process and a route both get the same answer. */
export async function occupancyDays() {
  if (state) return state;
  return loadStore();
}

/**
 * Start sampling. Inert without an HA manager, the way healthService is —
 * a box with HA_ENABLED unset writes nothing rather than writing zeroes, and a
 * day of zeroes would read as a day nobody was home.
 */
export function startOccupancyDays({ manager: mgr = null, sampleMs = SAMPLE_MS } = {}) {
  if (timer || !mgr) return null;
  manager = mgr;

  const boot = loadStore().then((loaded) => {
    state = loaded;
    return loaded;
  });

  const sample = async () => {
    await boot;
    if (!state || !manager?.getStates) return;
    try {
      foldSample(state, manager.getStates(), houseDay());
      await persist();
    } catch (error) {
      console.warn("Occupancy sample failed:", error?.message || error);
    }
  };

  manager.on("event", ({ eventType, data }) => {
    if (eventType !== "state_changed" || !state) return;
    const entityId = data?.entity_id ?? data?.new_state?.entity_id;
    if (!personIdOf(entityId)) return;
    try {
      foldTransition(
        state,
        { entityId, from: data?.old_state?.state, to: data?.new_state?.state },
        houseDay()
      );
      void persist();
    } catch (error) {
      console.warn("Occupancy transition failed:", error?.message || error);
    }
  });

  /* One sample immediately so a day that starts with a restart is not blank
     until the first interval, then init-once — the pattern the memory rules
     call fine, as opposed to a per-event timer that needs teardown. */
  void sample();
  timer = setInterval(sample, sampleMs);
  timer.unref?.();
  return timer;
}

export function __resetOccupancy({ file } = {}) {
  if (timer) clearInterval(timer);
  timer = null;
  state = null;
  manager = null;
  writeQueue = Promise.resolve();
  overrideFile = file ?? null;
}
