import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S0 — two levers that were wired on the incumbent and dead on V3
   (docs/design/HOUSE-MIND.md §5).

   Both are asserted at the OUTCOME, never at the wiring: a delight that is
   pending, a line that wins the glance. An "the event was emitted" test would
   pass against a runtime that never listened — which is exactly how both went
   dead unnoticed. And both directions, because each has an off state that is
   the rollback: a lever set unconditionally passes every "it works when on"
   test and changes the wall with the flag off.
   ═══════════════════════════════════════════════════════════════════════════ */

// Monday midday: the awake view, and nowhere near a birthday or a boot delight.
const MIDDAY = new Date("2026-07-06T12:00:00");
const THREE_DAYS = 3 * 86_400_000;

async function bootWithClock(page, features, routes = {}) {
  await page.clock.install({ time: MIDDAY });
  const { pageErrors } = await bootV3(page, routes, { features });
  await page.waitForFunction(() => typeof window.__personality === "function");
  return pageErrors;
}

/** Leave, be away for `awayMs` of wall-clock time, come home. Returns what the
 *  personality runtime is holding afterwards. */
async function awayThenHome(page, awayMs) {
  await page.evaluate(() => {
    window.__v3Arrival("person.spec", "home");      // the snapshot: already in
    window.__v3Arrival("person.spec", "not_home");  // ...and out
  });
  await page.clock.setSystemTime(MIDDAY.getTime() + awayMs);
  return page.evaluate(() => {
    window.__v3Arrival("person.spec", "home");
    return { arrival: window.__v3().arrival ?? null, pending: window.__personality().pending };
  });
}

test.describe("v3ArrivalDelight — a long absence reaches the delight registry", () => {
  test("ON: home after three days fires home-after-away", async ({ page }) => {
    const pageErrors = await bootWithClock(page, { v3ArrivalDelight: true, personality: true });
    expect(await page.evaluate(() => window.__personality().pending)).toBeNull();

    const { pending } = await awayThenHome(page, THREE_DAYS);

    expect(pending).toBe("delight:home-after-away");
    expect(pageErrors).toEqual([]);
  });

  test("OFF: the same return fires nothing — the flag is the rollback", async ({ page }) => {
    const pageErrors = await bootWithClock(page, { v3ArrivalDelight: false, personality: true });

    const { pending } = await awayThenHome(page, THREE_DAYS);

    // The arrival itself still happened — this is not a dead page passing.
    expect(await page.evaluate(() => window.__v3().announced.map((a) => a.id)))
      .toContain("arrival:person.spec");
    expect(pending).toBeNull();
    expect(pageErrors).toEqual([]);
  });

  test("ON: a one-hour errand is an arrival, not a homecoming", async ({ page }) => {
    await bootWithClock(page, { v3ArrivalDelight: true, personality: true });

    const { pending } = await awayThenHome(page, 60 * 60 * 1000);

    expect(await page.evaluate(() => window.__v3().announced.map((a) => a.id)))
      .toContain("arrival:person.spec");
    expect(pending).toBeNull();
  });
});

/* Two candidates, both High band. By raw score IGNORED wins (80 > 75). The
   learned history says the room leans into FAVOURED and walks past IGNORED, so
   with the weights applied the order flips. The gap is 5 and the nudges are
   +10 / −15 at these ratios, so only the weights can explain a flip. */
const ROUTINES = {
  routines: {
    attention: {
      favoured: { shown: 10, dwell: 10 },
      ignored: { shown: 10, dwell: 0 }
    }
  }
};

const CANDIDATES = [
  { id: "spec:favoured", source: "favoured", text: "The favoured gate note", score: 75, interrupt: false, cooldownMs: 0 },
  { id: "spec:ignored", source: "ignored", text: "The ignored gate note", score: 80, interrupt: false, cooldownMs: 0 }
];

async function glanceWith(page, features) {
  const pageErrors = await bootWithClock(page, { routineLearning: true, ...features }, { "/api/routines": ROUTINES });
  // The aggregates must be loaded before the tick, or the weights are {} and
  // both states read the same.
  await page.waitForFunction(() => Object.keys(window.__routines().weights).length === 2);
  const said = await page.evaluate((cands) => {
    window.__v3Presence(true);
    window.__forceCandidate(cands);
    window.__v3Tick();
    return document.getElementById("glance-said")?.textContent ?? null;
  }, CANDIDATES);
  return { said, pageErrors };
}

test.describe("v3AttentionWeights — learned history reaches V3's ranking", () => {
  test("ON: the line the room leans into outranks a higher raw score", async ({ page }) => {
    const { said, pageErrors } = await glanceWith(page, { v3AttentionWeights: true });
    expect(said).toContain("favoured");
    expect(said).not.toContain("ignored");
    expect(pageErrors).toEqual([]);
  });

  test("OFF: raw score decides, exactly as before", async ({ page }) => {
    const { said, pageErrors } = await glanceWith(page, { v3AttentionWeights: false });
    expect(said).toContain("ignored");
    expect(said).not.toContain("favoured");
    expect(pageErrors).toEqual([]);
  });
});
