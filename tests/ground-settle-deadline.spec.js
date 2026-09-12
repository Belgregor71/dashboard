import { test, expect } from "./fixtures/coverage.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { judgeGround, SETTLE_GRACE_MS } = require("../scripts/kiosk/heap-metrics.cjs");

/* ═══════════════════════════════════════════════════════════════════════════
   THE SETTLE DEADLINE — and the detector that could not see it.

   `heap-metrics.cjs` raised SETTLE STUCK on `layers > 1 && !inFlight`. That is
   the NORMAL state for 62 s of every 10-minute rotation: ground.js clears
   `inFlight` the instant the incoming frame is on the glass, then removes the
   outgoing one on a timer armed for DISSOLVE_MS + CLEANUP_BUFFER_MS.

   Measured on the live G11 2026-09-12, 700 s at 1 Hz across one natural
   rotation: 61 of 698 samples satisfied the old condition — 8.7% — and it
   cleared itself after 61.2 s. The wall was healthy the whole time.

        t+404.4s layers=2 inFlight=true   asset=a42c6170   (loading)
        t+407.4s layers=2 inFlight=false  asset=c38e5da7   <-- fault fired
        t+468.6s layers=1 inFlight=false  asset=c38e5da7   (cleanup ran)

   🔑 A false positive here is worse than a missing check. SETTLE STUCK is the
   ONLY instrument aimed at the transitionend-zombie class that cost this house
   709 lottie wrappers and 230k detached nodes, and `--gate` exits non-zero on
   it. Crying wolf on a tenth of the samples is how the one real reading gets
   waved through.

   ⚠⚠ BOTH DIRECTIONS, because the behaviour has an off state and one direction
   is half a test. A detector that never fires passes every "it does not fire on
   a rotation" assertion ever written — so every quiet case below is paired with
   a loud one that differs by ONE field.
   ═══════════════════════════════════════════════════════════════════════════ */

/* A sample shaped exactly like the one heap-metrics.cjs assembles, mid-settle:
   the incoming frame is up, the outgoing one is still scheduled for removal. */
const midSettle = (over = {}) => ({
  assetId: "c38e5da7",
  assetIds: ["c38e5da7"],
  dayKey: "Sat Sep 12 2026",
  shown: true,
  layers: 2,
  imgs: 2,
  pair: false,
  inFlight: false,
  settleDueInMs: 45_000,
  ...over
});

const POOL_OK = [{ path: "/api/immich/on-this-day", count: 30 }];
const TODAY = "Sat Sep 12 2026";

const settleFaults = (ground) =>
  judgeGround(ground, POOL_OK, TODAY).faults.filter((f) => f.startsWith("SETTLE"));

test.describe("the SETTLE STUCK detector", () => {
  test("stays QUIET through an ordinary cross-fade — the 8.7% false positive", () => {
    expect(settleFaults(midSettle())).toEqual([]);
  });

  /* The paired loud case. Same sample, ONE field different: nothing is armed,
     so there is no work left that would ever remove the second layer. */
  test("FIRES when two layers are at rest with no cleanup armed", () => {
    const faults = settleFaults(midSettle({ settleDueInMs: null }));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("SETTLE STUCK");
    expect(faults[0]).toContain("no cleanup armed");
  });

  test("FIRES when the cleanup is overdue past the grace", () => {
    const faults = settleFaults(midSettle({ settleDueInMs: -(SETTLE_GRACE_MS + 8_000) }));
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("SETTLE STUCK");
    /* The overdue seconds are in the text, so a sample read by eye says how bad
       it is. TOTAL lateness (10 s), not lateness past the grace — the grace is
       the detector's tolerance, not part of the frame's story. */
    expect(faults[0]).toContain("10s overdue");
  });

  /* Scheduler drift on a loaded box is not a stuck settle. Paired with the case
     above so the grace cannot be quietly widened to infinity without a red. */
  test("tolerates drift INSIDE the grace", () => {
    expect(settleFaults(midSettle({ settleDueInMs: -(SETTLE_GRACE_MS - 500) }))).toEqual([]);
  });

  /* An old bundle cannot answer the question. The kiosk runs the previous
     bundle until a reload, so this is the expected reading right after a
     deploy — and a silent pass there would be the file's stated sin of
     "reporting healthy for the wrong reason". */
  test("REFUSES to judge a page that predates the deadline seam", () => {
    const { settleDueInMs, ...old } = midSettle();
    const faults = settleFaults(old);
    expect(faults).toHaveLength(1);
    expect(faults[0]).toContain("SETTLE UNVERIFIABLE");
    expect(faults[0]).not.toContain("SETTLE STUCK");
  });

  /* One layer is the resting state and must never fault, whatever the deadline
     field says — otherwise the check would fire on every settled wall. */
  test("says nothing about a single settled layer", () => {
    expect(settleFaults(midSettle({ layers: 1, imgs: 1, settleDueInMs: null }))).toEqual([]);
  });
});

