import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHARED STORE, ON THE SURFACE THAT ACTUALLY SHIPS.

   `js/core/contextStore.js` carries the V3-SHARED-RUNTIME banner and, until
   2026-08-17, had no writer on V3 at all: its four writers are js/core/
   presence.js and intentEngine (both unarmed here), plus modules/screensaver.js
   and services/weather/renderer.js (no V3 equivalent). So on the live wall it
   was a frozen literal, and the literals were not neutral — they were WRONG:

     presence: "glance"   with nobody in the house
     lastMotionAt: 0      forever
     isNight: false       AT MIDNIGHT
     condition: null      in a storm

   Every assertion below is written against `__v3Context()` rather than against
   the wiring, so it goes red again for any regression that re-severs the feed,
   not only for the one that caused it. Neuter-verified in two passes: with
   pushContext() stubbed out, five go red; with the personality and intent
   stages removed from v3/main.js, four more do.

   ⚠ "and daylight is daylight" is the exception and is a CONTROL, not a
   defect-catcher — the frozen literal was `isNight: false`, so it passed
   against the broken source too. It is here to prove the midnight test is
   reading a live value rather than a constant that happens to be true at night.

   ⚠ THE CLOCK AND THE ZONE ARE BOTH PINNED. Night is derived from solar
   altitude (an absolute instant) but `deriveIntent` reads `getHours()` (a local
   one), so a spec that pinned only the instant would name a different posture
   on a UTC machine than on the kiosk. The times below are written as UTC and
   annotated with the Brisbane hour they mean.
   ═══════════════════════════════════════════════════════════════════════════ */

test.use({ timezoneId: "Australia/Brisbane" }); // UTC+10, no DST — the house's zone

const MIDNIGHT = new Date("2026-07-05T14:30:00Z"); // 00:30 Mon 6 Jul, Brisbane
const MIDDAY = new Date("2026-07-06T02:00:00Z");   // 12:00 Mon 6 Jul, Brisbane
const EVENING = new Date("2026-07-06T11:30:00Z");  // 21:30 Mon 6 Jul, Brisbane

/* The route the substrate and the store both read. `code` is the WMO number and
   `icon` is the server's own category string — they are handed DIFFERENT values
   on purpose in the collapse test below. */
const weatherNow = (code, icon) => ({
  now: { temp_c: 14, wind_kph: 6, condition: { code, label: "spec", icon, intensity: null, thunder: false } }
});

const context = (page) => page.evaluate(() => window.__v3Context());

test("the store tracks the room instead of claiming someone is always here", async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY);
  const { pageErrors } = await bootV3(page);

  /* The frozen literal was "glance" — the wall asserting an audience it did not
     have, which is the single worst value for a store whose readers gate on
     presence. V3 boots absent. */
  expect((await context(page)).presence).toBe("ambient");
  expect((await context(page)).lastMotionAt).toBe(0);

  await page.evaluate(() => window.__v3Presence(true));
  let ctx = await context(page);
  expect(ctx.presence).toBe("glance");
  expect(ctx.lastMotionAt).toBeGreaterThan(0);

  await page.evaluate(() => window.__v3Presence("dwell"));
  expect((await context(page)).presence).toBe("dwell");

  await page.evaluate(() => window.__v3Presence(false));
  expect((await context(page)).presence).toBe("ambient");

  expect(pageErrors).toEqual([]);
});

test("it is night at midnight, and the store agrees with the surface", async ({ page }) => {
  await page.clock.setFixedTime(MIDNIGHT);
  await bootV3(page);

  const [ctx, rootNight] = await Promise.all([
    context(page),
    page.evaluate(() => document.documentElement.dataset.night === "1")
  ]);

  expect(ctx.isNight).toBe(true);
  /* The agreement is the assertion, not a second opinion: the feed READS the
     root rather than doing its own suncalc, precisely so presence's linger, the
     ink tokens and the posture can never disagree about the time of day. */
  expect(ctx.isNight).toBe(rootNight);
});

test("and daylight is daylight", async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY);
  await bootV3(page);
  expect((await context(page)).isNight).toBe(false);
});

test("the weather lands as the collapsed vocabulary, taken from the code", async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY);
  // 75 is heavy snow: the server calls it "snow", contextStore's readers have no
  // snow case, and getBaseCategory folds it to cloudy. The snow family is the
  // ONLY place the two vocabularies disagree, so it is the only input that can
  // tell "we read condition.code" apart from "we read condition.icon".
  await bootV3(page, { "/api/weather/now": weatherNow(75, "snow") });

  await expect.poll(async () => (await context(page)).condition).toBe("cloudy");
});

