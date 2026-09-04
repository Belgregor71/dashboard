import { test, expect } from "@playwright/test";

import {
  cameraIdFor,
  cameraLevel,
  createCoverageTracker,
  WARN_EVENTS,
  WARN_MIN_MS,
  ERROR_EVENTS,
  ERROR_MIN_MS
} from "../server/services/motionCoverage.js";
import { occupancyFrom } from "../server/services/healthService.js";

// The incident this exists for (2026-08-08): four of nine cameras — kitchen,
// side gate, piano room, tilt-pan — stopped delivering while five carried on.
// The house-wide canary is satisfied by ANY camera firing, so it stayed green
// for 22 hours and the self-heal log stayed empty. The kitchen is where V3
// reads presence, so the wall ignored a person standing in front of it.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const T0 = Date.parse("2026-08-08T00:00:00Z");

const KITCHEN_ONLY = [{ id: "kitchen", label: "Kitchen", gateOnOccupancy: true }];
const HOUSE = [
  { id: "kitchen", label: "Kitchen", gateOnOccupancy: true },
  { id: "side_gate", label: "Side gate", gateOnOccupancy: false }
];

/** Fire `count` events from a camera, spread evenly across `spanMs`. */
function burst(tracker, camera, count, startAt, spanMs) {
  const step = spanMs / Math.max(1, count);
  for (let i = 0; i < count; i += 1) {
    tracker.noteEvent(`binary_sensor.${camera}_motion_detected`, startAt + Math.round(i * step));
  }
}

test.describe("cameraIdFor — the name out of the entity", () => {
  test("single-word and underscored camera names both resolve", () => {
    // `\w` includes `_`, so the greedy group has to backtrack to the LAST
    // _motion_/_person_ boundary or side_gate comes back as "side".
    expect(cameraIdFor("binary_sensor.kitchen_motion_detected")).toBe("kitchen");
    expect(cameraIdFor("binary_sensor.side_gate_motion_detected")).toBe("side_gate");
    expect(cameraIdFor("binary_sensor.piano_room_person_detected")).toBe("piano_room");
    expect(cameraIdFor("binary_sensor.doorbell_person_detected")).toBe("doorbell");
  });

  test("anything that is not a camera edge is null", () => {
    // The ring carries no camera name and is deliberately not a motion edge.
    expect(cameraIdFor("binary_sensor.doorbell_ringing")).toBeNull();
    expect(cameraIdFor("sensor.kitchen_person_name")).toBeNull();
    expect(cameraIdFor("switch.kitchen_motion_detection")).toBeNull();
    expect(cameraIdFor("")).toBeNull();
    expect(cameraIdFor(undefined)).toBeNull();
  });
});

test.describe("cameraLevel — BOTH bars must clear", () => {
  test("a busy house alone is not evidence", () => {
    // 40 events inside ten minutes is one car in the driveway, and says
    // nothing about the kitchen.
    expect(cameraLevel({ silentMs: 10 * MINUTE, elsewhere: 40 })).toBe("ok");
  });

  test("a long quiet alone is not evidence either", () => {
    // The whole point: an empty house is silent everywhere. A timeout at any
    // value gets this case wrong; divergence does not.
    expect(cameraLevel({ silentMs: 12 * HOUR, elsewhere: 0 })).toBe("ok");
  });

  test("the ladder", () => {
    expect(cameraLevel({ silentMs: WARN_MIN_MS, elsewhere: WARN_EVENTS })).toBe("warn");
    expect(cameraLevel({ silentMs: WARN_MIN_MS - 1, elsewhere: WARN_EVENTS })).toBe("ok");
    expect(cameraLevel({ silentMs: WARN_MIN_MS, elsewhere: WARN_EVENTS - 1 })).toBe("ok");
    expect(cameraLevel({ silentMs: ERROR_MIN_MS, elsewhere: ERROR_EVENTS })).toBe("error");
  });
});

test.describe("the tracker reproduces the incident", () => {
  test("kitchen frozen while the house is busy → error, naming the camera", () => {
    const tracker = createCoverageTracker({ watched: HOUSE, startedAt: T0 });
    tracker.seed("binary_sensor.kitchen_motion_detected", T0);
    tracker.seed("binary_sensor.side_gate_motion_detected", T0);

    // Six hours of ordinary activity from the cameras that kept working.
    burst(tracker, "driveway", 20, T0 + MINUTE, 6 * HOUR);
    burst(tracker, "front_yard", 20, T0 + 2 * MINUTE, 6 * HOUR);

    const result = tracker.evaluate({ now: T0 + 6 * HOUR, occupancy: "home" });
    expect(result.level).toBe("error");
    expect(result.detail).toContain("Kitchen");
    expect(result.detail).toContain("6h");

    const kitchen = result.cameras.find((c) => c.id === "kitchen");
    expect(kitchen.elsewhere).toBe(40);
    expect(kitchen.level).toBe("error");
    // The side gate was in the frozen set too and must not be masked.
    expect(result.cameras.find((c) => c.id === "side_gate").level).toBe("error");
  });

  test("a camera that keeps firing stays ok through the same window", () => {
    const tracker = createCoverageTracker({ watched: HOUSE, startedAt: T0 });
    burst(tracker, "kitchen", 20, T0, 6 * HOUR);
    burst(tracker, "side_gate", 20, T0, 6 * HOUR);
    burst(tracker, "driveway", 40, T0, 6 * HOUR);

    expect(tracker.evaluate({ now: T0 + 6 * HOUR, occupancy: "home" }).level).toBe("ok");
  });
});

