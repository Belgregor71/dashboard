/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

import { getEntity } from "./homeAssistant/state.js";

// Quiet mode — "someone is in the middle of something, don't chatter at them".
//
// Lives in its own module deliberately: both the attention engine and the
// personality runtime need it, and the attention engine already imports
// collectDelight FROM the personality runtime, so putting it in either one would
// close an import cycle.
//
// What it does NOT reach is the point. Quiet only ever filters attention
// CANDIDATES and rationed delight. The doorbell and the security cameras drive
// their popup, their TTS and the screen wake directly from doorbellAlert.js and
// never enter the attention queue at all — so no value here can silence the
// front door. That is structural, not a threshold choice.

const GAMING_ENTITY = "binary_sensor.gaming_hub_someone_is_gaming";

/** True when the room is busy gaming AND the flag is on. Never throws. */
export function isGamingQuiet() {
  try {
    if (!window.CONFIG?.features?.gamingQuiet) return false;
    return getEntity(GAMING_ENTITY)?.state === "on";
  } catch {
    return false;
  }
}