test("a storm reaches the store as a storm", async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY);
  await bootV3(page, { "/api/weather/now": weatherNow(95, "storm") });

  // The value personalityRuntime's dry-streak counter reads to know it rained.
  await expect.poll(async () => (await context(page)).condition).toBe("storm");
});

test("Phase 10's delight registry is armed on this surface", async ({ page }) => {
  await page.clock.setFixedTime(MIDDAY);
  await bootV3(page);

  // `undefined` on the live wall until 2026-08-17: initPersonalityRuntime had
  // exactly one caller and it was js/core/app.js.
  const personality = await page.evaluate(() => window.__personality?.() ?? null);
  expect(personality).not.toBeNull();
  expect(personality.enabled).toBe(true);
});

test("flag off, intent is readable but disarmed — the rollback path", async ({ page }) => {
  await page.clock.setFixedTime(EVENING);
  /* ⚠ PINNED OFF DELIBERATELY, and it must stay pinned. `v3HouseIntent` went
     default-ON 2026-08-17; this spec is the one that proves the one-line revert
     still lands somewhere sane, so it asserts the OFF state on purpose rather
     than tracking whatever the default happens to be. */
  const { pageErrors } = await bootV3(page, {}, { features: { v3HouseIntent: false } });

  // The handle exists in BOTH states — that is how the flag gets confirmed from
  // outside, and its absence is what made the orphan sweep necessary.
  const intent = await page.evaluate(() => window.__intent?.() ?? null);
  expect(intent).not.toBeNull();
  expect(intent.enabled).toBe(false);

  // Flag off is genuinely the old behaviour: the posture stays the neutral
  // literal no matter what the room does.
  await page.evaluate(() => window.__v3Presence("dwell"));
  expect((await context(page)).intent.activity).toBe("unknown");
  expect(pageErrors).toEqual([]);
});

test("armed, the posture is derived from the store rather than from a literal", async ({ page }) => {
  await page.clock.setFixedTime(EVENING);
  await bootV3(page, {}, { features: { v3HouseIntent: true } });

  await page.evaluate(() => window.__v3Presence("dwell"));

  /* The INPUTS, not the committed posture. A categorical change has to hold for
     SETTLE_MS before it commits, and the clock here is fixed — so asserting the
     settled activity would be asserting that Playwright's clock moves, not that
     the feed works. These four fields are exactly what deriveIntent was being
     handed as frozen literals. */
  const { inputs, enabled } = await page.evaluate(() => window.__intent());
  expect(enabled).toBe(true);
  expect(inputs.presence).toBe("dwell");
  expect(inputs.isNight).toBe(true);
});

test("a rushed room takes the surface back to interrupt-only", async ({ page }) => {
  await page.clock.setFixedTime(EVENING);
  const { pageErrors } = await bootV3(page, {}, { features: { v3HouseIntent: true } });

  const probe = {
    id: "spec:probe",
    source: "spec",
    text: "the back gate is open",
    score: 80,          // High band — earns the glance on any ordinary evening
    interrupt: false,
    cooldownMs: 0
  };

  const earnedWhenCalm = await page.evaluate((c) => {
    window.__v3Presence(true);
    window.__forceCandidate(c);
    return window.__v3Tick().earned;
  }, probe);
  expect(earnedWhenCalm).toBe(true);

  /* The whole reason this flag ships default-off: an armed posture has teeth.
     `rushed` is not a phrasing change — attentionRank raises the floor to
     interrupt-only and personality.shouldSpeak drops the line before it is even
     ranked, so a High-band candidate stops reaching the wall. */
  const earnedWhenRushed = await page.evaluate(() => {
    window.__forceIntent({ tempo: "rushed" });
    return window.__v3Tick().earned;
  });
  expect(earnedWhenRushed).toBe(false);

  /* And the effect is entirely the posture's — put the tempo back and the same
     candidate earns the wall again.

     ⚠ `__forceIntent(null)` would NOT do this, and the reason is worth knowing
     before reading it as a stuck gate: clearing the override hands the posture
     back to settleCategory, which requires a categorical change to hold for
     SETTLE_MS before it commits. The clock here is fixed, so "not rushed" can
     never finish settling. Overriding to the value directly commits at once. */
  const earnedAfterClear = await page.evaluate(() => {
    window.__forceIntent({ tempo: "neutral" });
    return window.__v3Tick().earned;
  });
  expect(earnedAfterClear).toBe(true);

  expect(pageErrors).toEqual([]);
});