test.describe("the false positive a plain timeout cannot avoid", () => {
  test("an empty house is silent everywhere, so nothing diverges", () => {
    const tracker = createCoverageTracker({ watched: HOUSE, startedAt: T0 });
    // Nobody home, nothing moves, for a full day.
    expect(tracker.evaluate({ now: T0 + 24 * HOUR, occupancy: "away" }).level).toBe("ok");
    // ...and the same is true even if we cannot tell whether anyone is home.
    expect(tracker.evaluate({ now: T0 + 24 * HOUR, occupancy: "unknown" }).level).toBe("ok");
  });

  test("house empty, outdoor cameras busy with cars and cats → kitchen NOT faulted", () => {
    // This is the case that would have made the detector untrustworthy: with
    // everyone out, the driveway fires all afternoon while the kitchen
    // correctly sees nothing.
    const tracker = createCoverageTracker({ watched: KITCHEN_ONLY, startedAt: T0 });
    burst(tracker, "driveway", 60, T0, 8 * HOUR);

    expect(tracker.evaluate({ now: T0 + 8 * HOUR, occupancy: "away" }).level).toBe("ok");
    // ...and the moment someone is home, the same silence IS a fault.
    expect(tracker.evaluate({ now: T0 + 8 * HOUR, occupancy: "home" }).level).toBe("error");
  });

  test("unknown occupancy still evaluates — absent is not empty", () => {
    // Failing towards silence here would rebuild the exact hole this closes.
    const tracker = createCoverageTracker({ watched: KITCHEN_ONLY, startedAt: T0 });
    burst(tracker, "driveway", 60, T0, 8 * HOUR);
    expect(tracker.evaluate({ now: T0 + 8 * HOUR, occupancy: "unknown" }).level).toBe("error");
  });

  test("an outdoor camera is never occupancy-gated", () => {
    const tracker = createCoverageTracker({
      watched: [{ id: "side_gate", label: "Side gate", gateOnOccupancy: false }],
      startedAt: T0
    });
    burst(tracker, "driveway", 60, T0, 8 * HOUR);
    expect(tracker.evaluate({ now: T0 + 8 * HOUR, occupancy: "away" }).level).toBe("error");
  });
});

