import { test, expect } from "@playwright/test";
import { bomOutlook, outlookLine, outlookSpeech } from "../src/js/services/weather/bomOutlook.js";
import { outlookCandidate, collectSources } from "../src/js/services/candidateSources.js";
import { matchIntent } from "../src/js/services/localIntents.js";
import { answer } from "../src/js/services/localAnswers.js";
import { houseSnapshot } from "../src/js/services/houseSnapshot.js";

/* features.v3BomOutlook. Pure node. Fixture strings are BOM's real day-0 and
   day-3 sensors for Nudgee, read off HA on 2026-11-08. */

const NOW = new Date("2026-11-08T09:00:00+10:00");
const DATE = "2026-11-08T00:00:00+10:00";

function sensors(fields, { date = DATE, place = "nudgee" } = {}) {
  return Object.fromEntries(Object.entries(fields).map(([f, v]) => {
    const id = `sensor.${place}_${f}_0`;
    return [id, { entity_id: id, state: String(v), attributes: { date }, last_updated: "2026-11-08T00:10:00+00:00" }];
  }));
}

const QUIET = {
  short_text: "Partly cloudy.",
  extended_text: "Partly cloudy. Slight chance of a shower in the late morning and afternoon. Winds east to southeasterly 20 to 30 km/h tending south to southeasterly and becoming light in the evening.",
  icon_descriptor: "mostly_sunny", temp_max: 27, rain_amount_min: 0, rain_amount_max: 1, fire_danger: "Moderate"
};
const STORM = {
  short_text: "Showers. Storm developing.",
  extended_text: "Partly cloudy. Very high chance of showers, most likely in the afternoon and evening. A thunderstorm likely in the afternoon and evening.",
  icon_descriptor: "storm", temp_max: 31, rain_amount_min: 7, rain_amount_max: 20, fire_danger: "Moderate"
};

test.describe("bomOutlook reader", () => {
  test("finds the place from the entity ids and reads day 0", () => {
    const o = bomOutlook(sensors(QUIET, { place: "somewhere_else" }), NOW);
    expect(o).not.toBeNull();
    expect(o.short).toBe("Partly cloudy.");
    expect(o.tempMax).toBe(27);
    expect(o.rainMax).toBe(1);
    expect(o.entityId).toBe("sensor.somewhere_else_short_text_0");
  });

  test("a day 0 dated yesterday is absent, not today's", () => {
    expect(bomOutlook(sensors(STORM, { date: "2026-11-07T00:00:00+10:00" }), NOW)).toBeNull();
  });

  test("unknown fields read as null; no BOM at all is null", () => {
    const o = bomOutlook(sensors({ ...QUIET, temp_max: "unknown" }), NOW);
    expect(o.short).toBe("Partly cloudy.");
    expect(o.tempMax).toBeNull();
    expect(bomOutlook({}, NOW)).toBeNull();
    expect(bomOutlook(null, NOW)).toBeNull();
  });
});

test.describe("the wall line", () => {
  test("an ordinary day has no line", () => {
    expect(outlookLine(bomOutlook(sensors(QUIET), NOW))).toBeNull();
  });

  test("a storm day names BOM's words and the rain amount", () => {
    expect(outlookLine(bomOutlook(sensors(STORM), NOW))).toBe("Showers, storm developing · 7–20 mm today");
  });

  test("10 mm without a storm icon is a line; 9 mm is not", () => {
    const wet = { ...QUIET, short_text: "Rain.", rain_amount_min: 4, rain_amount_max: 10 };
    expect(outlookLine(bomOutlook(sensors(wet), NOW))).toBe("Rain · 4–10 mm today");
    expect(outlookLine(bomOutlook(sensors({ ...wet, rain_amount_max: 9 }), NOW))).toBeNull();
  });

  test("fire danger speaks at High and above, never at Moderate", () => {
    expect(outlookLine(bomOutlook(sensors({ ...QUIET, fire_danger: "High" }), NOW))).toBe("Fire danger High today");
    expect(outlookLine(bomOutlook(sensors({ ...STORM, fire_danger: "Extreme" }), NOW)))
      .toBe("Showers, storm developing · 7–20 mm today · Fire danger Extreme today");
    expect(outlookLine(bomOutlook(sensors({ ...QUIET, fire_danger: "No Rating" }), NOW))).toBeNull();
  });

  test("the candidate carries the line, and stands down at 6 pm", () => {
    const text = "Showers, storm developing · 7–20 mm today";
    const c = outlookCandidate({ outlookText: text, now: NOW.getTime() });
    expect(c?.source).toBe("outlook");
    expect(c.text).toBe(text);
    expect(c.interrupt).toBeFalsy();
    // Medium band (50-69): Low never reaches the glass (attention.js), High would light an empty room.
    expect(c.score).toBeGreaterThanOrEqual(50);
    expect(c.score).toBeLessThan(70);
    const evening = new Date(NOW); evening.setHours(18, 0, 0, 0);
    expect(outlookCandidate({ outlookText: text, now: evening.getTime() })).toBeNull();
    expect(outlookCandidate({ outlookText: null, now: NOW.getTime() })).toBeNull();
  });
});

