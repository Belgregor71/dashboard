import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { DOGS, OCCASIONS, artFor, smoothTiming } from "../src/v3/core/dog-occasion.js";
import { SMOOTH } from "../src/v3/core/dog-sheets-smooth.js";

/* ═══════════════════════════════════════════════════════════════════════════
   SMOOTH DOGS — features.v3DogSmooth: a look plays its interpolated sheet.

   What is asserted, and why:
     · every look has a smooth sheet that FITS it:
       shipped, sized to its grid, a non-empty window
       per frame                                        → a regenerated sheet
                                                          that no longer matches
                                                          paints a neighbour, or
                                                          nothing
     · the hard cuts are the judged ones                → a smeared transition
                                                          creeping back in
     · no time is added, and every drawn frame still
       starts when its choreography says                → a smoother dog that
                                                          performs out of step
     · flag OFF: the drawn sheet, 12 frames, and no
       smooth sheet ever requested                      → the flag-off build must
                                                          be the build before it
     · flag ON: the smooth sheet, every frame in order,
       each held its own time                           → the flag doing nothing,
                                                          or skipping frames
     · the settled portrait lands on the same pixels
       either way, peek and run                         → a dog that changes size
                                                          or jumps when it flips

   The clock is fixed at local midday so the screensaver cannot engage.
   ═══════════════════════════════════════════════════════════════════════════ */

const MIDDAY = new Date("2026-09-11T02:00:00Z");
const SHEET_URL = /\/assets\/dogs\//;
const CUTS = JSON.parse(readFileSync(new URL("../scripts/dogs/smooth-cuts.json", import.meta.url), "utf8"));

/* Every look the wall has: [occasion, mode, dog id, look index, look]. */
const LOOKS = Object.entries(OCCASIONS).flatMap(([occ, modes]) =>
  Object.entries(modes).flatMap(([mode, staged]) =>
    Object.entries(staged.dogs).flatMap(([id, looks]) => looks.map((look, i) => [occ, mode, id, i, look]))));

const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const stemOf = (src) => src.split("/").pop().replace(/\.\w+$/, "");

/* A shipped WebP's pixel size (VP8X: 24-bit little-endian width-1 / height-1). */
function webpSize(buf, at) {
  expect(buf.toString("latin1", 0, 4) + buf.toString("latin1", 8, 16), `${at} RIFF/WEBP/VP8X`).toBe("RIFFWEBPVP8X");
  return [buf.readUIntLE(24, 3) + 1, buf.readUIntLE(27, 3) + 1];
}

/* featureOn-style reads go to window.CONFIG, which a node-side spec does not
   have: without this every flag reads off and "on" is never exercised. */
function withFlagInNode(on, fn) {
  const before = globalThis.window;
  globalThis.window = { CONFIG: { features: { v3DogSmooth: on } } };
  try { return fn(); } finally {
    if (before === undefined) delete globalThis.window; else globalThis.window = before;
  }
}

