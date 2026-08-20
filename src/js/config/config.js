/* ═══ INCUMBENT ONLY ════════════════════════════════════════════════════════
   V3 no longer imports this. It carried the shared-runtime marker until
   2026-08-13, when the commute addresses — the only thing V3 read from here —
   moved to the server's .env (server/routes/commute.js). What is left is
   WEATHER_LAT/WEATHER_LON and the incumbent's own tables, and six modules
   under / still import them.

   ⚠ The marker string itself is deliberately not spelled out above.
   tests/v3-closure.spec.js matches it literally, so even naming it in a comment
   explaining its removal re-flags the file — which is the guard being right.

   A stale shared-marker is worse than none: it protects a file that no longer
   needs protecting and teaches the next reader to distrust the rest. Removed
   deliberately, and tests/v3-closure.spec.js asserts both halves.
   ════════════════════════════════════════════════════════════════════════ */

// Nudgee, QLD — the suburb this dashboard reports on. Suburb centroid, not the
// house: this file is public and ships in the browser bundle.
export const WEATHER_LAT = -27.3691;
export const WEATHER_LON = 153.0847;

export const REFRESH_CALENDAR_MS = 5 * 60 * 1000;
export const REFRESH_WEATHER_MS = 15 * 60 * 1000;
export const REFRESH_CLOCK_MS = 1000;
export const BACKGROUND_INTERVAL = 5 * 60 * 1000;

export const MEAL_PREFIX = "MEAL:";

export const CALENDAR_SOURCES = [
  { id: "google", name: "Family", icsUrl: "/api/calendar/google", color: "#F5A623" },
  { id: "apple", name: "Home Calendar", icsUrl: "/api/calendar/apple", color: "#FF9500" },
  { id: "tripit", name: "Travel", icsUrl: "/api/calendar/tripit", color: "#50E3C2" }
];

export const EVENT_ICONS = {
  gym: "🏋️",
  flight: "✈️",
  airport: "🛫",
  doctor: "🩺",
  dentist: "🦷",
  meeting: "📅",
  birthday: "🎂",
  anniversary: "💍",
  school: "🏫",
  haircut: "💈",
  concert: "🎵",
  movie: "🎬",
  meal: "🍽️",
  travel: "🧳"
};

/* ⚠ THE COMMUTE ADDRESSES ARE GONE FROM HERE, ON PURPOSE.
   COMMUTE_ORIGIN was this house's street address, and it lived in a file that
   is tracked in a PUBLIC repository AND bundled to the browser — so it was
   readable in the repo, in dist/, and in the query string of every
   `/api/commute` request the wall made.

   They are `.env` values on the server now (COMMUTE_ORIGIN, COMMUTE_GREG_DEST,
   COMMUTE_BRETT_DEST, and the matching *_LABEL). The client asks for a leg BY
   NAME and gets back a label and a number: `/api/commute/all`, or
   `/api/commute?leg=greg`. See server/routes/commute.js.

   Do not reintroduce them. The route ignores a client-supplied `origin`
   entirely, so a caller that passed one would silently route from the wrong
   place rather than fail loudly. */
