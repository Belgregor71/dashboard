// Per-camera motion divergence detector.
//
// WHY THIS EXISTS, precisely. The house-wide `motion` canary in healthService
// asks "is the eufy pipeline alive at all", and ANY one camera firing answers
// yes. That is the right question for a total outage and the wrong one for a
// partial. On 2026-08-08 four of nine cameras (kitchen, side gate, piano room,
// tilt-pan) stopped delivering while the driveway, doorbell, patio, front yard
// and backyard carried on. The canary stayed green for 22 hours, the recovery
// log stayed empty, and the kitchen is where V3 reads presence — so the wall
// sat at its resting photo with someone standing in front of it, and the two
// existing self-heal guards had no way to notice.
//
// THE RULE IS DIVERGENCE, NOT STALENESS. A watched camera is faulted when the
// REST of the house has produced enough events, over enough time, that this
// camera's silence stops being explicable. This is deliberately immune to the
// case a plain timeout gets wrong: an empty house produces no events anywhere,
// so nothing diverges and nobody is woken about a quiet holiday. A tighter
// staleMs cannot make that distinction at any value.
//
// ⚠ The thresholds below are a deliberately conservative STARTING POINT, not a
// measurement. The per-camera table is published on /api/system/health so they
// can be tuned against real numbers — do that before tightening them.

/* The house has to be demonstrably busy AND the camera quiet for a while.
   Both bars must clear: a burst of driveway events inside ten minutes is not
   evidence about the kitchen, and neither is a slow afternoon. */
export const WARN_EVENTS = 12;
export const WARN_MIN_MS = 90 * 60 * 1000;
export const ERROR_EVENTS = 30;
export const ERROR_MIN_MS = 4 * 60 * 60 * 1000;

const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_EVENTS = 1000; // hard ceiling; this process runs for weeks

/* `\w` includes `_`, so the greedy group backtracks to the last `_motion_` /
   `_person_` boundary: side_gate_motion_detected → "side_gate". */
export const MOTION_ENTITY_RE = /^binary_sensor\.(\w+)_(?:motion|person)_detected$/;

/**
 * Which cameras are worth this check. NOT every camera: the piano room and
 * tilt-pan are deliberately absent for the same reason recoveryService leaves
 * them out of its switch re-arming — nothing on the dashboard depends on them,
 * so a fault there is noise rather than news.
 *
 * `gateOnOccupancy` marks a camera whose silence is only meaningful when
 * someone is actually home. The kitchen is the one that matters: with the house
 * empty, outdoor cameras still fire on cars, wind and cats while the kitchen
 * correctly sees nothing, and without this gate that ordinary afternoon reads
 * as a fault. Outdoor cameras need no such gate — they fire regardless.
 */
const DEFAULT_WATCHED = [
  { id: "kitchen", label: "Kitchen", gateOnOccupancy: true },
  { id: "side_gate", label: "Side gate", gateOnOccupancy: false },
  { id: "doorbell", label: "Doorbell", gateOnOccupancy: false }
];

export function watchedCameras() {
  const raw = process.env.MOTION_COVERAGE_CAMERAS;
  if (!raw) return DEFAULT_WATCHED;
  return raw
    .split(",")
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      // "kitchen:occupancy" opts a camera into the occupancy gate.
      const [id, flag] = chunk.split(":");
      return { id, label: id, gateOnOccupancy: flag === "occupancy" };
    });
}

export function cameraIdFor(entityId) {
  const match = MOTION_ENTITY_RE.exec(entityId || "");
  return match ? match[1] : null;
}

export function formatAge(ms) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

/**
 * Pure verdict for one camera, exported so the ladder is testable without a
 * tracker, a clock or a live socket.
 */
export function cameraLevel({ silentMs, elsewhere }) {
  if (elsewhere >= ERROR_EVENTS && silentMs >= ERROR_MIN_MS) return "error";
  if (elsewhere >= WARN_EVENTS && silentMs >= WARN_MIN_MS) return "warn";
  return "ok";
}