test.describe("seed does not fabricate activity", () => {
  test("a container restart re-stamps every sensor and must not count as events", () => {
    // 2026-08-08 22:40:42 — all 18 sensors re-registered at one instant. If
    // those were replayed as house events, every camera would be handed a
    // divergence it did not earn the moment the restart's neighbours seeded.
    const tracker = createCoverageTracker({ watched: HOUSE, startedAt: T0 });
    for (const camera of ["kitchen", "side_gate", "driveway", "doorbell", "patio", "backyard"]) {
      tracker.seed(`binary_sensor.${camera}_motion_detected`, T0);
      tracker.seed(`binary_sensor.${camera}_person_detected`, T0);
    }
    expect(tracker.snapshot().houseEvents).toBe(0);
    expect(tracker.evaluate({ now: T0 + 5 * HOUR, occupancy: "home" }).level).toBe("ok");
  });

  /* 2026-09-04. HA came back from a NAS swap-livelock and re-registered every
     eufy sensor at one instant — kitchen, side_gate, piano_room, tilt_pan and
     backyard all stamped within 35 ms. A snapshot arrives on every RECONNECT,
     not just at boot, so the seed overwrote 18 days of correct observation and
     the wall reported "Kitchen silent 45h" for a camera with ZERO on-edges in
     seven days of HA history. Worse than the wrong number: silentMs had gone
     back to zero, and cameraLevel needs 90 min AND a dozen events elsewhere —
     so the detector would have read `ok` on a dead camera for the next 90
     minutes, every time HA restarted. */
  test("an HA reconnect re-stamps every sensor and must NOT reset the silence clock", () => {
    const tracker = createCoverageTracker({ watched: HOUSE, startedAt: T0 });
    tracker.seed("binary_sensor.kitchen_motion_detected", T0);
    tracker.seed("binary_sensor.side_gate_motion_detected", T0);

    burst(tracker, "driveway", 20, T0 + MINUTE, 6 * HOUR);
    burst(tracker, "front_yard", 20, T0 + 2 * MINUTE, 6 * HOUR);
    const reconnect = T0 + 6 * HOUR;
    expect(tracker.evaluate({ now: reconnect, occupancy: "home" }).level).toBe("error");

    // HA restarts. Every sensor re-registers at one instant, dead ones included.
    for (const camera of ["kitchen", "side_gate", "driveway", "front_yard"]) {
      tracker.seed(`binary_sensor.${camera}_motion_detected`, reconnect);
      tracker.seed(`binary_sensor.${camera}_person_detected`, reconnect);
    }

    // The kitchen has still never delivered. The fault must survive the restart.
    const after = tracker.evaluate({ now: reconnect + MINUTE, occupancy: "home" });
    expect(after.level).toBe("error");
    expect(after.detail).toContain("Kitchen");
    expect(after.detail).toContain("6h");
    expect(tracker.snapshot().lastSeen.kitchen).toBe(T0);
  });

  /* The other direction, and it is not symmetric bookkeeping — refusing to seed
     at all is the tempting over-correction and it reopens the same 90-minute
     hole from the other side, on every deploy instead of every HA restart. */
  test("but a COLD start must still seed, or every deploy blinds the detector", () => {
    const startedAt = T0 + 6 * HOUR;
    const tracker = createCoverageTracker({ watched: KITCHEN_ONLY, startedAt });
    // The process knows nothing yet; HA's snapshot says six hours ago.
    tracker.seed("binary_sensor.kitchen_motion_detected", T0);
    expect(tracker.snapshot().lastSeen.kitchen).toBe(T0);

    burst(tracker, "driveway", 40, startedAt, MINUTE);
    // Without the seed, lastSeen falls back to startedAt and reads one minute
    // of silence — a dead camera looking healthy because we just restarted.
    expect(tracker.evaluate({ now: startedAt + MINUTE, occupancy: "home" }).level).toBe("error");
  });

  test("seed ignores an unparseable timestamp rather than stamping the epoch", () => {
    // new Date(null) is the epoch and sails past a finite check — the trap
    // that captioned an undated photo "56 years ago".
    const tracker = createCoverageTracker({ watched: KITCHEN_ONLY, startedAt: T0 });
    expect(tracker.seed("binary_sensor.kitchen_motion_detected", NaN)).toBeNull();
    expect(tracker.snapshot().lastSeen.kitchen).toBeUndefined();
  });
});

test.describe("bounded for a page that runs for weeks", () => {
  test("the event log prunes past its retention window", () => {
    const tracker = createCoverageTracker({ watched: KITCHEN_ONLY, startedAt: T0 });
    burst(tracker, "driveway", 400, T0, 48 * HOUR);
    const { houseEvents } = tracker.snapshot();
    expect(houseEvents).toBeGreaterThan(0);
    // 48h of events at a 24h retention: roughly half survive, never all.
    expect(houseEvents).toBeLessThan(400);
  });
});

test.describe("occupancyFrom — tri-state on purpose", () => {
  test("someone home", () => {
    expect(occupancyFrom([{ entity_id: "person.greg", state: "home" }])).toBe("home");
  });

  test("everyone confidently out", () => {
    expect(
      occupancyFrom([
        { entity_id: "person.greg", state: "not_home" },
        { entity_id: "person.brett", state: "not_home" }
      ])
    ).toBe("away");
  });

  test("no person entities at all is UNKNOWN, not away", () => {
    expect(occupancyFrom([])).toBe("unknown");
    expect(occupancyFrom([{ entity_id: "sensor.kitchen_person_name", state: "No Person" }])).toBe(
      "unknown"
    );
  });

  test("a tracker reporting unavailable is not an empty house", () => {
    expect(
      occupancyFrom([
        { entity_id: "person.greg", state: "not_home" },
        { entity_id: "person.brett", state: "unavailable" }
      ])
    ).toBe("unknown");
  });
});

test.describe("health contract", () => {
  test("GET /api/system/health carries the coverage feed and the per-camera table", async ({
    request
  }) => {
    const res = await request.get("/api/system/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    const feed = body.feeds.find((f) => f.id === "motionCoverage");
    expect(feed).toBeTruthy();
    expect(feed.label).toBe("Motion coverage");
    expect(["ok", "warn", "error"]).toContain(feed.level);

    // Published so the thresholds can be tuned from real numbers.
    expect(Array.isArray(body.motionCoverage)).toBe(true);
    for (const camera of body.motionCoverage) {
      expect(typeof camera.id).toBe("string");
      expect(typeof camera.silentMs).toBe("number");
      expect(typeof camera.elsewhere).toBe("number");
      expect(["ok", "warn", "error"]).toContain(camera.level);
    }
  });
});
