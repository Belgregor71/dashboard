import { test, expect } from "@playwright/test";

import { selectForMode, QUIET_MIN_SCORE, MODE } from "../src/js/services/attentionRank.js";

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

test.describe("quiet mode — the boundary that must never move", () => {
  test("the doorbell is not in this queue at all, so quiet cannot reach it", () => {
    // Structural guard, not a threshold one. doorbellAlert.js drives the camera
    // popup, its TTS and the screen wake DIRECTLY; a ring never becomes an
    // attention candidate. If someone ever routes the doorbell through the queue,
    // this test is the thing that should make them think twice — a ring must not
    // be silenceable by a games console.
    const everything = selectForMode(queue(), MODE.DWELL, { quiet: true });
    const sources = ids(everything.stack).concat(ids(queue()));
    expect(sources.some((id) => /doorbell|ring|person-detected/i.test(id))).toBe(false);
  });
});
