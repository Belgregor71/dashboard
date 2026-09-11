import { test, expect } from "@playwright/test";
import {
  clockDim,
  CLOCK_DIM_DAY,
  CLOCK_DIM_NIGHT,
  CLOCK_ALT_DAY,
  CLOCK_ALT_NIGHT
} from "../src/v3/core/sun-clock.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE SUN-DIMMED HOUR — features.v3SunClock (F1 census, family 4).

   The incumbent's `ambientClock` dimmed the clock with the sky; V3 never read
   that flag and never had the behaviour, while writing `--sun-alt` every minute
   for nothing. The curve is the incumbent's; the ceiling is V3's own hour.

   What is asserted, and why:
     · the curve's ends, its middle and its clamp  → a curve inverted or unclamped
                                                     still "dims"
     · an unknown sky reads as day                 → NaN must never dim the only
                                                     clock on the wall
     · flag on at midnight: the hour is DIM        → the property written and the
                                                     rule never matching passes a
                                                     property-only check — so the
                                                     PAINTED opacity is read
     · flag on at midday: the hour is full         → a flag that always dims
     · flag off: nothing written, the hour full    → flag-off must be the wall of
                                                     before, not merely "close"

   Times are absolute UTC so the result cannot depend on the runner's timezone:
   14:00Z is local midnight in Brisbane (+10), 02:00Z local noon.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDNIGHT = new Date("2026-09-11T14:00:00Z");
const MIDDAY = new Date("2026-09-11T02:00:00Z");

test.describe("the curve", () => {
  test("its ends, its middle, and the clamp beyond both", () => {
    expect(clockDim(CLOCK_ALT_DAY)).toBeCloseTo(CLOCK_DIM_DAY, 6);
    expect(clockDim(CLOCK_ALT_NIGHT)).toBeCloseTo(CLOCK_DIM_NIGHT, 6);
    const mid = (CLOCK_ALT_DAY + CLOCK_ALT_NIGHT) / 2;
    expect(clockDim(mid)).toBeCloseTo((CLOCK_DIM_DAY + CLOCK_DIM_NIGHT) / 2, 6);
    expect(clockDim(60)).toBe(CLOCK_DIM_DAY);
    expect(clockDim(-60)).toBe(CLOCK_DIM_NIGHT);
  });

  test("it only ever falls as the sun does", () => {
    let prev = Infinity;
    for (let alt = 30; alt >= -40; alt -= 0.5) {
      const d = clockDim(alt);
      expect(d).toBeLessThanOrEqual(prev);
      prev = d;
    }
  });

  test("an unknown sky reads as day — never a dimmed clock", () => {
    for (const alt of [NaN, undefined, null, Infinity]) expect(clockDim(alt)).toBe(CLOCK_DIM_DAY);
  });
});

async function bootAt(page, { at, on }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(at);
  await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: (await res.text()) + `\nwindow.CONFIG.features.v3SunClock = ${on};\n` });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/* What the glass shows, not what was written: the property, the attribute, and
   the hour's own computed opacity (polled, because it rides a transition). */
const readHour = () => {
  const root = document.documentElement;
  const hour = document.getElementById("hour");
  return {
    present: Boolean(hour),
    depth: root.dataset.depth ?? null,
    sunClock: root.dataset.sunClock ?? null,
    clockDim: root.style.getPropertyValue("--clock-dim") || null,
    opacity: hour ? Number(getComputedStyle(hour).opacity) : null
  };
};

test.describe("on the page", () => {
  test("flag on at midnight: the hour is dimmed to the floor, on the glass", async ({ page }) => {
    const errors = await bootAt(page, { at: MIDNIGHT, on: true });
    const first = await page.evaluate(readHour);
    expect(first.present, "no #hour to measure").toBe(true);
    expect(first.depth).toBe("0");
    expect(first.sunClock).toBe("1");
    expect(Number(first.clockDim)).toBeCloseTo(CLOCK_DIM_NIGHT, 3);
    await expect.poll(async () => (await page.evaluate(readHour)).opacity, { timeout: 8000 })
      .toBeCloseTo(CLOCK_DIM_NIGHT, 2);
    expect(errors).toEqual([]);
  });

  test("flag on at midday: the hour is at full strength", async ({ page }) => {
    const errors = await bootAt(page, { at: MIDDAY, on: true });
    const r = await page.evaluate(readHour);
    expect(r.sunClock).toBe("1");
    expect(Number(r.clockDim)).toBeCloseTo(CLOCK_DIM_DAY, 3);
    await expect.poll(async () => (await page.evaluate(readHour)).opacity, { timeout: 8000 }).toBe(1);
    expect(errors).toEqual([]);
  });

  test("flag off at midnight: nothing is written and the hour is untouched", async ({ page }) => {
    const errors = await bootAt(page, { at: MIDNIGHT, on: false });
    const r = await page.evaluate(readHour);
    expect(r.present, "no #hour to measure").toBe(true);
    expect(r.depth).toBe("0");
    expect(r.sunClock).toBeNull();
    expect(r.clockDim).toBeNull();
    await expect.poll(async () => (await page.evaluate(readHour)).opacity, { timeout: 8000 }).toBe(1);
    expect(errors).toEqual([]);
  });
});
