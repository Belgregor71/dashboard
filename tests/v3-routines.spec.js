import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PHASE 8 ON V3 — the three channels it actually learns through.

   `tests/routines.spec.js` is a pure unit test of routineStore.js: it proves the
   folding maths to the decimal and never once asks whether an event ARRIVES.
   That is exactly the gap this file exists to close. Phase 8 was armed on V3 on
   2026-08-16 and two of its three observers were subscribed to channels no V3
   module has ever spoken on:

     wake                ← bus `presence:changed`, emitted only by
                           js/core/presence.js — the module V3 replaced
     departure / return  ← `document`'s `ha:state-updated`, dispatched only by
                           `registerHAEvents`, which V3 does not call
     attention weights   ← bus `attention:hero` — the one that did work

   So the house was learning which candidates get leaned into and nothing at all
   about the shape of the day. Both are repaired at their source (V3's presence
   now emits the FSM's vocabulary; routineRuntime now listens on the bus), and
   the assertions below are written against the aggregates rather than against
   the wiring, so they would fail again for either regression.
   ═══════════════════════════════════════════════════════════════════════════ */

// Monday, so every sample lands in the weekday bucket, and 07:30 so it sits
// inside onPresence's 04:00–11:00 wake window. 450 minutes into the day.
const MONDAY_MORNING = new Date("2026-07-06T07:30:00");
const WAKE_MINUTES = 450;

/* The blob the runtime is served at init. Two jobs: every distribution starts
   at n:0 no matter what `data/routines/aggregates.json` happens to hold on the
   machine running the suite, and `sentinel` gives the spec something to wait
   for that cannot be confused with "the fetch has not resolved yet".

   ⚠ Waiting matters. loadAggregates() assigns `routines` WHOLESALE, so an event
   recorded before it resolves is silently overwritten — which reads as a dead
   channel and is a race. */
const SENTINEL = { attention: { sentinel: { shown: 7, dwell: 3 } } };

const EMPTY = { n: 0, mean: 0, variance: 0 };

async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.clock.setFixedTime(MONDAY_MORNING);

  await page.route("**/api/routines", async (route) => {
    // The 10-minute flush cannot fire inside a spec, but if it ever did it must
    // not write the developer's real aggregates.
    if (route.request().method() !== "GET") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    await route.fulfill({ json: { routines: SENTINEL } });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__routines === "function");
  await page.waitForFunction(() => window.__routines().routines.attention?.sentinel?.shown === 7);

  // A known floor: the boot tick may already have acted on real state.
  await page.evaluate(() => {
    window.__forceCandidate(null);
    window.__v3Presence(false);
  });
  return pageErrors;
}

const aggregates = (page) => page.evaluate(() => window.__routines().routines);

test("the morning wake is recorded — V3's presence reaches the shared runtime", async ({ page }) => {
  const pageErrors = await bootV3(page);

  expect((await aggregates(page)).wake.weekday).toEqual(EMPTY);

  // Somebody walks into the kitchen. This is the whole channel: V3 knows, and
  // until now the shared runtime did not.
  await page.evaluate(() => window.__v3Presence(true));

  const wake = (await aggregates(page)).wake.weekday;
  expect(wake.n).toBe(1);
  expect(Math.round(wake.mean)).toBe(WAKE_MINUTES);
  expect(pageErrors).toEqual([]);
});

test("the wake is one per day, not one per trip to the kitchen", async ({ page }) => {
  await bootV3(page);

  for (const present of [true, false, true, false, true]) {
    await page.evaluate((p) => window.__v3Presence(p), present);
  }

  expect((await aggregates(page)).wake.weekday.n).toBe(1);
});

test("a person leaving and coming home is recorded", async ({ page }) => {
  const pageErrors = await bootV3(page);

  // The opening snapshot is not a transition — the runtime has no previous
  // state to compare against, and treating it as one would record a departure
  // every time the page reloads.
  await page.evaluate(() => window.__emitHaState({ entity_id: "person.spec", state: "home" }));
  let r = await aggregates(page);
  expect(r.departure.weekday).toEqual(EMPTY);
  expect(r.return.weekday).toEqual(EMPTY);

  await page.evaluate(() => window.__emitHaState({ entity_id: "person.spec", state: "not_home" }));
  r = await aggregates(page);
  expect(r.departure.weekday.n).toBe(1);
  expect(Math.round(r.departure.weekday.mean)).toBe(WAKE_MINUTES);
  expect(r.return.weekday).toEqual(EMPTY);

  await page.evaluate(() => window.__emitHaState({ entity_id: "person.spec", state: "home" }));
  r = await aggregates(page);
  expect(r.return.weekday.n).toBe(1);
  expect(Math.round(r.return.weekday.mean)).toBe(WAKE_MINUTES);

  expect(pageErrors).toEqual([]);
});

test("a hero that was leaned into is closed out as dwelt when the room empties", async ({ page }) => {
  await bootV3(page);

  await page.evaluate(() => {
    window.__v3Presence(true);
    window.__forceCandidate({
      id: "spec:probe",
      source: "spec",
      text: "the back gate is open",
      score: 80,
      interrupt: false,
      cooldownMs: 0
    });
    window.__v3Tick();
  });

  // Shown, but nothing is recorded until the presentation closes — the outcome
  // is not known while it is still on the glass.
  expect((await aggregates(page)).attention.spec).toBeUndefined();

  await page.evaluate(() => window.__v3Presence("dwell"));  // leaned into
  await page.evaluate(() => window.__v3Presence(false));    // and now the room empties

  expect((await aggregates(page)).attention.spec).toEqual({ shown: 1, dwell: 1 });
});
