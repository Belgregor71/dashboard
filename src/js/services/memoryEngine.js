import { afterglowFactor } from "./momentsEngine.js";

// The memory selector — Phase 9 (docs/vision/phase-9-remember.md). Pure: its
// only dependency is the pure `afterglowFactor` timeline helper — no DOM, no IO,
// no storage — so the whole module unit-tests in plain node (tests/memory.spec.js).
// The runtime (core/memoryRuntime.js) owns the IO: it loads the authored entries,
// tracks the surface history, reads/writes cooldowns, and emits the candidate.
//
// The entire value of this phase is RARITY and RESTRAINT. `pickMemory` returns
// null far more often than not — silence is the default; a memory is earned, not
// scheduled. Three limits keep it rare, and every one lives here in the pure
// layer so it is testable, not a convention the renderer might forget:
//   1. a per-DAY budget    — at most one memory surfaces per calendar day;
//   2. a per-ENTRY cooldown — measured in months, so nothing repeats soon;
//   3. a context-fit FLOOR  — an ordinary afternoon with no matching memory
//      stays silent; a memory surfaces only when the day actually fits it.
//
// Tender entries (a lost pet, a grief anchor) get the gentlest possible surface,
// enforced HERE and unit-tested as an invariant: ambient-only, a longer hold,
// and NEVER a caption. A house that can only match a keyword will never know to
// bring a dog back gently — so the gentleness is code, not hope.

// ── Bands / tunables ───────────────────────────────────────────
export const MEMORY_SCORE = 44;   // Low band (40–49): only ever wins a quiet moment
const FIT_FLOOR = 25;             // below this context fit, stay silent (an anniversary clears it alone)
const NORMAL_HOLD_MS = 12_000;    // a memory holds a beat longer than an ordinary hero
const TENDER_HOLD_MS = 22_000;    // tender memories linger, unhurried
const DEFAULT_COOLDOWN_MONTHS = 6;
const DAY_MS = 86_400_000;
const MONTH_MS = 30 * DAY_MS;     // "months" cooldown, approximate by design
const AFTERGLOW_DAYS = 5;

// Context-fit weights (additive). An anniversary alone clears the floor; the
// rest are the "right kind of afternoon" nudges — the season, the weather-mood,
// the character of the day.
const FIT_ANNIVERSARY = 100;
const FIT_SEASON = 30;
const FIT_MOOD = 25;
const FIT_DAY = 15;
const FIT_AFTERGLOW = 45; // scaled by the decay factor (0..1)

// ── Helpers ────────────────────────────────────────────────────

function dateKey(d) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function endOfDay(now) {
  const d = new Date(now);
  d.setHours(23, 59, 59, 999);
  return d;
}

// The weather-mood a condition evokes — the "grey afternoon" match. Kept coarse
// on purpose; an entry opts in by tagging itself with one of these words.
export function moodOf(condition) {
  const c = String(condition || "").toLowerCase();
  if (!c) return null;
  if (/rain|drizzle|shower|storm/.test(c)) return "wistful";
  if (/cloud|overcast|fog|mist|grey|gray/.test(c)) return "grey";
  if (/clear|sunny|fine/.test(c)) return "bright";
  return null;
}

// Does the entry's anchor (a one-off `date` or a `recurring` {month,day}) land
// on today? month is 1-based in the data for human authoring.
function anniversaryToday(entry, now) {
  const rec = entry.recurring;
  if (rec && Number.isFinite(rec.month) && Number.isFinite(rec.day)) {
    return rec.month === now.getMonth() + 1 && rec.day === now.getDate();
  }
  if (entry.date) {
    const d = new Date(entry.date);
    if (!Number.isNaN(d.getTime())) {
      return d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
    }
  }
  return false;
}

// Days since a one-off dated occasion ended (null when there's no usable date or
// it hasn't happened yet). Feeds the afterglow decay.
function daysSince(entry, now) {
  if (!entry.date) return null;
  const d = new Date(entry.date);
  if (Number.isNaN(d.getTime())) return null;
  const diff = (now.getTime() - d.getTime()) / DAY_MS;
  return diff >= 0 ? diff : null;
}

function cooldownMs(entry) {
  const months = Number.isFinite(entry.cooldownMonths) ? entry.cooldownMonths : DEFAULT_COOLDOWN_MONTHS;
  return Math.max(0, months) * MONTH_MS;
}

