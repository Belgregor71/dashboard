// The day model behind the temporal spine ("The Day, Rendered" v2, §2).
//
// Same discipline as candidateSources.js / insightRules.js: no imports, no DOM,
// no storage. The runtime (modules/temporalSpine.js) reads live state and passes
// it in, so every rule below unit-tests in plain node.
//
// The spine is a fixed day, not a feed: 05:00 → 24:00 mapped left to right, and
// "now" travels across it at the sun's speed (~1.5px/min at 1920). Nothing here
// scrolls, and nothing here is a card — a mark is a point of light with a time,
// a weight and a temperature.

/** The panel's waking life. Outside this window there is no spine to be on. */
export const DAY_START_HOUR = 5;
export const DAY_END_HOUR = 24;

/**
 * The fixed slot budget (§8). The model allocates this array once and overwrites
 * in place; a day that produces more marks than this evicts its oldest ember
 * rather than growing. This is what makes the 230k-detached-node failure class
 * structurally impossible on the spine — it never allocates per mark.
 */
export const MAX_SLOTS = 64;

/** How many previous years sit beneath as strata (§2 "Reach"). */
export const STRATA_ROWS = 3;

/** Weight is the only hierarchy (§2 "Density") — no categories, no per-domain colour. */
export const WEIGHT_MIN = 1;
export const WEIGHT_MAX = 3;

// The attention bands the queue already scores in (Low 40 → Interrupt 100).
const SCORE_FLOOR = 40;
const SCORE_CEIL = 100;

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

/**
 * Fractional hours since local midnight.
 *
 * Absent values are rejected before `new Date` sees them: `new Date(null)` is
 * the epoch, which is a perfectly valid date and lands mid-morning in local
 * time — so "no time" would otherwise silently become a mark at 10:00.
 */
