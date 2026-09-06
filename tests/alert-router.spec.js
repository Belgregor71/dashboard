import { test, expect } from "@playwright/test";
import {
  LOCATIONS,
  ALERT_COOLDOWN_MS,
  locationFor,
  isActiveState,
  alertLine,
  routeAlert,
  DROP_INACTIVE,
  DROP_STALE,
  DROP_COOLDOWN
} from "../src/js/services/alertRouter.js";
import {
  VISITOR_KNOWN_LINES,
  VISITOR_UNKNOWN_LINES,
  INTRUDER_KNOWN_LINES,
  INTRUDER_UNKNOWN_LINES
} from "../src/js/config/alertLines.js";

/* The shared alert decision, in plain node. Extracted from doorbellAlert.js at
   V3 migration step 3.1 so the incumbent and V3 cannot disagree about which door
   is which — which matters more here than anywhere else in the migration,
   because the two pools are "a visitor" and "an intruder" and getting them the
   wrong way round is not a cosmetic bug.

   The entity-cache reads (`knownPersonName`) are covered on a page in
   tests/v3-alerts.spec.js; everything else is pure and belongs here. */

const at = (iso) => ({ last_changed: iso });
const ring = (over = {}) => ({
  entity_id: "binary_sensor.doorbell_ringing",
  state: "on",
  ...over
});

test("the two doors are the two doors, and nothing else is a trigger", () => {
  expect(locationFor("binary_sensor.doorbell_ringing").prefix).toBe("doorbell");
  expect(locationFor("binary_sensor.doorbell_person_detected").prefix).toBe("doorbell");
  expect(locationFor("binary_sensor.side_gate_person_detected").prefix).toBe("side_gate");

  // Ordinary camera motion is NOT an alert. It reaches the surface as a scored
  // candidate through candidateSources, or it does not reach it at all — the
  // difference between the front door and the driveway at 3pm is the whole
  // reason this table is a fixed list rather than a pattern.
  expect(locationFor("binary_sensor.driveway_motion_detected")).toBeNull();
  expect(locationFor("binary_sensor.kitchen_motion_detected")).toBeNull();
  expect(locationFor("")).toBeNull();
  expect(locationFor(undefined)).toBeNull();
});

test("every location names a camera that the subject mount can actually show", () => {
  // V3 mounts /api/camera/{camera}/live off this field. A location whose camera
  // id does not exist would announce a visitor over a broken image.
  for (const location of LOCATIONS) {
    expect(typeof location.camera, `${location.prefix} has no camera`).toBe("string");
    expect(location.camera.length).toBeGreaterThan(0);
    expect(location.triggerEntities.length).toBeGreaterThan(0);
    expect(location.personNameEntity).toMatch(/^sensor\./);
  }
});

test("ringing and on are happening; off is not", () => {
  expect(isActiveState("on")).toBe(true);
  expect(isActiveState("ringing")).toBe(true);
  expect(isActiveState("RINGING")).toBe(true);
  expect(isActiveState("off")).toBe(false);
  expect(isActiveState("unavailable")).toBe(false);
  expect(isActiveState(null)).toBe(false);
});

test("the visitor pool and the intruder pool never cross", () => {
  const doorbell = locationFor("binary_sensor.doorbell_ringing");
  const gate = locationFor("binary_sensor.side_gate_person_detected");

  expect(doorbell.unknownLines).toBe(VISITOR_UNKNOWN_LINES);
  expect(doorbell.knownLines).toBe(VISITOR_KNOWN_LINES);
  expect(gate.unknownLines).toBe(INTRUDER_UNKNOWN_LINES);
  expect(gate.knownLines).toBe(INTRUDER_KNOWN_LINES);

  // Drawn many times, a doorbell line never comes out of the intruder pool.
  const intruderStrings = new Set(
    [...INTRUDER_UNKNOWN_LINES].filter((l) => typeof l === "string")
  );
  for (let i = 0; i < 60; i++) {
    expect(intruderStrings.has(alertLine(doorbell, null))).toBe(false);
  }
});

test("a name resolves the template; no name takes the name-free pool", () => {
  const doorbell = locationFor("binary_sensor.doorbell_ringing");

  // Name-free lines are plain strings BECAUSE the server pre-warms them into the
  // TTS cache — a template that slipped into the unknown pool would be a cache
  // miss on the one line that has to play instantly.
  for (const entry of VISITOR_UNKNOWN_LINES) expect(typeof entry).toBe("string");

  const named = alertLine(doorbell, "Sam");
  expect(typeof named).toBe("string");
  expect(named.length).toBeGreaterThan(0);
});

test("a location that isn't one says nothing at all", () => {
  expect(alertLine(null)).toBeNull();
  expect(alertLine(undefined, "Sam")).toBeNull();
});

