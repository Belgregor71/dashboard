import { test, expect } from "@playwright/test";
import {
  planNextEpisode,
  BUDGETS,
  RAIN_GAP_MS,
  LIGHTNING_GAP_MS,
  TWINKLE_GAP_MS
} from "../src/js/services/atmoFx/planner.js";
import {
  categoryForWeatherCode,
  intensityForWeatherCode,
  isThunderCode
} from "../src/js/weatherPrompts.js";
import { conditionFor } from "../server/services/weatherService.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// Pure unit tests for the living-window Phase 1 lane: the episode planner
// (services/atmoFx/planner.js — no imports, no DOM, runs in plain node), the
// widened weather-code data path, and the atmo-fx CSS guardrail. The design
// law under test is "moments, not loops": every plan the planner can ever
// emit must fit the exported budgets, and the effect CSS must never loop.

// Deterministic rng for seeded planner tests.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test.describe("weather code tiers (living-window data path)", () => {
  test("intensity tiers: last step of each precip family is heavy", () => {
    expect(conditionFor(51)).toMatchObject({ icon: "rain", intensity: "light", thunder: false });
    expect(conditionFor(55)).toMatchObject({ icon: "rain", intensity: "heavy", thunder: false });
    expect(conditionFor(61)).toMatchObject({ icon: "rain", intensity: "light" });
    expect(conditionFor(63)).toMatchObject({ icon: "rain", intensity: "moderate" });
    expect(conditionFor(65)).toMatchObject({ icon: "rain", intensity: "heavy" });
    expect(conditionFor(82)).toMatchObject({ icon: "rain", intensity: "heavy" });
  });

  test("thunderstorm codes 95/96/99 carry thunder", () => {
    expect(conditionFor(95)).toMatchObject({ icon: "storm", thunder: true, intensity: "moderate" });
    expect(conditionFor(96)).toMatchObject({ icon: "storm", thunder: true, intensity: "heavy" });
    expect(conditionFor(99)).toMatchObject({ icon: "storm", thunder: true, intensity: "heavy" });
  });

  test("snow is snow, not storm (the old 71 mislabel)", () => {
    expect(conditionFor(71).icon).toBe("snow");
    expect(conditionFor(75).icon).toBe("snow");
    expect(conditionFor(71).thunder).toBe(false);
  });

  test("unknown codes degrade to Unavailable with inert effect fields", () => {
    expect(conditionFor(42)).toMatchObject({ label: "Unavailable", intensity: null, thunder: false });
  });

  test("frontend helpers agree with the backend tiers", () => {
    for (const code of [51, 55, 61, 63, 65, 80, 82, 95, 96, 99]) {
      expect(intensityForWeatherCode(code)).toBe(conditionFor(code).intensity);
      expect(isThunderCode(code)).toBe(conditionFor(code).thunder);
    }
    expect(intensityForWeatherCode(0)).toBe(null);
    expect(intensityForWeatherCode(3)).toBe(null);
    expect(isThunderCode(61)).toBe(false);
    // categories still line up for the codes both sides know
    expect(categoryForWeatherCode(71)).toBe("snow");
  });
});

