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
import { recognisedName } from "../src/js/services/personName.js";
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

/* Eufy's own placeholders, read off 14 days of live HA history (2026-10-03):
   134 × "Unknown Person", 134 × "No Person", 4 × "Greg". "Unknown Person" was
   missing from the old deny list, so the doorbell said
   "Unknown Person's here! Look who decided to grace us." */
test("Eufy's placeholders are not names; a recognised face is", () => {
  for (const junk of ["Unknown Person", "No Person", "unknown person", " No Person ", "unknown", "unavailable", "none", "", null, undefined]) {
    expect(recognisedName(junk), `${JSON.stringify(junk)} read as a name`).toBeNull();
  }
  expect(recognisedName("Greg")).toBe("Greg");
  expect(recognisedName(" Greg ")).toBe("Greg");

  // And the line it produces: a placeholder must take the name-free pool.
  const doorbell = locationFor("binary_sensor.doorbell_ringing");
  const line = alertLine(doorbell, recognisedName("Unknown Person"));
  expect(VISITOR_UNKNOWN_LINES).toContain(line);
  expect(line).not.toMatch(/Unknown Person/);
});

/* ── Variety ───────────────────────────────────────────────────────────────
   Owner, 2026-10-03: "keep hearing the same ones". Two causes — pools of 6
   against ~10 front-door detections a day, and a picker whose only rule was
   "not the same twice running", which permits A-B-A-B indefinitely. */

test("every line is heard once before any line is heard twice", () => {
  const doorbell = locationFor("binary_sensor.doorbell_ringing");
  const n = VISITOR_UNKNOWN_LINES.length;
  const rounds = 5;
  const drawn = Array.from({ length: n * rounds }, () => alertLine(doorbell, null));

  // Never the same line back to back — including across a refill.
  for (let i = 1; i < drawn.length; i++) {
    expect(drawn[i], `repeat at draw ${i}`).not.toBe(drawn[i - 1]);
  }

  // Other tests in this file draw from the same pool, so the run may start
  // mid-bag: the tail of one bag, four whole bags, the head of the next. Each
  // line therefore appears 4, 5 or 6 times — plain random does not hold that
  // across a whole pool (and A-B-A-B fails it outright).
  for (const line of VISITOR_UNKNOWN_LINES) {
    const count = drawn.filter((d) => d === line).length;
    expect(count, `"${line}" was drawn ${count} times in ${rounds} rounds`).toBeGreaterThanOrEqual(rounds - 1);
    expect(count, `"${line}" was drawn ${count} times in ${rounds} rounds`).toBeLessThanOrEqual(rounds + 1);
  }

  // And any window one pool long holds no line three times.
  for (let i = 0; i + n <= drawn.length; i++) {
    const window = drawn.slice(i, i + n);
    for (const line of new Set(window)) {
      expect(window.filter((d) => d === line).length).toBeLessThanOrEqual(2);
    }
  }
});

test("the seam between two bags never repeats a line", () => {
  // A fresh shuffle opens with the line that closed the last one 1 time in n.
  // 200 refills of a pool of 10 would hit that with near certainty (1 - 0.9^200)
  // if nothing kept the two ends apart.
  const gate = locationFor("binary_sensor.side_gate_person_detected");
  const total = INTRUDER_UNKNOWN_LINES.length * 200;
  let previous = alertLine(gate, null);
  for (let i = 0; i < total; i++) {
    const line = alertLine(gate, null);
    expect(line, `repeat at draw ${i}`).not.toBe(previous);
    previous = line;
  }
});