/* ── The other half: the page really does populate the field ─────────────────
   The unit tests above would all pass against a `settleDueInMs` that ground.js
   never sets — every one of them builds its own sample. This is the test that
   fails if the seam is not really there. */

const asset = (id, iso) => ({
  id,
  aspect: 1.78,
  localDateTime: iso,
  city: "Nudgee",
  country: "Australia",
  people: []
});

const POOL = [
  asset("one", "2013-08-13T06:00:00Z"),
  asset("two", "2013-08-13T07:00:00Z"),
  asset("three", "2013-08-13T08:00:00Z")
];

/* A 1x1 PNG — `load` has to fire and naturalWidth has to be non-zero. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/* Diptych off: this file counts photographic layers, and one image per frame
   keeps that a single unambiguous number. Pinned, never inherited. */
async function stubGround(page) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        "\nwindow.CONFIG.features.groundMemories = true;" +
        "\nwindow.CONFIG.features.groundDiptych = false;\n"
    });
  });
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: POOL }) })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );
}

test("the page arms a deadline for the settle, and clears it when cleanup runs", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await stubGround(page);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__groundDissolve === "function");
  await expect
    .poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 })
    .toBe(true);

  // ── At rest: one layer, nothing armed.
  const atRest = await page.evaluate(() => window.__ground());
  expect(atRest.layers).toBe(1);
  expect(atRest.settleDueInMs).toBeNull();

  /* ── Mid-settle. 150 ms of dissolve so the cleanup lands 2,150 ms later —
     long enough to sample inside the window, short enough for a suite to run.
     The REAL 60 s constant is exercised on the wall, not here. */
  await page.evaluate(() => window.__groundDissolve(150));
  await expect
    .poll(() => page.evaluate(() => window.__ground().layers), { timeout: 10_000 })
    .toBe(2);

  const during = await page.evaluate(() => window.__ground());

  /* ⚠ Assert the state this sample is actually IN before asserting what the
     detector says about it — a sample that had already cleaned up would satisfy
     "no fault" for entirely the wrong reason. */
  expect(during.layers).toBe(2);
  expect(during.inFlight).toBe(false);
  expect(typeof during.settleDueInMs).toBe("number");
  expect(during.settleDueInMs).toBeGreaterThan(0);
  expect(during.settleDueInMs).toBeLessThanOrEqual(2150);

  // The real page's own sample, through the real judge: quiet.
  expect(settleFaults({ ...during, dayKey: TODAY })).toEqual([]);

  /* The discriminator is THIS FIELD and nothing else: the identical sample with
     the deadline gone is the loud case. */
  expect(settleFaults({ ...during, dayKey: TODAY, settleDueInMs: null })[0])
    .toContain("SETTLE STUCK");

  // ── After cleanup: back to one layer, and the deadline disarmed.
  await expect
    .poll(() => page.evaluate(() => window.__ground().layers), { timeout: 10_000 })
    .toBe(1);
  const after = await page.evaluate(() => window.__ground());
  expect(after.settleDueInMs).toBeNull();
  expect(after.imgs).toBe(1);
  expect(settleFaults({ ...after, dayKey: TODAY })).toEqual([]);

  expect(pageErrors).toEqual([]);
});
