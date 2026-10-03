/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by V3 (the wall). The incumbent that shared it was retired 2026-10-03.
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   PERSON NAME — what a Eufy `sensor.<camera>_person_name` actually says.

   The camera's face recognition reports through one text sensor, and that
   sensor is a NAME only some of the time. Read off the live HA history
   2026-10-03 (14 days, doorbell): 134 × "Unknown Person", 134 × "No Person",
   4 × "Greg". Neither placeholder had been on the old deny list ("no person",
   "unknown", …) in BOTH readers — so the doorbell announced
   "Unknown Person's here! Look who decided to grace us." and the voice lane
   could say a person named "No Person" was at the door.

   Pure and dependency-free on purpose: voiceSnapshot.js is imported by the
   server (houseStore, voiceShape) as well as the page, so this must not pull
   in the browser entity cache the way alertRouter.js does.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Every value the sensor uses for "nobody I know", lower-cased. */
const NOT_A_NAME = new Set([
  "",
  "no person",
  "unknown person",
  "unknown",
  "unavailable",
  "none",
  "null"
]);

/** The recognised person's name, or null when the sensor holds a placeholder. */
export function recognisedName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return NOT_A_NAME.has(name.toLowerCase()) ? null : name;
}
