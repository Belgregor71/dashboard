/* ═══ THE DAY IN 20 SECONDS — what the replay may play (features.v3DayLapse) ═════
   Camera and world events only. The wall's log is already scrubbed of people, and
   beats here are rebuilt from a whitelist of sources, so an arrival row cannot ride
   through: "who came home at 3" stays out of a timed replay (phase-8's
   "aggregates-not-logs", the same rule as houseToday.js).

   ⚠ The log says what reached the WALL, not everything that happened: a dark panel
   logs nothing. So the replay shows what the house saw and never says what didn't
   happen.
   ═══════════════════════════════════════════════════════════════════════════ */

export const WINDOW_MS = 15 * 60_000;   // one camera, one pulse per window: 10-31 logged 172 triggers
export const MAX_BEATS = 40;

const WET = /rain|shower|storm|drizzle|hail/i;
const BIN_ID = /^bin-(night|last-chance|weather):/;

const cameraOf = (evidenceKey) => /^ha:binary_sensor\.(.+)_(motion|person)_detected$/.exec(evidenceKey ?? "")?.[1] ?? null;

// A trigger row can open long after the motion, and its id carries when the motion was.
function triggerAt(row) {
  const at = Number(String(row.id).split(":")[1]);
  return Number.isFinite(at) ? at : row.start;
}

/** @returns {Array<{at:number, kind:"camera"|"door"|"bins"|"sky", camera?:string, n?:number, to?:string}>} Pure. */
export function dayBeats(rows, world, { from, to }) {
  const events = [];
  const seen = new Set();
  for (const row of rows ?? []) {
    if (row?.shown === false || !Number.isFinite(row?.start) || seen.has(row.id)) continue;
    if (row.source === "cameraTrigger") {
      const camera = cameraOf(row.evidenceKey);
      if (!camera) continue;
      seen.add(row.id);
      events.push({ at: triggerAt(row), kind: "camera", camera });
    } else if (row.source === "doorbell") {
      // shortcut: this source is the reflex lane, so a side gate alert plays as the door; it logged 1 trigger in 33 days. Log the camera if that ever matters.
      events.push({ at: row.start, kind: "door" });
    } else if (BIN_ID.test(row.id ?? "")) {
      seen.add(row.id);
      events.push({ at: row.start, kind: "bins" });
    }
  }

  const held = new Map();   // camera or kind → the beat its window is open on
  const beats = [];
  for (const event of events.filter(({ at }) => at >= from && at <= to).sort((a, b) => a.at - b.at)) {
    const key = event.camera ?? event.kind;
    const beat = held.get(key);
    if (event.kind === "bins" && beat) continue;   // a night's reminders are one fact
    if (beat && event.at - beat.at < WINDOW_MS) {
      beat.n += 1;
      continue;
    }
    const next = { ...event, n: 1 };
    held.set(key, next);
    beats.push(next);
  }

  for (const entry of world ?? []) {
    if (entry.kind !== "condition" || !WET.test(entry.to) || WET.test(entry.from)) continue;
    if (entry.at >= from && entry.at <= to) beats.push({ at: entry.at, kind: "sky", to: entry.to });
  }

  // Only a quiet camera is ever dropped: the door, the bins and the sky are the day's story.
  const cameras = beats.filter((beat) => beat.kind === "camera").sort((a, b) => b.n - a.n);
  const spare = Math.max(0, MAX_BEATS - (beats.length - cameras.length));
  const dropped = new Set(cameras.slice(spare));
  return beats.filter((beat) => !dropped.has(beat)).sort((a, b) => a.at - b.at);
}
