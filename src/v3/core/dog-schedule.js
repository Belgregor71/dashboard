/* ═══════════════════════════════════════════════════════════════════════════
   DOG SCHEDULE — when Benji and Teddy pop up on their own.
   features.v3DogSchedule (default off). dog-occasion.js is the show; this is
   the only thing that calls it without a person asking.

   THE CALENDAR (owner's rules, 2026-09-26). Each day is exactly one of:
     birthday   only on the day. Wins over any season that day. A dog's own
                birthday: that dog (Benji and Teddy share 20/5, so both).
                A family birthday: either dog, or both.
     season     New Year 30 Dec – 2 Jan (the day: 31 Dec) · Australia Day
                20–26 Jan (26th) · Easter: Monday of Holy Week – Easter Monday
                (Easter Sunday) · Halloween all of October (31st) · Christmas
                3–26 Dec (25th).
     generic    every other day of the year.

   HOW OFTEN. Rates are per hour SOMEONE IS THERE, not per wall-clock hour:
   a dog nobody sees is not a moment, so nothing fires to an empty room, in
   quiet hours, or over something the house is showing (a doorbell, a voice
   reply — anything at SUBJECT depth).
     generic    ~1 an hour on average, never more than 2 in any 60 minutes.
     season     climbs from ~1 an hour on its first day to 5 on the day
                itself, easing off on any days after it (Boxing Day, Easter
                Monday, 1–2 Jan). Never more than 5 in any 60 minutes.
     birthday   the day itself, so the peak: 5.
   The cap is a sliding 60 minutes of what was actually SHOWN, and a minimum
   gap keeps two from landing back to back. Within those, each minute rolls
   against the rate (a Poisson clock), so the timing never becomes a pattern.

   WHO. One dog or both, at random (never the same dog twice — dog-occasion
   takes a set). Each draws his own outfit. Christmas also has the run across
   the glass: about one Christmas popup in five, always the pair.

   Quiet hours are health.js's, 22:00–07:00, and deliberately NOT V3's solar
   night — sunset would stop the dogs at six on a December evening, which is
   exactly when the family is home to see them.
   ═══════════════════════════════════════════════════════════════════════════ */

export const QUIET = { from: 22, to: 7 };
export const TICK_MS = 60_000;
export const PAIR_SHARE = 0.5;

export const GENERIC = { rate: 1, cap: 2, minGapMin: 10 };
export const SEASONAL = { floor: 1, peak: 5, cap: 5, minGapMin: 6, taperPerDay: 2 };
export const BIRTHDAY = { rate: 5, cap: 5, minGapMin: 6 };

/* Occasions with a run mode, and how often a popup is the run instead. */
export const RUN_SHARE = { christmas: 0.2 };

const DOGS = ["benji", "teddy"];

/* ── Dates ─────────────────────────────────────────────────────────────────
   Whole LOCAL days as integers, so a DST change is never a 23-hour "day". */
const dayNo = (y, m, d) => Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
const dayOf = (date) => dayNo(date.getFullYear(), date.getMonth() + 1, date.getDate());

/** Easter Sunday (Gregorian), as { month, day }. The anonymous algorithm. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

/* Each season's [first day, THE day, last day] for the season that starts in
   year y, as day numbers. */
export const SEASONS = {
  newYear: (y) => [dayNo(y, 12, 30), dayNo(y, 12, 31), dayNo(y + 1, 1, 2)],
  australiaDay: (y) => [dayNo(y, 1, 20), dayNo(y, 1, 26), dayNo(y, 1, 26)],
  easter: (y) => {
    const { month, day } = easterSunday(y);
    const sunday = dayNo(y, month, day);
    return [sunday - 6, sunday, sunday + 1];
  },
  halloween: (y) => [dayNo(y, 10, 1), dayNo(y, 10, 31), dayNo(y, 10, 31)],
  christmas: (y) => [dayNo(y, 12, 3), dayNo(y, 12, 25), dayNo(y, 12, 26)]
};

/** Popups per present hour on day `d` of a season [start, peak, end]. */
export function seasonRate(d, [start, peak]) {
  const { floor, peak: top, taperPerDay } = SEASONAL;
  if (d < peak) return floor + (top - floor) * ((d - start) / Math.max(1, peak - start));
  if (d === peak) return top;
  return Math.max(floor, top - taperPerDay * (d - peak));
}

/** The season `date` falls in, or null. */
export function seasonOf(date) {
  const d = dayOf(date);
  const y = date.getFullYear();
  for (const [id, window] of Object.entries(SEASONS)) {
    // New Year straddles the year line: 1–2 Jan belong to last year's season.
    for (const sy of [y - 1, y]) {
      const w = window(sy);
      if (d >= w[0] && d <= w[2]) return { id, window: w, day: d };
    }
  }
  return null;
}

/**
 * What today is, for the dogs: { kind, occasion, rate, cap, minGapMs, dogs,
 * runShare }. `birthdays` is /api/dogs/birthdays' `days`
 * ([{ month, day, dogs: [ids], family }]).
 */