export function hourOf(date) {
  if (date == null || date === "") return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

/** Is this fractional hour on the spine at all? */
export function onSpine(hour) {
  return Number.isFinite(hour) && hour >= DAY_START_HOUR && hour <= DAY_END_HOUR;
}

/**
 * Fractional hour → 0..1 across the spine. Linear and fixed: mid-morning looks
 * mid-morning from the toaster, before you have read a word.
 */
export function spineT(hour) {
  if (!Number.isFinite(hour)) return null;
  return clamp((hour - DAY_START_HOUR) / (DAY_END_HOUR - DAY_START_HOUR), 0, 1);
}

/**
 * The existing attention score sets a mark's size and glow — nothing else (§2).
 * Maps the queue's 40..100 bands onto weight 1..3, continuously: a school
 * morning reads dense, a Saturday reads loose.
 */
export function weightForScore(score) {
  const s = Number(score);
  if (!Number.isFinite(s)) return WEIGHT_MIN;
  const t = clamp((s - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR), 0, 1);
  return WEIGHT_MIN + t * (WEIGHT_MAX - WEIGHT_MIN);
}

// ── Source adapters ───────────────────────────────────────────
// One per domain (§3). Each is a way of being present, not a container: they all
// emit the same shape, so eleven domains share one vocabulary.
//
//   { id, at, hour, weight, warm, kind, label }
//
// `spent` is not decided here — it is a function of `now`, applied in buildDay.

/** Dinner is a structural anchor — the heaviest standing mark most days, always warm. */
const MEAL_PATTERN = /^\s*meal\s*:/i;

// A calendar title carries authoring scaffolding the wall must not repeat: the
// "Meal:" routing prefix the recipe panel keys off, and the category emoji the
// timeline uses as its glyph. The spine has no icons and no categories, so the
// label is the plain name of the thing.
const TITLE_PREFIX = /^\s*(?:\p{Extended_Pictographic}️?\s*)*(?:[A-Za-z]+\s*:\s*)?/u;

function cleanLabel(title) {
  const text = String(title ?? "").replace(TITLE_PREFIX, "").trim();
  return text || null;
}

/**
 * A calendar event → a mark at its hour. All-day events have no hour, so they
 * have no geometry: they are not on the spine (they live in language).
 */
export function eventMark(ev, { now = new Date() } = {}) {
  if (!ev || ev.isAllDay) return null;
  const start = ev.start instanceof Date ? ev.start : new Date(ev.start);
  const hour = hourOf(start);
  if (!onSpine(hour)) return null;
  if (!sameDay(start, now)) return null;

  const raw = String(ev.rawTitle ?? ev.title ?? "");
  const meal = MEAL_PATTERN.test(raw);
  return {
    id: `event:${ev.id ?? raw}:${start.getTime()}`,
    at: start.getTime(),
    hour,
    // A meal anchors the day; everything else takes the band it was scored in.
    weight: meal ? WEIGHT_MAX : weightForScore(ev.score ?? 50),
    warm: meal,
    kind: meal ? "meal" : "calendar",
    label: cleanLabel(ev.displayTitle ?? ev.title ?? raw)
  };
}

/**
 * A camera trigger → an ember at its minute (§3 "Cameras"). Never scheduled —
 * they happen. The spine gives events an afterlife, which is what lets the
 * announcement itself be brief and unrepeated.
 */
export function triggerMark({ name, at, label } = {}) {
  const hour = hourOf(at);
  if (!name || !onSpine(hour)) return null;
  return {
    id: `camera:${at}`,
    at: Number(at),
    hour,
    weight: weightForScore(60),
    warm: false,
    kind: "camera",
    label: label ? `${name} · ${label}` : name
  };
}

/** Bins: a small weekly evening anchor. Lid colour lives in the utterance, never an icon. */
export function binMark({ due, binsText, hour = 18.5 } = {}, { now = new Date() } = {}) {
  if (!due || !onSpine(hour)) return null;
  const at = new Date(now);
  at.setHours(Math.floor(hour), Math.round((hour % 1) * 60), 0, 0);
  return {
    id: "bins:tonight",
    at: at.getTime(),
    hour,
    weight: weightForScore(55),
    warm: false,
    kind: "bins",
    label: binsText || "Bins out"
  };
}

/**
 * Rain with a time is one mark, not weather furniture (§3 "Weather" — the
 * condition is already the light). Anything without a clock time stays silent.
 */
export function rainMark({ startsAt, label } = {}) {
  const hour = hourOf(startsAt);
  if (!onSpine(hour)) return null;
  return {
    id: `rain:${startsAt}`,
    at: Number(new Date(startsAt).getTime()),
    hour,
    weight: weightForScore(70),
    warm: false,
    kind: "weather",
    label: label || "Rain"
  };
}

function sameDay(a, b) {
  const x = a instanceof Date ? a : new Date(a);
  const y = b instanceof Date ? b : new Date(b);
  return (
    x.getFullYear() === y.getFullYear() &&
    x.getMonth() === y.getMonth() &&
    x.getDate() === y.getDate()
  );
}

// ── The model ─────────────────────────────────────────────────

/**
 * Fold raw marks into the fixed-slot day.
 *
 * - Marks left of now are **embers** (`spent`): the day as it actually went,
 *   not as it was planned. An empty afternoon looks like an empty afternoon.
 * - Duplicate ids collapse (the runtime re-reads the same sources every tick,
 *   so this is the overwrite-in-place path, not a growth path).
 * - Over budget, the oldest ember is evicted first — the future is never
 *   dropped to make room for the past.
 *
 * @returns {{ marks: Array, nowHour: number|null, nowT: number|null, strata: Array }}
 */
export function buildDay({ marks = [], now = new Date(), strata = [] } = {}) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const nowHour = hourOf(now);

  const byId = new Map();
  for (const m of marks) {
    if (!m || !onSpine(m.hour)) continue;
    byId.set(m.id, {
      ...m,
      weight: clamp(Number(m.weight) || WEIGHT_MIN, WEIGHT_MIN, WEIGHT_MAX),
      spent: Number(m.at) <= nowMs,
      t: spineT(m.hour)
    });
  }

  let kept = [...byId.values()].sort((a, b) => a.at - b.at);
  if (kept.length > MAX_SLOTS) {
    // Evict oldest embers first; if the day is somehow all future, drop from the
    // far end so the near future — the part you can still act on — survives.
    const embers = kept.filter((m) => m.spent);
    const live = kept.filter((m) => !m.spent);
    const overflow = kept.length - MAX_SLOTS;
    const trimmedEmbers = embers.slice(Math.min(overflow, embers.length));
    const stillOver = trimmedEmbers.length + live.length - MAX_SLOTS;
    kept = [...trimmedEmbers, ...(stillOver > 0 ? live.slice(0, live.length - stillOver) : live)]
      .sort((a, b) => a.at - b.at);
  }

  return {
    marks: kept,
    nowHour: onSpine(nowHour) ? nowHour : null,
    nowT: onSpine(nowHour) ? spineT(nowHour) : null,
    strata: buildStrata(strata, { now })
  };
}

