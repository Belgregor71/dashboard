import { on, emit } from "./eventBus.js";
import { set as setContext } from "./contextStore.js";

// The presence FSM — the "spine" of the Home OS reframe (docs/vision/phase-1).
// It observes signals the app already produces and names the mode the display
// is in. Phase 1 drives only AMBIENT<->GLANCE from real signals; DWELL is
// emitted but has no consumer yet (Phase 2), and VOICE is dormant (Phase 4).
//
// Screensaver stays authoritative for Mode 0 (AMBIENT): this module observes
// its enter/exit rather than owning the idle logic, which keeps Phase 1
// surgical and fully reversible via the feature flag.

export const MODES = {
  AMBIENT: "ambient", // nobody near — screensaver / night clock
  GLANCE: "glance",   // motion or interaction — display is awake
  DWELL: "dwell",     // sustained presence (30s+) — emitted, dormant in P1
  VOICE: "voice"      // conversational — dormant until Phase 4
};

const DWELL_MS = 30_000;
const KITCHEN_MOTION = new Set([
  "binary_sensor.kitchen_motion_detected",
  "binary_sensor.kitchen_person_detected"
]);

let mode = MODES.GLANCE; // the dashboard is visibly awake at boot
let dwellTimer = null;
let enabled = false;

function clearDwell() {
  clearTimeout(dwellTimer);
  dwellTimer = null;
}

function armDwell() {
  clearDwell();
  dwellTimer = setTimeout(() => {
    dwellTimer = null;
    // Dormant in Phase 1: emitted for Phase 2's lean-in reveal to consume.
    setMode(MODES.DWELL, "dwell-timeout");
  }, DWELL_MS);
}

export function getMode() {
  return mode;
}

export function setMode(next, reason = "") {
  if (!enabled || next === mode) return;
  const prev = mode;
  mode = next;
  document.body.dataset.presence = next;
  setContext({ presence: next });
  emit("presence:changed", { mode: next, prev, reason });
}

export function initPresence(options = {}) {
  enabled = options.enabled === true;
  if (!enabled) return; // flag off → exact pre-Phase-1 behaviour

  document.body.dataset.presence = mode;
  setContext({ presence: mode });

  // Mode 0 boundary: screensaver is the authority. Its enter/exit emit this.
  on("screensaver:changed", ({ active }) => {
    if (active) {
      clearDwell();
      setMode(MODES.AMBIENT, "screensaver-on");
    } else {
      setMode(MODES.GLANCE, "screensaver-off");
      armDwell();
    }
  });

  // Kitchen motion keeps the presence clock warm. When ambient, screensaver's
  // own handler exits and emits screensaver:changed (which drives us to
  // GLANCE) — so here we only record the signal and, if already awake, make
  // sure a dwell countdown is running.
  document.addEventListener("ha:state-updated", (event) => {
    const entity = event.detail;
    if (!KITCHEN_MOTION.has(entity?.entity_id) || entity?.state !== "on") return;
    setContext({ lastMotionAt: Date.now() });
    if (mode === MODES.GLANCE && dwellTimer === null) armDwell();
  });

  // Debug/verification hook — matches __switchView / __forceInsight so the
  // presence tier can be driven from the Pi over CDP.
  window.__presence = (forced) => {
    if (forced) setMode(forced, "debug");
    return { mode, enabled };
  };
}
