import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   A ROTATED-OUT PHOTOGRAPH MUST BE COLLECTABLE.

   Found on the G11 2026-09-24 as a linear listener climb: +2 every ~10 min,
   stepping exactly on the ground's rotation, with the attached DOM flat. The
   cause was a closure chain. dissolve()'s onload/onerror close over the scope
   holding `old`, and `old`'s imgs still carried THEIR handlers, so every frame
   the wall ever showed stayed reachable from the current one, detached, with
   its two listeners attached.

   Measured on the wall, and pinned here the same way: count HTMLImageElement
   instances in the heap after a forced GC. Nothing on the attached DOM can see
   this, because every leaked node has been removed from it.
   ═══════════════════════════════════════════════════════════════════════════ */

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

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/* Diptych off: one image per frame, so "one per rotation" is one number. */
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

/** Every HTMLImageElement alive in the heap after GC, split by attachment. */
async function heapImgs(cdp) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const proto = await cdp.send("Runtime.evaluate", { expression: "HTMLImageElement.prototype" });
  const q = await cdp.send("Runtime.queryObjects", {
    prototypeObjectId: proto.result.objectId,
    objectGroup: "retention"
  });
  const r = await cdp.send("Runtime.callFunctionOn", {
    objectId: q.objects.objectId,
    returnByValue: true,
    functionDeclaration: `function () {
      const thumbs = this.filter((e) => (e.src || "").includes("/thumb"));
      const detached = thumbs.filter((e) => !e.isConnected);
      return {
        connected: thumbs.length - detached.length,
        detached: detached.length,
        detachedWithHandlers: detached.filter((e) => e.onload || e.onerror).length
      };
    }`
  });
  await cdp.send("Runtime.releaseObjectGroup", { objectGroup: "retention" });
  return r.result.value;
}

const settled = (page) =>
  page.evaluate(() => {
    const g = window.__ground();
    return g.shown && g.layers === 1 && !g.inFlight && g.settleDueInMs == null;
  });

test("six rotations leave no chain of detached photographs behind", async ({ page }) => {
  test.setTimeout(60_000);
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await stubGround(page);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__groundDissolve === "function");
  await expect.poll(() => settled(page), { timeout: 10_000 }).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("HeapProfiler.enable");

  const before = await heapImgs(cdp);
  // ⚠ Assert the probe SEES the ground before trusting a zero from it: a query
  // that matched nothing would report "0 detached" against any defect.
  expect(before.connected).toBeGreaterThanOrEqual(1);

  const ROTATIONS = 6;
  const seen = [await page.evaluate(() => window.__ground().assetId)];
  for (let i = 0; i < ROTATIONS; i++) {
    expect(await page.evaluate(() => window.__groundDissolve(20, 5000))).toBe(true);
    // Wait out the whole exchange, cleanup timer included — that is the moment
    // the outgoing node leaves the DOM and must become garbage.
    await expect.poll(() => settled(page), { timeout: 10_000 }).toBe(true);
    seen.push(await page.evaluate(() => window.__ground().assetId));
  }
  // Positive control: the rotations really exchanged photographs. A dissolve
  // that did nothing would leave nothing behind and pass for the wrong reason.
  for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);

  const after = await heapImgs(cdp);
  expect(after.connected).toBeGreaterThanOrEqual(1);

  // The mechanism: no removed photograph still holds a load/error handler.
  expect(after.detachedWithHandlers).toBe(0);
  // The consequence: detached imgs do not grow with the rotation count. One
  // rotation-out's worth of slack for a subscriber holding the last frame; the
  // defect grows by ROTATIONS.
  expect(after.detached - before.detached).toBeLessThanOrEqual(1);

  expect(pageErrors).toEqual([]);
});
