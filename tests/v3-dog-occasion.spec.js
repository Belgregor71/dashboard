import { test, expect } from "@playwright/test";
import { DOGS, MOTION, OCCASIONS } from "../src/v3/core/dog-occasion.js";

/* ═══════════════════════════════════════════════════════════════════════════
   DOG OCCASION — Benji and Teddy peeking up for Christmas.

   What is asserted, and why:
     · inert until called: no node, no sheet fetched   → "costs nothing" must be
                                                          measured, not claimed
     · every frame 0..11 in order, each on its own
       cell, base on the box bottom                     → an off-by-one column or a
                                                          row/col swap shows a
                                                          neighbour's face
     · the per-frame gaps follow each dog's timing      → a constant frame rate
                                                          throws the characters away
     · pair staging: Benji left, Teddy right and
       0.88 the size, a clear gap, sunk below the edge  → overlap or a floating cut
     · z 15 between .stage and .presence, no pointer,
       no layout shift, no page error                   → an overlay that moves or
                                                          blocks the wall
     · busy call ignored, run removes itself, three
       runs in a row, hide() mid-run, a depth change   → a stacked or stranded
       mid-run                                            overlay on a 24/7 kiosk
     · reduced motion: last portrait only, no frames    → the still path must not
                                                          animate the sheet

   Real timers throughout: a run is ~5 s (Benji) / ~6.5 s (Teddy). The clock
   is fixed at local midday so the screensaver cannot engage mid-run.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");
const SHEETS = /\/assets\/dogs\//;

async function open(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // Console errors too, except the browser's own line for a failed fetch: the
  // test server stubs every upstream dead, so those are the suite's weather,
  // not this feature's. The sheets' own responses are asserted by status below
  // instead, so a missing sheet cannot hide inside that exclusion.
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  const sheetRequests = [];
  page.on("request", (r) => { if (SHEETS.test(r.url())) sheetRequests.push(r.url()); });
  page.on("response", (r) => { if (SHEETS.test(r.url()) && r.status() >= 400) errors.push(`sheet ${r.status()} ${r.url()}`); });
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.dogOccasion?.show === "function");
  return { errors, sheetRequests };
}

/* Watch ONE element's data-frame (never a body-subtree observer — that froze
   the kiosk's renderer once) and, on every change, measure where the sheet
   sits relative to the frame box, in cells. */
async function recordFrames(page) {
  await page.evaluate(() => {
    window.__dogRec = {};
    const watch = (dog) => {
      const id = dog.dataset.dog;
      const rec = (window.__dogRec[id] = []);
      const sample = () => {
        const f = Number(dog.dataset.frame);
        if (Number.isNaN(f) || rec.at(-1)?.frame === f) return;
        const box = dog.querySelector(".dog__frame").getBoundingClientRect();
        const sheet = dog.querySelector(".dog__sheet").getBoundingClientRect();
        rec.push({
          frame: f,
          t: performance.now(),
          // Cells from the sheet's origin to the box's left / bottom edge.
          col: (box.left - sheet.left) / box.width,
          rowPlusBase: (box.bottom - sheet.top) / box.height,
          sheetCols: sheet.width / box.width,
          sheetRows: sheet.height / box.height,
          clip: getComputedStyle(dog.querySelector(".dog__frame")).clipPath
        });
      };
      sample();
      new MutationObserver(sample).observe(dog, { attributes: true, attributeFilter: ["data-frame"] });
    };
    // <body>'s direct children only: the overlay is appended there, and the
    // callback (a microtask) runs before the first frame's timer can fire.
    const mount = new MutationObserver(() => {
      const dogs = document.querySelectorAll(".dogs .dog");
      if (!dogs.length) return;
      mount.disconnect();
      dogs.forEach(watch);
    });
    mount.observe(document.body, { childList: true });
  });
}

