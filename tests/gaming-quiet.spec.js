import { test, expect } from "@playwright/test";

import { selectForMode, QUIET_MIN_SCORE, MODE } from "../src/js/services/attentionRank.js";
import { isGamingQuiet } from "../src/js/services/quietMode.js";
import { updateEntity, __resetEntities } from "../src/js/services/homeAssistant/state.js";
import { collectSources } from "../src/js/services/candidateSources.js";

// Pure unit tests — attentionRank has no imports and no DOM by design.
//
// Quiet mode holds the chatty end of the queue while someone is gaming. The
// tests that matter most here are the NEGATIVE ones: what quiet must never reach.

const candidate = (id, score, extra = {}) => ({
  id, score, source: id, text: id, cooldownMs: 0, ...extra
});

const ids = (list) => list.map((c) => c.id);

// A realistic spread across the documented bands.
const queue = () => [
  candidate("bom-warning", 95, { interrupt: true }),   // Interrupt
  candidate("leave-by", 84),                            // High
  candidate("bin-last-chance", 68),                     // Medium
  candidate("bin-night", 50),                           // Medium
  candidate("camera-trigger", 45, { stackOnly: true }), // Low
  candidate("robot-problem", 44, { stackOnly: true }),  // Low
  candidate("tonights-menu", 40, { stackOnly: true })   // Low
];

test.describe("quiet mode — what it holds back", () => {
  test("off by default: the queue is untouched", () => {
    const loud = selectForMode(queue(), MODE.DWELL, {});
    const explicitlyOff = selectForMode(queue(), MODE.DWELL, { quiet: false });
    expect(ids(loud.stack)).toEqual(ids(explicitlyOff.stack));
    expect(loud.hero.id).toBe("bom-warning");
  });

  test("drops everything below the High band", () => {
    const { stack } = selectForMode(queue(), MODE.DWELL, { quiet: true });
    for (const c of stack) {
      expect(c.interrupt || c.score >= QUIET_MIN_SCORE).toBe(true);
    }
    expect(ids(stack)).not.toContain("tonights-menu");
    expect(ids(stack)).not.toContain("robot-problem");
    expect(ids(stack)).not.toContain("bin-night");
  });

  test("a storm warning is not chatter — Interrupt still gets through", () => {
    const { hero } = selectForMode(queue(), MODE.DWELL, { quiet: true });
    expect(hero.id).toBe("bom-warning");
  });

  test("'leave by' is not chatter either — High still gets through", () => {
    const withoutInterrupt = queue().filter((c) => !c.interrupt);
    const { hero } = selectForMode(withoutInterrupt, MODE.DWELL, { quiet: true });
    expect(hero.id).toBe("leave-by");
  });

  test("the band boundary is inclusive at exactly the High floor", () => {
    const edge = [candidate("edge-in", QUIET_MIN_SCORE), candidate("edge-out", QUIET_MIN_SCORE - 1)];
    const { stack } = selectForMode(edge, MODE.DWELL, { quiet: true });
    expect(ids(stack)).toEqual(["edge-in"]);
  });

  test("a quiet room with nothing High-band shows nothing at all", () => {
    const chatterOnly = queue().filter((c) => c.score < QUIET_MIN_SCORE);
    const { hero, stack } = selectForMode(chatterOnly, MODE.DWELL, { quiet: true });
    expect(hero).toBeNull();
    expect(stack).toEqual([]);
  });

  test("quiet composes with the presence floor rather than fighting it", () => {
    // AMBIENT is already interrupt-only; quiet must not widen it.
    const { stack } = selectForMode(queue(), MODE.AMBIENT, { quiet: true });
    expect(ids(stack)).toEqual(["bom-warning"]);
  });
});

/* ── WHO DECIDES `quiet` ────────────────────────────────────────────────────
   Everything above tests the CONSUMER: selectForMode's `quiet` parameter. For
   most of this feature's life nothing tested the thing that SETS it, so
   isGamingQuiet() could have returned a constant — or ignored the flag entirely
   — and every test here stayed green. Found by mutation sweep 2026-09-19: both
   `if (!features.gamingQuiet) return false` and the entity read survived being
   deleted.

   That matters more than an ordinary gap, because flag-off is this feature's
   documented ROLLBACK PATH. A rollback nothing asserts is not a rollback.

   isGamingQuiet() reads `window.CONFIG` and the module-level HA cache, so the
   window is stood up here rather than in a browser — the function has no DOM in
   it, only those two globals.
─────────────────────────────────────────────────────────────────────────── */

