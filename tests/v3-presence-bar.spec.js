import { test, expect } from "./fixtures/coverage.js";

/* PRESENCE EARNS MEDIUM — the bar that moves with the room.

   attention.js normally requires score >= 70 before a candidate can take the
   glance cell. That line exists so the wall never lights up for nobody. The
   flag says: when someone IS in the room, the bar drops to the Medium floor
   (50), because the audience is itself the visible cause the calm law asks for.

   The four assertions below are the whole contract, and each names ONE cause:
   the flag, the presence, the Medium floor, and the Low band that must survive
   all of it. A Medium candidate is the only probe that can tell them apart —
   a score-80 candidate earns at either bar and would pass every one of these
   tests against a completely broken implementation. */

const MEDIUM = { id: "bar-med", source: "test", score: 50, text: "Bin night", cooldownMs: 0 };
const LOW = { id: "bar-low", source: "test", score: 45, text: "11 min", cooldownMs: 0 };

/** Boot V3 with features.presenceEarnsMedium pinned, and presence known. */
async function bootV3(page, { presenceEarnsMedium }) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  // Pinned, never inherited from the default — flipping this flag back is the
  // rollback path, so both states have to keep being tested after the default
  // moves. Same reason as tests/v3-sound-presence.spec.js.
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.presenceEarnsMedium = ${presenceEarnsMedium};\n`
    });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() =>
    typeof window.__v3Presence === "function" &&
    typeof window.__forceCandidate === "function" &&
    typeof window.__v3Tick === "function"
  );
  return pageErrors;
}

/* Presence FIRST, then the queue, then the tick. The bar is read inside the
   tick, so setting presence after it would measure the previous pass. */
async function ask(page, { present, candidates }) {
  await page.evaluate((p) => window.__v3Presence(p), present);
  await page.evaluate((c) => window.__forceCandidate(c), candidates);
  await page.evaluate(() => window.__v3Tick());
  return page.evaluate(() => window.__v3().attention);
}

test("flag ON, someone in the room: a Medium candidate earns the glance", async ({ page }) => {
  const pageErrors = await bootV3(page, { presenceEarnsMedium: true });

  const attention = await ask(page, { present: true, candidates: [MEDIUM] });

  // The bar itself, so a failure says WHICH of the two numbers was wrong rather
  // than only that the outcome differed.
  expect(attention.bar).toBe(50);
  expect(attention.earned).toBe(true);
  expect(attention.depth).toBe(1);
  expect(attention.reason).toBe("attention:test");
  expect(pageErrors).toEqual([]);
});

test("flag ON, empty room: the same candidate does NOT earn it", async ({ page }) => {
  const pageErrors = await bootV3(page, { presenceEarnsMedium: true });

  const attention = await ask(page, { present: false, candidates: [MEDIUM] });

  // The flag alone must not lower anything — an empty room is exactly the case
  // the 70 line was written for, and the one this feature must not weaken.
  expect(attention.bar).toBe(70);
  expect(attention.earned).toBe(false);
  expect(attention.depth).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("flag OFF: presence does not move the bar — the off state is the old behaviour", async ({ page }) => {
  const pageErrors = await bootV3(page, { presenceEarnsMedium: false });

  const attention = await ask(page, { present: true, candidates: [MEDIUM] });

  // The rollback path. If this ever goes green at 50, flipping the flag back is
  // no longer a rollback and the feature is not reversible.
  expect(attention.bar).toBe(70);
  expect(attention.earned).toBe(false);
  expect(attention.depth).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("Low band never earns the screen, flag on and someone standing right there", async ({ page }) => {
  const pageErrors = await bootV3(page, { presenceEarnsMedium: true });

  const attention = await ask(page, { present: true, candidates: [LOW] });

  /* The guardrail on the whole idea. Commute, plex and tonight's menu live at
     40-45 and are permanently true; if presence dropped the bar to THEM the
     wall would show the same four readouts every time anyone walked past and
     would be furniture inside a week. 45 < 50 is the line that prevents it. */
  expect(attention.bar).toBe(50);
  expect(attention.earned).toBe(false);
  expect(attention.depth).toBe(0);
  expect(pageErrors).toEqual([]);
});