test.describe("dog occasion", () => {
  test.describe.configure({ timeout: 60_000 });

  test("config: every dog's timing covers its sheet exactly", () => {
    for (const [occ, modes] of Object.entries(OCCASIONS)) {
      for (const [mode, staged] of Object.entries(modes)) {
        const n = staged.grid.columns * staged.grid.rows;
        for (const [id, art] of Object.entries(staged.dogs)) {
          expect(DOGS[id], `${occ}/${mode}/${id}`).toBeTruthy();
          expect(DOGS[id].timing[mode]).toHaveLength(n);
          expect(art.frames).toHaveLength(n);
          expect(MOTION[DOGS[id].motion]).toBeTruthy();
        }
      }
    }
  });

  test("inert until called: no overlay and no sheet fetched", async ({ page }) => {
    const { errors, sheetRequests } = await open(page);
    await page.waitForTimeout(500);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(await page.evaluate(() => window.__v3().dogs)).toEqual(
      expect.objectContaining({ running: false, runs: 0, dogs: [] })
    );
    expect(sheetRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("the pair: every frame on its own cell, in order, on each dog's timing", async ({ page }) => {
    const { errors } = await open(page);
    // The wall settles after boot on its own — measured: #hour 799.7 → 770.8
    // within 700ms with no dog ever called. "Before" must be the settled wall,
    // or the check blames the dogs for the boot.
    await page.waitForFunction(() => new Promise((ok) => {
      const a = document.getElementById("hour").getBoundingClientRect().top;
      setTimeout(() => ok(a === document.getElementById("hour").getBoundingClientRect().top), 600);
    }), null, { timeout: 10_000 });
    const before = await page.evaluate(() => ({
      hour: JSON.stringify(document.getElementById("hour").getBoundingClientRect()),
      stage: JSON.stringify(document.querySelector(".stage").getBoundingClientRect()),
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth
    }));
    await page.evaluate(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls += e.value; })
        .observe({ type: "layout-shift", buffered: false });
    });
    await recordFrames(page);

    const done = page.evaluate(() => window.dogOccasion.show("christmas", { mode: "peek", dogs: ["benji", "teddy"] }));

    // Mid-run: staging, stacking, pointer, layout.
    // Length first: `[].every()` is true, and before the mount dogs is [].
    await page.waitForFunction(() => {
      const d = window.dogOccasion.state().dogs;
      return d.length === 2 && d.every((x) => x.phase === "idle");
    }, null, { timeout: 8_000 });
    const staged = await page.evaluate(() => {
      const root = document.querySelector(".dogs");
      const r = (s) => document.querySelector(s).getBoundingClientRect();
      const stageZ = Number(getComputedStyle(document.querySelector(".stage")).zIndex);
      const presenceZ = Number(getComputedStyle(document.querySelector(".presence")).zIndex);
      return {
        count: document.querySelectorAll(".dogs").length,
        parent: root.parentElement.tagName,
        z: Number(getComputedStyle(root).zIndex),
        stageZ, presenceZ,
        position: getComputedStyle(root).position,
        pointer: getComputedStyle(root).pointerEvents,
        benji: r(".dog--benji .dog__frame").toJSON(),
        teddy: r(".dog--teddy .dog__frame").toJSON(),
        benjiSheet: getComputedStyle(document.querySelector(".dog--benji .dog__sheet")).backgroundImage,
        vh: innerHeight, vw: innerWidth
      };
    });
    expect(staged.count).toBe(1);
    expect(staged.parent).toBe("BODY");
    expect(staged.position).toBe("fixed");
    expect(staged.pointer).toBe("none");
    expect(staged.z).toBeGreaterThan(staged.stageZ);
    expect(staged.z).toBeLessThan(staged.presenceZ);
    expect(staged.benjiSheet).toContain("/assets/dogs/christmas/benji-peek-sprite.png");
    // Present before placed: a 0-size box satisfies every check below.
    expect(staged.benji.height).toBeGreaterThan(200);
    expect(staged.teddy.height).toBeGreaterThan(200);
    expect(staged.teddy.height / staged.benji.height).toBeCloseTo(0.88, 2);
    expect(staged.benji.right).toBeLessThan(staged.teddy.left - 40);         // a clear gap
    expect((staged.benji.left + staged.benji.right) / 2).toBeLessThan(staged.vw / 2);
    expect((staged.teddy.left + staged.teddy.right) / 2).toBeGreaterThan(staged.vw / 2);
    // Sunk: the flat cut at each frame's base is below the glass, not on it.
    expect(staged.benji.bottom).toBeGreaterThan(staged.vh);
    expect(staged.teddy.bottom).toBeGreaterThan(staged.vh);

    const result = await done;
    expect(result).toEqual({ shown: true });

    const rec = await page.evaluate(() => window.__dogRec);
    for (const id of ["benji", "teddy"]) {
      const frames = rec[id];
      expect(frames.map((f) => f.frame), id).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      const art = OCCASIONS.christmas.peek.dogs[id];
      for (const f of frames) {
        expect(f.sheetCols, `${id} ${f.frame}`).toBeCloseTo(4, 3);
        expect(f.sheetRows, `${id} ${f.frame}`).toBeCloseTo(3, 3);
        expect(f.col, `${id} frame ${f.frame} column`).toBeCloseTo(f.frame % 4, 2);
        expect(f.rowPlusBase, `${id} frame ${f.frame} row`).toBeCloseTo(Math.floor(f.frame / 4) + art.frames[f.frame].base, 2);
        expect(f.clip).toMatch(/^inset\(/);
      }
      // Timing: each gap is its own frame's duration. Generous tolerance for
      // a loaded runner, but tight enough that a constant rate cannot pass:
      // Teddy's frame 1 (320) against frame 5 (160) is a factor of two.
      const timing = DOGS[id].timing.peek;
      for (let i = 1; i < frames.length; i++) {
        const gap = frames[i].t - frames[i - 1].t;
        expect(gap, `${id} gap before frame ${i}`).toBeGreaterThan(timing[i - 1] - 30);
        expect(gap, `${id} gap before frame ${i}`).toBeLessThan(timing[i - 1] + 120);
      }
    }

    // Gone, and nothing moved.
    expect(await page.locator(".dogs").count()).toBe(0);
    const after = await page.evaluate(() => ({
      hour: JSON.stringify(document.getElementById("hour").getBoundingClientRect()),
      stage: JSON.stringify(document.querySelector(".stage").getBoundingClientRect()),
      scrollH: document.documentElement.scrollHeight,
      scrollW: document.documentElement.scrollWidth,
      cls: window.__cls
    }));
    expect(after.hour).toBe(before.hour);
    expect(after.stage).toBe(before.stage);
    expect(after.scrollH).toBe(before.scrollH);
    expect(after.scrollW).toBe(before.scrollW);
    expect(after.cls).toBe(0);
    expect(errors).toEqual([]);
  });

  test("one dog alone stands in the middle; either dog can go alone", async ({ page }) => {
    const { errors } = await open(page);
    for (const id of ["benji", "teddy"]) {
      const done = page.evaluate((id) => window.dogOccasion.show("christmas", { dogs: [id] }), id);
      await page.waitForFunction((id) => window.dogOccasion.state().dogs[0]?.id === id && window.dogOccasion.state().dogs[0].phase === "idle", id, { timeout: 8_000 });
      const box = await page.evaluate(() => ({
        n: document.querySelectorAll(".dogs .dog").length,
        r: document.querySelector(".dogs .dog__frame").getBoundingClientRect().toJSON(),
        vw: innerWidth
      }));
      expect(box.n).toBe(1);
      expect(box.r.width).toBeGreaterThan(200);
      expect(Math.abs((box.r.left + box.r.right) / 2 - box.vw / 2)).toBeLessThan(8);
      expect(await done).toEqual({ shown: true });
    }
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("a second call while running is ignored, never stacked", async ({ page }) => {
    const { errors } = await open(page);
    const first = page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji"] }));
    await page.waitForFunction(() => window.dogOccasion.state().running);
    const second = await page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji", "teddy"] }));
    expect(second).toEqual({ shown: false, reason: "busy" });
    await page.waitForSelector(".dogs .dog");
    expect(await page.locator(".dogs").count()).toBe(1);
    expect(await page.locator(".dogs .dog").count()).toBe(1);
    expect(await first).toEqual({ shown: true });
    expect(errors).toEqual([]);
  });

  test("three runs in a row each clean up; a depth change mid-run is harmless", async ({ page }) => {
    const { errors } = await open(page);
    for (let n = 1; n <= 3; n++) {
      const done = page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji"] }));
      await page.waitForFunction(() => window.dogOccasion.state().dogs[0]?.phase === "entering");
      if (n === 2) {
        await page.evaluate(() => window.__setDepth(1, "spec"));
        await page.waitForTimeout(300);
        await page.evaluate(() => window.__setDepth(0, "spec"));
      }
      expect(await page.locator(".dogs").count()).toBe(1);
      expect(await done).toEqual({ shown: true });
      expect(await page.locator(".dogs").count()).toBe(0);
      expect(await page.evaluate(() => window.dogOccasion.state())).toEqual(
        expect.objectContaining({ running: false, runs: n })
      );
    }
    expect(errors).toEqual([]);
  });

  test("hide() mid-run removes it at once and the run answers", async ({ page }) => {
    const { errors } = await open(page);
    const done = page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji", "teddy"] }));
    await page.waitForFunction(() => Number(document.querySelector(".dog--benji")?.dataset.frame) >= 3);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(await done).toEqual({ shown: false, reason: "hidden" });
    expect(await page.locator(".dogs").count()).toBe(0);
    // No stranded timer brings it back or throws after its planned end.
    await page.waitForTimeout(7_000);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(await page.evaluate(() => window.dogOccasion.state().running)).toBe(false);
    // And the next run is not blocked.
    expect(await page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji"] }))).toEqual({ shown: true });
    expect(errors).toEqual([]);
  });

  test("bad requests answer with a reason and touch nothing", async ({ page }) => {
    const { errors, sheetRequests } = await open(page);
    const ask = (occ, opts) => page.evaluate(([o, p]) => window.dogOccasion.show(o, p), [occ, opts]);
    expect(await ask("halloween", {})).toEqual({ shown: false, reason: "unknown-occasion" });
    expect(await ask("christmas", { mode: "run" })).toEqual({ shown: false, reason: "unknown-occasion" });
    expect(await ask("christmas", { dogs: ["rex"] })).toEqual({ shown: false, reason: "unknown-dog:rex" });
    expect(await ask("christmas", { dogs: [] })).toEqual({ shown: false, reason: "no-dogs" });
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(await page.evaluate(() => window.dogOccasion.state().running)).toBe(false);
    expect(sheetRequests).toEqual([]);
    expect(errors).toEqual([]);
  });

  test("reduced motion: the last portrait, still, then gone", async ({ page }) => {
    const { errors } = await open(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Prove the emulation landed before trusting anything below.
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await recordFrames(page);
    const done = page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji", "teddy"] }));
    await page.waitForSelector(".dogs .dog");
    const mid = await page.evaluate(() => ({
      still: document.querySelector(".dogs").dataset.still,
      phases: [...document.querySelectorAll(".dogs .dog")].map((d) => d.dataset.phase),
      bodyAnim: getComputedStyle(document.querySelector(".dog--benji .dog__body")).animationName
    }));
    expect(mid.still).toBe("1");
    expect(mid.phases).toEqual(["still", "still"]);
    expect(mid.bodyAnim).toBe("dog-fade-in");
    expect(await done).toEqual({ shown: true });
    const rec = await page.evaluate(() => window.__dogRec);
    expect(rec.benji.map((f) => f.frame)).toEqual([11]);
    expect(rec.teddy.map((f) => f.frame)).toEqual([11]);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
