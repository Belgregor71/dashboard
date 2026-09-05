import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLUTIONS ON THE WALL — src/v3/core/resolutions.js.

   The wording, the freshness floor and the one-shot are server-side and are
   tested in tests/unresolved.spec.js against the store itself. This file has
   one job the store cannot do: prove that the line reaches the queue AND that
   the queue keeps it in its place.

   ⚠⚠ THE LOAD-BEARING ASSERTIONS HERE ARE THE NEGATIVE ONES, and for the same
   reason v3-health.spec.js says so about the pill. "A resolution was
   announced" is true of any implementation that also shouts it across the
   glass in 132px Fraunces — which is exactly what core/health.js used to do
   with a fault, until the owner's verdict at the panel ("the big text error
   messages take away from the dashboard itself") reversed it on 2026-09-01.
   Good news in that register is not an improvement on bad news in it.

   So what is actually being proved is a pair: the candidate IS in the queue
   (so silence is the band working, not the feature being broken) and
   `#glance-said` is empty with the depth still at 0 (so the band is working).
   Either half alone is a green test against a wall that is wrong.
   ═══════════════════════════════════════════════════════════════════════════ */

const RESOLUTION = {
  key: "camera-silent:kitchen",
  text: "The kitchen camera is reporting again, on its own.",
  resolvedAt: Date.now()
};

/**
 * Boot V3 with the resolutions feed under our control.
 *
 * ⚠ `enabled` writes the flag onto window.CONFIG rather than editing
 * src/js/config.js, so this spec pins the state it means in BOTH directions
 * and does not inherit whichever way the committed default happens to point.
 * A flag flip must not be able to quietly turn one of these tests into a test
 * of the other state — that is the ambientSubstrate lesson.
 */