export function planFor(date, birthdays = []) {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const bday = birthdays.find((b) => b.month === month && b.day === day);
  if (bday) {
    const own = (bday.dogs ?? []).filter((id) => DOGS.includes(id));
    return {
      kind: "birthday", occasion: "birthday", rate: BIRTHDAY.rate, cap: BIRTHDAY.cap,
      minGapMs: BIRTHDAY.minGapMin * 60_000,
      // A dog's own day is his alone — unless a person shares it.
      dogs: own.length && !bday.family ? own : [...DOGS],
      runShare: 0
    };
  }
  const season = seasonOf(date);
  if (season) {
    const rate = seasonRate(season.day, season.window);
    return {
      // The cap climbs WITH the rate: a flat 5 let 3 December — ~1 an hour —
      // throw five in one lucky hour (measured in simulation), which is not
      // "more often the closer it gets". Twice the rate, between generic's 2
      // and the season's 5.
      kind: "season", occasion: season.id, rate,
      cap: Math.min(SEASONAL.cap, Math.max(GENERIC.cap, Math.ceil(rate * 2))),
      minGapMs: SEASONAL.minGapMin * 60_000, dogs: [...DOGS], runShare: RUN_SHARE[season.id] ?? 0
    };
  }
  return {
    kind: "generic", occasion: "generic", rate: GENERIC.rate, cap: GENERIC.cap,
    minGapMs: GENERIC.minGapMin * 60_000, dogs: [...DOGS], runShare: 0
  };
}

export function isQuiet(date) {
  const h = date.getHours();
  return QUIET.from > QUIET.to ? h >= QUIET.from || h < QUIET.to : h >= QUIET.from && h < QUIET.to;
}

/* The dice's rate, not the delivered one. The gap after each popup is dead
   time the dice never rolls in, so rolling at `rate` would deliver
   1 / (1/rate + gap) — 3.3 an hour at a peak of 5 with a 6-minute gap.
   Solving for the roll that DELIVERS `rate` gives rate / (1 − rate·gap). The
   cap still has the last word. */
export function rollRate({ rate, minGapMs }) {
  const busy = rate * (minGapMs / 3_600_000);
  return rate / Math.max(0.05, 1 - busy);
}

/** One dog or the pair, from `pool`. Never the same dog twice. */
export function chooseDogs(pool, random = Math.random) {
  if (pool.length < 2) return [...pool];
  if (random() < PAIR_SHARE) return [...pool];
  return [pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))]];
}

/**
 * The clock. Everything it touches is injected, so a spec can run a year of
 * it in milliseconds: `show` is dogOccasion.show; `isPresent`/`isBusy` gate;
 * `birthdays()` returns the current list.
 *
 * tick() is one roll of the dice; it returns what it decided and why, so the
 * readout (and a spec) can see a quiet hour or a spent cap rather than
 * silence. A show that ends { shown: false } (busy, an asset failed) is
 * handed back to the cap — only a dog that reached the glass counts.
 */
export function createDogSchedule({
  show, isPresent, isBusy = () => false, birthdays = () => [],
  // random reads Math.random per roll, not once at creation, so a page-side
  // stub (the specs force a winning roll) reaches the live clock.
  now = () => new Date(), random = () => Math.random(), tickMs = TICK_MS, planOf = planFor
}) {
  const shown = [];   // ms of each popup that reached (or is reaching) the glass
  let last = null;
  let fired = 0;

  function decide() {
    const date = now();
    const t = date.getTime();
    if (isQuiet(date)) return { fired: false, reason: "quiet" };
    if (!isPresent()) return { fired: false, reason: "absent" };
    if (isBusy()) return { fired: false, reason: "busy" };
    const plan = planOf(date, birthdays() ?? []);
    while (shown.length && t - shown[0] >= 3_600_000) shown.shift();
    const lastShown = shown[shown.length - 1];
    if (lastShown != null && t - lastShown < plan.minGapMs) return { fired: false, reason: "gap", plan };
    if (shown.length >= plan.cap) return { fired: false, reason: "cap", plan };
    const p = 1 - Math.exp(-rollRate(plan) * (tickMs / 3_600_000));
    if (random() >= p) return { fired: false, reason: "dice", plan };

    const run = plan.runShare > 0 && random() < plan.runShare;
    const dogs = run ? [...DOGS] : chooseDogs(plan.dogs, random);
    const mode = run ? "run" : "peek";
    shown.push(t);
    fired += 1;
    Promise.resolve(show(plan.occasion, { mode, dogs })).then((r) => {
      if (!r?.shown) {
        const i = shown.indexOf(t);
        if (i >= 0) shown.splice(i, 1);
      }
    }, () => {
      const i = shown.indexOf(t);
      if (i >= 0) shown.splice(i, 1);
    });
    return { fired: true, occasion: plan.occasion, mode, dogs, plan };
  }

  function tick() {
    last = { at: now().toISOString(), ...decide() };
    return last;
  }

  return {
    tick,
    state: () => ({ last, fired, lastHour: shown.length })
  };
}

/* ── The live clock ────────────────────────────────────────────────────────
   Init-once, like main.js's other intervals: one setInterval for the life of
   the page, never re-created. Birthdays are fetched at start and every six
   hours (a .env edit + service restart already reloads the page, so this is
   belt and braces for a date added while the wall runs). A failed fetch keeps
   the last good list — a flaky network must not turn today's birthday into a
   generic day. The tick itself never throws: dog-occasion.show() never
   rejects, and decide() is pure. */
const BIRTHDAYS_URL = "/api/dogs/birthdays";
const BIRTHDAYS_REFRESH_MS = 6 * 3_600_000;

let live = null;

export function initDogSchedule({ show, isPresent, isBusy }) {
  if (live) return live;
  let days = [];
  const refresh = () => fetch(BIRTHDAYS_URL)
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => { if (Array.isArray(body?.days)) days = body.days; }, () => {});
  refresh();
  const schedule = createDogSchedule({ show, isPresent, isBusy, birthdays: () => days });
  setInterval(() => schedule.tick(), TICK_MS);
  setInterval(refresh, BIRTHDAYS_REFRESH_MS);
  live = {
    tick: schedule.tick,
    state: () => ({ ...schedule.state(), birthdays: days.length, today: planFor(new Date(), days) })
  };
  return live;
}
