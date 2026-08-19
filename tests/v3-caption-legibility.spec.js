import { test, expect } from "./fixtures/coverage.js";
import { encodePng } from "./fixtures/png.js";

/* THE GROUND CAPTION'S PLACE IN THE PAINT ORDER.
 *
 * This file exists because of a defect that was invisible in every other kind
 * of check. `#ground-caption` was a child of `.photo`, and `.photo` is
 * `position: fixed` — which creates a stacking context on its own, whatever its
 * z-index. So the caption's `z-index: 2` was confined inside that context and
 * the browser painted it BENEATH `.scrim`: the one piece of text in V3 sitting
 * under the very layer whose job is to make text legible.
 *
 * Measured over the white ground in daylight with the gate's three-frame
 * method: the scrim owned 84% of the glyph and the caption read 1.02:1. Moved
 * out of that context it reads 5.29:1.
 *
 * ⚠ NOTHING ABOUT THE CSS LOOKED WRONG, and that is the point of testing it
 * here rather than trusting the stylesheet. `z-index: 2` beside a comment
 * saying "above .photo (1)" reads as correct and was wrong for as long as it
 * existed. A z-index is a claim about a stacking context, not about the page,
 * so the only honest check is the pixels.
 *
 * Two guards, deliberately different in kind: one structural (where the node
 * lives), one mechanistic (what survives an opaque scrim). The structural one
 * says what broke; the pixel one would also catch a NEW layer moving on top,
 * which the structural one never could.
 */

const WHITE_GROUND = encodePng(480, 270, () => [255, 255, 255]);

const CAPTIONED = {
  assets: [
    { id: "cap-a", localDateTime: "2013-08-13T06:00:00Z", city: "Nudgee", people: [], aspect: 1.78 }
  ]
};

async function bootWithCaption(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  /* Pinned on. The caption only exists behind this flag, and a flag-off run
     proves nothing about it — an empty caption is skipped by every text sweep
     in the repo, which is exactly how this defect survived.

     ⚠⚠ AND v3Archive PINNED **OFF**, which this file did not need until that
     flag went default-on 2026-08-20. The archive takes the depth-0 face and
     hides #ground-caption, so an inherited default-on made the glyph count come
     back 0 and this spec failed with "something is ALREADY painted over it" —
     a true sentence about the archive and a false one about the scrim.

     Pinning it off keeps the subject of this file the SCRIM, which is what it
     is for. Whether the archive should be allowed to cover the caption is a
     different question, asked on the wall, not here. */
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        "\nwindow.CONFIG.features.groundMemories = true;" +
        "\nwindow.CONFIG.features.v3Archive = false;\n"
    });
  });
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify(CAPTIONED) })
  );
  // The worst case by construction: nothing real is this bright everywhere.
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: WHITE_GROUND })
  );

  /* ⚠ DAYLIGHT, PINNED. At night the caption is `opacity: 0` by design, so
     every assertion below would pass for the wrong reason — "no glyph pixels
     were covered" is trivially true when there are no glyph pixels. */
  await page.clock.setFixedTime(new Date("2026-07-06T12:00:00"));
  await page.goto("/v3/");
  await expect.poll(() => page.evaluate(() => window.__ground?.().shown === true), { timeout: 15_000 }).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.dataset.night ?? null),
    "the phase pin failed — a night run cannot test the caption"
  ).not.toBe("1");

  /* ⚠ The caption fades in over 1.2s. A screenshot taken during that fade
     reads a real computed opacity that was never the resting state — 0.191 in
     the session that found this — and reports zero glyph pixels. */
  await page.addStyleTag({
    content: "*, *::before, *::after { transition: none !important; animation: none !important; }"
  });
  await expect.poll(() => page.evaluate(() => document.getElementById("ground-caption").textContent))
    .toBe("Nudgee · 2013");

  return pageErrors;
}

/**
 * The caption's glyphs, in a colour nothing else on the wall is painted in.
 *
 * ⚠ INTERIORS ONLY, and the margin is why. An antialiased EDGE pixel is a blend
 * of ink and whatever is behind it, so changing the backdrop legitimately
 * changes how many edge pixels still read as green — the first version of this
 * counted 784 before and 574 after and called a healthy caption buried. A
 * strong margin keeps only pixels the glyph fully covers, and those are
 * independent of the backdrop, which is the property the assertion needs.
 *
 * `maxGreen` is the decisive one: fully buried under an opaque scrim it goes to
 * zero, whatever the counting threshold does.
 */
