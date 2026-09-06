import { test, expect } from "@playwright/test";
import { getBomWarnings } from "../src/js/services/weather/bom.js";
import { bomCandidate, bomWarningTier } from "../src/js/services/candidateSources.js";
import { rankQueue, selectForMode, MODE } from "../src/js/services/attentionRank.js";

/* ── Not every BOM warning is a storm ─────────────────────────────────────────
   Every fixture below is the LIVE payload read off sensor.nudgee_warnings at
   2026-09-06 08:20 AEST, when a minor marine advisory for the whole of
   Queensland was hero on the wall at score 95 / interrupt, holding depth 1 with
   nobody in the room and a next-best candidate of 44.

   The regression these guard is not "the number went down". It is that the
   warning STOPS SURVIVING AN EMPTY ROOM — AMBIENT filters to interrupt-only, so
   the `interrupt` half is what actually clears the wall. A suite that asserted
   only the score would pass against a change that does nothing on the glass. */

const LIVE_MARINE_WARNING = {
  id: "QLD_MW013_IDQ20085",
  area_id: "QLD_MW013",
  type: "marine_wind_warning",
  title: "Marine Wind Warning for Queensland",
  short_title: "Marine Wind Warning",
  state: "QLD",
  warning_group_type: "minor",
  issue_time: "2026-09-05T17:00:00Z",
  expiry_time: "2026-09-06T00:00:00Z",
  phase: "renewal"
};

const SEVERE_LAND_WARNING = {
  id: "QLD_SEV_IDQ20031",
  area_id: "QLD_PW014",
  type: "severe_thunderstorm_warning",
  title: "Severe Thunderstorm Warning for Brisbane",
  state: "QLD",
  warning_group_type: "severe",
  expiry_time: "2026-09-06T09:00:00Z"
};

const statesWith = (...warnings) => ({
  "sensor.nudgee_warnings": {
    entity_id: "sensor.nudgee_warnings",
    state: String(warnings.length),
    attributes: { friendly_name: "Nudgee Warnings", warnings }
  }
});

/* ── The reader keeps what BOM said ──────────────────────────────────────── */

test("getBomWarnings preserves type, severity and area, not just the title", () => {
  const { summary, top, details } = getBomWarnings(statesWith(LIVE_MARINE_WARNING));

  expect(summary).toBe("Marine Wind Warning for Queensland");
  expect(details).toHaveLength(1);
  // Each field is asserted by VALUE. A shape-only check ("top is an object")
  // passes against a reader that carries the keys through empty.
  expect(top).toMatchObject({
    title: "Marine Wind Warning for Queensland",
    type: "marine_wind_warning",
    groupType: "minor",
    areaId: "QLD_MW013",
    state: "QLD"
  });
});

test("a string-form warning yields a summary but no detail — absence, not a guess", () => {
  // Some integrations publish bare strings. There is no severity to read, so
  // `top` must be null and the ladder must fall back to the old behaviour
  // rather than invent a tier from the wording of the title.
  const { summary, top, details } = getBomWarnings(statesWith("Flood Warning for the Brisbane River"));

  expect(summary).toBe("Flood Warning for the Brisbane River");
  expect(details).toEqual([]);
  expect(top).toBeNull();
});

test("`details` is not index-aligned with `messages` and `top` still finds the structured one", () => {
  const { messages, details, top } = getBomWarnings(statesWith("A bare string", LIVE_MARINE_WARNING));

  expect(messages).toHaveLength(2);
  expect(details).toHaveLength(1);
  expect(top.type).toBe("marine_wind_warning");
});

/* ── The ladder ───────────────────────────────────────────────────────────── */

test("the tier ladder reads BOM's own severity", () => {
  expect(bomWarningTier({ type: "severe_thunderstorm_warning", groupType: "severe" }))
    .toEqual({ score: 95, interrupt: true });
  expect(bomWarningTier({ type: "flood_warning", groupType: "moderate" }))
    .toEqual({ score: 75, interrupt: false });
  expect(bomWarningTier({ type: "flood_warning", groupType: "minor" }))
    .toEqual({ score: 45, interrupt: false });
});

