/* The robot vacuum's run: where it is and where it has been, for the house plan
   on the wall (features.v3RobotPlan, src/v3/core/robot-layer.js).

   Kept here and not in the page, because "where's the vacuum" wants the path
   from before anyone asked, and the page may have reloaded since.

   Armed by ROBOT_VACUUM_ENTITY in .env (the Ecovacs vacuum's entity id). Unset:
   nothing is polled and the route 404s. Positions are the robot's own map
   millimetres; the page owns the mapping onto the plate, which is private. */

import { normalizeBaseUrl } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch.js";

// shortcut: a guess at a rate the Ecovacs cloud tolerates (no documented limit); slow it if calls start failing.
const SAMPLE_MS = 10_000;
const MIN_STEP_MM = 150;     // a robot scrubbing one spot is one point, not sixty
const MAX_POINTS = 1500;
const OUT = new Set(["cleaning", "returning", "paused", "error"]);

export const emptyTrack = () => ({ state: null, startedAt: null, endedAt: null, robot: null, dock: null, trail: [] });

/**
 * One reading folded into the run. Pure.
 *
 * A run starts and ends only on a change this process SAW. The first reading,
 * and an entity coming back from `unavailable`, are the server finding out what
 * is true: Home Assistant re-stamps every entity on a restart, and that is not
 * the robot leaving its dock.
 */
export function stepTrack(track, { state, robot = null, dock = null, at }) {
  if (!state || state === "unavailable" || state === "unknown") return track;

  const was = track.state;
  const next = { ...track, state, robot: robot ?? track.robot, dock: dock ?? track.dock };

  if (state === "cleaning" && was && !OUT.has(was)) {
    next.startedAt = at;
    next.endedAt = null;
    next.trail = [];
  }
  if (state === "docked" && OUT.has(was)) next.endedAt = at;

  if (robot && (OUT.has(state) || OUT.has(was))) {
    const last = next.trail.at(-1);
    if (!last || Math.hypot(robot[0] - last[0], robot[1] - last[1]) >= MIN_STEP_MM) {
      next.trail = [...next.trail, robot];
      // Halve rather than drop the start: the whole shape of the run is the point.
      if (next.trail.length > MAX_POINTS) next.trail = next.trail.filter((_, i) => i % 2 === 0);
    }
  }
  return next;
}

/** `{ x, y, invalid }` from the robot, as `[x, y]`, or null. Pure. */
export function point(pos) {
  return pos && !pos.invalid && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? [pos.x, pos.y] : null;
}

let track = emptyTrack();
let timer = null;

async function sample({ base, token, entity }) {
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const res = await fetchWithTimeout(`${base}/api/states/${entity}`, { headers });
  if (!res.ok) return;
  const { state } = await res.json();

  // The reading that ends a run still wants its last position, and the dock is only ever learned here.
  let data = null;
  if (OUT.has(state) || OUT.has(track.state) || !track.dock) {
    const pos = await fetchWithTimeout(
      `${base}/api/services/ecovacs/raw_get_positions?return_response`,
      { method: "POST", headers, body: JSON.stringify({ entity_id: entity }) },
      20_000
    );
    if (pos.ok) data = (await pos.json())?.service_response?.[entity]?.resp?.body?.data ?? null;
  }

  track = stepTrack(track, { state, robot: point(data?.deebotPos), dock: point(data?.chargePos?.[0]), at: Date.now() });
}

export function startRobotTrack() {
  const entity = (process.env.ROBOT_VACUUM_ENTITY || "").trim();
  const base = normalizeBaseUrl(process.env.HA_HOST || process.env.HA_URL);
  const token = (process.env.HA_TOKEN || "").trim().replace(/^"|"$/g, "");
  if (timer || !/^vacuum\.[a-z0-9_]+$/.test(entity) || !base || !token) return false;

  // A missed reading is a gap in the trail and nothing more.
  const run = () => sample({ base, token, entity }).catch(() => {});
  timer = setInterval(run, SAMPLE_MS);
  timer.unref?.();
  run();
  return true;
}

/** The run so far, or null when no robot is configured on this box. */
export const robotTrack = () => (timer ? track : null);
