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
        // The module's own paint stamp, never this callback's clock: under a
        // loaded suite the callback ran ~30ms late, so one gap read 58ms and
        // the next long (and before that, a forced layout read 90ms as 81).
        const t = window.dogOccasion.state().dogs.find((d) => d.id === id)?.paintedAt;
        const f = Number(dog.dataset.frame);
        if (Number.isNaN(f) || rec.at(-1)?.frame === f) return;
        const frameEl = dog.querySelector(".dog__frame");
        const box = frameEl.getBoundingClientRect();
        const sheet = dog.querySelector(".dog__sheet").getBoundingClientRect();
        const pad = window.dogOccasion.state().dogs.find((d) => d.id === id).pad;
        const cellW = box.width / (1 + 2 * pad);
        const cellH = box.height;
        // The painted window, from the inline inset() the module set. Chromium
        // re-serialises it in CSS box shorthand — equal left and right come
        // back as 3 values — so expand 1-4 values the way CSS does.
        const inner = frameEl.style.clipPath.match(/^inset\((.*)\)$/)?.[1];
        const v = inner ? inner.trim().split(/\s+/).map((s) => (s === "0" || s === "0px" ? 0 : s.endsWith("%") ? Number(s.slice(0, -1)) : NaN)) : [];
        const box4 = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
        const m = v.length >= 1 && v.length <= 4 && box4.every(Number.isFinite) && box4[2] === 0;
        const [T, R, , L] = box4;
        // Where THIS frame's cell starts, on screen.
        const cellLeft = sheet.left + (f % 4) * cellW;
        const cellTop = sheet.top + Math.floor(f / 4) * cellH;
        rec.push({
          frame: f,
          t,
          pad,
          // Cells from the sheet's origin to the cell under the box.
          col: (box.left + pad * cellW - sheet.left) / cellW,
          rowPlusBase: (box.bottom - sheet.top) / cellH,
          sheetCols: sheet.width / cellW,
          sheetRows: sheet.height / cellH,
          clipParsed: Boolean(m),
          // The visible window in the frame's own cell units.
          win: {
            top: (box.top + (T / 100) * box.height - cellTop) / cellH,
            left: (box.left + (L / 100) * box.width - cellLeft) / cellW,
            right: (box.right - (R / 100) * box.width - cellLeft) / cellW,
            base: (box.bottom - cellTop) / cellH
          }
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

/* Run mode: on every frame change, record where the sheet sits relative to the
   box (in cells, so the centroid placement can be checked against the config),
   the painted window, and where the wrapper is on the glass. */
async function recordRun(page) {
  await page.evaluate(() => {
    window.__runRec = {};
    const watch = (dog) => {
      const id = dog.dataset.dog;
      const rec = (window.__runRec[id] = []);
      const sample = () => {
        // The module's paint stamp (see recordFrames), not this callback's.
        const t = window.dogOccasion.state().dogs.find((d) => d.id === id)?.paintedAt;
        const f = Number(dog.dataset.frame);
        if (Number.isNaN(f)) return;
        const frameEl = dog.querySelector(".dog__frame");
        const box = frameEl.getBoundingClientRect();
        const sheet = dog.querySelector(".dog__sheet").getBoundingClientRect();
        const cellW = sheet.width / 4;
        const cellH = sheet.height / 4;
        const inner = frameEl.style.clipPath.match(/^inset\((.*)\)$/)?.[1];
        const v = inner ? inner.trim().split(/\s+/).map((s) => (s === "0" || s === "0px" ? 0 : s.endsWith("%") ? Number(s.slice(0, -1)) : NaN)) : [];
        const [T, R, B, L] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
        const col = f % 4;
        const row = Math.floor(f / 4);
        rec.push({
          frame: f,
          t,
          phase: dog.dataset.phase,
          box: window.dogOccasion.state().dogs.find((d) => d.id === id)?.box,
          // Cells from the sheet's origin to the box's top-left corner.
          offX: (box.left - sheet.left) / cellW,
          offY: (box.top - sheet.top) / cellH,
          boxW: box.width / cellW,
          boxH: box.height / cellH,
          clipParsed: [T, R, B, L].every(Number.isFinite),
          // The visible window in the frame's own cell units.
          win: {
            top: (box.top + (T / 100) * box.height - (sheet.top + row * cellH)) / cellH,
            base: (box.bottom - (B / 100) * box.height - (sheet.top + row * cellH)) / cellH,
            left: (box.left + (L / 100) * box.width - (sheet.left + col * cellW)) / cellW,
            right: (box.right - (R / 100) * box.width - (sheet.left + col * cellW)) / cellW
          },
          // Where the wrapper is on the glass.
          x: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, height: box.height }
        });
      };
      sample();
      new MutationObserver(sample).observe(dog, { attributes: true, attributeFilter: ["data-frame"] });
    };
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
          expect(MOTION[DOGS[id].motion]?.[mode], `${occ}/${mode}/${id} motion`).toBeTruthy();
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
    expect(staged.benjiSheet).toContain("/assets/dogs/christmas/benji_christmas_popup_sprite.png");
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
      // The pad is what lets a frame reach past its cell. Teddy's scarf tails
      // do (frame 4 to 390px of a 362 cell); none of Benji's does.
      const expectedPad = Math.max(0, ...art.frames.map((w) => Math.max(-w.left, w.right - 1)));
      expect(frames[0].pad, `${id} pad`).toBeCloseTo(expectedPad, 6);
      expect(frames[0].pad > 0, `${id} padded`).toBe(id === "teddy");
      for (const f of frames) {
        const w = art.frames[f.frame];
        const at = `${id} frame ${f.frame}`;
        expect(f.sheetCols, at).toBeCloseTo(4, 3);
        expect(f.sheetRows, at).toBeCloseTo(3, 3);
        expect(f.col, `${at} column`).toBeCloseTo(f.frame % 4, 2);
        expect(f.rowPlusBase, `${at} row`).toBeCloseTo(Math.floor(f.frame / 4) + w.base, 2);
        // The painted window IS this frame's own-dog rectangle: nothing of a
        // neighbour outside it, nothing of this dog cut inside it.
        expect(f.clipParsed, `${at} clip`).toBe(true);
        expect(f.win.top, `${at} window top`).toBeCloseTo(w.top, 2);
        expect(f.win.base, `${at} window base`).toBeCloseTo(w.base, 2);
        expect(f.win.left, `${at} window left`).toBeCloseTo(w.left, 2);
        expect(f.win.right, `${at} window right`).toBeCloseTo(w.right, 2);
      }
      // Timing: every expression is held AT LEAST its own duration — the
      // floor is the promise (a frame cut short is an expression that does not
      // read; in the full suite an absolute schedule once gave a 140ms frame
      // 58ms). The ceiling allows a loaded runner's late timer, and is still
      // too tight for any constant rate: nothing fits both Benji's 100ms frame
      // (< 350) and Teddy's 1100ms one.
      const timing = DOGS[id].timing.peek;
      for (let i = 1; i < frames.length; i++) {
        const gap = frames[i].t - frames[i - 1].t;
        expect(gap, `${id} gap before frame ${i}`).toBeGreaterThanOrEqual(timing[i - 1] - 2);
        expect(gap, `${id} gap before frame ${i}`).toBeLessThan(timing[i - 1] + 250);
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
    expect(await ask("christmas", { mode: "gallop" })).toEqual({ shown: false, reason: "unknown-occasion" });
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

  /* ── Run ──────────────────────────────────────────────────────────────────
     What is asserted, and why:
       · the gait loops 0..15 in order, each frame placed by its own centroid
         and clipped to its own window                  → a paw-anchored or
                                                           plain-cropped frame
                                                           jumps the dog
       · the wrapper enters from fully off-left, moves right only, and leaves
         off-right, ONCE, in crossMs                    → travel baked into the
                                                           frames, or a looping
                                                           path
       · Teddy starts a beat after Benji, smaller, on a higher ground line, and
         painted behind him                              → one dog dragged along
                                                           by the other
       · the lower third, fixed, no layout shift; the frame loop stops when a
         dog has left, nothing survives the run         → a timer spinning for
                                                           weeks on a 24/7 kiosk */

  test("run: the pair crosses once, left to right, each on its own gait", async ({ page }) => {
    const { errors } = await open(page);
    await page.evaluate(() => {
      window.__cls = 0;
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__cls += e.value; })
        .observe({ type: "layout-shift", buffered: false });
    });
    await recordRun(page);
    const done = page.evaluate(() => window.dogOccasion.show("christmas", { mode: "run", dogs: ["benji", "teddy"] }));

    // Mid-run, both on the glass: stacking, order, travel animation.
    await page.waitForFunction(() => {
      const d = window.dogOccasion.state().dogs;
      return d.length === 2 && d.every((x) => x.phase === "running");
    }, null, { timeout: 8_000 });
    const mid = await page.evaluate(() => {
      const root = document.querySelector(".dogs");
      const anim = (id) => {
        const a = document.querySelector(`.dog--${id}`).getAnimations().find((x) => x.animationName?.startsWith("dog-run-"));
        if (!a) return null;
        const t = a.effect.getTiming();
        const kf = a.effect.getKeyframes();
        return { name: a.animationName, duration: t.duration, iterations: t.iterations, first: kf[0].transform, last: kf.at(-1).transform };
      };
      return {
        order: [...root.children].map((d) => d.dataset.dog),
        mode: root.dataset.mode,
        position: getComputedStyle(root).position,
        pointer: getComputedStyle(root).pointerEvents,
        z: Number(getComputedStyle(root).zIndex),
        stageZ: Number(getComputedStyle(document.querySelector(".stage")).zIndex),
        presenceZ: Number(getComputedStyle(document.querySelector(".presence")).zIndex),
        benji: anim("benji"),
        teddy: anim("teddy"),
        sheet: getComputedStyle(document.querySelector(".dog--benji .dog__sheet")).backgroundImage,
        timers: window.dogOccasion.state().timers,
        vw: innerWidth
      };
    });
    expect(mid.mode).toBe("run");
    expect(mid.position).toBe("fixed");
    expect(mid.pointer).toBe("none");
    expect(mid.z).toBeGreaterThan(mid.stageZ);
    expect(mid.z).toBeLessThan(mid.presenceZ);
    expect(mid.sheet).toContain("/assets/dogs/christmas/benji_christmas_run_basic.png");
    expect(mid.order, "Teddy painted first, so Benji passes in front").toEqual(["teddy", "benji"]);
    // One frame timer and one end-of-crossing timer per dog, nothing else.
    expect(mid.timers).toBe(4);
    for (const id of ["benji", "teddy"]) {
      const a = mid[id];
      expect(a, `${id} travel animation`).toBeTruthy();
      expect(a.name).toBe(MOTION[DOGS[id].motion].run.path);
      expect(a.duration).toBe(MOTION[DOGS[id].motion].run.crossMs);
      expect(a.iterations, `${id} crosses ONCE`).toBe(1);
      // Chromium re-serialises translateX(v) as translate(v), and resolves vw.
      expect(a.first).toMatch(/^translateX?\(-100%\)$/);
      expect(a.last).toMatch(new RegExp(`^translateX?\\(${mid.vw}px\\)$`));
    }

    expect(await done).toEqual({ shown: true });
    const rec = await page.evaluate(() => window.__runRec);
    const vw = await page.evaluate(() => innerWidth);
    const vh = await page.evaluate(() => innerHeight);
    const staged = OCCASIONS.christmas.run;

    for (const id of ["benji", "teddy"]) {
      const frames = rec[id].filter((f) => f.phase === "running");
      const m = MOTION[DOGS[id].motion].run;
      const timing = DOGS[id].timing.run;
      // Enough to have seen the whole cycle more than twice.
      expect(frames.length, `${id} frames`).toBeGreaterThan(40);
      expect(frames[0].frame).toBe(0);
      const gaps = [];
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].frame, `${id} sample ${i}`).toBe((frames[i - 1].frame + 1) % 16);
        const gap = frames[i].t - frames[i - 1].t;
        gaps.push(gap - timing[frames[i - 1].frame]);
        expect(gap, `${id} gap before sample ${i}`).toBeGreaterThanOrEqual(timing[frames[i - 1].frame] - 2);
        // A stall, not a late timer: the full suite once held one 83ms frame
        // for 371ms (runner load), and a chained loop absorbs that by design.
        expect(gap, `${id} gap before sample ${i}`).toBeLessThan(1000);
      }
      // The gait runs AT its rate: the median frame is on time.
      const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
      expect(median, `${id} median lateness`).toBeLessThan(30);
      // Loop lasts the crossing, not less and not a stride more.
      const span = frames.at(-1).t - frames[0].t;
      expect(span, `${id} loop span`).toBeLessThan(m.crossMs + 50);
      expect(span, `${id} loop span`).toBeGreaterThan(m.crossMs - 350);

      for (const f of frames) {
        const w = staged.dogs[id].frames[f.frame];
        const at = `${id} frame ${f.frame}`;
        expect(f.box, `${at} box`).toBeTruthy();
        // Centroid on the anchor point: the body travels level.
        expect(f.offX, `${at} x`).toBeCloseTo((f.frame % 4) + w.cx - f.box.ax, 2);
        expect(f.offY, `${at} y`).toBeCloseTo(Math.floor(f.frame / 4) + w.cy - f.box.ay, 2);
        expect(f.boxW, `${at} box w`).toBeCloseTo(f.box.w, 2);
        expect(f.boxH, `${at} box h`).toBeCloseTo(f.box.h, 2);
        // The window is this frame's own rectangle.
        expect(f.clipParsed, `${at} clip`).toBe(true);
        expect(f.win.top, `${at} window top`).toBeCloseTo(w.top, 2);
        expect(f.win.base, `${at} window base`).toBeCloseTo(w.base, 2);
        expect(f.win.left, `${at} window left`).toBeCloseTo(w.left, 2);
        expect(f.win.right, `${at} window right`).toBeCloseTo(w.right, 2);
        // The lower third, and on the glass vertically.
        expect(f.x.height, `${at} present`).toBeGreaterThan(150);
        expect(f.x.top, `${at} lower third`).toBeGreaterThan(vh * 0.6);
        expect(f.x.bottom, `${at} on the glass`).toBeLessThanOrEqual(vh);
      }
      // Enters fully off-left, moves right only, gets (almost) off-right by
      // its last frame — the rest is the ~83ms before the end timer.
      expect(frames[0].x.right, `${id} starts off-glass`).toBeLessThanOrEqual(1);
      for (let i = 1; i < frames.length; i++) {
        expect(frames[i].x.left, `${id} never steps back (sample ${i})`).toBeGreaterThanOrEqual(frames[i - 1].x.left - 0.5);
      }
      expect(frames.at(-1).x.left, `${id} reaches the far edge`).toBeGreaterThan(vw * 0.9);
    }

    // Two characters, not one pasted twice.
    const b = rec.benji.filter((f) => f.phase === "running");
    const t = rec.teddy.filter((f) => f.phase === "running");
    const lag = t[0].t - b[0].t;
    // The brief's window (350-650ms). Not delayMs exactly: both start timers
    // are set together, and Benji's 0ms one lands ~30ms late behind the mount.
    expect(lag, "Teddy follows").toBeGreaterThanOrEqual(350);
    expect(lag, "Teddy follows").toBeLessThanOrEqual(650);
    expect(t[0].x.height / b[0].x.height).toBeCloseTo((0.88 * t[0].box.h) / b[0].box.h, 2);
    expect(t[0].x.bottom, "Teddy on a higher ground line").toBeLessThan(b[0].x.bottom - 8);

    expect(await page.locator(".dogs").count()).toBe(0);
    expect(await page.evaluate(() => window.dogOccasion.state())).toEqual(
      expect.objectContaining({ running: false, timers: 0, dogs: [] })
    );
    expect(await page.evaluate(() => window.__cls)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("run: a dog that has left stops cycling while the other runs on", async ({ page }) => {
    const { errors } = await open(page);
    const done = page.evaluate(() => window.dogOccasion.show("christmas", { mode: "run", dogs: ["benji", "teddy"] }));
    await page.waitForFunction(() => window.dogOccasion.state().dogs.find((d) => d.id === "benji")?.phase === "gone", null, { timeout: 10_000 });
    const a = await page.evaluate(() => ({ st: window.dogOccasion.state(), f: document.querySelector(".dog--benji").dataset.frame }));
    await page.waitForTimeout(300);
    const b = await page.evaluate(() => ({ st: window.dogOccasion.state(), f: document.querySelector(".dog--benji").dataset.frame }));
    expect(a.st.dogs.find((d) => d.id === "teddy").phase).toBe("running");
    expect(b.f, "Benji's loop cancelled").toBe(a.f);
    // Teddy's frame + end timers only.
    expect(a.st.timers).toBe(2);
    expect(await done).toEqual({ shown: true });
    expect(errors).toEqual([]);
  });

  test("run: either dog alone; a peek and a run never stack; hide() mid-run", async ({ page }) => {
    const { errors } = await open(page);
    for (const id of ["benji", "teddy"]) {
      await recordRun(page);
      const done = page.evaluate((id) => window.dogOccasion.show("christmas", { mode: "run", dogs: [id] }), id);
      await page.waitForFunction((id) => window.dogOccasion.state().dogs[0]?.id === id && window.dogOccasion.state().dogs[0].phase === "running", id);
      expect(await page.locator(".dogs .dog").count()).toBe(1);
      expect(await page.evaluate(() => window.dogOccasion.show("christmas", { mode: "peek" }))).toEqual({ shown: false, reason: "busy" });
      expect(await done).toEqual({ shown: true });
      const frames = (await page.evaluate((id) => window.__runRec[id], id)).filter((f) => f.phase === "running");
      expect(frames.length, `${id} ran`).toBeGreaterThan(40);
      expect(frames[0].x.right).toBeLessThanOrEqual(1);
    }
    // A peek in progress refuses a run too.
    const peek = page.evaluate(() => window.dogOccasion.show("christmas", { dogs: ["benji"] }));
    await page.waitForFunction(() => window.dogOccasion.state().running);
    expect(await page.evaluate(() => window.dogOccasion.show("christmas", { mode: "run" }))).toEqual({ shown: false, reason: "busy" });
    expect(await peek).toEqual({ shown: true });
    // hide() mid-run: gone at once, no timer left behind.
    const run = page.evaluate(() => window.dogOccasion.show("christmas", { mode: "run" }));
    await page.waitForFunction(() => Number(document.querySelector(".dog--benji")?.dataset.frame) >= 5);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(await run).toEqual({ shown: false, reason: "hidden" });
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(await page.evaluate(() => window.dogOccasion.state().timers)).toBe(0);
    expect(errors).toEqual([]);
  });

  test("run, reduced motion: a still portrait near the bottom, no travel, then gone", async ({ page }) => {
    const { errors } = await open(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    await recordRun(page);
    const done = page.evaluate(() => window.dogOccasion.show("christmas", { mode: "run", dogs: ["benji", "teddy"] }));
    await page.waitForSelector(".dogs .dog");
    await page.waitForTimeout(200);
    const mid = await page.evaluate(() => ({
      still: document.querySelector(".dogs").dataset.still,
      phases: [...document.querySelectorAll(".dogs .dog")].map((d) => d.dataset.phase),
      travel: [...document.querySelectorAll(".dogs .dog")].flatMap((d) => d.getAnimations().map((a) => a.animationName)),
      rects: [...document.querySelectorAll(".dogs .dog__frame")].map((f) => f.getBoundingClientRect().toJSON()),
      vw: innerWidth, vh: innerHeight
    }));
    expect(mid.still).toBe("1");
    expect(mid.phases).toEqual(["still", "still"]);
    expect(mid.travel.filter((n) => n.startsWith("dog-run-") || n === "dog-stride")).toEqual([]);
    for (const r of mid.rects) {
      expect(r.height).toBeGreaterThan(150);
      expect(r.left).toBeGreaterThan(0);
      expect(r.right).toBeLessThan(mid.vw);
      expect(r.top).toBeGreaterThan(mid.vh * 0.6);
    }
    expect(await done).toEqual({ shown: true });
    const rec = await page.evaluate(() => window.__runRec);
    expect(rec.benji.map((f) => f.frame)).toEqual([OCCASIONS.christmas.run.stillFrame]);
    expect(rec.teddy.map((f) => f.frame)).toEqual([OCCASIONS.christmas.run.stillFrame]);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });
});
