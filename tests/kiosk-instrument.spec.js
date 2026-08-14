import { test, expect } from "./fixtures/coverage.js";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MANIFESTS, detectExpr, verdict } = require("../scripts/kiosk/surface.cjs");

/* ═══════════════════════════════════════════════════════════════════════════
   THE MEASUREMENT INSTRUMENT'S OWN SEAMS.

   This is the test that would have caught the V3 cutover breaking the sweep.

   On 2026-08-14, a live probe of the wall found `__wakeScreensaver`,
   `__engageScreensaver`, `__forceAtmoEpisode`, `__switchView`, `__archive` and
   `__atmosphere` ALL undefined. `/` had served V3 since the cutover; every one
   of those is an incumbent hook. `kiosk-sweep.sh` drove them anyway, so its
   wake, its rain-heavy re-fire and its view cycle were no-ops — it would log
   ambient three times and label the second one a peak. Nothing failed. The
   whole M1 measurement gate sat on readings that could not have been taken.

   It was the SECOND time: `kiosk-drive.cjs cycle` printed "cycled 6x" while
   being a total no-op for weeks after Phase 7 shipped, and the lottie-churn
   leak test it exists to drive measured nothing the entire time.

   Both incidents have the same shape — **the instrument's seams are page
   internals, and page internals move.** A comment cannot hold them still and a
   probe cannot notice they are gone, because a missing hook is `undefined` and
   `undefined` is not an error until something calls it.

   So the manifest in surface.cjs is the contract, and this file is what makes it
   one. It is deliberately dull: no measurement, no CDP, no kiosk. It asks the
   real page whether the seams the sweep declares are there.

   ⚠ If a name here needs changing, the sweep needs changing in the same commit.
   That is the entire point of the file — do not "update the manifest until
   green" without reading what moved.
   ═══════════════════════════════════════════════════════════════════════════ */

async function bootV3(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

test("every seam the sweep declares for V3 exists on the V3 page", async ({ page }) => {
  await bootV3(page);

  const present = await page.evaluate(
    (names) => Object.fromEntries(names.map((n) => [n, typeof window[n]])),
    MANIFESTS.v3.required
  );

  // Named individually rather than as a set difference, so a failure says WHICH
  // seam went and the reader does not have to diff two arrays by eye.
  for (const name of MANIFESTS.v3.required) {
    expect(present[name], `window.${name} is a required seam of kiosk-sweep.sh`).toBe("function");
  }
});

test("the detector recognises the V3 surface and clears it to sample", async ({ page }) => {
  await bootV3(page);

  const detected = await page.evaluate((expr) => JSON.parse(eval(expr)), detectExpr());

  expect(detected.surface).toBe("v3");
  expect(detected.missing).toEqual([]);
  expect(verdict(detected).ok).toBe(true);
});

test("the detector REFUSES rather than sampling when a seam is missing", async ({ page }) => {
  await bootV3(page);

  /* The half that matters. A tripwire nobody has watched fire is not a
     tripwire — that sentence is already in heap-metrics.cjs's own footer,
     written after `cycle` spent weeks reporting success while doing nothing.
     So: actually remove a seam, and prove the instrument stops. */
  const detected = await page.evaluate((expr) => {
    const saved = window.__substrate;
    delete window.__substrate;
    const out = eval(expr);
    window.__substrate = saved;
    return JSON.parse(out);
  }, detectExpr());

  expect(detected.missing).toContain("__substrate");

  const v = verdict(detected);
  expect(v.ok).toBe(false);
  expect(v.why).toContain("__substrate");
});

test("an unbooted page is refused too, not treated as a quiet one", async ({ page }) => {
  // `unknown` has to be fatal in its own right. A page that is neither surface
  // has thrown on the way up or has not finished booting, and a sample taken
  // from it looks exactly like a very calm dashboard.
  const v = verdict({ surface: "unknown", missing: [], absent: [], url: "/" });
  expect(v.ok).toBe(false);
  expect(v.why).toContain("neither");
});

test("__substrate reports the fields the fps delta is computed from", async ({ page }) => {
  await bootV3(page);

  const s = await page.evaluate(() => window.__substrate());

  /* `frames` is monotonic since page load and `seconds` is its clock; the sweep
     brackets a window and divides. This is the ONLY honest frame rate on V3 —
     `document.getAnimations()` cannot see a rAF loop on a canvas, which is how a
     15.0 fps live-ambient sample once read `anims: 0` and would have been filed
     under the quiescent row. */
  expect(typeof s.frames).toBe("number");
  expect(typeof s.seconds).toBe("number");
  expect(typeof s.animating).toBe("boolean");
  expect(typeof s.paused).toBe("boolean");
});

test("an unknown subject id is the documented way to clear the subject", async ({ page }) => {
  await bootV3(page);

  /* The subject cycle relies on this to return to a known state between steps,
     and it is a BEHAVIOUR rather than an API: showSubject() calls
     clearSubject() before it looks the id up, so an id that is not in the
     registry tears down whatever was mounted and returns false.

     That is load-bearing and entirely implicit. A refactor that moved the
     registry lookup above the clear would leave the cycle mounting subjects on
     top of each other while still reporting every step as landed — so it is
     pinned here rather than left as a comment in a shell script. */
  const result = await page.evaluate(async () => {
    await window.__v3Subject("show.status");
    const mounted = window.__v3().subject;
    const cleared = await window.__v3Subject("__not.a.subject__");
    return {
      mounted,
      cleared,
      after: window.__v3().subject,
      mountChildren: document.getElementById("subject-mount")?.children.length ?? null
    };
  });

  expect(result.mounted).toBe("show.status");
  expect(result.cleared).toBe(false);
  expect(result.after).toBeNull();
  expect(result.mountChildren).toBe(0);
});
