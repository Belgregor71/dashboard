import { test, expect } from "@playwright/test";
import { compose, FORECAST_LEAD_MIN } from "../src/v3/core/composer.js";
import { rainIncoming, binNight } from "../src/js/services/predictiveRules.js";
import { binWeatherClash } from "../src/js/services/insightRules.js";

/* features.v3ChoreFirst — node-side, like tests/v3-composer.spec.js: the
   composer is pure, so the rule is tested where it lives.

   The case, from the critique of 2026-11-25: rain at 83% scores 76, the bins
   score 50, and by score alone the forecast takes the dominant cell while the
   thing the house must DO tonight drops to a footnote. Owner's rule: a forecast
   leads only when it starts within 30 minutes. */

const NOW = new Date("2026-11-25T17:00:00+10:00");
const rain = (mins) => rainIncoming({ nowcast: { startsInMin: mins, probabilityPct: 83 } }, NOW);
const bins = binNight({ bins: { eve: true, colours: ["yellow"] }, weather: { rainChancePct: 10 } }, NOW);
const commute = { id: "commute", source: "commute", text: "23 min to work", score: 42 };

const dominant = (stack, choreFirst) =>
  compose({ stack }, { choreFirst, now: NOW.getTime() })?.cells[0].text ?? null;

test("the real rules carry the roles the composer reads", () => {
  // If a rule loses its role the composer silently falls back to score order,
  // so the producers are asserted here, not only the consumer.
  expect(rain(75)?.role).toBe("forecast");
  expect(bins?.role).toBe("chore");
  expect(binNight({ bins: { lastChance: true } }, NOW)?.role).toBe("chore");
  expect(binWeatherClash({ bins: { eve: true }, weather: { rainChancePct: 80 } }, NOW)?.role).toBe("chore");
  // And they are what the critique saw: the forecast outscores the chore.
  expect(rain(75).score).toBeGreaterThan(bins.score);
});

test("OFF: the dominant cell goes by score, so the forecast leads", () => {
  expect(dominant([rain(75), bins, commute], false)).toBe(rain(75).text);
});

test("ON: a forecast more than 30 minutes out gives the dominant cell to the chore", () => {
  const out = compose({ stack: [rain(75), bins, commute] }, { choreFirst: true, now: NOW.getTime() });
  expect(out.cells[0].text).toBe(bins.text);
  // Nothing is dropped: the forecast is still on the wall, beside it.
  expect(out.cells.map((c) => c.text)).toContain(rain(75).text);
});

test("ON: a forecast within 30 minutes keeps the lead", () => {
  expect(dominant([rain(FORECAST_LEAD_MIN), bins, commute], true)).toBe(rain(FORECAST_LEAD_MIN).text);
  expect(dominant([rain(15), bins], true)).toBe(rain(15).text);
});

test("ON: the boundary is 30 minutes, not 31", () => {
  expect(dominant([rain(35), bins], true), "35 min out must not lead").toBe(bins.text);
});

test("ON: a forecast with no start time keeps its place — 'not imminent' cannot be shown", () => {
  const unknown = { ...rain(75), expiresAt: undefined };
  expect(dominant([unknown, bins], true)).toBe(unknown.text);
});

test("ON: with no chore on the wall, the forecast leads as before", () => {
  expect(dominant([rain(75), commute], true)).toBe(rain(75).text);
});

test("ON: an interrupt still goes first, whatever the chore rule says", () => {
  const must = { id: "door", source: "door", text: "Someone's at the door", score: 95, interrupt: true };
  expect(dominant([must, rain(75), bins], true)).toBe(must.text);
});
