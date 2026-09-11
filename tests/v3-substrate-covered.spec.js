import { test, expect } from "@playwright/test";

/* ═══════════════════════════════════════════════════════════════════════════
   THE COVERED FIELD — features.v3SubstrateCoveredPause.

   At depth 0 with the archive on, `.archive` is inset:0 over an opaque
   --surface, and the substrate beneath it cannot be seen. Measured on the live
   wall 2026-09-12 (HOST-BASELINES.md, the Living Window baseline): it drew at
   15 fps there anyway, ~1.4 gpu-process / ~7.5 renderer points for nothing.

   Two reasons now share the substrate's ONE setPaused — the panel being dark
   and the archive covering it — and the defects this file exists to catch are
   the two ways one reason can clobber the other:
     · the panel coming back while the archive still covers the field
                                              → must STAY paused
     · leaving depth 0 while the panel is dark
                                              → must STAY paused
   Plus the obvious ones:
     · covered at depth 0 with the archive on → paused
     · leaving depth 0 draws a frame at once  → never a stale field on the glass
     · the archive off                        → never covered, whatever the depth
     · flag off                               → never covered: the pause is the
                                                panel's alone, as it was
     · flag flipped off live                  → uncovers on the next depth change
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z"); // local noon in Brisbane (+10)

async function bootV3(page, flags) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(MIDDAY);
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
  );
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

const read = () => {
  const v3 = window.__v3();
  const s = window.__substrate?.() ?? null;
  return {
    depth: document.documentElement.dataset.depth ?? null,
    archive: document.documentElement.dataset.archive ?? null,
    why: v3.substratePause ?? null,
    paused: s ? s.paused : null,
    frames: s ? s.frames : null
  };
};

test("flag on, archive on, depth 0: the covered field is paused", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: true });
  const r = await page.evaluate(read);
  // The node the claim is about must exist before its state means anything.
  expect(r.paused, "no substrate to measure").not.toBeNull();
  expect(r.depth).toBe("0");
  expect(r.archive).toBe("1");
  expect(r.why).toEqual({ dark: false, covered: true });
  expect(r.paused).toBe(true);
  expect(errors).toEqual([]);
});

test("leaving depth 0 uncovers it at once, and draws before anything can see it", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: true });
  const before = await page.evaluate(read);
  expect(before.paused).toBe(true);

  await page.evaluate(() => window.__setDepth(1, "test"));
  const after = await page.evaluate(read);
  expect(after.depth).toBe("1");
  expect(after.why.covered).toBe(false);
  expect(after.paused).toBe(false);
  // Without the draw on the way out, the glass would show a frame from whenever
  // depth 0 began — possibly hours of sun ago.
  expect(after.frames).toBeGreaterThan(before.frames);

  await page.evaluate(() => window.__setDepth(0, "test"));
  expect((await page.evaluate(read)).paused).toBe(true);
  expect(errors).toEqual([]);
});

test("the panel coming back does NOT restart a field the archive still covers", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: true, v3EnergySaver: true });
  await page.evaluate(() => window.__v3PanelDark(true));
  expect(await page.evaluate(read)).toMatchObject({ why: { dark: true, covered: true }, paused: true });

  // 05:00. The panel is lit, the wall is still at depth 0 under the archive.
  await page.evaluate(() => window.__v3PanelDark(false));
  const r = await page.evaluate(read);
  expect(r.why).toEqual({ dark: false, covered: true });
  expect(r.paused).toBe(true);
  expect(errors).toEqual([]);
});

test("leaving depth 0 does NOT wake a field on a dark panel", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: true, v3EnergySaver: true });
  await page.evaluate(() => window.__v3PanelDark(true));

  // A doorbell at 3am takes the wall to depth 1 while the panel is still down.
  await page.evaluate(() => window.__setDepth(1, "test"));
  const r = await page.evaluate(read);
  expect(r.why).toEqual({ dark: true, covered: false });
  expect(r.paused).toBe(true);
  expect(errors).toEqual([]);
});

test("the archive off: never covered, at depth 0 or anywhere", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: false });
  const r = await page.evaluate(read);
  expect(r.paused, "no substrate to measure").not.toBeNull();
  expect(r.depth).toBe("0");
  expect(r.archive).toBeNull();
  expect(r.why).toEqual({ dark: false, covered: false });
  expect(r.paused).toBe(false);
  expect(errors).toEqual([]);
});

test("flag off: the field is never covered — the pause is the panel's alone, as it was", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: false, v3Archive: true });
  const r = await page.evaluate(read);
  expect(r.paused, "no substrate to measure").not.toBeNull();
  // Same conditions as the first test — archive on, depth 0 — so the only
  // difference between a paused field and this one is the flag.
  expect(r.depth).toBe("0");
  expect(r.archive).toBe("1");
  expect(r.why).toEqual({ dark: false, covered: false });
  expect(r.paused).toBe(false);
  expect(errors).toEqual([]);
});

test("flipped off live, it uncovers on the next depth change — the rollback needs no reload", async ({ page }) => {
  const errors = await bootV3(page, { v3SubstrateCoveredPause: true, v3Archive: true });
  expect((await page.evaluate(read)).paused).toBe(true);

  await page.evaluate(() => {
    window.CONFIG.features.v3SubstrateCoveredPause = false;
    window.__setDepth(1, "test");
    window.__setDepth(0, "test");
  });
  const r = await page.evaluate(read);
  expect(r.depth).toBe("0");
  expect(r.why.covered).toBe(false);
  expect(r.paused).toBe(false);
  expect(errors).toEqual([]);
});
