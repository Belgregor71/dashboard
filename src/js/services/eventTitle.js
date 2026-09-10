/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   THE PLAIN TITLE — what a calendar event is called, with the scaffolding off.

   Some calendar titles carry a prefix the household types so that CODE can find
   the event: "Meal: " is how tonightsMenu, the recipe panel, houseSnapshot and
   mealEvent all locate dinner, and "Bill: " is how the incumbent's categoriser
   is told to draw 💵. Neither is something anybody should read on a 1920px wall.

   ⚠ SEEN ON THE WALL, 2026-09-09: the ambient glance read
   "📅 Bill: Ora due · Starts in 12 min". `Meal:` had already been fixed once
   (v3/subjects/calendar.js, 2026-08-08) — in ONE of the three places a raw
   title reaches the glass, with its own private regex. That is the shape of
   drift services/mealEvent.js exists to prevent, so this is the one home.

   ⚠⚠ THIS IS NOT "STRIP THE CATEGORY PREFIX", and the difference is the whole
   design. The incumbent strips any of ~20 category prefixes because it puts an
   ICON in the space it just cleared: "Flight: Brisbane to Gladstone" becomes
   "✈️ Brisbane to Gladstone" and loses nothing. V3's lists have no icon column,
   so the same strip would leave "Brisbane to Gladstone" — a title that no
   longer says what it is. Measured against the real calendar on 2026-09-10:
   Meal: ×104, Flight: ×24, Bill: ×5. Only the first two of those three are
   routing conventions; `Flight:` is simply what the event is called.

   So: authoring scaffolding comes off, description stays on. Adding a prefix
   here is a claim that the household types it FOR THE CODE, not for the glass.

   Pure, DOM-free, no imports — same contract as mealEvent.js, because
   voiceSnapshot is on the answer path and is unit-tested in plain node.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The prefixes the household types for routing, not for reading. */
export const AUTHORING_PREFIXES = ["meal", "bill"];

/* Case-insensitive on purpose: the live calendar contains "MEAL: spaghetti Bol"
   as well as "Meal: Satay Chicken", and a wall that shows the scaffolding on
   one and not the other reads like a bug because it is one.

   The separator is a colon, or a hyphen with space around it. A BARE hyphen is
   deliberately not accepted — "Meal-prep Sunday" is a title, not a prefix, and
   `[:\-]` (which the incumbent's categoriser uses) eats the front of it. */
export const AUTHORING_PREFIX = new RegExp(
  `^\\s*(?:${AUTHORING_PREFIXES.join("|")})\\s*(?::|\\s-\\s)\\s*`,
  "i"
);

/**
 * The event's name as a person should read it.
 *
 * ⚠ A prefix with nothing after it is a TITLE, not scaffolding. "Meal:" on its
 * own must render as "Meal:" — an empty row is worse than a scruffy one, and a
 * caller that gets "" here cannot tell it apart from an event with no title.
 *
 * @param {object} event  a calendar event ({ displayTitle?, title? })
 * @returns {string}      the plain name, or "" when there was never one
 */
export function plainTitle(event) {
  const raw = String(event?.displayTitle ?? event?.title ?? "");
  const stripped = raw.replace(AUTHORING_PREFIX, "").trim();
  return stripped || raw.trim();
}
