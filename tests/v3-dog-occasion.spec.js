import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DOGS, MOTION, OCCASIONS, pickLooks } from "../src/v3/core/dog-occasion.js";
import { SHEETS } from "../src/v3/core/dog-sheets.js";

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
     · looks: every look's windows painted in a real
       browser; one independent draw per dog, only the
       drawn sheets fetched                             → a new outfit with a
                                                          neighbour's sliver, both
                                                          dogs always matched, or
                                                          every sheet decoded

   Real timers throughout: a run is ~5 s (Benji) / ~6.5 s (Teddy). The clock
   is fixed at local midday so the screensaver cannot engage mid-run.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");
const SHEET_URL = /\/assets\/dogs\//;

/* A shipped sheet's pixel size: PNG (IHDR) or WebP (VP8X, which every sheet
   with alpha is written as — 24-bit little-endian width-1 / height-1). */
function sheetSize(buf, at) {
  if (buf.toString("latin1", 12, 16) === "IHDR") return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  expect(buf.toString("latin1", 0, 4) + buf.toString("latin1", 8, 12), `${at} RIFF/WEBP`).toBe("RIFFWEBP");
  expect(buf.toString("latin1", 12, 16), `${at} VP8X`).toBe("VP8X");
  return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
}

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
  page.on("request", (r) => { if (SHEET_URL.test(r.url())) sheetRequests.push(r.url()); });
  page.on("response", (r) => { if (SHEET_URL.test(r.url()) && r.status() >= 400) errors.push(`sheet ${r.status()} ${r.url()}`); });
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
        for (const [id, looks] of Object.entries(staged.dogs)) {
          expect(DOGS[id], `${occ}/${mode}/${id}`).toBeTruthy();
          expect(DOGS[id].timing[mode]).toHaveLength(n);
          expect(MOTION[DOGS[id].motion]?.[mode], `${occ}/${mode}/${id} motion`).toBeTruthy();
          expect(looks.length, `${occ}/${mode}/${id} looks`).toBeGreaterThan(0);
          expect(new Set(looks.map((l) => l.name)).size).toBe(looks.length);
          expect(new Set(looks.map((l) => l.src)).size).toBe(looks.length);
          for (const [i, look] of looks.entries()) {
            const at = `${occ}/${mode}/${id}/${look.name}`;
            expect(look.frames, at).toHaveLength(n);
            // The sheet is shipped, and its grid divides it the way the
            // windows were measured: Christmas's hand-measured sheets have
            // square cells; a generated sheet's cells are exactly the ones its
            // windows were measured on.
            const [w, h] = sheetSize(readFileSync(new URL(`../static${look.src}`, import.meta.url)), at);
            const gen = SHEETS[occ]?.[id]?.[i];
            if (gen) {
              expect(gen.src, at).toBe(look.src);
              expect(w / staged.grid.columns, `${at} cell w`).toBeCloseTo(gen.cell.w, 6);
              expect(h / staged.grid.rows, `${at} cell h`).toBeCloseTo(gen.cell.h, 6);
              expect(staged.cellScale, at).toBeCloseTo(gen.cell.h / 362, 6);
            } else {
              expect(w / staged.grid.columns, `${at} square cells`).toBeCloseTo(h / staged.grid.rows, 6);
              expect(staged.cellScale ?? 1, at).toBe(1);
            }
          }
        }
      }
    }
  });

  test("pickLooks: one independent draw per dog, pins win, a bad pin refuses", () => {
    const seq = (...v) => { let i = 0; return () => v[i++]; };
    const peek = OCCASIONS.christmas.peek.dogs;
    expect(peek.benji.length).toBe(3);
    expect(peek.teddy.length).toBe(3);
    // One draw each, in the order asked: Benji's outfit says nothing about Teddy's.
    expect(pickLooks("christmas", { dogs: ["benji", "teddy"], random: seq(0.5, 0.9) })).toEqual({ benji: 1, teddy: 2 });
    expect(pickLooks("christmas", { dogs: ["benji", "teddy"], random: seq(0.99, 0) })).toEqual({ benji: 2, teddy: 0 });
    // The whole [0, 1) range lands on a real look; 1 - ε never overruns.
    expect(pickLooks("christmas", { dogs: ["benji"], random: () => 0.9999999 })).toEqual({ benji: 2 });
    // Every look is reachable for each dog.
    for (const id of ["benji", "teddy"]) {
      const seen = new Set([0, 0.34, 0.67].map((r) => pickLooks("christmas", { dogs: [id], random: () => r })[id]));
      expect([...seen].sort(), id).toEqual([0, 1, 2]);
    }
    expect(pickLooks("christmas", { dogs: ["benji", "teddy"], pinned: { teddy: 0 }, random: () => 0.9 })).toEqual({ benji: 2, teddy: 0 });
    expect(pickLooks("christmas", { dogs: ["benji"], pinned: { benji: 3 } })).toBeNull();
    // Run has one look: every draw is it.
    expect(pickLooks("christmas", { mode: "run", random: () => 0.9 })).toEqual({ benji: 0, teddy: 0 });
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

  // Once per look: each is its own sheet with its own measured windows, so a
  // look that is never painted here is a look whose windows are unchecked.
  for (const look of [0, 1, 2]) test(`the pair, look ${look}: every frame on its own cell, in order, on each dog's timing`, async ({ page }) => {
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

    const done = page.evaluate((look) => window.dogOccasion.show("christmas",
      { mode: "peek", dogs: ["benji", "teddy"], looks: { benji: look, teddy: look } }), look);

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
        teddySheet: getComputedStyle(document.querySelector(".dog--teddy .dog__sheet")).backgroundImage,
        vh: innerHeight, vw: innerWidth
      };
    });
    expect(staged.count).toBe(1);
    expect(staged.parent).toBe("BODY");
    expect(staged.position).toBe("fixed");
    expect(staged.pointer).toBe("none");
    expect(staged.z).toBeGreaterThan(staged.stageZ);
    expect(staged.z).toBeLessThan(staged.presenceZ);
    // The pinned look's sheet, up to the closing quote so no other file name
    // can match by prefix.
    expect(staged.benjiSheet).toContain(`${OCCASIONS.christmas.peek.dogs.benji[look].src}"`);
    expect(staged.teddySheet).toContain(`${OCCASIONS.christmas.peek.dogs.teddy[look].src}"`);
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
      const art = OCCASIONS.christmas.peek.dogs[id][look];
      // The pad is what lets a frame reach past its cell. In look 0 Teddy's
      // scarf tails do (frame 4 to 390px of a 362 cell); none of Benji's does.
      const expectedPad = Math.max(0, ...art.frames.map((w) => Math.max(-w.left, w.right - 1)));
      expect(frames[0].pad, `${id} pad`).toBeCloseTo(expectedPad, 6);
      if (look === 0) expect(frames[0].pad > 0, `${id} padded`).toBe(id === "teddy");
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
      // 58ms). Load can only lengthen a gap, so the floor is load-proof.
      // NO ceiling or median here: under the 8-worker pre-push suite single
      // frames ran 290-370ms late and whole runs ~30ms late per frame, which
      // overlaps what a constant rate looks like. "Each expression has its
      // own duration" is proven on a fake clock instead (test below).
      const timing = DOGS[id].timing.peek;
      for (let i = 1; i < frames.length; i++) {
        const gap = frames[i].t - frames[i - 1].t;
        expect(gap, `${id} gap before frame ${i}`).toBeGreaterThanOrEqual(timing[i - 1] - 2);
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

  /* The generated occasions (scripts/dogs/measure-sheets.py): every look of
     every dog painted in a real browser, frame by frame. On a paused fake
     clock stepped 20ms at a time — shorter than any expression — so all 36
     looks run in seconds and every frame change is observed. Taller cells
     (460 against Christmas's 362) must come out at Christmas's px size:
     `cellScale` grows the box, so a sheet px is the same on the glass. */
  for (const occ of Object.keys(SHEETS)) test(`${occ}: every look of each dog paints every frame on its own cell and window`, async ({ page }) => {
    const { errors, sheetRequests } = await open(page);
    const staged = OCCASIONS[occ].peek;
    const vh = await page.evaluate(() => innerHeight);
    await page.clock.install({ time: MIDDAY });
    await page.clock.pauseAt(new Date(MIDDAY.getTime() + 1000));
    const n = Math.max(staged.dogs.benji.length, staged.dogs.teddy.length);
    for (let i = 0; i < n; i++) {
      const looks = { benji: i % staged.dogs.benji.length, teddy: i % staged.dogs.teddy.length };
      sheetRequests.length = 0;
      await recordFrames(page);
      await page.evaluate(([occ, looks]) => {
        window.__dogDone = window.dogOccasion.show(occ, { dogs: ["benji", "teddy"], looks });
      }, [occ, looks]);
      await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 8_000 }).toBe(2);
      const box = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".dogs .dog")]
        .map((d) => [d.dataset.dog, { h: d.querySelector(".dog__frame").getBoundingClientRect().height, look: d.dataset.look }])));
      // A whole peek, by the config: Teddy's beat, twelve faces, the hold and
      // the exit (~5.8s) — then some. Stepping less leaves the run on a paused
      // clock and __dogDone waiting for ever.
      const lasts = (id) => MOTION[DOGS[id].motion].peek.delayMs + DOGS[id].timing.peek.reduce((a, b) => a + b, 0)
        + staged.holdMs + MOTION[DOGS[id].motion].peek.exitMs;
      const until = Math.max(lasts("benji"), lasts("teddy")) + 500;
      for (let t = 0; t < until; t += 20) await page.clock.runFor(20);
      await expect.poll(() => page.evaluate(() => window.dogOccasion.state().running), { timeout: 5_000 }).toBe(false);
      const rec = await page.evaluate(() => window.__dogRec);
      for (const id of ["benji", "teddy"]) {
        const art = staged.dogs[id][looks[id]];
        const at = `${occ}/${id}/${art.name}`;
        expect(box[id].look, at).toBe(art.name);
        // Present before placed, then the size: one cell is 34vh × dog scale
        // × cellScale (460/362) — Christmas's px size, not 27% bigger or
        // squeezed into a 362 cell.
        expect(box[id].h, `${at} box`).toBeCloseTo(0.34 * vh * DOGS[id].scale * staged.cellScale, 0);
        const frames = rec[id];
        expect(frames.map((f) => f.frame), at).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
        for (const f of frames) {
          const w = art.frames[f.frame];
          const fat = `${at} frame ${f.frame}`;
          expect(f.sheetCols, fat).toBeCloseTo(4, 3);
          expect(f.sheetRows, fat).toBeCloseTo(3, 3);
          expect(f.col, `${fat} column`).toBeCloseTo(f.frame % 4, 2);
          expect(f.rowPlusBase, `${fat} row`).toBeCloseTo(Math.floor(f.frame / 4) + w.base, 2);
          expect(f.clipParsed, `${fat} clip`).toBe(true);
          expect(f.win.top, `${fat} window top`).toBeCloseTo(w.top, 2);
          expect(f.win.left, `${fat} window left`).toBeCloseTo(w.left, 2);
          expect(f.win.right, `${fat} window right`).toBeCloseTo(w.right, 2);
        }
      }
      expect(await page.evaluate(() => window.__dogDone)).toEqual({ shown: true });
      expect(await page.locator(".dogs").count()).toBe(0);
      // This look's two sheets, 200 (a 4xx lands in `errors`), and no others.
      const fetched = [...new Set(sheetRequests.map((u) => new URL(u).pathname))].sort();
      expect(fetched).toEqual([staged.dogs.benji[looks.benji].src, staged.dogs.teddy[looks.teddy].src].sort());
    }
    expect(errors).toEqual([]);
  });

  test("each expression holds exactly its own duration (fake clock, load-proof)", async ({ page }) => {
    const { errors } = await open(page);
    // Timers created from here on are the test's to advance; boot's were real.
    // install() alone lets virtual time flow with real time — the dogs ran on
    // while the mount was being polled — so pause it before show().
    await page.clock.install({ time: MIDDAY });
    await page.clock.pauseAt(new Date(MIDDAY.getTime() + 1000));
    await page.evaluate(() => { window.__dogDone = window.dogOccasion.show("christmas", { dogs: ["benji", "teddy"] }); });
    // decode() is real work, not a timer: wait for the mount, still frame -1.
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 8_000 }).toBe(2);
    const frameOf = () => page.evaluate(() => Object.fromEntries(window.dogOccasion.state().dogs.map((d) => [d.id, d.frame])));
    // Walk the virtual clock 5ms at a time and log when each dog's frame
    // changes; both dogs, both delays, all twelve expressions.
    const changedAt = { benji: [], teddy: [] };
    let last = { benji: -1, teddy: -1 };
    for (let t = 0; t <= 4000; t += 5) {
      const now = await frameOf();
      for (const id of ["benji", "teddy"]) {
        if (now[id] !== last[id]) changedAt[id].push({ frame: now[id], t });
      }
      last = now;
      await page.clock.runFor(5);
    }
    for (const id of ["benji", "teddy"]) {
      const timing = DOGS[id].timing.peek;
      const seen = changedAt[id];
      expect(seen.map((s) => s.frame), id).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
      for (let i = 1; i < seen.length; i++) {
        // Exactly the frame's own time, to the 5ms sampling step: a constant
        // rate, or a neighbour's duration, cannot land inside ±5ms of all 11.
        expect(Math.abs(seen[i].t - seen[i - 1].t - timing[i - 1]), `${id} frame ${i - 1} held`).toBeLessThanOrEqual(5);
      }
    }
    // Teddy arrives a beat after Benji, on his own terms.
    const beat = MOTION.deliberate.peek.delayMs - MOTION.eager.peek.delayMs;
    expect(Math.abs(changedAt.teddy[0].t - changedAt.benji[0].t - beat), "Teddy's beat").toBeLessThanOrEqual(5);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(await page.evaluate(() => window.__dogDone)).toEqual({ shown: false, reason: "hidden" });
    expect(errors).toEqual([]);
  });

  test("unpinned, each dog wears its own drawn look, and only that sheet is fetched", async ({ page }) => {
    const { errors, sheetRequests } = await open(page);
    const peek = OCCASIONS.christmas.peek.dogs;
    // Two calls, two different draws, with the dogs NOT matched in either: a
    // single shared draw, or a show() that ignores the draw, cannot pass both.
    for (const [draws, want] of [[[0.5, 0.9], { benji: 1, teddy: 2 }], [[0.99, 0.1], { benji: 2, teddy: 0 }]]) {
      sheetRequests.length = 0;
      // Stub, call, restore in one synchronous turn: show() draws before its
      // first await, so no app timer can take a queued draw in between.
      await page.evaluate((draws) => {
        const real = Math.random;
        const queue = [...draws];
        Math.random = () => (queue.length ? queue.shift() : real());
        window.__dogDone = window.dogOccasion.show("christmas", { dogs: ["benji", "teddy"] });
        Math.random = real;
      }, draws);
      const done = page.evaluate(() => window.__dogDone);
      await page.waitForFunction(() => window.dogOccasion.state().dogs.length === 2);
      const seen = await page.evaluate(() => Object.fromEntries(window.dogOccasion.state().dogs.map((d) => [d.id, {
        look: d.look,
        name: document.querySelector(`.dog--${d.id}`).dataset.look,
        sheet: getComputedStyle(document.querySelector(`.dog--${d.id} .dog__sheet`)).backgroundImage
      }])));
      for (const id of ["benji", "teddy"]) {
        const art = peek[id][want[id]];
        expect(seen[id].look, id).toBe(want[id]);
        expect(seen[id].name, id).toBe(art.name);
        expect(seen[id].sheet, id).toContain(`${art.src}"`);
      }
      await page.evaluate(() => window.dogOccasion.hide());
      expect(await done).toEqual({ shown: false, reason: "hidden" });
      // The drawn sheets and nothing else: all six decoded would be ~38 MB of
      // bitmap for one peek.
      const fetched = [...new Set(sheetRequests.map((u) => new URL(u).pathname))].sort();
      expect(fetched).toEqual([peek.benji[want.benji].src, peek.teddy[want.teddy].src].sort());
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
    expect(await ask("arbor-day", {})).toEqual({ shown: false, reason: "unknown-occasion" });
    expect(await ask("christmas", { mode: "gallop" })).toEqual({ shown: false, reason: "unknown-occasion" });
    expect(await ask("christmas", { dogs: ["rex"] })).toEqual({ shown: false, reason: "unknown-dog:rex" });
    expect(await ask("christmas", { dogs: [] })).toEqual({ shown: false, reason: "no-dogs" });
    expect(await ask("christmas", { looks: { teddy: 3 } })).toEqual({ shown: false, reason: "unknown-look:teddy" });
    expect(await ask("christmas", { mode: "run", looks: { benji: 1 } })).toEqual({ shown: false, reason: "unknown-look:benji" });
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
        const w = staged.dogs[id][0].frames[f.frame];
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
