import { test, expect } from "@playwright/test";
import { OCCASIONS } from "../src/v3/core/dog-occasion.js";
import { programmeFor, playDogShow, stopDogShow, GAP_MS } from "../src/v3/core/dog-show.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE DOG SHOW — "show me the dogs" (features.v3DogVoice).

     · the programme is every look of the occasion, both dogs in step, the
       shorter list wrapping, a run last only where one exists  → a demo that
       skips a look, or runs where there is no run sheet
     · a named dog plays only his own looks                     → Teddy's ask
                                                                  bringing Benji
     · a step that does not reach the glass ends the show; a
       new ask replaces a running one                           → a show that
                                                                  presses on over
                                                                  a hide(), or two
                                                                  shows racing
     · on the wall: the spoken ask is answered locally and the
       dogs mount on look 0; flag off, no dogs                  → the lane wired
                                                                  to nothing, or
                                                                  claimed while off
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");   // local midday; generic season
const noSleep = () => Promise.resolve();

test.describe("dog show — the programme", () => {
  test("generic: all five looks, both dogs in step, no run", () => {
    const { occasion, steps } = programmeFor(OCCASIONS, "generic");
    expect(occasion).toBe("generic");
    expect(steps).toEqual([0, 1, 2, 3, 4].map((i) => ({ mode: "peek", looks: { benji: i, teddy: i } })));
  });

  test("christmas: three looks each, then the run", () => {
    const { occasion, steps } = programmeFor(OCCASIONS, "christmas");
    expect(occasion).toBe("christmas");
    expect(steps).toEqual([
      { mode: "peek", looks: { benji: 0, teddy: 0 } },
      { mode: "peek", looks: { benji: 1, teddy: 1 } },
      { mode: "peek", looks: { benji: 2, teddy: 2 } },
      { mode: "run", looks: { benji: 0, teddy: 0 } }
    ]);
  });

  test("one dog named: only his looks; an unknown occasion plays the generic show", () => {
    const { steps } = programmeFor(OCCASIONS, "halloween", ["teddy"]);
    expect(steps.map((s) => s.looks)).toEqual([{ teddy: 0 }, { teddy: 1 }, { teddy: 2 }]);
    const fallback = programmeFor(OCCASIONS, "not-a-day");
    expect(fallback.occasion).toBe("generic");
    expect(fallback.steps).toHaveLength(5);
  });

  test("the shorter list wraps rather than leaving a dog out", () => {
    const fake = { odd: { peek: { dogs: { benji: [{}, {}, {}], teddy: [{}] } } } };
    expect(programmeFor(fake, "odd").steps.map((s) => s.looks))
      .toEqual([{ benji: 0, teddy: 0 }, { benji: 1, teddy: 0 }, { benji: 2, teddy: 0 }]);
  });
});

test.describe("dog show — playing it", () => {
  test("plays every step in order, pinned, with a breath between", async () => {
    const calls = [];
    const sleeps = [];
    const r = await playDogShow({
      ...programmeFor(OCCASIONS, "christmas"),
      show: (occ, opts) => { calls.push([occ, opts]); return Promise.resolve({ shown: true }); },
      sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); }
    });
    expect(r).toEqual({ played: 4, of: 4 });
    expect(calls).toEqual([
      ["christmas", { mode: "peek", dogs: ["benji", "teddy"], looks: { benji: 0, teddy: 0 } }],
      ["christmas", { mode: "peek", dogs: ["benji", "teddy"], looks: { benji: 1, teddy: 1 } }],
      ["christmas", { mode: "peek", dogs: ["benji", "teddy"], looks: { benji: 2, teddy: 2 } }],
      ["christmas", { mode: "run", dogs: ["benji", "teddy"], looks: { benji: 0, teddy: 0 } }]
    ]);
    expect(sleeps).toEqual([GAP_MS, GAP_MS, GAP_MS]);
  });

  test("a step that does not reach the glass ends the show there", async () => {
    let n = 0;
    const r = await playDogShow({
      ...programmeFor(OCCASIONS, "generic"),
      show: () => Promise.resolve(++n === 2 ? { shown: false, reason: "hidden" } : { shown: true }),
      sleep: noSleep
    });
    expect(r).toEqual({ played: 1, of: 5, stopped: "hidden" });
    expect(n).toBe(2);
  });

  test("a throwing show() ends it quietly; it never rejects", async () => {
    const r = await playDogShow({ ...programmeFor(OCCASIONS, "generic"), show: () => { throw new Error("boom"); }, sleep: noSleep });
    expect(r).toEqual({ played: 0, of: 5, stopped: "threw" });
  });

  test("a new ask replaces a running show at its next step", async () => {
    let release;
    const first = [];
    const a = playDogShow({
      ...programmeFor(OCCASIONS, "generic"),
      show: (occ, opts) => { first.push(opts.looks.benji); return new Promise((r) => { release = r; }); },
      sleep: noSleep
    });
    await Promise.resolve();
    stopDogShow();
    release({ shown: true });
    expect(await a).toEqual({ played: 1, of: 5, stopped: "replaced" });
    expect(first).toEqual([0]);
  });
});

/* ── On the wall ─────────────────────────────────────────────────────────── */

async function boot(page, dogVoice) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.clock.setFixedTime(MIDDAY);
  // A setter, as v3-voice.spec does: the voice ON and this flag as asked,
  // whatever config.js says (flag-reversibility flips that file).
  await page.addInitScript((dogVoice) => {
    let real;
    Object.defineProperty(window, "CONFIG", {
      configurable: true,
      get() { return real; },
      set(value) {
        real = value ?? {};
        real.features = { ...(real.features ?? {}), voiceSession: true, v3DogVoice: dogVoice };
      }
    });
  }, dogVoice);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3Transcript === "function" && window.dogOccasion, null, { timeout: 10_000 });
  return errors;
}

const onGlass = (page) => page.evaluate(() => window.dogOccasion.state().dogs.map((d) => [d.id, d.lookName]));

test.describe("dog show — asked for out loud", () => {
  test.describe.configure({ timeout: 60_000 });

  test("flag on: 'show me the dogs' is answered locally and the show starts on look 0", async ({ page }) => {
    const errors = await boot(page, true);
    const turn = page.evaluate(() => window.__v3Transcript("show me the dogs"));
    // Present before placed: both dogs mount, on the programme's FIRST look —
    // a random draw would land on look 0 for both only 1 time in 25.
    await expect.poll(() => onGlass(page), { timeout: 10_000 })
      .toEqual([["benji", "lickscreen"], ["teddy", "boneguard"]]);
    const result = await turn;
    expect(result).toEqual(expect.objectContaining({ handled: true, lane: "local" }));
    await expect(page.locator("#heard")).toHaveText("show me the dogs");

    // A second ask, naming one dog, REPLACES the show: Teddy alone, look 0.
    await page.evaluate(() => window.__v3Transcript("show me teddy"));
    await expect.poll(() => onGlass(page), { timeout: 10_000 }).toEqual([["teddy", "boneguard"]]);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(errors).toEqual([]);
  });

  test("flag off: the same sentence puts no dog on the glass", async ({ page }) => {
    const errors = await boot(page, false);
    // Started, not awaited: off, the turn goes on to Assist (stubbed dead here),
    // and how long that takes is not this test's business.
    await page.evaluate(() => { window.__v3Transcript("show me the dogs"); });
    // Long enough for a show to have mounted (the flag-on test mounts in well
    // under a second) — and the positive control above proves it would.
    await page.waitForTimeout(2_000);
    expect(await page.evaluate(() => window.dogOccasion.state().runs)).toBe(0);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