/**
 * How well this entry fits *today* — the "chooses, not shuffles" score. An
 * anniversary clears the floor on its own; season/mood/day-character are the
 * quieter nudges; a just-passed dated occasion earns a decaying afterglow boost.
 */
export function scoreFit(entry, ctx = {}, now = new Date()) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  let score = 0;

  if (anniversaryToday(entry, now)) score += FIT_ANNIVERSARY;
  if (ctx.season && tags.includes(ctx.season)) score += FIT_SEASON;

  const mood = ctx.mood ?? moodOf(ctx.condition);
  if (mood && tags.includes(mood)) score += FIT_MOOD;

  if (ctx.dayCharacter && tags.includes(ctx.dayCharacter)) score += FIT_DAY;

  const since = daysSince(entry, now);
  if (since != null) score += FIT_AFTERGLOW * afterglowFactor(since, AFTERGLOW_DAYS);

  return score;
}

/**
 * Turn a chosen entry into the attention-queue candidate. This is the ONE place
 * tender-gating is applied, so the invariant holds no matter who calls it
 * (pickMemory or the __forceMemory debug hook): a `sensitivity:"tender"` entry
 * is ambient-only, holds longer, and NEVER carries a caption. A memory NEVER
 * interrupts — it is a Low-band, non-interrupt candidate by construction.
 */
export function toSurface(entry, now = new Date()) {
  if (!entry || !entry.id) return null;
  const tender = entry.sensitivity === "tender";
  const title = String(entry.title ?? "").trim();

  // Tender → no caption (the photo carries it; we do not narrate grief).
  // Normal → a quiet one-line caption, rotated by day so it varies over time
  // (stable within a day, so it never changes under a re-render).
  const day = Math.floor(now.getTime() / 86400000);
  const pick = (lines) => lines[day % lines.length];
  const caption = tender
    ? null
    : title
      ? pick([
          `On this day — ${title}.`,
          `A memory from today — ${title}.`,
          `${title} — on this day.`
        ])
      : pick(["On this day.", "A memory for today."]);

  return {
    id: `memory:${entry.id}`,
    entryId: entry.id,
    source: "memory",
    kind: entry.kind ?? "memory",
    sensitivity: tender ? "tender" : "normal",
    icon: tender ? "🕯️" : "🕰️",
    caption,
    text: caption ?? "",
    photos: Array.isArray(entry.photos) ? entry.photos : [],
    ambientOnly: tender,          // tender memories only ever belong to the quiet ambient frame
    holdMs: tender ? TENDER_HOLD_MS : NORMAL_HOLD_MS,
    interrupt: false,             // a memory never interrupts — full stop
    score: MEMORY_SCORE,          // Low band
    cooldownMs: cooldownMs(entry),
    expiresAt: endOfDay(now).getTime()
  };
}

/**
 * Choose at most one memory to surface today, or null (the common case).
 *
 * @param {Array}  entries authored + anchor-derived memory entries
 * @param {object} ctx     { season, dayCharacter, condition|mood } — today's character
 * @param {object} history { lastSurfacedDay:string, cooldowns:{ [candidateId]:epochMs } }
 * @param {Date}   now
 * @returns {object|null} a Low-band, non-interrupt surface, or null
 */
export function pickMemory(entries, ctx = {}, history = {}, now = new Date()) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  // 1. Daily budget — at most one memory per calendar day. Once spent, silence.
  if (history.lastSurfacedDay === dateKey(now)) return null;

  const cooldowns = history.cooldowns || {};
  const t = now.getTime();

  // 2. Eligibility (per-entry cooldown) + 3. context-fit scoring.
  const scored = entries
    .filter((e) => e && e.id)
    .filter((e) => {
      const until = cooldowns[`memory:${e.id}`];
      return !until || until <= t; // past its months-long cooldown
    })
    .map((e) => ({ entry: e, fit: scoreFit(e, ctx, now) }))
    .filter(({ fit }) => fit >= FIT_FLOOR) // an ordinary day with no fitting memory stays silent
    .sort((a, b) => b.fit - a.fit);

  const chosen = scored[0];
  return chosen ? toSurface(chosen.entry, now) : null;
}
