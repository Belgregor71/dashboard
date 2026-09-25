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
   and 3 on y≈320-328, and the row below's hat tips reach up into the bottom of
   the row above. A plain crop would drop the dog ~24px between frames 3 and 4
   and paint a neighbour's hat under frames 4-7.

   So every frame carries two measured numbers, as fractions of its cell:
     base  where THIS dog's body ends. It is anchored to the bottom of the
           viewport, so everything below it (the neighbour's hat tips) is
           off-glass and the dog never jumps between rows.
     top   where the visible window starts. Everything above it is clipped.
   Fractions, not pixels, so a proportionally re-rendered sheet stays valid.

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
   `timing` is per mode: one entry per frame, in ms. A constant frame rate
   would make every expression last the same time, and the expressions are
   the point — Benji's last look lingers 900ms, Teddy's side-eye (frames 1-3)
   is held long enough to read as an assessment. `motion` names a profile
   below; `side` decides who stands left when both are on the glass. */
export const DOGS = {
  benji: {
    personality: "enthusiastic",   // friendly, boof head, a bull in a china shop
    scale: 1,
    side: "left",
    motion: "eager",
    timing: {
      peek: [140, 110, 140, 180, 180, 90, 130, 140, 180, 150, 260, 900]
    }
  },
  teddy: {
    personality: "cheeky",         // chaos, loner, does things on his terms
    scale: 0.88,
    side: "right",
    motion: "deliberate",
    timing: {
      peek: [180, 320, 260, 300, 230, 160, 220, 170, 180, 280, 140, 1100]
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

/* Frame windows for the christmas peek sheets, measured in px on the
   1448×1086 originals (362 cells) and stored as fractions of a cell.
   Row 3's hats poke up to 41px above their cell; `top` lets them through
   only as far as the row-2 body above them ends. */
const cell = (px) => px / 362;
const window12 = (tops, bases) => tops.map((t, i) => ({ top: cell(t), base: cell(bases[i]) }));

/* ── Occasions ──────────────────────────────────────────────────────────────
   occasion → mode → { grid, holdMs, dogs: { id → { src, frames } } }.
   A dog absent from an occasion simply cannot be asked for in it. */
export const OCCASIONS = {
  christmas: {
    peek: {
      grid: { columns: 4, rows: 3 },
      holdMs: 2000,                 // after the last frame's own 900/1100ms
      dogs: {
        benji: {
          src: "/assets/dogs/christmas/benji-peek-sprite.png",
          frames: window12(
            [0, 0, 0, 0, 0, 0, 0, 0, -34, -34, -34, -34],
            [352, 352, 352, 352, 327, 327, 327, 327, 328, 328, 328, 328]
          )
        },
        teddy: {
          src: "/assets/dogs/christmas/teddy-peek-sprite.png",
          frames: window12(
            [0, 0, 0, 0, 0, 0, 0, 0, -32, -41, -28, -28],
            [351, 351, 351, 351, 320, 320, 320, 320, 327, 327, 327, 326]
          )
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

/* Show frame `i`: shift the sheet so this frame's cell is in the box with its
   `base` on the box's bottom edge, then clip above its `top`. Both are
   transform / clip-path on elements that are their own layers — no layout,
   no repaint of anything else on the wall. */
function paintFrame(dog, i) {
  const { columns, rows } = dog.grid;
  const { top, base } = dog.frames[i];
  const col = i % columns;
  const row = Math.floor(i / columns);
  // translate % is of the SHEET, which is columns × rows cells.
  const x = (-col / columns) * 100;
  const y = (-(row + base - 1) / rows) * 100;
  dog.sheet.style.transform = `translate(${x}%, ${y}%)`;
  // In the box, this cell's top sits at (1 - base) of the box height.
  const clip = Math.max(0, (1 - base + top) * 100);
  dog.frame.style.clipPath = `inset(${clip.toFixed(3)}% 0 0 0)`;
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

    later(() => {
      paintFrame(dog, 0);
      setPhase(dog, "entering");
      let at = 0;
      dog.timing.forEach((ms, i) => {
        if (i > 0) later(() => paintFrame(dog, i), at);
        at += ms;
      });
      // Faces done: breathe, hold, go.
      later(() => setPhase(dog, "idle"), at);
      later(() => setPhase(dog, "exiting"), at + holdMs);
      later(resolve, at + holdMs + m.exitMs);
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

    const el = document.createElement("div");
    el.className = `dog dog--${id}`;
    el.dataset.dog = id;
    const x = ordered.length === 1 ? staging.single : staging.pair[def.side];
    el.style.setProperty("--dog-x", `${x}%`);
    el.style.setProperty("--dog-scale", String(def.scale));
    // One cell's aspect, from the sheet itself — never assumed square.
    el.style.setProperty("--dog-aspect", String((width / columns) / (height / rows)));
    el.style.setProperty("--dog-enter", m.enter);
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
    sheet.style.width = `${columns * 100}%`;
    sheet.style.height = `${rows * 100}%`;

    frame.append(sheet);
    body.append(frame);
    el.append(body);
    root.append(el);

    return {
      id, el, frame, sheet, phase: "waiting",
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
    dogs: (run?.dogs ?? []).map((d) => ({ id: d.id, phase: d.phase, frame: Number(d.el.dataset.frame ?? -1) })),
    runs
  };
}

export const dogOccasion = { show, hide, preload, state };
