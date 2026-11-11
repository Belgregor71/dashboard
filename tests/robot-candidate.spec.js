import { test, expect } from "@playwright/test";

import { robotAttentionFrom, robotCandidate, collectSources } from "../src/js/services/candidateSources.js";

// Pure unit tests — candidateSources carries no DOM and no imports by design.
//
// Entity shapes below are copied from the live house (2026-11-11, Ecovacs T80S),
// including the `piano_room_deebot` object id every one of its entities carries:
// the robot's sensors are found from the vacuum's own id, not a brand name.

const entities = (overrides = {}) => ({
  "vacuum.piano_room_deebot": { state: "docked", attributes: {} },
  "binary_sensor.piano_room_deebot_mop_attached": { state: "on", attributes: {} },
  "sensor.piano_room_deebot_station_state": { state: "idle", attributes: { device_class: "enum" } },
  "sensor.piano_room_deebot_battery": { state: "0", attributes: { device_class: "battery" } },
  "sensor.piano_room_deebot_main_brush_lifespan": { state: "99.14", attributes: {} },
  "sensor.piano_room_deebot_filter_lifespan": { state: "97.85", attributes: {} },
  // The live house has one of these at `unknown`.
  "sensor.piano_room_deebot_unit_care_lifespan": { state: "unknown", attributes: {} },
  // Somebody else's spent lifespan, to prove the scan is robot-scoped.
  "sensor.printer_drum_lifespan": { state: "0", attributes: {} },
  ...overrides
});

test.describe("robotAttentionFrom — what actually needs a human", () => {
  test("a healthy robot reports nothing", () => {
    // The fixture holds a flat battery, an unknown lifespan and a printer's
    // spent drum: none of them is the robot asking for anything.
    expect(robotAttentionFrom(entities())).toEqual({ problems: [], consumables: [] });
  });

  test("a vacuum in error has stopped and needs a hand", () => {
    const { problems } = robotAttentionFrom(entities({
      "vacuum.piano_room_deebot": { state: "error", attributes: {} }
    }));
    expect(problems).toEqual(["stopped and needs a hand"]);
  });

  test("cleaning, returning and docked are not problems", () => {
    for (const state of ["cleaning", "returning", "docked", "idle", "paused", "unavailable"]) {
      expect(robotAttentionFrom(entities({ "vacuum.piano_room_deebot": { state, attributes: {} } })).problems).toEqual([]);
    }
  });

  test("a lifespan at zero is a spent consumable, named from its own id", () => {
    const { consumables } = robotAttentionFrom(entities({
      "sensor.piano_room_deebot_main_brush_lifespan": { state: "0", attributes: {} },
      "sensor.piano_room_deebot_filter_lifespan": { state: "0.0", attributes: {} }
    }));
    expect(consumables).toEqual(["filter", "main brush"]); // sorted for a stable id
  });

  test("unknown, unavailable and empty are NOT spent", () => {
    // A missing reading is not a due one, and "" must not coerce to zero.
    const { consumables } = robotAttentionFrom(entities({
      "sensor.piano_room_deebot_filter_lifespan": { state: "unknown", attributes: {} },
      "sensor.piano_room_deebot_main_brush_lifespan": { state: "unavailable", attributes: {} },
      "sensor.piano_room_deebot_side_brush_lifespan": { state: "", attributes: {} }
    }));
    expect(consumables).toEqual([]);
  });

  test("a house with no vacuum reports nothing, whatever else is spent", () => {
    const { "vacuum.piano_room_deebot": _gone, ...rest } = entities({
      "sensor.piano_room_deebot_filter_lifespan": { state: "0", attributes: {} }
    });
    expect(robotAttentionFrom(rest)).toEqual({ problems: [], consumables: [] });
  });

  test("survives junk input", () => {
    expect(robotAttentionFrom(null)).toEqual({ problems: [], consumables: [] });
    expect(robotAttentionFrom({})).toEqual({ problems: [], consumables: [] });
  });
});

test.describe("robotCandidate — a chore, and it stays one", () => {
  test("returns null when nothing needs doing", () => {
    expect(robotCandidate({ robotProblems: [], robotConsumables: [] })).toBeNull();
    expect(robotCandidate()).toBeNull();
  });

  test("a problem outranks a consumable and both stay in the low band", () => {
    const problem = robotCandidate({ robotProblems: ["water tank's empty"], robotConsumables: ["filter"] });
    const consumable = robotCandidate({ robotProblems: [], robotConsumables: ["filter"] });

    expect(problem.score).toBeGreaterThan(consumable.score);
    for (const c of [problem, consumable]) {
      expect(c.score).toBeGreaterThanOrEqual(40);
      expect(c.score).toBeLessThan(50); // Low band — never Medium, never Interrupt
    }
  });

  test("NEVER takes the centred hero", () => {
    // A water tank interrupting the room is exactly what this must not do.
    const c = robotCandidate({ robotProblems: ["water tank's empty"] });
    expect(c.stackOnly).toBe(true);
    expect(c.interrupt).toBeUndefined();
  });

  test("carries no expiresAt — it is a state, not an event", () => {
    // A camera trigger decays because it happened. A dirty tank stays dirty.
    const c = robotCandidate({ robotProblems: ["dirty tank needs emptying"] });
    expect(c.expiresAt).toBeUndefined();
  });

  test("reads as a sentence when several things need doing", () => {
    const c = robotCandidate({
      robotProblems: ["clean tank needs filling", "dirty tank needs emptying"]
    });
    expect(c.text).toBe("The vacuum — clean tank needs filling and dirty tank needs emptying.");
  });

  test("the id tracks WHICH problem, so a new one is not swallowed by the old cooldown", () => {
    const a = robotCandidate({ robotProblems: ["water tank's empty"] });
    const b = robotCandidate({ robotProblems: ["dirty tank needs emptying"] });
    expect(a.id).not.toBe(b.id);
  });
});

test.describe("collectSources integration", () => {
  test("the robot rides the shared queue like any other source", () => {
    const found = collectSources({ robotProblems: ["water tank's empty"], robotConsumables: [] });
    expect(found.some((c) => c.source === "robot")).toBe(true);
  });

  test("flag-off state (nulls) contributes no candidate", () => {
    // focusHero passes null for both when features.robotCandidate is off.
    const found = collectSources({ robotProblems: null, robotConsumables: null });
    expect(found.some((c) => c.source === "robot")).toBe(false);
  });
});
