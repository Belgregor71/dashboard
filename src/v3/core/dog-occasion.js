/* ═══════════════════════════════════════════════════════════════════════════
   DOG OCCASION — Benji and Teddy, the house's two recurring characters.

   A reusable overlay: an OCCASION (christmas, later halloween, a birthday, bin
   night) supplies sprite sheets; a MODE (peek, later run-across) says how they
   are staged; each DOG brings its own personality — frame timing, scale, how
   it moves. None of the three knows about the others' specifics, so a new
   occasion is a config entry and a folder of sheets, never a code change.

     dogOccasion.show("christmas", { mode: "peek", dogs: ["benji", "teddy"] })

   Nothing triggers this automatically yet. Until a caller exists the module
   does nothing at all: no DOM, no timers, no images decoded. That is also why
   it has no feature flag — the flag belongs to the first AUTOMATIC trigger.

   ── Why each frame has a window, not just a grid index ─────────────────────
   The sheets are an exact 4×3 grid, and frames ARE indexed on that grid. But
   the artwork does not respect its own cells (measured 2026-09-25, alpha > 24
   on the 1448×1086 sheets): row 1's dogs stand on y≈352 of a 362 cell, rows 2
   and 3 higher, the row below's hats reach up to 47px into the row above,
   and a few of Teddy's scarf tails cross into the next column. A plain crop
   would jump the dog between rows and paint slivers of neighbours.

   So every frame carries its OWN DOG's measured rectangle — the bounding box
   of that frame's connected blob (alpha > 24), which on the 2026-09-25 sheets
   isolates every frame with at most 9 stray fringe pixels of anyone else:
     base         where this dog ends. Anchored to the bottom of the glass,
                  so the dog never jumps between rows and anything below it
                  (the next row's hats) is off-glass.
     top          everything above is clipped.
     left, right  likewise; may reach past the cell, and the box is padded
                  (computed from these, never configured) so they fit.
   Fractions of a cell, not pixels, so a proportionally re-rendered sheet
   stays valid. Re-measure (scratch `cc2.mjs` method) whenever art changes.

   ── 24/7 discipline ─────────────────────────────────────────────────────────
   Every step is a setTimeout with a known duration — never animationend,
   which does not fire under display:none. No requestAnimationFrame at all.
   Every timer is tracked and cancelled by hide(). The overlay is REMOVED, not
   hidden, when a run ends; the decoded sheets are released with it (the HTTP
   cache keeps the bytes). Nothing is preloaded at boot: 2 × 6.3 MB of decoded
   bitmap held for weeks for a once-a-year moment is the leak this kiosk's
   memory rules exist to prevent. show() awaits decode() before mounting
   instead, so the first frame can never flash blank; preload() is for a
   scheduler that wants the first frame instant.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── Characters ─────────────────────────────────────────────────────────────
   `timing` is per mode: one entry per frame, in ms, indexed exactly as the
   sheet is drawn (owner's arrays, 2026-09-25, for these sheets). A constant
   frame rate would make every expression last the same time, and the
   expressions are the point. `motion` names a profile below; `side` decides
   who stands left when both are on the glass. */
export const DOGS = {
  benji: {
    personality: "enthusiastic",   // friendly, boof head, a bull in a china shop
    scale: 1,
    side: "left",
    motion: "eager",
    timing: {
      peek: [
        140,  // 1  barely peeking
        120,  // 2  rises quickly
        150,  // 3  fully up
        180,  // 4  glance
        170,  // 5  head tilt
        100,  // 6  blink
        150,  // 7  smile starts
        170,  // 8  big grin
        210,  // 9  tongue, full happy
        180,  // 10 enthusiastic tilt
        220,  // 11 settles
        1000  // 12 final hold
      ]
    }
  },
  teddy: {
    personality: "cheeky",         // chaos, loner, does things on his terms
    scale: 0.88,
    side: "right",
    motion: "deliberate",
    timing: {
      peek: [
        180,  // 1  peeking
        240,  // 2  slow rise
        260,  // 3  assessing
        320,  // 4  side-eye
        260,  // 5  deliberate tilt
        140,  // 6  blink
        220,  // 7  neutral hold
        180,  // 8  mouth opens
        220,  // 9  cheeky tongue
        300,  // 10 held tilt
        260,  // 11 composed reset
        1100  // 12 final hold
      ]
    }
  }
};

/* ── Motion profiles ────────────────────────────────────────────────────────
   Keyframes live in dog-occasion.css; these are the durations the timers must
   agree with. `delayMs` is when this dog starts relative to the other: Teddy
   arrives a beat after Benji, on his own terms. `bob` is the idle breathing
   once the face sequence is done — px of travel, ms per breath. */
