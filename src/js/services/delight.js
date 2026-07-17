// The delight registry — Phase 10 (docs/vision/phase-10-temperament.md). Pure
// detection + budget math, same contract as the other reducers (no imports, no
// DOM, no IO), so the whole module unit-tests in plain node
// (tests/personality.spec.js). The runtime (core/personalityRuntime.js) owns the
// side effects: it gathers the signals into a ctx, fires the behaviour, and
// persists the budgets.
//
// These are the house's two-or-three-times-a-year moments. They are NOT new
// sensors — each is a RARE TRIGGER on a signal the house already has. What keeps
// them magic instead of a feature is the BUDGET: a trigger cannot fire twice
// within its budget window, enforced here in the pure layer (a `budgetKey` the
// runtime records on fire and checks before the next), so it is tested, not a
// convention the runtime might forget.

export const DRY_SPELL_DAYS = 10; // a "long dry spell" before the first-rain moment earns itself
export const AWAY_DAYS = 2;       // a "long absence" before the home-again moment earns itself

function year(now) {
  return String(now.getFullYear());
}

// The gentle window a morning moment may greet in (local hour).
function isMorning(now) {
  const h = now.getHours();
  return h >= 4 && h <= 11;
}

/**
 * The registry. Each trigger is a small, distinct behaviour, ordered by priority
 * (a returning household + restored power beats the calendar). `detect` is pure
 * over the runtime-supplied ctx; `budget(ctx, now)` is the key that dedupes a
 * fire — the same key means "already spent for this occasion".
 */
export const DELIGHT_TRIGGERS = [
  {
    id: "power-restored",
    detect: (ctx) => Boolean(ctx.outageRecovered),
    budget: (ctx) => `boot:${ctx.bootKey ?? ""}`,
    occasion: () => ({
      id: "power-restored", icon: "🔌", title: "Back on",
      line: "Power's back — the house is up and waiting."
    })
  },
  {
    id: "home-after-away",
    detect: (ctx) => Number.isFinite(ctx.awayDays) && ctx.awayDays >= AWAY_DAYS,
    budget: (ctx) => `away:${ctx.awayReturnKey ?? ""}`,
    occasion: (ctx) => ({
      id: "home-after-away", icon: "🏡", title: "Home again",
      line: ctx.awayName ? `Welcome back, ${ctx.awayName} — the house missed you.` : "Welcome back — the house missed you."
    })
  },
  {
    id: "birthday-morning",
    detect: (ctx, now) => Boolean(ctx.birthdayName) && isMorning(now),
    budget: (ctx, now) => `bday:${year(now)}:${ctx.birthdayName ?? ""}`,
    occasion: (ctx) => ({
      id: "birthday-morning", icon: "🎂",
      title: ctx.birthdayName ? `${ctx.birthdayName}'s birthday` : "Birthday",
      line: ctx.birthdayName ? `Happy birthday, ${ctx.birthdayName}.` : "Happy birthday."
    })
  },
  {
    // A fixed/moveable calendar occasion (Christmas, Easter, Halloween, ANZAC …),
    // detected by occasions.js and read into ctx.occasion by the runtime. Retires
    // the old full-screen occasionPopup: the same days now surface as a single
    // house-voiced celebration line, budgeted once per occasion per year. Lower
    // priority than a birthday/homecoming, which speak to a person.
    id: "calendar-occasion",
    detect: (ctx) => Boolean(ctx.occasion?.id),
    budget: (ctx, now) => `occ:${year(now)}:${ctx.occasion?.id ?? ""}`,
    occasion: (ctx) => ctx.occasion
  },
  {
    id: "first-rain-after-dry",
    detect: (ctx) =>
      Boolean(ctx.rainNow) && Number.isFinite(ctx.dryStreakDays) && ctx.dryStreakDays >= DRY_SPELL_DAYS,
    budget: (ctx) => `rain:${ctx.dryBreakKey ?? ""}`,
    occasion: () => ({
      id: "first-rain-after-dry", icon: "🌧️", title: "First rain",
      line: "First rain in a while — the garden's grateful."
    })
  },
  {
    id: "christmas-eve",
    detect: (_ctx, now) => now.getMonth() === 11 && now.getDate() === 24,
    budget: (_ctx, now) => `xmas:${year(now)}`,
    occasion: () => ({
      id: "christmas-eve", icon: "🎄", title: "Christmas Eve",
      line: "Christmas Eve — nearly there."
    })
  },
  {
    id: "dst-sunrise",
    detect: (ctx, now) => Boolean(ctx.dstJustChanged) && isMorning(now),
    budget: (_ctx, now) => `dst:${year(now)}`,
    occasion: () => ({
      id: "dst-sunrise", icon: "🌅", title: "Longer days",
      line: "The clocks changed — longer evenings from here."
    })
  }
];

/**
 * Choose at most one delight moment to fire now, or null (overwhelmingly the
 * common case). Walks the registry in priority order; the first trigger whose
 * `detect` is true AND whose budget key has not already been spent wins.
 *
 * @param {object} ctx     runtime-gathered signals
 * @param {object} history { [triggerId]: lastFiredBudgetKey }
 * @param {Date}   now
 * @param {Array}  [triggers]
 * @returns {{ id:string, occasion:object, budgetKey:string } | null}
 */
export function pickDelight(ctx = {}, history = {}, now = new Date(), triggers = DELIGHT_TRIGGERS) {
  for (const t of triggers) {
    let fired = false;
    try { fired = Boolean(t.detect(ctx, now)); } catch { fired = false; }
    if (!fired) continue;

    const budgetKey = t.budget(ctx, now);
    if (history[t.id] === budgetKey) continue; // budget already spent for this occasion

    const occasion = t.occasion(ctx, now);
    return { id: t.id, occasion, budgetKey };
  }
  return null;
}

/** Record a fire against the budget — returns a new history that blocks a re-fire. */
export function spendBudget(history = {}, fired) {
  if (!fired || !fired.id) return history;
  return { ...history, [fired.id]: fired.budgetKey };
}

/** Is `id` already spent for `budgetKey`? (The can't-fire-twice check.) */
export function isBudgeted(history = {}, id, budgetKey) {
  return Boolean(history) && history[id] === budgetKey;
}

/** Compute the budget key a trigger would spend right now (for the force hook). */
export function budgetKeyFor(id, ctx = {}, now = new Date(), triggers = DELIGHT_TRIGGERS) {
  const t = triggers.find((x) => x.id === id);
  return t ? t.budget(ctx, now) : null;
}