test.describe("atmoFx planner", () => {
  const NOW = 1_800_000_000_000;

  test("returns null when the sky earns nothing", () => {
    expect(planNextEpisode({ weather: null, mode: "ambient", now: NOW })).toBe(null);
    expect(planNextEpisode({})).toBe(null);
    for (const category of ["clear", "cloudy", "fog", "snow"]) {
      expect(
        planNextEpisode({ weather: { category, intensity: null, thunder: false }, mode: "ambient", now: NOW })
      ).toBe(null);
    }
  });

  test("is deterministic under a seeded rng", () => {
    const weather = { category: "storm", intensity: "heavy", thunder: true };
    const a = planNextEpisode({ weather, mode: "ambient", now: NOW, rng: mulberry32(7) });
    const b = planNextEpisode({ weather, mode: "ambient", now: NOW, rng: mulberry32(7) });
    expect(a).toEqual(b);
  });

  test("lane selection: rain plans rain, thunder-only plans lightning", () => {
    const rain = planNextEpisode({
      weather: { category: "rain", intensity: "moderate", thunder: false },
      mode: "ambient",
      now: NOW,
      rng: mulberry32(1)
    });
    expect(rain.type).toBe("rain-moment");

    const lightning = planNextEpisode({
      weather: { category: "clear", intensity: null, thunder: true },
      mode: "ambient",
      now: NOW,
      rng: mulberry32(1)
    });
    expect(lightning.type).toBe("lightning");
  });

  test("heavy intensity plans the heavy variant, others the moment", () => {
    for (const [intensity, expected] of [
      ["light", "rain-moment"],
      ["moderate", "rain-moment"],
      [null, "rain-moment"], // unknown intensity rests on moderate
      ["heavy", "rain-heavy"]
    ]) {
      const ep = planNextEpisode({
        weather: { category: "rain", intensity, thunder: false },
        mode: "awake",
        now: NOW,
        rng: mulberry32(3)
      });
      expect(ep.type).toBe(expected);
    }
  });

  test("twinkle lane: only a clear ambient night plans a twinkle", () => {
    const clear = { category: "clear", intensity: null, thunder: false };
    const twinkle = planNextEpisode({ weather: clear, mode: "ambient", now: NOW, night: true, rng: mulberry32(5) });
    expect(twinkle.type).toBe("twinkle");

    // Not night → the pre-Phase-3 null (default arg keeps old callers intact).
    expect(planNextEpisode({ weather: clear, mode: "ambient", now: NOW, rng: mulberry32(5) })).toBe(null);
    // Awake → the field is a Mode-0 scene; no twinkles over the dashboard.
    expect(planNextEpisode({ weather: clear, mode: "awake", now: NOW, night: true, rng: mulberry32(5) })).toBe(null);
    // Clouded-over night → no stars to twinkle.
    expect(
      planNextEpisode({ weather: { category: "cloudy", intensity: null, thunder: false }, mode: "ambient", now: NOW, night: true, rng: mulberry32(5) })
    ).toBe(null);
  });

  test("twinkle budget invariants hold across 200 seeds", () => {
    const weather = { category: "clear", intensity: null, thunder: false };
    for (let seed = 0; seed < 200; seed++) {
      const ep = planNextEpisode({ weather, mode: "ambient", now: NOW, night: true, rng: mulberry32(seed) });
      expect(ep.type).toBe("twinkle");
      expect(ep.durationMs).toBeLessThanOrEqual(BUDGETS.twinkle.maxActiveMs);
      expect(ep.params.count).toBeGreaterThanOrEqual(2);
      expect(ep.params.count).toBeLessThanOrEqual(BUDGETS.twinkle.maxStars);
      const gap = ep.startAt - NOW;
      expect(gap).toBeGreaterThanOrEqual(TWINKLE_GAP_MS[0]);
      expect(gap).toBeLessThanOrEqual(TWINKLE_GAP_MS[1]);
    }
  });

  test("budget invariants hold for every mode × weather × 200 seeds", () => {
    const modes = ["ambient", "awake"];
    const weathers = [];
    for (const category of ["rain", "storm"]) {
      for (const intensity of ["light", "moderate", "heavy", null]) {
        for (const thunder of [false, true]) {
          weathers.push({ category, intensity, thunder });
        }
      }
    }
    weathers.push({ category: "clear", intensity: null, thunder: true }); // lightning-only lane

    for (const mode of modes) {
      const budget = BUDGETS[mode];
      for (const weather of weathers) {
        for (let seed = 0; seed < 200; seed++) {
          const ep = planNextEpisode({ weather, mode, now: NOW, rng: mulberry32(seed) });
          expect(ep).not.toBe(null);
          expect(ep.startAt).toBeGreaterThan(NOW);

          if (ep.type === "lightning") {
            expect(ep.durationMs).toBeLessThanOrEqual(BUDGETS.lightning.maxSequenceMs);
            expect(ep.params.aftershocks.length).toBeLessThanOrEqual(BUDGETS.lightning.maxAftershocks);
            expect(ep.params.peak).toBeGreaterThanOrEqual(0.8);
            expect(ep.params.peak).toBeLessThanOrEqual(1.0);
            let prevOffset = 0;
            for (const shock of ep.params.aftershocks) {
              // flickers are weaker than the big strike and play in order
              expect(shock.peak).toBeLessThan(ep.params.peak);
              expect(shock.offsetMs).toBeGreaterThanOrEqual(prevOffset);
              prevOffset = shock.offsetMs;
            }
            expect(ep.startAt - NOW).toBeGreaterThanOrEqual(LIGHTNING_GAP_MS[0]);
            expect(ep.startAt - NOW).toBeLessThanOrEqual(LIGHTNING_GAP_MS[1]);
          } else {
            // rain lanes: the rAF-driven stretch and the particle load must fit
            expect(ep.durationMs).toBeLessThanOrEqual(budget.maxActiveMs);
            expect(ep.params.droplets).toBeLessThanOrEqual(budget.maxDroplets);
            expect(ep.params.streaks).toBeLessThanOrEqual(budget.maxStreaks);
            expect(ep.params.holdMs).toBeLessThanOrEqual(budget.maxHoldMs);
            expect(ep.params.sliders).toBeLessThanOrEqual(ep.params.droplets);
            const intensity =
              weather.intensity === "light" || weather.intensity === "heavy" ? weather.intensity : "moderate";
            const gap = ep.startAt - NOW;
            expect(gap).toBeGreaterThanOrEqual(RAIN_GAP_MS[mode][intensity][0]);
            expect(gap).toBeLessThanOrEqual(RAIN_GAP_MS[mode][intensity][1]);
          }
        }
      }
    }
  });
});

test.describe("atmo-fx css guardrail", () => {
  // The idle-freeze law extended to the effects file: nothing in atmo-fx.css
  // may loop. Strikes are one-shots that fill forwards; flickers live inside
  // the decay keyframes, never as a repeat.
  test("no infinite animations; every animation is a forwards one-shot", () => {
    const cssPath = fileURLToPath(new URL("../src/css/utils/atmo-fx.css", import.meta.url));
    // Strip comments so the guardrail reads declarations, not prose about itself.
    const css = readFileSync(cssPath, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

    expect(css).not.toMatch(/infinite/);
    expect(css).not.toMatch(/animation-iteration-count/);

    const animationLines = css.match(/animation(-name)?\s*:[^;]+;/g) || [];
    expect(animationLines.length).toBeGreaterThan(0); // the strike exists
    for (const line of animationLines) {
      const isKill = /animation\s*:\s*none/.test(line); // reduced-motion off-switch
      if (!isKill) expect(line).toMatch(/forwards/);
    }
  });
});