test("the boot snapshot's stuck sensor is not somebody at the door", () => {
  /* ⚠ The one that would actually have hurt. The opening SSE frame replays every
     entity in the house including any binary_sensor sitting `on` since this
     morning — presence.js hit exactly this shape and faked someone in the
     kitchen at every load. Here it would announce a visitor and take the wall to
     depth 3 on every single page load. */
  const now = Date.parse("2026-08-08T18:00:00Z");
  const stale = ring(at("2026-08-08T09:14:00Z"));
  const fresh = ring(at("2026-08-08T17:59:50Z"));

  expect(routeAlert(stale, { now, minFreshMs: 30_000 })).toBeNull();
  expect(routeAlert(fresh, { now, minFreshMs: 30_000 })).not.toBeNull();

  // No window asked for → no freshness opinion. That is the incumbent's path and
  // it must keep working: it listens on the document re-broadcast, which it only
  // starts hearing after its own boot.
  expect(routeAlert(stale, { now })).not.toBeNull();

  // A missing last_changed is what a genuine push event looks like, so it is
  // treated as live rather than dropped.
  expect(routeAlert(ring(), { now, minFreshMs: 30_000 })).not.toBeNull();
});

test("one ring per location per cooldown, and the two doors are independent", () => {
  const now = Date.parse("2026-08-08T18:00:00Z");
  const cooldowns = new Map();

  expect(routeAlert(ring(), { now, cooldowns })).not.toBeNull();
  // Rung again a second later: the same visitor pressing twice is one event.
  expect(routeAlert(ring(), { now: now + 1000, cooldowns })).toBeNull();
  // The person sensor is the same location, so it is suppressed too.
  expect(routeAlert(
    { entity_id: "binary_sensor.doorbell_person_detected", state: "on" },
    { now: now + 2000, cooldowns }
  )).toBeNull();

  // The side gate is a different door and is not covered by the doorbell's quiet.
  expect(routeAlert(
    { entity_id: "binary_sensor.side_gate_person_detected", state: "on" },
    { now: now + 2000, cooldowns }
  )).not.toBeNull();

  // And it comes back once the cooldown is spent.
  expect(routeAlert(ring(), { now: now + ALERT_COOLDOWN_MS + 1, cooldowns })).not.toBeNull();
});

/* ── The drop reason, because one bucket could not accuse anything ──────────
   The census read doorbell 252 dropped / 108 routed and that number is
   unreadable: `inactive` fires on the off-edge after every ring, so a perfectly
   healthy doorbell out-drops its own routes roughly 2:1. Only `cooldown` means a
   real event did not reach the screen. These assert the three causes are told
   apart AND that the fourth null stays silent — a light switch must not be
   counted as a dropped alert. */
test("a dropped alert says which of the three drops it was", () => {
  const now = Date.parse("2026-08-08T18:00:00Z");

  const reasons = [];
  const onDrop = (r) => reasons.push(r);

  // 1. off-edge → inactive
  expect(routeAlert(ring({ state: "off" }), { now, onDrop })).toBeNull();
  expect(reasons).toEqual(["inactive"]);

  // 2. older than the freshness window → stale
  reasons.length = 0;
  expect(routeAlert(
    ring(at("2026-08-08T09:14:00Z")),
    { now, minFreshMs: 30_000, onDrop }
  )).toBeNull();
  expect(reasons).toEqual(["stale"]);

  // 3. suppressed duplicate → cooldown. The FIRST ring routes and reports nothing.
  reasons.length = 0;
  const cooldowns = new Map();
  expect(routeAlert(ring(), { now, cooldowns, onDrop })).not.toBeNull();
  expect(reasons, "a routed alert must not report a drop").toEqual([]);
  expect(routeAlert(ring(), { now: now + 1000, cooldowns, onDrop })).toBeNull();
  expect(reasons).toEqual(["cooldown"]);
});

test("an entity that is not a door is not a dropped alert", () => {
  const now = Date.parse("2026-08-08T18:00:00Z");
  const reasons = [];

  expect(routeAlert(
    { entity_id: "light.kitchen_bench", state: "off" },
    { now, onDrop: (r) => reasons.push(r) }
  )).toBeNull();
  // Every light, sensor and media player in the house passes through here on
  // every SSE frame. Counting them would bury the doorbell.
  expect(reasons, "a non-trigger entity was counted as a dropped alert").toEqual([]);
});

test("the drop reasons are the three the census records, and routeAlert still returns null", () => {
  // Guards the contract both callers and every other test in this file rely on:
  // the reason rides out of band, the return value stays falsy.
  expect([DROP_INACTIVE, DROP_STALE, DROP_COOLDOWN]).toEqual(["inactive", "stale", "cooldown"]);
  expect(routeAlert(ring({ state: "off" }), { now: Date.now() })).toBeNull();
});

test("a sensor going off is not an event, and does not spend the cooldown", () => {
  const now = Date.parse("2026-08-08T18:00:00Z");
  const cooldowns = new Map();

  expect(routeAlert(ring({ state: "off" }), { now, cooldowns })).toBeNull();
  expect(cooldowns.size, "an ignored update armed a cooldown").toBe(0);
  // ...so the ring that follows it a moment later still announces.
  expect(routeAlert(ring(), { now: now + 500, cooldowns })).not.toBeNull();
});