/**
 * The strata (§2 "Reach"): previous years as fainter parallel lines beneath —
 * the same axis, scrolled down by years. This is where "on this day" lives.
 * A year is `lit` only when a memory from it is actually surfacing, and a lit
 * row carries a mark at the memory's hour joined to now by a hairline.
 */
export function buildStrata(rows = [], { now = new Date(), count = STRATA_ROWS } = {}) {
  const thisYear = (now instanceof Date ? now : new Date(now)).getFullYear();
  const litByYear = new Map();
  for (const r of rows) {
    if (!r || !Number.isFinite(Number(r.year))) continue;
    litByYear.set(Number(r.year), r);
  }

  const out = [];
  for (let i = 1; i <= count; i++) {
    const year = thisYear - i;
    const hit = litByYear.get(year);
    const hour = hit ? hourOf(hit.at ?? hit.hour ?? null) ?? Number(hit.hour) : null;
    out.push({
      year,
      row: i,
      lit: Boolean(hit),
      hour: hit && onSpine(hour) ? hour : null,
      t: hit && onSpine(hour) ? spineT(hour) : null
    });
  }
  return out;
}

// ── Language rationing (§5) ───────────────────────────────────

/** How many marks may take a short label, per presence mode. */
export const LABEL_SLOTS = 3;

/**
 * Presence changes how much language the spine is allowed. The spine never
 * leaves; presence rations its words.
 *
 *   nobody   → the day as pure light. No words, no breath.
 *   passing  → the spine speaks once — a single utterance, anchored to its mark.
 *   staying  → the next three take short labels, dimmed by rank.
 *   voice    → the spine holds and stills; an answer may point at a mark.
 */
export function languageBudget(mode) {
  switch (mode) {
    case "dwell":
      return { utterance: 1, labels: LABEL_SLOTS };
    case "glance":
      return { utterance: 1, labels: 0 };
    case "voice":
      return { utterance: 0, labels: 0 };
    default: // ambient — nobody home
      return { utterance: 0, labels: 0 };
  }
}

/**
 * Which marks take the label slots when someone stays: the nearest-heaviest
 * ahead of now. Rank is rendered as ink (the runtime dims by index), never as
 * position — the spine must not become a queue.
 */
export function labelledMarks(marks = [], { now = new Date(), limit = LABEL_SLOTS } = {}) {
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  return marks
    .filter((m) => m && !m.spent && m.label)
    .map((m) => ({ mark: m, wait: m.at - nowMs }))
    .sort((a, b) => b.mark.weight - a.mark.weight || a.wait - b.wait)
    .slice(0, limit)
    .map((x) => x.mark);
}

/**
 * The one mark an utterance is anchored to. Language grows out of time: the
 * utterance names the mark nearest the scored winner, so the hairline has
 * somewhere true to land. Falls back to the heaviest live mark.
 */
export function anchorFor(marks = [], { id = null, now = new Date() } = {}) {
  if (!marks.length) return null;
  if (id) {
    const exact = marks.find((m) => m.id === id);
    if (exact) return exact;
  }
  const live = labelledMarks(marks, { now, limit: 1 });
  return live[0] ?? null;
}
