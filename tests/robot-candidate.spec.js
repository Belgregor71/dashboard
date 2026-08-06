import { test, expect } from "@playwright/test";

import { robotAttentionFrom, robotCandidate, collectSources } from "../src/js/services/candidateSources.js";

// Pure unit tests — candidateSources carries no DOM and no imports by design.
//
// Entity shapes below are copied from the live house (2026-08-06), including the
// `piano_room_` prefix the dock sensors actually carry: that prefix is exactly why
// selection is by device_class rather than by entity id.

const entities = (overrides = {}) => ({
  "binary_sensor.roborock_s7_maxv_water_shortage": {
    state: "off", attributes: { device_class: "problem" }
  },
  "binary_sensor.piano_room_roborock_s7_maxv_dock_dirty_water_box": {
    state: "off", attributes: { device_class: "problem" }
  },
  "binary_sensor.piano_room_roborock_s7_maxv_dock_clean_water_box": {
    state: "off", attributes: { device_class: "problem" }
  },
  // Not a problem sensor — must never be read as one however it is set.
  "binary_sensor.roborock_s7_maxv_cleaning": {
    state: "on", attributes: { device_class: "running" }
  },
  "binary_sensor.roborock_s7_maxv_mop_attached": {
    state: "on", attributes: { device_class: "connectivity" }
  },
  "sensor.roborock_s7_maxv_main_brush_time_left": { state: "120", attributes: { device_class: "duration" } },
  "sensor.roborock_s7_maxv_filter_time_left": { state: "60", attributes: { device_class: "duration" } },
  // An unrelated house entity, to prove the scan is robot-scoped.
  "binary_sensor.doorbell_ringing": { state: "on", attributes: { device_class: "problem" } },
  ...overrides
});

test.describe("robotAttentionFrom — what actually needs a human", () => {
  test("a healthy robot reports nothing", () => {
    expect(robotAttentionFrom(entities())).toEqual({ problems: [], consumables: [] });
  });

  test("picks up a problem sensor that is ON, prefix and all", () => {
    const { problems } = robotAttentionFrom(entities({
      "binary_sensor.piano_room_roborock_s7_maxv_dock_dirty_water_box": {
        state: "on", attributes: { device_class: "problem" }
      }
    }));
    expect(problems).toEqual(["dirty tank needs emptying"]);
  });

  test("ignores ON sensors whose device_class is not 'problem'", () => {
    // `cleaning` and `mop_attached` are both ON in the fixture by design.
    expect(robotAttentionFrom(entities()).problems).toEqual([]);
  });

  test("never reads non-robot entities, even a problem-class one that is on", () => {
    // The doorbell fixture is device_class problem AND on.
    expect(robotAttentionFrom(entities()).problems).toEqual([]);
  });

  test("a negative time_left is an overdue consumable", () => {
    const { consumables } = robotAttentionFrom(entities({
      "sensor.roborock_s7_maxv_main_brush_time_left": { state: "-5.98", attributes: {} },
      "sensor.roborock_s7_maxv_filter_time_left": { state: "-2.83", attributes: {} }
    }));
    expect(consumables).toEqual(["filter", "main brush"]); // sorted for a stable id
  });

  test("unknown/unavailable is NOT overdue", () => {
    // NaN must not read as negative — a missing reading is not a due one.
    const { consumables } = robotAttentionFrom(entities({
      "sensor.roborock_s7_maxv_filter_time_left": { state: "unknown", attributes: {} },
      "sensor.roborock_s7_maxv_main_brush_time_left": { state: "unavailable", attributes: {} }
    }));
    expect(consumables).toEqual([]);
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
    expect(c.text).toBe("Roborock — clean tank needs filling and dirty tank needs emptying.");
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