async function bootV3(page, { enabled = false, resolutions = [] } = {}) {
  const pageErrors = [];
  const posted = [];
  const spoke = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3ResolutionVoice = ${enabled};\n`
    });
  });

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname === "/api/house/resolutions") {
      posted.push({ method: "GET" });
      return json({ resolutions });
    }
    if (url.pathname === "/api/house/resolutions/aired") {
      posted.push({ method: "POST", body: route.request().postDataJSON() });
      return json({ aired: 1 });
    }
    /* ⚠ COUNTED, NOT JUST STUBBED. "It never speaks" is a claim about a request
       that must not happen, and the only way to assert an absence is to be the
       thing that would have received it. */
    if (url.pathname.startsWith("/api/tts")) {
      spoke.push(url.pathname);
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    }
    if (/\/(thumb|snapshot|live|image|basemap|overlay)/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64")
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return { pageErrors, posted, spoke };
}

/** What is on the glass, and what the queue is holding. */
async function wall(page) {
  return page.evaluate(() => ({
    announced: window.__v3().announced.filter((c) => c.source === "resolution"),
    /* ⚠ TWO READINGS OF THE SAME CANDIDATE, because they carry different
       fields. `announcements()` reports id/source/score/expiresAt — the
       announce lane's own book — and only the RANKED QUEUE reports
       `interrupt`, which is the field that decides whether this can seize the
       wall. Asserting the band from the first alone would leave the one
       property that matters unmeasured. */
    queued: (window.__v3().attention?.queue ?? []).filter((c) => c.source === "resolution"),
    glance: (document.getElementById("glance-said").textContent ?? "").trim(),
    measured: (document.getElementById("glance-measured").textContent ?? "").trim(),
    depth: document.documentElement.dataset.depth,
    last: window.__v3().resolutions
  }));
}

test.describe("flag OFF — the committed default", () => {
  test("⚠ nothing is armed, and the feed is never asked", async ({ page }) => {
    const { pageErrors, posted } = await bootV3(page, { enabled: false, resolutions: [RESOLUTION] });

    /* ⚠ THE REQUEST IS THE MEASUREMENT, not the argument. This repo has retired
       flags as DEAD LEVERS after finding 0 occurrences in the bundle; the
       mirror-image error is asserting a feature is off by reasoning about the
       code. A fixture is sitting on the other end of that route with a line in
       it — if the flag leaked, this goes red. */
    expect(posted, "the flag is off and the wall polled anyway").toEqual([]);
    expect(await page.evaluate(() => typeof window.__v3Resolutions)).toBe("undefined");

    /* Null, not `{announced: []}`. The two readings must stay distinguishable:
       one is a feature that is not armed, the other is a house with nothing to
       report — and only one of them would be a bug. */
    const got = await wall(page);
    expect(got.last).toBeNull();
    expect(got.announced).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("flag ON — the line reaches the queue and stays in the Low band", () => {
  test("⚠ it is announced, and it does NOT take the glance", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { enabled: true, resolutions: [RESOLUTION] });
    await page.evaluate(() => window.__v3Resolutions());
    const got = await wall(page);

    /* The positive half: it really is in the queue.

       ⚠ ASSERTED ON THE QUEUE, NOT ON THE POLL'S RETURN VALUE, and that is a
       correction rather than a preference. `initResolutions` polls once at
       boot, so by the time `__v3Resolutions()` runs the line has usually
       already been announced and that call correctly returns [] — the
       one-shot working. A first draft asserted the return and went red against
       an implementation that was doing exactly the right thing. The handle is
       still called, because it makes the state deterministic rather than a
       race with the boot poll; it is just not the thing being measured. */
    expect(got.announced, "the resolution never reached the queue").toHaveLength(1);
    expect(got.announced[0].id).toBe("resolution:camera-silent:kitchen");
    expect(got.last, "the poll never recorded a verdict").toBeTruthy();

    /* ⚠⚠ THE NEGATIVE HALF, WHICH IS THE FEATURE. Score 41 is the Low band, so
       `attentionRank.selectForMode` cannot give it depth 1 — that needs
       `interrupt` or the High floor at 70 — and an empty room is
       interrupt-only besides. A surface that lit up for a camera coming back
       is a surface nobody trusts. */
    expect(got.announced[0].score, "the resolution is not in the Low band").toBe(41);
    expect(got.queued, "the candidate never reached the ranked queue").toHaveLength(1);
    expect(got.queued[0].interrupt, "the resolution can interrupt the room").toBe(false);
    /* ⚠ `announce()` REQUIRES an end, and its reason is exactly this case: "an
       announcement with no end is a claim about the present that becomes a
       lie, and there is no timer here to clean it up." A null here is a cell
       that never leaves. */
    expect(got.announced[0].expiresAt, "the resolution never expires").toBeGreaterThan(Date.now());
    expect(got.glance, "the resolution took the glance").toBe("");
    expect(got.depth, "the resolution deepened the surface").toBe("0");
    expect(pageErrors).toEqual([]);
  });

  test("⚠ it never speaks", async ({ page }) => {
    /* core/health.js's rule, and it is about FREQUENCY rather than sentiment: a
       wall that runs for weeks and talks about its own plumbing is the surface
       teaching the household to stop listening to it. The line is written to
       be READ. */
    const { spoke } = await bootV3(page, { enabled: true, resolutions: [RESOLUTION] });
    await page.evaluate(() => window.__v3Resolutions());
    expect(spoke, "the house said its own maintenance out loud").toEqual([]);
  });

  test("⚠ even a room with someone standing in it does not get the glance", async ({ page }) => {
    /* The empty-room filter (MODE.AMBIENT is interrupt-only) would carry the
       test above on its own, which would make it green for a reason that has
       nothing to do with the band. Presence removes that alibi: with someone
       in the room the queue is genuinely free to promote this, and the score
       is the only thing still holding it down. */
    await bootV3(page, { enabled: true, resolutions: [RESOLUTION] });
    const got = await page.evaluate(async () => {
      await window.__v3Resolutions();
      window.__v3Presence(true);
      /* ⚠⚠ `__v3Tick`, NOT `__refreshAttention`. They are different engines and
         the wrong one makes this test measure nothing at all — proved by
         injection on 2026-09-05: with SCORE raised to 72 (which MUST take the
         glance) this test stayed GREEN, because `__refreshAttention` is
         attentionEngine's own async briefing refresh and never re-runs V3's
         tick. Nothing re-rendered, so the glance was empty for the same reason
         a wall that had never booted would be. `__v3Tick` is the handle that
         re-evaluates depth and writes the cell. */
      window.__v3Tick();
      return {
        present: window.__v3Presence().present,
        hero: window.__v3().attention?.hero?.source ?? null,
        glance: (document.getElementById("glance-said").textContent ?? "").trim(),
        depth: document.documentElement.dataset.depth
      };
    });
    expect(got.present, "presence did not take — the alibi is back").toBe(true);
    /* ⚠ AND THE TICK REALLY RANKED IT. Without this the two assertions below
       are satisfied by any tick that did nothing, which is the failure this
       test was just found to have. */
    expect(got.hero, "the resolution did not even reach the ranking").toBe("resolution");
    expect(got.glance, "the resolution took the glance").toBe("");
    expect(got.depth, "the resolution deepened the surface").toBe("0");
  });

  test("the airing is POSTed with the key that was announced", async ({ page }) => {
    const { posted } = await bootV3(page, { enabled: true, resolutions: [RESOLUTION] });
    await page.evaluate(() => window.__v3Resolutions());
    await expect.poll(() => posted.filter((p) => p.method === "POST").length).toBeGreaterThan(0);

    const air = posted.find((p) => p.method === "POST");
    expect(air.body.keys).toEqual(["camera-silent:kitchen"]);
  });

  test("⚠ a feed that keeps returning the same line does not repeat it", async ({ page }) => {
    /* The server burns it on the POST, so a correct server never offers it
       twice. This asserts the client's own belt: `seen` means a POST that
       failed costs one repeat at most, not a cell that re-announces every
       minute for the life of a page that runs for weeks.

       ⚠ THE FIXTURE KEEPS SERVING IT, WHICH IS THE POINT. This route never
       stops returning the same line, so nothing but `seen` is preventing four
       announcements here — the server's one-shot is deliberately taken out of
       the picture so the client's own is what is measured. */
    const { posted } = await bootV3(page, { enabled: true, resolutions: [RESOLUTION] });
    const counts = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 3; i++) out.push((await window.__v3Resolutions()).length);
      return out;
    });

    // Every poll after the first (the boot one) announced nothing.
    expect(counts, "the same resolution was announced more than once").toEqual([0, 0, 0]);
    // And exactly one candidate stands, from exactly one airing.
    expect((await wall(page)).announced).toHaveLength(1);
    expect(posted.filter((p) => p.method === "POST")).toHaveLength(1);
  });

  test("a house with nothing to report announces nothing, and says so", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { enabled: true, resolutions: [] });
    await page.evaluate(() => window.__v3Resolutions());
    const got = await wall(page);
    expect(got.announced).toEqual([]);
    // ⚠ Not null — the poll happened and found nothing, which is the ordinary
    // reading on almost every one of these and must not look like "not armed".
    expect(got.last).toBeTruthy();
    expect(got.last.announced).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("a rubbish payload is ignored rather than announced", async ({ page }) => {
    await bootV3(page, {
      enabled: true,
      resolutions: [{ key: "a" }, { text: "  " }, null, { key: "b", text: 42 }]
    });
    await page.evaluate(() => window.__v3Resolutions());
    expect((await wall(page)).announced).toEqual([]);
  });
});
