/* ═══════════════════════════════════════════════════════════════════════════
   DINNER — the recipe puts itself on the screen, and fills the book doing it.

   The second thing in V3 that takes depth 3 without being spoken to. alerts.js
   was the first, and this follows it deliberately rather than inventing a
   second way to do the same thing.

   ── Why this exists ─────────────────────────────────────────────────────────

   The incumbent's modules/recipePanel.js has exactly ONE caller, js/core/app.js,
   and V3 does not import it. Since the cutover (77f5fb1, 2026-08-11) `/` serves
   V3, so that panel has not run on the wall since — and it was the only thing
   that fetched each night's dish into data/recipe-cache. Measured on the G11:
   a write at 17:00 on every meal-day from 23 Jul to 6 Aug, then nothing at
   17:00 again; 11 Aug (Souvlaki) and 14 Aug (Katsu) have no entry at all. The
   recipe book stopped filling and the method stopped showing, from one cause.

   ⚠ THE WARM IS NOT A SIDE ERRAND — IT IS THE POINT. /api/recipe is
   cache-first, so showing the panel is what writes the dish to disk, which is
   what the portal at /recipes/ browses. Tomorrow's dish is warmed on the same
   tick: it costs the same single web search either way (a dish is searched once,
   forever), and it gives every dinner two chances at it instead of one.

   ── The door outranks you; dinner does not ──────────────────────────────────

   alerts.js calls setDepth() because someone at the door outranks whatever you
   were looking at. Dinner does NOT — it is a standing fact about the evening,
   not an event, and interrupting "show me the driveway" to announce a recipe
   you have already seen would be the wrong kind of eager. So this deepens only
   from the field or the glance, and never displaces a subject.
   ═══════════════════════════════════════════════════════════════════════════ */

import { MEAL_PREFIX } from "../../js/services/mealEvent.js";
import { voiceSnapshot } from "../../js/services/voiceSnapshot.js";
import { showSubject } from "../subjects/index.js";
import { DEPTH, setDepth, getDepth } from "./depth.js";

/* The incumbent's windows, unchanged — these are a household habit, not a
   tuning parameter, and the family has been reading a panel on this schedule
   since 22 July. */
const WINDOW_BEFORE_MS = 60 * 60 * 1000;  // on screen 1 h before the meal
const WINDOW_AFTER_MS = 20 * 60 * 1000;   // gone 20 min after it
const TICK_MS = 30_000;

/* After a failed fetch, back off before spending another web search on the same
   dish. A miss is usually the upstream, and retrying every 30 s for an hour is
   120 attempts at a billable route. */
const RETRY_BACKOFF_MS = 5 * 60 * 1000;

/* How long the recipe holds the screen once mounted. Longer than an ordinary
   subject's 30 s and longer than the door's 60 s, because this is the one
   surface someone is meant to be READING while their hands are busy.

   ⚠ NOT the whole window, and that is a deliberate departure from the
   incumbent. The incumbent's panel was a right-hand overlay: it could sit there
   for eighty minutes because the ambient dashboard carried on behind it. A V3
   subject is not an overlay — it IS the wall — so holding the window open would
   take the photographic ground and the whole field off the screen every evening
   from five o'clock, which is the opposite of what this surface is for.

   So it holds generously, recedes, and comes BACK: the tick re-mounts whenever
   the window is still open and the wall has fallen back to the field. Walk in
   and the recipe is there; look away and the house returns to itself; walk back
   and it is there again. */
export const DINNER_HOLD_MS = 180_000;

/* How long the wall gets to itself after a recipe recedes before that same
   dinner may take it again. Without this the re-mount is instant and the
   subject is effectively pinned after all. */
export const RESHOW_COOLDOWN_MS = 240_000;

let timer = null;
let inFlightKey = null;   // the meal whose recipe is being fetched
let reshowAt = 0;         // ms timestamp; dinner leaves the wall alone until then
let warmed = new Set();   // dishes already warmed this page-life
const nextRetryAt = new Map();
let last = null;

/**
 * The meal whose window is open right now, or null.
 *
 * ⚠ All-day events are excluded, and that is not tidiness. A little over half
 * this household's Meal: events are all-day (measured on the live feed), and an
 * all-day event has no dinner TIME — its start is midnight, so a "1 h before"
 * window would put the recipe on the wall at 11pm the night before. The timed
 * ones are the ones that mean "we eat at six".
 *
 * MEAL_PREFIX is imported rather than re-written: mealEvent.js exists precisely
 * because four modules had each grown their own copy of this regex.
 *
 * Exported for the spec — the windowing is the only real decision here and it
 * should be testable without a browser.
 */