test.describe("houseSnapshot gating", () => {
  test.afterEach(() => { delete globalThis.window; });

  test("flag ON: a storm day reaches the queue as an outlook candidate", () => {
    globalThis.window = { CONFIG: { features: { v3BomOutlook: true } } };
    const snap = houseSnapshot({ now: NOW, entities: Object.values(sensors(STORM)) });
    expect(snap.outlookText).toBe("Showers, storm developing · 7–20 mm today");
    const c = collectSources({ ...snap, now: NOW.getTime() }).find((x) => x.source === "outlook");
    expect(c?.text).toBe("Showers, storm developing · 7–20 mm today");
    expect(c.evidence).not.toBeNull();
  });

  test("flag OFF: the same storm reaches nothing", () => {
    globalThis.window = { CONFIG: { features: { v3BomOutlook: false } } };
    const snap = houseSnapshot({ now: NOW, entities: Object.values(sensors(STORM)) });
    expect(snap.outlookText).toBeNull();
    expect(collectSources({ ...snap, now: NOW.getTime() }).some((x) => x.source === "outlook")).toBe(false);
  });
});

test.describe("the voice", () => {
  test.afterEach(() => { delete globalThis.window; });
  const on = () => { globalThis.window = { CONFIG: { features: { v3BomOutlook: true } } }; };

  test("the phrases reach weather.outlook with the flag on", () => {
    on();
    for (const q of [
      "what's the weather going to be like today",
      "what's the weather gonna be like",
      "what's today's forecast",
      "what's the weather doing today",
      "how's today looking"
    ]) expect(matchIntent(q)?.id, q).toBe("weather.outlook");
    expect(matchIntent("what's the weather going to be like tomorrow")?.id).toBe("weather.tomorrow");
    expect(matchIntent("what's the weather")?.id).toBe("weather.now");
  });

  test("flag OFF: the same question is weather.now, as before", () => {
    expect(matchIntent("what's the weather going to be like today")?.id).toBe("weather.now");
  });

  test("an ordinary day: BOM's words, the top, and its next sentence (no wind)", () => {
    on();
    const r = answer({ id: "weather.outlook", slots: {} }, { outlook: bomOutlook(sensors(QUIET), NOW) });
    expect(r.speech).toBe("Partly cloudy, top of 27. Slight chance of a shower in the late morning and afternoon.");
  });

  test("a storm day: rain amount, and the house will be watching", () => {
    on();
    const r = answer({ id: "weather.outlook", slots: {} }, { outlook: bomOutlook(sensors(STORM), NOW) });
    expect(r.speech).toBe("Showers, storm developing, 7 to 20 millimetres, top of 31. Very high chance of showers, most likely in the afternoon and evening, and I'll be watching it come in.");
  });

  test("a loud fire danger takes the second sentence", () => {
    on();
    const r = answer({ id: "weather.outlook", slots: {} }, { outlook: bomOutlook(sensors({ ...QUIET, fire_danger: "High" }), NOW) });
    expect(r.speech).toBe("Partly cloudy, top of 27. Fire danger's high today.");
  });

  test("no BOM: falls back to today's top, then to now", () => {
    on();
    const day = answer({ id: "weather.outlook", slots: {} }, { outlook: null, weather: { now: { temp_c: 22 }, day: { high_c: 27, low_c: 19 } } });
    expect(day.speech).toBe("Today's top is 27, low of 19.");
    const now = answer({ id: "weather.outlook", slots: {} }, { outlook: null, weather: { now: { temp_c: 22, condition: { label: "Clear" } } } });
    expect(now.speech).toBe("It's 22 degrees and clear.");
  });
});