async function glyphPixels(page) {
  await page.evaluate(() => {
    const cap = document.getElementById("ground-caption");
    cap.style.setProperty("color", "rgb(0,255,0)", "important");
    cap.style.setProperty("-webkit-text-fill-color", "rgb(0,255,0)", "important");
    // The shadow is a second legibility mechanism and would blur the count.
    cap.style.setProperty("text-shadow", "none", "important");
  });
  const shot = await page.screenshot({ type: "png" });
  return page.evaluate(async (b64) => {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = b64;
    });
    const cv = document.createElement("canvas");
    cv.width = img.width;
    cv.height = img.height;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const r = document.getElementById("ground-caption").getBoundingClientRect();
    const s = img.width / window.innerWidth;
    const d = ctx.getImageData(
      Math.round(r.x * s), Math.round(r.y * s),
      Math.round(r.width * s), Math.round(r.height * s)
    ).data;
    let count = 0;
    let maxGreen = 0;
    for (let i = 0; i < d.length; i += 4) {
      const margin = Math.min(d[i + 1] - d[i], d[i + 1] - d[i + 2]);
      if (margin > 100) count += 1;
      if (margin > 0 && d[i + 1] > maxGreen) maxGreen = d[i + 1];
    }
    return { count, maxGreen };
  }, `data:image/png;base64,${shot.toString("base64")}`);
}

test("the caption is not inside a stacking context that can bury it", async ({ page }) => {
  const pageErrors = await bootWithCaption(page);

  /* The blunt structural invariant. `position: fixed` creates a stacking
     context BY ITSELF in every current browser — z-index need not be set — so
     "which ancestors have a z-index" is not the question. The question is
     whether it has any positioned ancestor at all. */
  const where = await page.evaluate(() => {
    const cap = document.getElementById("ground-caption");
    const ancestors = [];
    for (let el = cap.parentElement; el && el !== document.documentElement; el = el.parentElement) {
      const s = getComputedStyle(el);
      ancestors.push({
        el: el.id || (typeof el.className === "string" && el.className) || el.tagName,
        position: s.position,
        zIndex: s.zIndex,
        opacity: s.opacity,
        transform: s.transform,
        filter: s.filter,
        // Every one of these creates a stacking context and would re-bury it.
        makesContext:
          s.position === "fixed" ||
          s.position === "sticky" ||
          (s.position !== "static" && s.zIndex !== "auto") ||
          parseFloat(s.opacity) < 1 ||
          s.transform !== "none" ||
          s.filter !== "none" ||
          s.isolation === "isolate" ||
          s.mixBlendMode !== "normal"
      });
    }
    return { parent: cap.parentElement.tagName, ancestors };
  });

  expect(where.parent, "the caption must be a direct child of <body>").toBe("BODY");
  expect(
    where.ancestors.filter((a) => a.makesContext),
    `an ancestor creates a stacking context, so the caption's z-index is a claim about ` +
      `that context and not about the page — this is exactly the 1.02:1 defect:\n` +
      JSON.stringify(where.ancestors, null, 2)
  ).toHaveLength(0);

  expect(pageErrors).toEqual([]);
});

test("an opaque scrim cannot erase the caption", async ({ page }) => {
  const pageErrors = await bootWithCaption(page);

  const before = await glyphPixels(page);
  expect(
    before.count,
    "no glyph pixels found before the scrim was even touched — either the caption " +
      "did not render, or something is ALREADY painted over it"
  ).toBeGreaterThan(100);

  /* Drive the scrim to fully opaque, in a colour the count cannot mistake for
     ink. This is a mechanism test, not a ratio test: if ANY layer is painting
     over this text — the scrim today, something new tomorrow — the glyphs
     vanish here. It is the check that would have caught the original defect on
     the day it shipped, without anyone having to compute a contrast ratio. */
  await page.evaluate(() => {
    const r = document.documentElement;
    r.style.setProperty("--scrim-base", "rgb(255,0,0)");
    r.style.setProperty("--scrim-opacity", "1");
  });
  const after = await glyphPixels(page);

  const report =
    `before ${before.count} px (brightest ${before.maxGreen}), ` +
    `after ${after.count} px (brightest ${after.maxGreen})`;

  /* ⚠ THE BRIGHTEST GLYPH PIXEL IS THE ASSERTION, not the pixel count, and the
     difference is not pedantry. Only a FULLY covered pixel is independent of
     what is behind it; a partially covered one is a blend, so changing the
     backdrop from white to red legitimately moves the count at every threshold
     (643 -> 452 here, with the caption in perfect health). Comparing counts
     would make this spec fail for a reason that has nothing to do with paint
     order. Buried, `maxGreen` goes to ZERO — the box becomes the scrim — so it
     separates the two states cleanly and for the right reason. */
  expect(
    after.maxGreen,
    `the scrim erased the caption — ${report}. It is beneath the scrim, the ` +
      "layer whose entire job is to make text legible."
  ).toBeGreaterThan(before.maxGreen * 0.9);
  // And the glyphs are still substantially on the glass, not down to one pixel.
  expect(after.count, `almost nothing survived the scrim — ${report}`).toBeGreaterThan(100);

  expect(pageErrors).toEqual([]);
});