export function activeMeal(events, now = new Date()) {
  if (!Array.isArray(events)) return null;
  const t = now.getTime();

  return events
    .filter((ev) => !(ev?.allDay === true))
    .map((ev) => {
      const title = ev?.displayTitle || ev?.title || "";
      if (!MEAL_PREFIX.test(title)) return null;
      const start = new Date(ev?.start);
      if (!Number.isFinite(start.getTime())) return null;
      if (t < start.getTime() - WINDOW_BEFORE_MS) return null;
      if (t >= start.getTime() + WINDOW_AFTER_MS) return null;
      const dish = title.replace(MEAL_PREFIX, "").trim();
      if (!dish) return null;
      return { dish, start, hideAt: start.getTime() + WINDOW_AFTER_MS, key: `${dish}|${start.toISOString()}` };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start)[0] ?? null;
}

/**
 * Every Meal: dish on a later day than `now`, nearest first.
 *
 * Used only for the warm, so it deliberately does NOT care about all-day vs
 * timed — an all-day meal event still names a dish worth having on disk before
 * anybody asks for it, even though it will never open the panel.
 */
export function upcomingDishes(events, now = new Date()) {
  if (!Array.isArray(events)) return [];
  const today = now.toDateString();

  return events
    .map((ev) => {
      const title = ev?.displayTitle || ev?.title || "";
      if (!MEAL_PREFIX.test(title)) return null;
      const start = new Date(ev?.start);
      if (!Number.isFinite(start.getTime())) return null;
      if (start.getTime() < now.getTime()) return null;
      if (start.toDateString() === today) return null;  // today's is the panel's job
      const dish = title.replace(MEAL_PREFIX, "").trim();
      return dish ? { dish, start } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);
}

/* A bare GET at the cache-first endpoint. The response is thrown away: this is
   here to make /api/recipe write data/recipe-cache/<slug>.json, not to render
   anything. Failures are silent by design — a warm that did not happen costs
   nothing anyone can see, and the panel will try again on its own tick. */
async function warm(dish) {
  if (!dish || warmed.has(dish)) return false;
  warmed.add(dish);
  try {
    await fetch(`/api/recipe?dish=${encodeURIComponent(dish)}`);
    return true;
  } catch {
    warmed.delete(dish);   // a network failure is worth retrying; a 502 is not
    return false;
  }
}

async function open(meal) {
  inFlightKey = meal.key;
  try {
    /* The subject does its own fetch and its own "no method saved" fallback, so
       there is nothing to pre-check here. It returns falsy when it could not
       build anything at all, which is the only case worth backing off from.

       ⚠ The snapshot is read FRESH rather than passed in. showRecipe reads
       `menu` off it, and a snapshot captured on a tick 30 s ago can name
       yesterday's dinner across a midnight boundary.

       ⚠ No lat/lon: those only fill `sun`, which no part of the recipe subject
       reads. Passing CITY down through this module would couple it to the
       geography for a field it never touches. */
    const snap = voiceSnapshot();
    const shown = await showSubject({ id: "show.recipe" }, snap);

    if (!shown) {
      nextRetryAt.set(meal.key, Date.now() + RETRY_BACKOFF_MS);
      return;
    }

    /* Window closed while we were awaiting — put the wall back rather than
       leaving a recipe up for a dinner that is over. */
    if (Date.now() >= meal.hideAt) {
      if (getDepth() === DEPTH.SUBJECT) setDepth(DEPTH.FIELD, "dinner-expired");
      return;
    }

    setDepth(DEPTH.SUBJECT, "dinner", { holdMs: DINNER_HOLD_MS });
    reshowAt = Date.now() + DINNER_HOLD_MS + RESHOW_COOLDOWN_MS;
    last = { dish: meal.dish, at: new Date().toISOString() };
  } finally {
    inFlightKey = null;
  }
}

function tick() {
  const events = voiceSnapshot()?.calendar;
  const now = new Date();

  /* The warm runs on every tick and is independent of the panel — the book must
     keep filling on days nobody is standing in the kitchen at six, and on days
     the panel never opens at all because the meal event is all-day. `warmed`
     makes it at most one request per dish per page-life. */
  for (const { dish } of upcomingDishes(events, now).slice(0, 2)) warm(dish);

  const meal = activeMeal(events, now);
  if (!meal) return;
  warm(meal.dish);

  if (meal.key === inFlightKey) return;
  if (Date.now() < (nextRetryAt.get(meal.key) ?? 0)) return;

  /* Let the room have the wall back between showings. Without this the subject
     recedes on its hold and is re-mounted on the very next tick, which is a pin
     with extra steps. */
  if (Date.now() < reshowAt) return;

  /* Deepen, never force. See the header: dinner is a standing fact, so it takes
     the field and the glance and leaves anything deeper alone — a subject
     somebody asked for, a doorbell, or a spread the house composed. That the
     recipe is currently up is covered by the same test: a mounted dinner IS
     depth 3. */
  if (getDepth() > DEPTH.GLANCE) return;

  open(meal).catch(() => { inFlightKey = null; });
}

/** The last recipe this put on the wall, or null. For __v3(). */
export function lastDinner() {
  return last;
}

export function initDinner({ enabled = false } = {}) {
  if (!enabled || timer) return null;

  timer = setInterval(tick, TICK_MS);
  tick();

  /* Drive dinner without waiting for six o'clock. Mirrors the incumbent's
     window.__recipePanel, which the audit notes record as `undefined` on the
     wall since the cutover — this is that hook coming back. */
  window.__v3Dinner = async (dish = null) => {
    if (dish) await warm(dish);
    const snap = voiceSnapshot();
    const shown = await showSubject({ id: "show.recipe" }, dish ? { ...snap, menu: dish } : snap);
    if (shown) setDepth(DEPTH.SUBJECT, "dinner", { holdMs: DINNER_HOLD_MS });
    return { shown: Boolean(shown), dish: dish ?? snap?.menu ?? null };
  };

  return timer;
}

/** Test seam — drops the tick and every memo so a spec starts cold. */
export function __resetDinner() {
  if (timer) { clearInterval(timer); timer = null; }
  inFlightKey = null;
  reshowAt = 0;
  warmed = new Set();
  nextRetryAt.clear();
  last = null;
}
