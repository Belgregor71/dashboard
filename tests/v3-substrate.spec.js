import { test, expect } from "./fixtures/coverage.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE WEBGL-LOSS GAP — cutover handover move ① (docs/design/V3-CUTOVER.md).

   §5's runtime coverage found `substrate/canvas2d.js` 100% dead: 138 lines that
   had never executed once, plus index.js's `webglcontextlost` handler and both
   `destroy()`s. Every machine that has ever run this code — headless Chromium,
   the G11, the Pi before it — has WebGL2, so the fallback was chosen by nothing
   and exercised by nobody. Once `/` serves V3 there is no second surface: a GPU
   reset at 3am drops the ONLY wall into that code.

   ⚠⚠ IT WAS BROKEN, AND ONLY RUNNING IT COULD SHOW THAT. A canvas keeps its
   context type for life — `getContext("2d")` on the element the shader was
   using returns null, lost context or not. So the loss handler built `null` for
   a backend and every later `update()`, `setPaused()` and `.backend` read threw
   a TypeError. On the wall: a frozen field, and an uncaught error on every
   causes tick for as long as the page lives. Reading the handler could not
   reveal that; losing a real context did, first try.

   The two ways in, and both are used below because they cover different code:
     ?__backend=canvas2d   the cold fallback — a machine with no WebGL at all
     WEBGL_lose_context    the genuine handler path — a GPU that went away

   Each assertion names one cause, and every one was proven red by mutation —
   listed by the test numbers as they run:

     the canvas swap removed (the shipped bug)       → 3, 5, 8
     replaceWith() → after() (the new one BESIDE)    → 3, 4
     `?? INERT` dropped                              → 6
     the rebuild's try/catch dropped                 → 7
     the pause not inherited across the swap         → 8
     the ?__backend seam not passed through main.js  → 1
     canvas2d's moving() replaced by false           → 2

   ⚠ Two near-misses worth keeping: removing the swap leaves 4 GREEN (one canvas
   is still one canvas), and removing the seam leaves 2 green (the GL backend
   animates in the wind exactly as the 2D one does). Neither assertion is
   redundant with the other — they fail to different mutations, which is the
   only reason both are here.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-07-06T12:00:00");

/* A windy, rainy hour. Wind is the only cause that makes the field MOVE, so a
   still fixture cannot see the loop at all — and the loop is where a fallback
   that resumed against a dark panel would cost 15fps a night. */
const BLUSTERY = {
  now: {
    wind_kph: 34,
    wind_bearing: 130,
    cloud_pct: 78,
    condition: { label: "Rain", icon: "rain", intensity: "moderate" }
  }
};

async function bootV3(page, { query = "", weather = null, flags = {} } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.clock.setFixedTime(MIDDAY);

  if (Object.keys(flags).length) {
    await page.route("**/js/config.js", async (route) => {
      const res = await route.fetch();
      const body = (await res.text()) +
        Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
      await route.fulfill({ response: res, body });
    });
  }

  /* ⚠ The catch-all is registered FIRST on purpose — Playwright matches route
     handlers in REVERSE registration order, so a catch-all added last would
     swallow the weather stub and every "the field moves" case would fail for a
     reason that has nothing to do with the substrate. */
  await page.route("**/api/**", (route) =>
    route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));

  if (weather) {
    await page.route("**/api/weather/now", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weather) }));
  }

  await page.goto(`/v3/${query}`);
  await page.waitForFunction(() => typeof window.__v3Boot === "function");
  return pageErrors;
}

/** Take the context away for real, the way a driver reset does. */
async function loseTheContext(page) {
  const asked = await page.evaluate(() => {
    const gl = document.getElementById("substrate").getContext("webgl2");
    const ext = gl?.getExtension("WEBGL_lose_context");
    if (!ext) return false;
    ext.loseContext();
    return true;
  });
  // A fixture that silently did nothing would make every assertion below pass
  // for the wrong reason — the §4 lesson, in one line.
  expect(asked, "WEBGL_lose_context is unavailable — the loss was never injected").toBe(true);
  await page.waitForFunction(() => window.__substrate?.().backend !== "webgl2", null, { timeout: 5000 });
}