export const MOTION = {
  eager: { enter: "dog-pop-benji", enterMs: 650, exit: "dog-exit", exitMs: 520, delayMs: 0, bob: { px: 3, ms: 2400 } },
  deliberate: { enter: "dog-pop-teddy", enterMs: 1100, exit: "dog-exit", exitMs: 780, delayMs: 300, bob: { px: 2, ms: 3400 } }
};

/* ── Staging ────────────────────────────────────────────────────────────────
   Horizontal centre of each dog, % of the viewport width. Vertical is always
   the bottom edge — that is what a peek is. */
export const STAGING = {
  peek: {
    single: 50,
    pair: { left: 37, right: 63 }
  }
};

/* Reduced motion: the last portrait, faded in and out. No rise, no frames. */
const STILL = { fadeInMs: 400, holdMs: 2600, fadeOutMs: 600 };

/* Frame windows, measured in px on the 1448×1086 sheets (362 cells) as each
   frame's own-blob bounding box, stored as fractions of a cell. Top, left and
   right get 2px of air so the art's soft alpha fringe (≤ 24) is not cut
   hard; base is exact — below it is off-glass anyway. */
const CELL_PX = 362;
const AIR = 2;
const windows = ({ top, base, left, right }) => base.map((b, i) => ({
  top: (top[i] - AIR) / CELL_PX,
  base: b / CELL_PX,
  left: (left[i] - AIR) / CELL_PX,
  right: (right[i] + AIR) / CELL_PX
}));

/* ── Occasions ──────────────────────────────────────────────────────────────
   occasion → mode → { grid, holdMs, dogs: { id → { src, frames } } }.
   A dog absent from an occasion simply cannot be asked for in it. */
export const OCCASIONS = {
  christmas: {
    peek: {
      grid: { columns: 4, rows: 3 },
      holdMs: 2000,                 // after the last frame's own 1000/1100ms
      dogs: {
        benji: {
          src: "/assets/dogs/christmas/benji_christmas_popup_sprite.png",
          frames: windows({
            top: [133, 97, 17, 28, -4, -7, -13, -10, -25, -20, -18, -24],
            base: [331, 335, 337, 338, 327, 324, 332, 333, 334, 334, 334, 335],
            left: [9, 11, 6, 21, 15, 13, 18, 17, 13, 10, 9, 16],
            right: [358, 346, 346, 359, 358, 354, 346, 353, 354, 352, 353, 351]
          })
        },
        teddy: {
          src: "/assets/dogs/christmas/teddy_christmas_popup_sprite.png",
          frames: windows({
            top: [194, 114, 35, 45, 11, 14, 10, 4, -14, -14, -26, -28],
            base: [346, 356, 357, 356, 326, 326, 326, 326, 304, 307, 304, 306],
            left: [32, 25, 21, 20, 32, 30, 24, 20, 30, 27, 16, 19],
            right: [367, 352, 352, 346, 390, 373, 360, 345, 376, 375, 358, 348]
          })
        }
      }
    }
  }
};

/* ── Sheets ─────────────────────────────────────────────────────────────── */

const sheets = new Map(); // src → Promise<{ width, height }>

function loadSheet(src) {
  if (!sheets.has(src)) {
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    // Two-handler .then: a failed load is answered here and evicted so the
    // next show retries, never re-thrown onto an unhandled chain.
    const ready = img.decode().then(
      () => ({ width: img.naturalWidth, height: img.naturalHeight, img }),
      () => { sheets.delete(src); return null; }
    );
    sheets.set(src, ready);
  }
  return sheets.get(src);
}

/** Warm an occasion's sheets so the next show() mounts without waiting. */
export function preload(occasionId, { mode = "peek" } = {}) {
  const staged = OCCASIONS[occasionId]?.[mode];
  if (!staged) return Promise.resolve(false);
  return Promise.all(Object.values(staged.dogs).map((d) => loadSheet(d.src)))
    .then((all) => all.every(Boolean));
}

/* ── Run state ──────────────────────────────────────────────────────────── */

let run = null;        // the one live run, or null
let generation = 0;    // bumps on every hide(); a stale await sees it changed
let runs = 0;

function later(fn, ms) {
  if (!run) return;
  const id = setTimeout(() => {
    run?.timers.delete(id);
    fn();
  }, ms);
  run.timers.add(id);
}

const reducedMotion = () =>
  Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

/* ── Frames ─────────────────────────────────────────────────────────────── */