const GAMING_ENTITY = "binary_sensor.gaming_hub_someone_is_gaming";

function withHouse({ flag, gaming }, fn) {
  const hadWindow = "window" in globalThis;
  const prev = globalThis.window;
  globalThis.window = { CONFIG: { features: { gamingQuiet: flag } } };
  __resetEntities();
  if (gaming !== null) updateEntity({ entity_id: GAMING_ENTITY, state: gaming });
  try {
    return fn();
  } finally {
    __resetEntities();
    if (hadWindow) globalThis.window = prev;
    else delete globalThis.window;
  }
}

test.describe("quiet mode — the half that decides it", () => {
  test("the flag OFF is the rollback: the sensor is not even consulted", () => {
    expect(withHouse({ flag: false, gaming: "on" }, isGamingQuiet)).toBe(false);
  });

  test("the flag ON and the room gaming is the only combination that quiets", () => {
    expect(withHouse({ flag: true, gaming: "on" }, isGamingQuiet)).toBe(true);
  });

  test("the flag ON and nobody gaming leaves the queue alone", () => {
    expect(withHouse({ flag: true, gaming: "off" }, isGamingQuiet)).toBe(false);
  });

  test("an absent or unavailable sensor is not 'gaming'", () => {
    // The hub can drop off the network. Missing must read as quiet-OFF, never as
    // quiet-ON — the failure mode of the second is a wall that silently stops
    // saying anything below the High band and never says why.
    expect(withHouse({ flag: true, gaming: null }, isGamingQuiet)).toBe(false);
    expect(withHouse({ flag: true, gaming: "unavailable" }, isGamingQuiet)).toBe(false);
    expect(withHouse({ flag: true, gaming: "unknown" }, isGamingQuiet)).toBe(false);
  });

  test("it reads THAT entity, not any gaming-ish one", () => {
    const wrongId = () => {
      globalThis.window = { CONFIG: { features: { gamingQuiet: true } } };
      __resetEntities();
      updateEntity({ entity_id: "binary_sensor.someone_is_gaming", state: "on" });
      try { return isGamingQuiet(); } finally { __resetEntities(); delete globalThis.window; }
    };
    expect(wrongId()).toBe(false);
  });

  test("it never throws, whatever the house hands it", () => {
    // Called on every attention tick; a throw here would take the hero with it.
    const noWindow = () => {
      const had = "window" in globalThis;
      const prev = globalThis.window;
      delete globalThis.window;
      try { return isGamingQuiet(); } finally { if (had) globalThis.window = prev; }
    };
    expect(noWindow()).toBe(false);
  });
});

test.describe("quiet mode — the boundary that must never move", () => {
  test("the doorbell never becomes a candidate, so quiet cannot reach it", () => {
    /* Structural guard, not a threshold one. doorbellAlert.js drives the camera
       popup, its TTS and the screen wake DIRECTLY; a ring never becomes an
       attention candidate. If someone ever routes the doorbell through the
       queue, this is the test that should make them think twice — a ring must
       not be silenceable by a games console.

       ⚠ THIS USED TO ASSERT OVER ITS OWN FIXTURE. It built `queue()` from seven
       literals, none of them a doorbell, and then checked that none of them was
       a doorbell — a tautology that no change to any source file could ever
       turn red. It now runs the REAL adapter list against a house where the
       doorbell IS ringing, which is the claim the comment above was always
       making. */
    __resetEntities();
    for (const entity_id of [
      "binary_sensor.doorbell_ringing",
      "binary_sensor.front_door_person_detected"
    ]) updateEntity({ entity_id, state: "on", attributes: { device_class: "problem" } });

    try {
      const produced = collectSources({ now: Date.now() });
      const text = produced.map((c) => `${c.id} ${c.source} ${c.text ?? ""}`).join(" | ");
      expect(
        /doorbell|person-detected|person detected/i.test(text),
        `a ring reached the attention queue as: ${text}`
      ).toBe(false);
    } finally {
      __resetEntities();
    }
  });
});