test("the pools are big enough to last a day, and every line obeys the house rules", () => {
  const words = (s) => s.split(/\s+/).filter((w) => /[A-Za-z]/.test(w)).length;
  const pools = {
    visitorUnknown: VISITOR_UNKNOWN_LINES,
    intruderUnknown: INTRUDER_UNKNOWN_LINES,
    visitorKnown: VISITOR_KNOWN_LINES.map((t) => t("Sam")),
    intruderKnown: INTRUDER_KNOWN_LINES.map((t) => t("Sam"))
  };

  for (const [name, lines] of Object.entries(pools)) {
    expect(lines.length, `${name} is too small to feel varied`).toBeGreaterThanOrEqual(10);
    expect(new Set(lines).size, `${name} has a duplicate line`).toBe(lines.length);
    for (const line of lines) {
      // VOICE.md mechanics: at most one "!", and short enough to say at a door.
      expect((line.match(/!/g) ?? []).length, line).toBeLessThanOrEqual(1);
      expect(words(line), `too long to speak: ${line}`).toBeLessThanOrEqual(12);
    }
  }

  // VOICE.md rule 7 — security is information first: WHERE, in plain words.
  // (A NAMED face at the front door is exempt, as it always was: "Ooh, it's
  // Sam. Get the good biscuits out." — the name is the information.)
  for (const line of pools.visitorUnknown) {
    expect(line, `does not say where: ${line}`).toMatch(/front door/i);
  }
  for (const line of [...pools.intruderUnknown, ...pools.intruderKnown]) {
    expect(line, `does not say where: ${line}`).toMatch(/side/i);
  }
  for (const line of pools.visitorKnown) expect(line).toContain("Sam");
  for (const line of pools.intruderKnown) expect(line).toContain("Sam");

  // The door most often heard gets the deepest pool (~10 detections a day).
  expect(pools.visitorUnknown.length).toBeGreaterThanOrEqual(20);
});

/* The pools were rewritten against docs/design/CHARACTER.md on 2026-10-03 after
   the owner caught the old costume coming back in new lines ("we are slipping
   back into the Kath & Kim personality which I thought we veto'd"). These are
   that page's rules, as literals, against every line the door can say. */
test("the door speaks as the house, not in the retired costume", () => {
  const every = [
    ...VISITOR_UNKNOWN_LINES,
    ...INTRUDER_UNKNOWN_LINES,
    ...VISITOR_KNOWN_LINES.map((t) => t("Sam")),
    ...INTRUDER_KNOWN_LINES.map((t) => t("Sam"))
  ];
  expect(every.length).toBeGreaterThanOrEqual(50);

  const banned = [
    // Borrowed flavour — "not zany … no catchphrases … never quotes anything".
    [/\b(hun|noice|gorgeous|ooh|biscuits|cushions|glamour|squiz)\b|different, unusual|look at moi/i, "the retired costume"],
    // "Not a mate."
    [/\b(mate|ya)\b/i, "matey"],
    // "It never announces a pattern" — and it was never handed one.
    [/as usual|per usual|right on cue|creature of habit|as always|never the front|again\b/i, "a pattern nobody handed it"],
    // A particular it cannot know: most alerts are person_detected, not a ring,
    // and nothing here knows what was planned or who was expected.
    // There is no porch at this house (owner, 2026-10-03) — the lines said so twice.
    [/doorbell|knock|porch|did not plan|expected|\bhome\b/i, "an invented particular"],
    // Mechanics.
    [/!!|\.\.\.|…/, "punctuation the house does not use"]
  ];
  for (const line of every) {
    for (const [pattern, why] of banned) {
      expect(line, `${why}: ${line}`).not.toMatch(pattern);
    }
    expect(line, `ALL CAPS word: ${line}`).not.toMatch(/\b[A-Z]{3,}\b/);
  }

  // The fact first: an unknown-visitor line opens on who/where, never on a
  // reaction ("Ooh —", "Company!").
  for (const line of [...VISITOR_UNKNOWN_LINES, ...INTRUDER_UNKNOWN_LINES]) {
    expect(line, `opens with a reaction, not the fact: ${line}`)
      .toMatch(/^(Someone's|There's|A person|A visitor|Front door —|Side gate —)/);
  }
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