/* The box is one cell tall and (1 + 2·pad) cells wide, the cell centred in
   it: pad is the furthest any frame's own dog reaches past its cell's sides,
   so no frame's window is ever cut by the box. Derived, never configured. */
function padFor(frames) {
  return Math.max(0, ...frames.map((f) => Math.max(-f.left, f.right - 1)));
}

/* Show frame `i`: shift the sheet so this frame's cell sits centred in the box
   with its `base` on the box's bottom edge, then clip to its window. Both are
   transform / clip-path on elements that are their own layers — no layout,
   no repaint of anything else on the wall. */
function paintFrame(dog, i) {
  const { columns, rows } = dog.grid;
  const { top, base, left, right } = dog.frames[i];
  const pad = dog.pad;
  const span = 1 + 2 * pad;
  const col = i % columns;
  const row = Math.floor(i / columns);
  // translate % is of the SHEET, which is columns × rows cells.
  const x = ((pad - col) / columns) * 100;
  const y = (-(row + base - 1) / rows) * 100;
  dog.sheet.style.transform = `translate(${x}%, ${y}%)`;
  // In the box, this cell's top sits at (1 - base) of the box height, and its
  // left edge at pad of the box's width in cells.
  const pct = (v) => `${Math.max(0, v * 100).toFixed(3)}%`;
  const clipTop = 1 - base + top;
  const clipLeft = (pad + left) / span;
  const clipRight = (pad + 1 - right) / span;
  dog.frame.style.clipPath = `inset(${pct(clipTop)} ${pct(clipRight)} 0 ${pct(clipLeft)})`;
  dog.el.dataset.frame = String(i);
}

function setPhase(dog, phase) {
  dog.phase = phase;
  dog.el.dataset.phase = phase;
}

/* One dog's whole life: enter + faces, idle hold, exit. Resolves when it has
   left the glass. Reduced motion collapses it to a faded still. */
function perform(dog, holdMs, still) {
  return new Promise((resolve) => {
    const m = dog.motion;
    if (still) {
      paintFrame(dog, dog.frames.length - 1);
      setPhase(dog, "still");
      later(() => setPhase(dog, "fading"), STILL.fadeInMs + STILL.holdMs);
      later(resolve, STILL.fadeInMs + STILL.holdMs + STILL.fadeOutMs);
      return;
    }

    /* CHAINED, each frame timed from the previous one's paint — never all
       scheduled up front at absolute offsets. Measured in the full suite: a
       timer ~80ms late under load, and the absolute schedule then fired the
       NEXT frame on time, so Benji's frame 7 was on the glass for 58ms of its
       140. Chained, every expression gets at least its own duration and a
       late timer only makes the whole run a little longer. */
    const step = (i) => {
      paintFrame(dog, i);
      if (i + 1 < dog.timing.length) {
        later(() => step(i + 1), dog.timing[i]);
        return;
      }
      // Faces done: breathe, hold, go.
      later(() => {
        setPhase(dog, "idle");
        later(() => setPhase(dog, "exiting"), holdMs);
        later(resolve, holdMs + m.exitMs);
      }, dog.timing[i]);
    };
    later(() => {
      setPhase(dog, "entering");
      step(0);
    }, m.delayMs);
  });
}

function build(ids, staged, sizes) {
  const root = document.createElement("div");
  root.className = "dogs";
  root.setAttribute("aria-hidden", "true");

  const staging = STAGING[run.mode] ?? STAGING.peek;
  const ordered = [...ids].sort((a, b) => (DOGS[a].side === "left" ? -1 : 1) - (DOGS[b].side === "left" ? -1 : 1));

  const dogs = ordered.map((id) => {
    const def = DOGS[id];
    const art = staged.dogs[id];
    const { width, height } = sizes.get(art.src);
    const { columns, rows } = staged.grid;
    const m = MOTION[def.motion];
    const pad = padFor(art.frames);
    const span = 1 + 2 * pad;

    const el = document.createElement("div");
    el.className = `dog dog--${id}`;
    el.dataset.dog = id;
    const x = ordered.length === 1 ? staging.single : staging.pair[def.side];
    el.style.setProperty("--dog-x", `${x}%`);
    el.style.setProperty("--dog-scale", String(def.scale));
    // One cell's aspect, from the sheet itself — never assumed square — widened
    // by the pad on both sides.
    el.style.setProperty("--dog-aspect", String(((width / columns) / (height / rows)) * span));    el.style.setProperty("--dog-enter", m.enter);
    el.style.setProperty("--dog-enter-ms", `${m.enterMs}ms`);
    el.style.setProperty("--dog-exit", m.exit);
    el.style.setProperty("--dog-exit-ms", `${m.exitMs}ms`);
    el.style.setProperty("--dog-bob-px", `${m.bob.px}px`);
    el.style.setProperty("--dog-bob-ms", `${m.bob.ms}ms`);
    el.style.setProperty("--dog-fade-in-ms", `${STILL.fadeInMs}ms`);
    el.style.setProperty("--dog-fade-out-ms", `${STILL.fadeOutMs}ms`);

    const body = document.createElement("div");
    body.className = "dog__body";
    const frame = document.createElement("div");
    frame.className = "dog__frame";
    const sheet = document.createElement("div");
    sheet.className = "dog__sheet";
    sheet.style.backgroundImage = `url("${art.src}")`;
    sheet.style.width = `${(columns / span) * 100}%`;
    sheet.style.height = `${rows * 100}%`;

    frame.append(sheet);
    body.append(frame);
    el.append(body);
    root.append(el);

    return {
      id, el, frame, sheet, pad, phase: "waiting",
      grid: staged.grid, frames: art.frames, timing: def.timing[run.mode], motion: m
    };
  });

  // Hidden until each dog's own delay has passed.
  for (const d of dogs) setPhase(d, "waiting");
  return { root, dogs };
}

