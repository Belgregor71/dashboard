import { test, expect } from "@playwright/test";
import { warmOnce } from "../server/services/ttsWarmer.js";
import { collectAlertNames, nameSensorIds, MAX_ALERT_NAMES } from "../server/services/alertNames.js";
import {
  PREWARM_LINES,
  ALERT_TTS_RATE,
  VISITOR_KNOWN_LINES,
  INTRUDER_KNOWN_LINES,
  namedPrewarmLines
} from "../src/js/config/alertLines.js";
import { locationFor, alertLine } from "../src/js/services/alertRouter.js";

/* The named doorbell lines are pre-warmed, in plain node.

   Measured on the wall 2026-10-03: with the name wait on, "Greg's home!" was
   CHOSEN 0.6 s after the trigger and its WAV landed 10 s after — a cache miss
   paying a 6 s primary timeout plus fallback synthesis. The owner, standing at
   the door, never heard his name. The cure is the cache key: the warmer must
   synthesise EXACTLY the string, at exactly the rate, the wall will ask for. */

const recorder = () => {
  const calls = [];
  const synth = async (text, rate) => {
    calls.push({ text, rate });
    return { cached: false };
  };
  return { calls, synth };
};

test("every line the door can say about a recognised face is warmed, verbatim", async () => {
  const { calls, synth } = recorder();
  const result = await warmOnce({ synth, names: async () => ["Greg"] });

  const warmed = new Set(calls.map((c) => c.text));
  expect(calls.length).toBe(PREWARM_LINES.length + VISITOR_KNOWN_LINES.length + INTRUDER_KNOWN_LINES.length);
  expect(result).toEqual({ warmed: calls.length, named: 1 });

  // The cache key is sha256(text::rate) — one wrong rate and every entry misses.
  for (const c of calls) expect(c.rate).toBe(ALERT_TTS_RATE);

  // Not "some lines mentioning Greg": the exact strings the CLIENT produces.
  // alertLine() picks at random, so draw until both pools are exhausted.
  for (const trigger of ["binary_sensor.doorbell_person_detected", "binary_sensor.side_gate_person_detected"]) {
    const location = locationFor(trigger);
    const spoken = new Set();
    for (let i = 0; i < 300; i++) spoken.add(alertLine(location, "Greg"));
    expect(spoken.size, `${trigger}: the draw did not cover the pool`).toBe(location.knownLines.length);
    for (const line of spoken) {
      expect(line).toContain("Greg");
      expect(warmed.has(line), `not warmed: ${line}`).toBe(true);
    }
  }
});

test("nobody recognisable → only the name-free pool, exactly as before", async () => {
  const { calls, synth } = recorder();
  const result = await warmOnce({ synth, names: async () => [] });
  expect(calls.map((c) => c.text)).toEqual(PREWARM_LINES);
  expect(result).toEqual({ warmed: PREWARM_LINES.length, named: 0 });
});

test("Home Assistant being down costs the names, never the ring", async () => {
  const { calls, synth } = recorder();
  const result = await warmOnce({ synth, names: async () => { throw new Error("HA 502"); } });
  expect(calls.map((c) => c.text)).toEqual(PREWARM_LINES);
  expect(result.named).toBe(0);
});

test("Kokoro being down does not go and ask who lives here", async () => {
  let asked = 0;
  const result = await warmOnce({
    synth: async () => { throw new Error("ECONNREFUSED"); },
    names: async () => { asked += 1; return ["Greg"]; }
  });
  expect(asked).toBe(0);
  expect(result).toEqual({ warmed: 0, named: 0 });
});

test("namedPrewarmLines is every template for every name, and nothing for no one", () => {
  expect(namedPrewarmLines([])).toEqual([]);
  expect(namedPrewarmLines(undefined)).toEqual([]);
  const lines = namedPrewarmLines(["Greg", "Sam"]);
  expect(lines.length).toBe(2 * (VISITOR_KNOWN_LINES.length + INTRUDER_KNOWN_LINES.length));
  expect(lines.filter((l) => l.includes("Greg")).length).toBe(lines.length / 2);
  expect(lines.filter((l) => l.includes("Sam")).length).toBe(lines.length / 2);
});

/* ── Who the cameras can recognise ─────────────────────────────────────────── */

const STATES = [
  { entity_id: "sensor.doorbell_person_name", state: "No Person" },
  { entity_id: "sensor.side_gate_person_name", state: "Unknown Person" },
  { entity_id: "sensor.doorbell_battery", state: "88" },
  { entity_id: "person.sam", state: "home", attributes: { friendly_name: "Sam" } },
  { entity_id: "person.greg", state: "home", attributes: { friendly_name: "Greg" } },
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen" } }
];

test("names come from what the sensor has said, then the household — never a placeholder", () => {
  const history = [{ state: "Unknown Person" }, { state: "Greg" }, { state: "No Person" }, { state: "Greg" }, { state: "unavailable" }];
  // Sensor-reported first (it is Eufy's own spelling), de-duplicated against person.*.
  expect(collectAlertNames(STATES, history)).toEqual(["Greg", "Sam"]);
  // No history at all: the household's person entities still name it.
  expect(collectAlertNames(STATES, [])).toEqual(["Sam", "Greg"]);
  // A light's friendly_name is not somebody at the door.
  expect(collectAlertNames(STATES, [])).not.toContain("Kitchen");
  expect(collectAlertNames([], [])).toEqual([]);
  expect(collectAlertNames(undefined, undefined)).toEqual([]);
});

test("the name list is capped — each name is 12 syntheses", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ state: `Visitor ${i}` }));
  const names = collectAlertNames(STATES, history);
  expect(names.length).toBe(MAX_ALERT_NAMES);
  expect(names[0]).toBe("Visitor 0");
});

test("only the person-name sensors are asked for history", () => {
  expect(nameSensorIds(STATES)).toEqual(["sensor.doorbell_person_name", "sensor.side_gate_person_name"]);
});