async function open(page, on) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().startsWith("Failed to load resource")) errors.push(m.text());
  });
  const sheetRequests = [];
  page.on("request", (r) => { if (SHEET_URL.test(r.url())) sheetRequests.push(new URL(r.url()).pathname); });
  page.on("response", (r) => { if (SHEET_URL.test(r.url()) && r.status() >= 400) errors.push(`sheet ${r.status()} ${r.url()}`); });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3DogSmooth = ${on};\n` });
  });
  await page.clock.setFixedTime(MIDDAY);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.dogOccasion?.show === "function");
  expect(await page.evaluate(() => window.CONFIG.features.v3DogSmooth), "the flag reached the page").toBe(on);
  return { errors, sheetRequests };
}

test.describe("smooth dogs", () => {
  test.describe.configure({ timeout: 90_000 });

  test("config: every look has a smooth sheet that fits it", () => {
    expect(LOOKS.length, "looks on the wall").toBeGreaterThan(40);
    expect(Object.keys(SMOOTH).sort()).toEqual(LOOKS.map(([, , , , l]) => l.src).sort());
    for (const [occ, mode, id, , look] of LOOKS) {
      const at = `${occ}/${mode}/${id}/${look.name}`;
      const s = SMOOTH[look.src];
      const drawn = look.frames.length;
      expect(s.between, `${at} between`).toHaveLength(mode === "run" ? drawn : drawn - 1);
      for (const n of s.between) expect([0, 2], `${at} between ${n}`).toContain(n);
      const count = drawn + sum(s.between);
      expect(count, `${at} fits its grid`).toBeLessThanOrEqual(s.grid.columns * s.grid.rows);
      expect(count, `${at} wastes no row`).toBeGreaterThan(s.grid.columns * (s.grid.rows - 1));
      const [w, h] = webpSize(readFileSync(new URL(`../static${s.src}`, import.meta.url)), at);
      expect([w, h], `${at} sheet px`).toEqual([s.grid.columns * s.cell.w, s.grid.rows * s.cell.h]);
      for (const k of ["top", "base", "left", "right"]) expect(s[k], `${at} ${k}`).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        // A window that is THERE: an empty one clips the dog away and still
        // satisfies any "inside the cell" check.
        expect(s.base[i] - s.top[i], `${at} frame ${i} height`).toBeGreaterThan(s.cell.h * 0.15);
        expect(s.right[i] - s.left[i], `${at} frame ${i} width`).toBeGreaterThan(s.cell.w * 0.3);
        expect(s.top[i] >= 0 && s.base[i] <= s.cell.h && s.left[i] >= 0 && s.right[i] <= s.cell.w, `${at} frame ${i} in its cell`).toBe(true);
      }
      expect(Boolean(s.cx), `${at} centroid only for a run`).toBe(mode === "run");
      expect(s.scale, `${at} scale`).toBeGreaterThan(0.7);
      expect(s.scale, `${at} scale`).toBeLessThan(1.3);
    }
  });

  test("config: the hard cuts are exactly the judged ones", () => {
    let cut = 0;
    let kept = 0;
    for (const [occ, mode, id, , look] of LOOKS) {
      const judged = CUTS[stemOf(look.src)];
      expect(Array.isArray(judged), `${occ}/${mode}/${id}/${look.name} judged`).toBe(true);
      const made = SMOOTH[look.src].between.flatMap((n, g) => (n === 0 ? [g + 1] : []));
      expect(made, `${occ}/${mode}/${id}/${look.name} cuts`).toEqual([...judged].sort((a, b) => a - b));
      cut += made.length;
      kept += SMOOTH[look.src].between.length - made.length;
    }
    // Both kinds exist, or the comparison above compared nothing to nothing.
    expect(cut, "hard cuts").toBeGreaterThan(50);
    expect(kept, "interpolated gaps").toBeGreaterThan(300);
  });

  test("timing: an in-between takes its time out of the drawn frame before it", () => {
    // Peek: 50 ms each while the drawn frame keeps 40; a short frame gives less.
    expect(smoothTiming([160, 100, 1000], [2, 2], "peek")).toEqual([60, 50, 50, 40, 30, 30, 1000]);
    // A hard cut leaves its drawn frame whole.
    expect(smoothTiming([160, 100, 1000], [0, 2], "peek")).toEqual([160, 40, 30, 30, 1000]);
    // Run: the stride is shared evenly, and the last gap closes the loop.
    expect(smoothTiming([83, 83], [2, 2], "run")).toEqual([27, 28, 28, 27, 28, 28]);

    for (const [occ, mode, id, , look] of LOOKS) {
      const at = `${occ}/${mode}/${id}/${look.name}`;
      const drawn = look.timing ?? DOGS[id].timing[mode];
      const { between } = SMOOTH[look.src];
      const out = smoothTiming(drawn, between, mode);
      expect(out, `${at} one time per frame`).toHaveLength(drawn.length + sum(between));
      expect(sum(out), `${at} no time added`).toBe(sum(drawn));
      for (const ms of out) expect(Number.isInteger(ms) && ms > 0, `${at} ${ms}ms`).toBe(true);
      // Every drawn frame starts when it always did.
      let k = 0;
      let i = 0;
      let tDrawn = 0;
      let tOut = 0;
      for (; k < drawn.length; k++) {
        expect(tOut, `${at} drawn frame ${k} starts`).toBe(tDrawn);
        tDrawn += drawn[k];
        for (let j = 0; j <= (between[k] ?? 0); j++) tOut += out[i++];
      }
      expect(i, `${at} every frame counted`).toBe(out.length);
    }
  });

  test("artFor: off is the drawn look; on is its smooth sheet; a misfit entry is refused whole", () => {
    for (const [occ, mode, id, i, look] of LOOKS) {
      const off = withFlagInNode(false, () => artFor(occ, mode, id, i));
      expect(off.smooth, `${occ}/${id}/${look.name} off`).toBe(false);
      expect(off.src).toBe(look.src);
      expect(off.frames).toBe(look.frames);
      expect(off.grid).toBe(OCCASIONS[occ][mode].grid);
      expect(off.timing).toBe(look.timing ?? DOGS[id].timing[mode]);
      expect(off.stillFrame).toBe(OCCASIONS[occ][mode].stillFrame);
      expect(off.scale).toBe(OCCASIONS[occ][mode].cellScale ?? 1);
    }

    // Three looks' entries are each broken ONE way, BEFORE they are first
    // resolved (resolution is cached per sheet). Each must play as drawn, not
    // half of each. One corruption per guard: a single corruption was caught by
    // a neighbouring guard, and the test stayed green with its own one deleted.
    const MISFITS = [
      // One gap too many, no frame more: only the gap count can see it.
      ["a gap too many", (s) => { const was = s.between; s.between = [...was, 0]; return () => { s.between = was; }; }],
      // A frame without a window.
      ["a window missing", (s) => { const was = s.top; s.top = was.slice(1); return () => { s.top = was; }; }],
      // More frames than the sheet has cells.
      ["a sheet too small", (s) => { const was = s.grid; s.grid = { columns: was.columns, rows: 1 }; return () => { s.grid = was; }; }]
    ];
    const victims = LOOKS.filter(([occ, , , , l]) => occ === "easter" && SMOOTH[l.src].between.includes(2)).slice(0, MISFITS.length);
    expect(victims, "three looks to break").toHaveLength(MISFITS.length);
    const broken = new Set();
    for (const [n, [why, breakIt]] of MISFITS.entries()) {
      const [bOcc, bMode, bId, bI, bLook] = victims[n];
      const restore = breakIt(SMOOTH[bLook.src]);
      try {
        const refused = withFlagInNode(true, () => artFor(bOcc, bMode, bId, bI));
        expect(refused.smooth, `misfit: ${why}`).toBe(false);
        expect(refused.src, why).toBe(bLook.src);
        expect(refused.frames, why).toBe(bLook.frames);
      } finally { restore(); }
      broken.add(bLook);
    }

    let smooth = 0;
    for (const [occ, mode, id, i, look] of LOOKS) {
      if (broken.has(look)) continue;
      const at = `${occ}/${mode}/${id}/${look.name}`;
      const s = SMOOTH[look.src];
      const on = withFlagInNode(true, () => artFor(occ, mode, id, i));
      const count = look.frames.length + sum(s.between);
      expect(on.smooth, `${at} on`).toBe(true);
      expect(on.src, at).toBe(s.src);
      expect(on.src, at).not.toBe(look.src);
      expect(on.grid, at).toBe(s.grid);
      expect(on.frames, at).toHaveLength(count);
      expect(on.timing, at).toHaveLength(count);
      // The reduced-motion portrait is still the same DRAWN frame.
      expect(on.stillFrame, `${at} still`).toBe(mode === "run" ? 0 : count - 1);
      expect(on.scale, `${at} scale`).toBeCloseTo((OCCASIONS[occ][mode].cellScale ?? 1) * s.scale, 9);
      expect(on.holdMs, at).toBe(look.holdMs ?? OCCASIONS[occ][mode].holdMs);
      smooth += 1;
    }
    expect(smooth).toBe(LOOKS.length - MISFITS.length);
  });

  test("flag off: the drawn sheet, twelve frames, and no smooth sheet requested", async ({ page }) => {
    const { errors, sheetRequests } = await open(page, false);
    const look = OCCASIONS.generic.peek.dogs.benji[0];
    await page.evaluate(() => { window.__dogDone = window.dogOccasion.show("generic", { dogs: ["benji"], looks: { benji: 0 } }); });
    // The show ran: mounted and painting. Only then does "nothing smooth was
    // asked for" mean anything.
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs[0]?.frame ?? -1), { timeout: 10_000 }).toBeGreaterThanOrEqual(1);
    const dog = await page.evaluate(() => window.dogOccasion.state().dogs[0]);
    expect(dog.smooth).toBe(false);
    expect(dog.frames).toBe(12);
    expect(sheetRequests).toContain(look.src);
    expect(sheetRequests.filter((u) => u.includes("/smooth/"))).toEqual([]);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("flag on: the smooth sheet, every frame in order, each held its own time", async ({ page }) => {
    const { errors, sheetRequests } = await open(page, true);
    const look = OCCASIONS.generic.peek.dogs.benji[0];
    const s = SMOOTH[look.src];
    const timing = smoothTiming(look.timing, s.between, "peek");
    expect(timing.length, "a look that really has in-betweens").toBeGreaterThan(20);

    await page.clock.install({ time: MIDDAY });
    await page.clock.pauseAt(new Date(MIDDAY.getTime() + 1000));
    await page.evaluate(() => { window.__dogDone = window.dogOccasion.show("generic", { dogs: ["benji"], looks: { benji: 0 } }); });
    await expect.poll(() => page.evaluate(() => window.dogOccasion.state().dogs.length), { timeout: 10_000 }).toBe(1);
    const dog = await page.evaluate(() => window.dogOccasion.state().dogs[0]);
    expect(dog.smooth).toBe(true);
    expect(dog.frames).toBe(timing.length);

    const seen = [];
    let last = -1;
    for (let t = 0; t <= sum(timing) + 200; t += 5) {
      const now = await page.evaluate(() => window.dogOccasion.state().dogs[0].frame);
      if (now !== last) seen.push({ frame: now, t });
      last = now;
      await page.clock.runFor(5);
    }
    expect(seen.map((x) => x.frame)).toEqual(timing.map((_, i) => i));
    for (let i = 1; i < seen.length; i++) {
      expect(Math.abs(seen[i].t - seen[i - 1].t - timing[i - 1]), `frame ${i - 1} held`).toBeLessThanOrEqual(5);
    }
    expect(sheetRequests).toContain(s.src);
    expect(sheetRequests, "the drawn sheet is not fetched as well").not.toContain(look.src);
    await page.evaluate(() => window.dogOccasion.hide());
    expect(await page.evaluate(() => window.__dogDone)).toEqual({ shown: false, reason: "hidden" });
    expect(errors).toEqual([]);
  });

  /* The settled portrait is a DRAWN frame in both states, so it must land on
     the same pixels: same place, same size. Cases chosen for what can differ —
     a re-packed sheet (same cells), Christmas peeks (lifted by window, cells
     re-cut), and a run (its own cell size, so `scale` is not 1). */
  const PORTRAITS = [
    ["generic", "peek", "benji", 0],
    ["christmas", "peek", "benji", 1],
    ["christmas", "peek", "teddy", 2],
    ["christmas", "run", "benji", 0],
    ["christmas", "run", "teddy", 0]
  ];

  async function portraits(page, on) {
    const { errors } = await open(page, on);
    await page.emulateMedia({ reducedMotion: "reduce" });
    expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(true);
    const out = [];
    for (const [occ, mode, id, i] of PORTRAITS) {
      await page.evaluate(([o, m, d, l]) => { window.__dogDone = window.dogOccasion.show(o, { mode: m, dogs: [d], looks: { [d]: l } }); }, [occ, mode, id, i]);
      await page.waitForSelector('.dogs .dog[data-phase="still"]');
      out.push(await page.evaluate(() => {
        const dog = document.querySelector(".dogs .dog");
        const frameEl = dog.querySelector(".dog__frame");
        const box = frameEl.getBoundingClientRect();
        const sheet = dog.querySelector(".dog__sheet").getBoundingClientRect();
        const inner = frameEl.style.clipPath.match(/^inset\((.*)\)$/)?.[1] ?? "";
        const v = inner.trim().split(/\s+/).map((x) => (x === "0" || x === "0px" ? 0 : x.endsWith("%") ? Number(x.slice(0, -1)) : NaN));
        const [T, R, B, L] = [v[0], v[1] ?? v[0], v[2] ?? v[0], v[3] ?? v[1] ?? v[0]];
        const st = window.dogOccasion.state().dogs[0];
        return {
          smooth: st.smooth, frame: st.frame, frames: st.frames,
          clipParsed: [T, R, B, L].every(Number.isFinite),
          sheet: { left: sheet.left, top: sheet.top, width: sheet.width, height: sheet.height },
          left: box.left + (L / 100) * box.width, right: box.right - (R / 100) * box.width,
          top: box.top + (T / 100) * box.height, bottom: box.bottom - (B / 100) * box.height
        };
      }));
      await page.evaluate(() => window.dogOccasion.hide());
      await expect(page.locator(".dogs")).toHaveCount(0);
    }
    expect(errors).toEqual([]);
    return out;
  }

  test("the settled portrait lands on the same pixels with the flag off and on", async ({ page }) => {
    const off = await portraits(page, false);
    await page.unrouteAll({ behavior: "wait" });
    const on = await portraits(page, true);
    for (const [n, [occ, mode, id]] of PORTRAITS.entries()) {
      const at = `${occ}/${mode}/${id}`;
      const a = off[n];
      const b = on[n];
      expect(a.smooth, `${at} off`).toBe(false);
      expect(b.smooth, `${at} on`).toBe(true);
      expect(b.frames, `${at} more frames on`).toBeGreaterThan(a.frames);
      // The same drawn frame: the last of a peek, the first of a run.
      expect(a.frame, `${at} off portrait`).toBe(mode === "run" ? 0 : a.frames - 1);
      expect(b.frame, `${at} on portrait`).toBe(mode === "run" ? 0 : b.frames - 1);
      expect(a.clipParsed && b.clipParsed, `${at} clip read`).toBe(true);
      // The dog is THERE, and a dog's size — before comparing where it is.
      expect(a.right - a.left, `${at} width`).toBeGreaterThan(80);
      expect(a.bottom - a.top, `${at} height`).toBeGreaterThan(80);
      // WHICH frame is under the window, not only where the window is: the
      // right window over the wrong cell shows another expression (or a
      // neighbour's half) in exactly the right place. The grid and the frame's
      // own window come from the data, never from the module's readout.
      const look = OCCASIONS[occ][mode].dogs[id][PORTRAITS[n][3]];
      const s = SMOOTH[look.src];
      const drawnWin = look.frames[a.frame];
      const cases = [
        ["off", a, OCCASIONS[occ][mode].grid,
          [(drawnWin.left + drawnWin.right) / 2, (drawnWin.top + drawnWin.base) / 2]],
        ["on", b, s.grid,
          [(s.left[b.frame] + s.right[b.frame]) / 2 / s.cell.w, (s.top[b.frame] + s.base[b.frame]) / 2 / s.cell.h]]
      ];
      for (const [state, got, grid, [wantX, wantY]] of cases) {
        const cellW = got.sheet.width / grid.columns;
        const cellH = got.sheet.height / grid.rows;
        expect(cellW, `${at} ${state} sheet is laid out`).toBeGreaterThan(80);
        const cellLeft = got.sheet.left + (got.frame % grid.columns) * cellW;
        const cellTop = got.sheet.top + Math.floor(got.frame / grid.columns) * cellH;
        const x = ((got.left + got.right) / 2 - cellLeft) / cellW;
        const y = ((got.top + got.bottom) / 2 - cellTop) / cellH;
        expect(Math.abs(x - wantX), `${at} ${state}: window centre x ${x.toFixed(3)} in its own cell, want ${wantX.toFixed(3)}`).toBeLessThan(0.02);
        expect(Math.abs(y - wantY), `${at} ${state}: window centre y ${y.toFixed(3)} in its own cell, want ${wantY.toFixed(3)}`).toBeLessThan(0.02);
      }
      // The windows are measured two ways (own blob by hand; every px of the
      // lifted frame), which may differ by the 2 px of air plus a fringe px.
      for (const edge of ["left", "right", "top", "bottom"]) {
        expect(Math.abs(a[edge] - b[edge]), `${at} ${edge}: off ${a[edge].toFixed(1)} on ${b[edge].toFixed(1)}`).toBeLessThanOrEqual(4);
      }
    }
  });
});