function teardown() {
  if (!run) return;
  for (const id of run.timers) clearTimeout(id);
  run.root?.remove();
  run.cancel?.();
  // Release the decoded bitmaps; a later show re-reads them from HTTP cache.
  for (const src of run.srcs) sheets.delete(src);
  run = null;
}

/* ── API ────────────────────────────────────────────────────────────────── */

/**
 * Put dogs on the glass for an occasion. Resolves when they have gone, with
 * `{ shown: true }`, or at once with `{ shown: false, reason }`. Never throws
 * and never rejects — a caller on a 24/7 kiosk must not need a catch.
 * A call while a run is live is IGNORED (reason "busy"), never stacked.
 */
export async function show(occasionId, { mode = "peek", dogs } = {}) {
  if (run) return { shown: false, reason: "busy" };
  if (typeof document === "undefined") return { shown: false, reason: "no-document" };

  const staged = OCCASIONS[occasionId]?.[mode];
  if (!staged) return { shown: false, reason: "unknown-occasion" };
  const ids = [...new Set(dogs ?? Object.keys(staged.dogs))];
  if (!ids.length) return { shown: false, reason: "no-dogs" };
  for (const id of ids) {
    if (!DOGS[id] || !staged.dogs[id]) return { shown: false, reason: `unknown-dog:${id}` };
    const frameCount = staged.grid.columns * staged.grid.rows;
    if (DOGS[id].timing[mode]?.length !== frameCount || staged.dogs[id].frames.length !== frameCount) {
      return { shown: false, reason: `bad-config:${id}` };
    }
  }

  const gen = generation;
  const srcs = ids.map((id) => staged.dogs[id].src);
  run = { occasion: occasionId, mode, timers: new Set(), root: null, dogs: [], srcs, started: Date.now() };

  const loaded = await Promise.all(srcs.map(loadSheet));
  if (gen !== generation) return { shown: false, reason: "hidden" };
  if (loaded.some((l) => !l)) {
    teardown();
    return { shown: false, reason: "asset" };
  }

  const sizes = new Map(srcs.map((s, i) => [s, loaded[i]]));
  const built = build(ids, staged, sizes);
  const still = reducedMotion();
  run.root = built.root;
  run.dogs = built.dogs;
  run.still = still;
  if (still) built.root.dataset.still = "1";
  document.body.append(built.root);
  runs += 1;

  // hide() cancels every timer, so a performance it interrupts never resolves;
  // the race lets this call answer instead of hanging forever.
  const cancelled = new Promise((resolve) => { run.cancel = resolve; });
  await Promise.race([Promise.all(built.dogs.map((d) => perform(d, staged.holdMs, still))), cancelled]);
  if (gen !== generation) return { shown: false, reason: "hidden" };
  teardown();
  return { shown: true };
}

/** Take the dogs off the glass now, whatever they are doing. */
export function hide() {
  generation += 1;
  teardown();
}

/** Readout for __v3() and the specs. */
export function state() {
  return {
    running: Boolean(run),
    occasion: run?.occasion ?? null,
    mode: run?.mode ?? null,
    still: run?.still ?? false,
    dogs: (run?.dogs ?? []).map((d) => ({ id: d.id, phase: d.phase, frame: Number(d.el.dataset.frame ?? -1), pad: d.pad })),
    runs
  };
}

export const dogOccasion = { show, hide, preload, state };