export function createCoverageTracker({ watched = watchedCameras(), startedAt = Date.now() } = {}) {
  const houseEvents = []; // ascending [{ at, camera }]
  const lastSeen = new Map(); // cameraId → ts of its most recent `on` edge

  function prune(now) {
    const cutoff = now - RETENTION_MS;
    let drop = 0;
    while (drop < houseEvents.length && houseEvents[drop].at < cutoff) drop += 1;
    if (drop) houseEvents.splice(0, drop);
    if (houseEvents.length > MAX_EVENTS) houseEvents.splice(0, houseEvents.length - MAX_EVENTS);
  }

  return {
    /** A real `on` edge arrived. Returns the camera id, or null if not a camera. */
    noteEvent(entityId, at = Date.now()) {
      const camera = cameraIdFor(entityId);
      if (!camera) return null;
      houseEvents.push({ at, camera });
      const previous = lastSeen.get(camera);
      if (!previous || at > previous) lastSeen.set(camera, at);
      prune(at);
      return camera;
    },

    /**
     * Seed a camera's last-seen from HA's boot snapshot. COLD START ONLY.
     *
     * ⚠ Seeds `lastSeen` ONLY — deliberately never `houseEvents`. The snapshot
     * stamps every entity at one moment, and an eufy container restart does
     * exactly the same thing (all 18 sensors re-registered at 22:40:42 on
     * 2026-08-08). Replaying those as discrete house events would fabricate a
     * burst of activity that never happened and hand every other camera a
     * divergence it did not earn.
     *
     * ⚠⚠ AND IT MUST NEVER OVERWRITE WHAT THIS PROCESS ALREADY WATCHED. A
     * snapshot arrives on every HA reconnect, not just at boot, and
     * `last_changed` on a re-registered entity is an `unavailable` → `off`
     * REGISTRY event, not a house event: it proves the integration restarted
     * and says nothing about whether the camera delivered. Taking the newer of
     * the two therefore let a re-registration reset the silence clock on a
     * camera that had been dead for weeks.
     *
     * Measured 2026-09-04: HA returned from a NAS swap-livelock and re-stamped
     * kitchen, side_gate, piano_room, tilt_pan and backyard within 35 ms of
     * each other. The wall then reported "Kitchen silent 45h" for a camera with
     * ZERO on-edges in seven days of history — and because `silentMs` had
     * dropped to zero, `cameraLevel()` (which needs 90 min / 4 h AND a dozen
     * events elsewhere) would have read `ok` on a permanently dead camera for
     * at least the next 90 minutes. A detector written because a green canary
     * hid four dead cameras had grown a green window of its own.
     *
     * `noteEvent` is the only thing allowed to move a camera forward, and
     * healthService only calls it on a genuine `on` edge. This is the same rule
     * one level up: evidence of delivery, or nothing.
     */
    seed(entityId, at) {
      const camera = cameraIdFor(entityId);
      if (!camera || !Number.isFinite(at)) return null;
      if (lastSeen.has(camera)) return camera;
      lastSeen.set(camera, at);
      return camera;
    },

    /**
     * @param occupancy "home" | "away" | "unknown"
     *
     * ⚠ Only a confident "away" suppresses the occupancy-gated cameras.
     * "unknown" still evaluates — absent is not empty, and this codebase has
     * produced that bug five times. Failing towards silence here would rebuild
     * the exact hole this detector was written to close.
     */
    evaluate({ now = Date.now(), occupancy = "unknown" } = {}) {
      const cameras = watched.map(({ id, label, gateOnOccupancy }) => {
        const last = lastSeen.get(id) ?? startedAt;
        const silentMs = Math.max(0, now - last);
        const elsewhere = houseEvents.reduce(
          (count, event) => (event.camera !== id && event.at > last ? count + 1 : count),
          0
        );
        const skipped = Boolean(gateOnOccupancy) && occupancy === "away";
        return {
          id,
          label,
          silentMs,
          elsewhere,
          skipped,
          level: skipped ? "ok" : cameraLevel({ silentMs, elsewhere })
        };
      });

      const rank = { ok: 0, warn: 1, error: 2 };
      const worst = cameras.reduce(
        (acc, camera) => (rank[camera.level] > rank[acc.level] ? camera : acc),
        { level: "ok" }
      );

      if (worst.level === "ok") {
        return { level: "ok", detail: null, cameras };
      }
      const detail =
        `${worst.label} silent ${formatAge(worst.silentMs)} ` +
        `while ${worst.elsewhere} motion events arrived from other cameras`;
      return { level: worst.level, detail, cameras };
    },

    /** Test/diagnostic seam — the raw table without a verdict. */
    snapshot() {
      return {
        houseEvents: houseEvents.length,
        lastSeen: Object.fromEntries(lastSeen)
      };
    }
  };
}