test("a marine warning is demoted at EVERY severity — the house is not a boat", () => {
  // The one that matters: severe, and still demoted. A ladder that only checked
  // `groupType` would hand a severe marine warning the whole wall.
  expect(bomWarningTier({ type: "marine_wind_warning", groupType: "severe" }))
    .toEqual({ score: 45, interrupt: false });
  expect(bomWarningTier({ type: "marine_gale_warning", groupType: "moderate" }))
    .toEqual({ score: 45, interrupt: false });
});

test("unknown or absent severity keeps the interrupt default — absence is never 'safe'", () => {
  expect(bomWarningTier(null)).toEqual({ score: 95, interrupt: true });
  expect(bomWarningTier({ type: "some_new_bom_type", groupType: "" }))
    .toEqual({ score: 95, interrupt: true });
  expect(bomWarningTier({ type: "fire_danger", groupType: "catastrophic" }))
    .toEqual({ score: 95, interrupt: true });
});

/* ── The flag, in both directions ─────────────────────────────────────────── */

test("flag OFF: the live marine warning is byte-identical to before", () => {
  const { summary, top } = getBomWarnings(statesWith(LIVE_MARINE_WARNING));
  const c = bomCandidate({ bomWarning: summary, bomWarningDetail: top });

  expect(c.score).toBe(95);
  expect(c.interrupt).toBe(true);
  expect(c.text).toBe("Marine Wind Warning for Queensland");
});

test("flag ON: the live marine warning is demoted out of the interrupt band", () => {
  const { summary, top } = getBomWarnings(statesWith(LIVE_MARINE_WARNING));
  const c = bomCandidate({ bomWarning: summary, bomWarningDetail: top, bomSeverity: true });

  expect(c.score).toBe(45);
  expect(c.interrupt).toBe(false);
  // Still a candidate, and still says the same thing — this is a demotion, not
  // a suppression. It reads at the wall; it just no longer seizes it.
  expect(c.text).toBe("Marine Wind Warning for Queensland");
});

test("flag ON: a severe LAND warning still takes the wall", () => {
  const { summary, top } = getBomWarnings(statesWith(SEVERE_LAND_WARNING));
  const c = bomCandidate({ bomWarning: summary, bomWarningDetail: top, bomSeverity: true });

  expect(c.score).toBe(95);
  expect(c.interrupt).toBe(true);
});

/* ── What it actually does on the glass ───────────────────────────────────── */

const heroInAmbient = (candidate) => {
  const queue = rankQueue([candidate], new Date("2026-09-06T08:20:00+10:00"));
  return selectForMode(queue, MODE.AMBIENT, { now: new Date("2026-09-06T08:20:00+10:00") }).hero;
};

test("AMBIENT: the demoted marine warning no longer lights an empty room", () => {
  const { summary, top } = getBomWarnings(statesWith(LIVE_MARINE_WARNING));

  // Before: the only interrupt candidate in the house, so it won an empty room.
  const before = heroInAmbient(bomCandidate({ bomWarning: summary, bomWarningDetail: top }));
  expect(before, "flag-off must still reproduce the defect").not.toBeNull();
  expect(before.id).toBe("bom:Marine Wind Warning for Queensland");

  // After: AMBIENT filters to interrupt-only, so dropping `interrupt` is what
  // clears the wall. Demoting the SCORE alone would leave this assertion red.
  const after = heroInAmbient(
    bomCandidate({ bomWarning: summary, bomWarningDetail: top, bomSeverity: true })
  );
  expect(after).toBeNull();
});

test("AMBIENT: a severe land warning still breaks through with the flag on", () => {
  const { summary, top } = getBomWarnings(statesWith(SEVERE_LAND_WARNING));
  const hero = heroInAmbient(
    bomCandidate({ bomWarning: summary, bomWarningDetail: top, bomSeverity: true })
  );

  expect(hero, "a storm must still reach a wall nobody is standing at").not.toBeNull();
  expect(hero.text).toBe("Severe Thunderstorm Warning for Brisbane");
});
