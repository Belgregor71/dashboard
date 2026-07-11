// The House Model — Phase 6 (docs/vision/phase-6-intent.md). A pure reducer that
// fuses signals the store already carries into a single *intent* posture, same
// contract as atmosphere.js / predictiveRules.js: no imports, no DOM, no IO, so
// the whole module unit-tests in plain node (tests/intent.spec.js).
//
// Presence already knows *where* someone is; intent names *what* they're doing so
// the attention gate can tell a person sprinting past their keys from one leaning
// in with a coffee. It emits a posture, never a candidate — nothing new lands on
// the glass in Phase 6; the later phases dress to the posture this derives.
//
// Discipline: no HA entity is assumed. Appliance/oven sensors are NOT presumed to
// exist — the model degrades to time + calendar + motion when they're absent (the
// Phase 3 "no rule for a phantom entity" rule).

// The full posture surface. The stateless reducer emits the subset it can ground;
// "arriving" needs an away→home transition (Phase 1 arrivalGreeting sees it, a
// stateless reducer can't) so it's reserved for a runtime that carries history.
export const ACTIVITIES = [
  "cooking",
  "leaving",
  "arriving",
  "entertaining",
  "passing",
  "winding-down",
  "unknown"
];
export const TEMPOS = ["rushed", "unhurried", "neutral"];
export const COMPANY = ["alone", "together", "hosting", "unknown"];

export const NEUTRAL_INTENT = {
  activity: "unknown",
  tempo: "neutral",
  timeBudget: null,
  company: "unknown"
};

// A hard event this close, while someone's present, means a rushed room.
const RUSHED_BUDGET_MIN = 30;
// A sustained dwell with nothing pressing this soon is an unhurried room.
const UNHURRIED_MIN = 60;
// Dinner-prep window (local hour) — the grounded "cooking" signal without an
// appliance entity: present, at the stove hours.
const DINNER_FROM = 17; // 5pm
const DINNER_TO = 20;   // until 8pm
const WINDDOWN_FROM = 21; // 9pm+ at night → winding down

function ms(v) {
  if (v instanceof Date) return v.getTime();
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

// Minutes until the next thing that matters: the soonest future leave-by (when
// you must act) or event start. Null when nothing is on the horizon.
function nextBudgetMin(events, nowMs) {
  let soonest = Infinity;
  for (const ev of events || []) {
    const at = ms(ev?.leaveBy ?? ev?.start);
    if (Number.isFinite(at) && at > nowMs) soonest = Math.min(soonest, at);
  }
  if (!Number.isFinite(soonest)) return null;
  return Math.max(0, Math.round((soonest - nowMs) / 60_000));
}

// Phase 8 (docs/vision/phase-8-learn.md): a confident learned departure sharpens
// the budget when the calendar is silent. Only when it's ahead and within a few
// hours — a soft prior, never overriding a hard calendar event. Null (below the
// confidence threshold) → no effect, so flag-off is byte-identical.
const LEARNED_HORIZON_MIN = 180;
function learnedBudgetMin(learnedDeparture, nowMs) {
  if (learnedDeparture == null) return null;
  const d = new Date(nowMs);
  const cur = d.getHours() * 60 + d.getMinutes();
  const diff = learnedDeparture - cur;
  if (diff <= 0 || diff > LEARNED_HORIZON_MIN) return null;
  return diff;
}

function companyFrom(peopleHome) {
  if (!Number.isFinite(peopleHome) || peopleHome <= 0) return "unknown";
  if (peopleHome === 1) return "alone";
  if (peopleHome === 2) return "together";
  return "hosting"; // 3+ person.* entities home
}

/**
 * Fuse the live slices into one posture.
 *
 * @param {object} input
 * @param {string} [input.presence] presence mode slug (ambient|glance|dwell|voice).
 * @param {number} [input.lastMotionAt] epoch ms of the last motion (reserved).
 * @param {boolean} [input.isNight] sunset→sunrise (screensaver's suncalc view).
 * @param {string} [input.condition] base weather category (reserved for later phases).
 * @param {Array}  [input.events] today's upcoming events, each { start, leaveBy? }
 *   as Date or epoch ms. Missing leaveBy falls back to start (graceful degrade).
 * @param {number} [input.peopleHome] count of person.* entities home.
 * @param {number} [input.learnedDeparture] learned departure (minutes-of-day) once
 *   confident, else null — Phase 8 sharpens the budget when the calendar is silent.
 * @param {Date}   [input.now]
 * @returns {{activity:string, tempo:string, timeBudget:(number|null), company:string}}
 */
export function deriveIntent({
  presence,
  lastMotionAt,   // eslint-disable-line no-unused-vars — reserved (motion cadence)
  isNight,
  condition,      // eslint-disable-line no-unused-vars — reserved (later phases)
  events,
  peopleHome,
  learnedDeparture = null,
  now = new Date()
} = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const hour = new Date(nowMs).getHours();

  // Calendar (a hard signal) always wins; the learned routine only fills the gap.
  const timeBudget = nextBudgetMin(events, nowMs) ?? learnedBudgetMin(learnedDeparture, nowMs);
  const company = companyFrom(peopleHome);
  const present = presence === "glance" || presence === "dwell";
  const hosting = company === "hosting";
  const imminent = timeBudget != null && timeBudget <= RUSHED_BUDGET_MIN;

  // ── activity — a priority ladder over grounded signals ──
  let activity = "unknown";
  if (present) {
    if (imminent) activity = "leaving";            // a hard event is close
    else if (hosting) activity = "entertaining";   // a full house
    else if (hour >= DINNER_FROM && hour < DINNER_TO) activity = "cooking";
    else if (isNight && hour >= WINDDOWN_FROM) activity = "winding-down";
    else if (presence === "glance") activity = "passing"; // awake but brief
    // else dwell with nothing salient → "unknown" (settled/present)
  }

  // ── tempo — the dimension the gate reads ──
  let tempo = "neutral";
  if (present && imminent) {
    tempo = "rushed";
  } else if (presence === "dwell" && !hosting && (timeBudget == null || timeBudget > UNHURRIED_MIN)) {
    tempo = "unhurried";
  }

  return { activity, tempo, timeBudget, company };
}

/**
 * Pure hysteresis reducer — the "settle, don't flap" instinct applied to state.
 * A categorical change (activity/tempo/company) must persist `settleMs` before it
 * commits, so noisy motion can't oscillate the posture. timeBudget is deliberately
 * NOT settled here — it counts down continuously and is not a flap.
 *
 * @param {{committed:object, pending:?{cat:object, since:number}}} prev
 * @param {object} proposed the freshly-derived { activity, tempo, company }
 * @param {number} nowMs
 * @param {number} settleMs
 * @returns {{committed:object, pending:?object, changed:boolean}}
 */
export function settleCategory(prev, proposed, nowMs, settleMs) {
  const { committed, pending } = prev;
  const eq = (a, b) =>
    a && b && a.activity === b.activity && a.tempo === b.tempo && a.company === b.company;

  if (eq(proposed, committed)) {
    return { committed, pending: null, changed: false }; // back to rest — cancel any pending
  }
  if (!pending || !eq(pending.cat, proposed)) {
    return { committed, pending: { cat: proposed, since: nowMs }, changed: false }; // start the clock
  }
  if (nowMs - pending.since >= settleMs) {
    return { committed: proposed, pending: null, changed: true }; // held long enough — commit
  }
  return { committed, pending, changed: false }; // still settling
}