/**
 * Did the field actually PAINT? A frame counter only says draw() was entered.
 * The horizon is warm at the bottom and cool at the top by construction, so two
 * pixels prove the gradient reached the panel — the same reason the cutover's
 * other steps insisted on a screenshot over a measurement.
 */
async function horizon(page) {
  return page.evaluate(() => {
    const ctx = document.getElementById("substrate").getContext("2d");
    if (!ctx) return null;
    const at = (x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3);
    return { bottom: at(240, 262), top: at(240, 6) };
  });
}

test.describe("the cold fallback — a machine with no WebGL at all", () => {
  test("the whole wall comes up on canvas 2D, and the field is painted", async ({ page }) => {
    const errors = await bootV3(page, { query: "?__backend=canvas2d", weather: BLUSTERY });

    const got = await page.evaluate(() => ({
      backend: window.__substrate().backend,
      renderer: window.__substrate().renderer,
      frames: window.__substrate().frames,
      failed: window.__v3Boot().failed,
      depth: window.__depth?.().depth ?? null,
      hour: document.getElementById("hour")?.textContent ?? ""
    }));

    expect(got.backend, "the seam did not reach initSubstrate").toBe("canvas2d");
    expect(got.renderer).toBe("canvas2d");
    expect(got.frames).toBeGreaterThan(0);
    // The fallback is silent by design: nothing above it may notice which
    // backend it got, so a boot on 2D is an ordinary boot in every other way.
    expect(got.failed).toEqual([]);
    expect(got.depth, "the field is the floor and must be reached regardless").toBe(0);
    expect(got.hour).toMatch(/^\d{1,2}:\d{2}$/);
    expect(errors).toEqual([]);

    const px = await horizon(page);
    expect(px, "no 2D context on the substrate canvas — nothing drew").not.toBeNull();
    expect(
      px.bottom[0] - px.top[0],
      `the horizon never painted (bottom ${px.bottom}, top ${px.top})`
    ).toBeGreaterThan(15);
  });

  test("the field still MOVES on the fallback — wind drives the loop", async ({ page }) => {
    await bootV3(page, { query: "?__backend=canvas2d", weather: BLUSTERY });

    const before = await page.evaluate(() => window.__substrate());
    expect(before.animating, "a blustery hour left the 2D field standing still").toBe(true);

    await page.waitForTimeout(400);
    const after = await page.evaluate(() => window.__substrate());
    // 15fps ceiling — six frames in 400ms, so this is a floor, not a count.
    expect(after.frames).toBeGreaterThan(before.frames);
  });
});

test.describe("a GPU that went away", () => {
  test("⚠ the lost context lands on a WORKING 2D field, not a null backend", async ({ page }) => {
    /* THE SHIPPED BUG. Before the canvas swap this left `impl === null`, and
       the very next read of window.__substrate() threw
       "Cannot read properties of null (reading 'backend')". */
    const errors = await bootV3(page, { weather: BLUSTERY });
    expect(await page.evaluate(() => window.__substrate().backend)).toBe("webgl2");

    await loseTheContext(page);

    const got = await page.evaluate(() => window.__substrate());
    expect(got.backend, "the fallback was never built").toBe("canvas2d");
    expect(got.frames, "the replacement never drew its first frame").toBeGreaterThan(0);

    const px = await horizon(page);
    expect(px, "the surviving canvas cannot give a 2D context — the swap did not happen").not.toBeNull();
    expect(px.bottom[0] - px.top[0], `the horizon never repainted (bottom ${px.bottom}, top ${px.top})`)
      .toBeGreaterThan(15);
    expect(errors).toEqual([]);
  });

  test("⚠ the replacement canvas is still ON THE WALL, in the same place", async ({ page }) => {
    /* The swap is what makes 2D possible at all, and it is also the move that
       could quietly delete the field: a detached replacement paints happily
       into memory and shows a black rectangle to the room. */
    await bootV3(page);
    const parentBefore = await page.evaluate(() =>
      document.getElementById("substrate").parentElement.tagName);

    await loseTheContext(page);

    const dom = await page.evaluate(() => {
      const all = document.querySelectorAll("canvas.substrate");
      const c = document.getElementById("substrate");
      return {
        count: all.length,
        connected: c.isConnected,
        parent: c.parentElement.tagName,
        first: c.parentElement.firstElementChild === c,
        size: [c.width, c.height]
      };
    });

    expect(dom.count, "the old canvas was left in the DOM beside the new one").toBe(1);
    expect(dom.connected).toBe(true);
    expect(dom.parent).toBe(parentBefore);
    // The field is the floor of the stack; anything above it must stay above it.
    expect(dom.first).toBe(true);
    expect(dom.size, "the 480x270 backing store did not survive the clone").toEqual([480, 270]);
  });

  test("⚠ the layer above keeps driving it — the panel still darkens and wakes", async ({ page }) => {
    /* The failure that outlives the loss. Nothing above the substrate checks
       which backend it got, so with a null impl the first setPaused() after a
       lost context threw — meaning the 3am GPU reset broke that night's panel
       darkening too, from inside an unrelated subsystem. */
    const errors = await bootV3(page, { weather: BLUSTERY, flags: { v3EnergySaver: true, displayWake: true } });
    await loseTheContext(page);

    const dark = await page.evaluate(() => {
      window.__v3PanelDark(true);
      return window.__substrate();
    });
    expect(dark.paused).toBe(true);
    expect(dark.animating, "a paused field is still burning a core against a dark panel").toBe(false);

    const lit = await page.evaluate(() => {
      window.__v3PanelDark(false);
      return window.__substrate();
    });
    expect(lit.paused).toBe(false);
    // Waking draws immediately: the causes it is holding are up to a night old.
    expect(lit.frames).toBeGreaterThan(dark.frames);
    expect(errors, "the panel handler threw across the backend swap").toEqual([]);
  });

  /* THE LAST RESORT. Both refusals are injected from the test rather than
     through a production seam — the page is monkeypatched, so nothing ships to
     make this reachable. "returns null" is the documented answer when a context
     cannot be created; "throws" is what a browser under real memory pressure
     does, and the difference decides whether a try/catch is doing anything. */
  for (const [how, shouldThrow] of [["refuses", false], ["throws", true]]) {
    test(`⚠ when 2D also ${how}, the wall keeps working — a still field, not a broken one`, async ({ page }) => {
      const errors = await bootV3(page, { weather: BLUSTERY, flags: { v3EnergySaver: true, displayWake: true } });

      await page.evaluate((angry) => {
        const orig = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
          if (type !== "2d") return orig.call(this, type, ...rest);
          if (angry) throw new Error("out of memory");
          return null;
        };
      }, shouldThrow);

      await loseTheContext(page);

      const got = await page.evaluate(() => {
        // Everything above the substrate calls these unconditionally, and none
        // of it knows or may ask which backend it got.
        window.__v3PanelDark(true);
        window.__v3PanelDark(false);
        return { ...window.__substrate(), v3: Boolean(window.__v3()) };
      });

      expect(got.backend, "a null backend is still in there").toBe("none");
      expect(got.animating).toBe(false);
      expect(got.v3).toBe(true);
      expect(errors, "the loss handler threw out of an event dispatch").toEqual([]);
    });
  }

  test("⚠ a context lost while the PANEL IS DARK must not start a loop", async ({ page }) => {
    /* The 3am case, and the one with no witness. The replacement backend starts
       life unpaused and the wrapper holds the only surviving copy of the pause,
       so without the inheritance a driver hiccup at 3am resumes a 15fps loop
       against a powered-down panel until morning — and leaves no trace. */
    await bootV3(page, { weather: BLUSTERY, flags: { v3EnergySaver: true, displayWake: true } });
    await page.evaluate(() => window.__v3PanelDark(true));
    expect(await page.evaluate(() => window.__substrate().paused)).toBe(true);

    await loseTheContext(page);

    const got = await page.evaluate(() => window.__substrate());
    expect(got.backend).toBe("canvas2d");
    expect(got.paused, "the replacement forgot the panel was off").toBe(true);
    expect(got.animating, "a fresh 15fps loop against a dark panel").toBe(false);
    expect(got.frames, "it drew a frame the dark panel cannot show").toBe(0);
  });
});
