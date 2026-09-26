/* ═══════════════════════════════════════════════════════════════════════════
   DOG OCCASION — Benji and Teddy, the house's two recurring characters.

   A reusable overlay: an OCCASION (christmas, later halloween, a birthday, bin
   night) supplies sprite sheets; a MODE says how they are staged; each DOG
   brings its own personality — frame timing, scale, how it moves. None of the
   three knows about the others' specifics, so a new occasion is a config entry
   and a folder of sheets, never a code change.

     dogOccasion.show("christmas", { mode: "peek", dogs: ["benji", "teddy"] })
     dogOccasion.show("christmas", { mode: "run",  dogs: ["benji", "teddy"] })
     dogOccasion.show("christmas", { looks: { benji: 1 } })   // pin a look

   Looks: a dog may have several sheets for one occasion and mode — the same
   expressions in a different outfit (Christmas peek: Benji in a Santa hat,
   reindeer antlers or an elf hat; Teddy in a Santa hat, a holly cape or a
   crown).
   Every show() picks one per dog, independently and at random, unless the
   caller pins it. Each look is a full sheet with its OWN measured windows.

   Modes:
     peek   up from the bottom edge, a sequence of expressions, back down.
     run    left to right across the lower third, once. Two layers: the sheet
            cycles the gait IN PLACE, and the wrapper alone travels the glass —
            the run cycle never carries screen travel.

   The only automatic caller is dog-schedule.js (features.v3DogSchedule);
   the flag is there, not here. Between shows this module does nothing at
   all: no DOM, no timers, no images decoded.

   ── Why each frame has a window, not just a grid index ─────────────────────
   Frames ARE indexed on the sheet's grid, but AI-drawn sheets do not respect
   their own cells: on the peek sheets (measured 2026-09-25, alpha > 24,
   1448×1086) rows sit at different heights, the row below's hats reach 47px
   into the row above, and Teddy's scarf tails cross into the next column. On
   the run sheets (1254×1254, 4×4) the paw line drifts 57px from row 1 to row
   4. A plain crop would jump the dog about and paint slivers of neighbours.

   So every frame carries its OWN DOG's measured rectangle — the bounding box
   of that frame's connected blob (alpha > 24; every frame on both sets is
   isolated to within 9 stray fringe pixels of anyone else):
     top, base, left, right   the window; everything outside is clipped. May
                              reach past the cell; the box is derived from
                              these so no window is ever cut by it.
     cx, cy                   (run only) the alpha-weighted centroid — the
                              body. A run frame is placed by its body, so the
                              torso travels level and the legs do the work;
                              anchored by the paws instead, a tucked-leg frame
                              would drop the whole dog 35px.
   A peek frame is placed by its `base` on the bottom edge instead — a peek IS
   the edge. Fractions of a cell, not pixels, so a proportionally re-rendered
   sheet stays valid. Re-measure whenever the art changes (method: label
   components over the cell; own = most pixels in the cell).

   ── 24/7 discipline ─────────────────────────────────────────────────────────
   Every step is a setTimeout with a known duration — never animationend,
   which does not fire under display:none. No requestAnimationFrame at all.
   Every timer is tracked and cancelled by hide(); a run's frame loop is
   cancelled the moment its dog has left the glass. The overlay is REMOVED, not
   hidden, when a run ends; the decoded sheets are released with it (the HTTP
   cache keeps the bytes). Nothing is preloaded at boot: several MB of decoded
   bitmap held for weeks for a once-a-year moment is the leak this kiosk's
   memory rules exist to prevent. show() awaits decode() before mounting
   instead, so the first frame can never flash blank; preload() is for a
   scheduler that wants the first frame instant.
   ═══════════════════════════════════════════════════════════════════════════ */

import { SHEETS, CELL_SCALE } from "./dog-sheets.js";

/* A constant rate, as a per-frame array: the run cycle's frames are strides,
   not expressions, so they share one duration — but the shape stays the same
   as peek's, and any frame can be given its own time later. */
const atFps = (fps, frames) => Array.from({ length: frames }, () => Math.round(1000 / fps));

/* ── Characters ─────────────────────────────────────────────────────────────
   `timing` is per mode: one entry per frame, in ms, indexed exactly as the
   sheet is drawn (peek: owner's arrays, 2026-09-25). A constant frame rate
   would make every peek expression last the same time, and the expressions
   are the point. `motion` names a profile below; `side` decides who stands
   left when both are on the glass. `scale` is the character's size in every
   mode — Benji is the bigger dog. */
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
      ],
      run: atFps(12, 16)           // 83ms: a quick, busy gait
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
      ],
      run: atFps(11, 16)           // 91ms: unhurried — he chose to run
    }
  }
};

/* ── Motion profiles ────────────────────────────────────────────────────────
   Per mode. Keyframes live in dog-occasion.css; these are the durations the
   timers must agree with.

   peek   `delayMs` is when this dog starts relative to the other: Teddy arrives
          a beat after Benji, on his own terms. `bob` is the idle breathing once
          the face sequence is done — px of travel, ms per breath.
   run    `path` is the wrapper's travel keyframes and `crossMs` how long it
          takes, off-glass left to off-glass right. Benji's path surges and
          checks himself; Teddy's is nearly even. `bob` is the stride bounce —
          px, ms per half-bounce. `ground` is the box's bottom edge above the
          glass's, in vh: Teddy runs a touch higher, which with his smaller
          size puts him a step further back. Nothing here rotates or reshapes
          a dog: the art is the character, and only position and scale move. */
export const MOTION = {
  eager: {
    peek: { enter: "dog-pop-benji", enterMs: 650, exit: "dog-exit", exitMs: 520, delayMs: 0, bob: { px: 3, ms: 2400 } },
    run: { path: "dog-run-eager", crossMs: 5400, delayMs: 0, bob: { px: 7, ms: 320 }, ground: 3.5 }
  },
  deliberate: {
    peek: { enter: "dog-pop-teddy", enterMs: 1100, exit: "dog-exit", exitMs: 780, delayMs: 300, bob: { px: 2, ms: 3400 } },
    run: { path: "dog-run-deliberate", crossMs: 6000, delayMs: 480, bob: { px: 3, ms: 470 }, ground: 5 }
  }
};

/* ── Staging ────────────────────────────────────────────────────────────────
   Horizontal centre of each dog, % of the viewport width. A peek is always at
   the bottom edge; a run uses these only for its reduced-motion still. */
export const STAGING = {
  peek: {
    single: 50,
    pair: { left: 37, right: 63 }
  },
  run: {
    single: 50,
    pair: { left: 40, right: 60 }
  }
};

/* Reduced motion: one portrait, faded in and out. No travel, no frames. */
const STILL = { fadeInMs: 400, holdMs: 2600, fadeOutMs: 600 };

/* Frame windows, measured in px as each frame's own-blob bounding box, stored
   as fractions of a cell. Top, left and right get 2px of air so the art's
   soft alpha fringe (≤ 24) is not cut hard. A peek's base is exact — below it
   is off-glass anyway; a run's base is on the glass, so it gets air too. */
const AIR = 2;
const windows = ({ top, base, left, right, cx, cy }, { cellPx, cellW = cellPx, cellH = cellPx, baseAir = 0 }) => base.map((b, i) => ({
  top: (top[i] - AIR) / cellH,
  base: (b + baseAir) / cellH,
  left: (left[i] - AIR) / cellW,
  right: (right[i] + AIR) / cellW,
  ...(cx && cy ? { cx: cx[i] / cellW, cy: cy[i] / cellH } : {})
}));

/* ── Choreography ───────────────────────────────────────────────────────────
   A look that is its own PERFORMANCE, not just an outfit, times its own faces.
   occasion → dog → look name → { timing?, holdMs? }. `timing` replaces the
   dog's per-mode array (same length, one entry per frame, ms); `holdMs`
   replaces the mode's idle hold. A look with no entry here performs on its
   dog's timing, as every look did before. Kept here, not in dog-sheets.js:
   that file is generated, and a re-import would wipe it.

   The generic sheets are ten different performances, each drawn beat by beat
   (contact sheets read 2026-09-27; one line per frame says what is on it). Each
   dog keeps its own character: Benji's frames are quick with a snap on the
   gag, Teddy's slower, holding longest on the look he is giving you. The final
   frame keeps its dog's settled 1000 / 1100 ms. */
const CHOREOGRAPHY = {
  generic: {
    benji: {
      lickscreen: {
        timing: [
          160,  // 1  up, grinning
          140,  // 2  paw lifts
          160,  // 3  tongue out, paw up
          200,  // 4  first lick
          260,  // 5  tongue full out, square on
          320,  // 6  licking the glass
          360,  // 7  the big lick, tongue across the nose
          220,  // 8  tongue swings to the side
          180,  // 9  tilt, tongue hanging
          180,  // 10 grin
          200,  // 11 settles
          1000  // 12 final hold
        ]
      },
      noseboop: {
        timing: [
          220,  // 1  eyes over the edge
          140,  // 2  pops up
          200,  // 3  looks at you
          220,  // 4  leans in
          240,  // 5  closer
          380,  // 6  nose on the glass
          420,  // 7  boop, a blep
          160,  // 8  pulls back
          200,  // 9  blep
          180,  // 10 smile
          200,  // 11 big grin
          1000  // 12 tilt, final hold
        ]
      },
      pawsup: {
        timing: [
          260,  // 1  eyes over the edge
          140,  // 2  up on the paws
          200,  // 3  head tilt
          260,  // 4  more tilt
          180,  // 5  one paw comes up
          160,  // 6  both paws
          160,  // 7  paws climbing
          260,  // 8  paws high
          300,  // 9  paws up, beaming
          260,  // 10 a wave
          180,  // 11 paws down
          1000  // 12 grin, final hold
        ]
      },
      tennisball: {
        timing: [
          200,  // 1  lying with the ball
          220,  // 2  eyes locked on it
          140,  // 3  mouths it
          140,  // 4  paw on it
          120,  // 5  mouth wide, excited
          180,  // 6  play bow
          140,  // 7  rolls it, chewing
          220,  // 8  ball in the mouth
          120,  // 9  a swipe
          260,  // 10 head down, guarding it
          200,  // 11 paw on it, happy
          1000  // 12 proud, final hold
        ]
      },
      wavepeek: {
        timing: [
          260,  // 1  eyes over the edge
          140,  // 2  rises
          180,  // 3  up, grinning
          160,  // 4  paw lifts
          260,  // 5  wave and a wink
          160,  // 6  wave
          280,  // 7  wave and a wink
          160,  // 8  paw down
          180,  // 9  square on
          220,  // 10 tilt, tongue out
          200,  // 11 tilt back
          1000  // 12 final hold
        ]
      }
    },
    teddy: {
      boneguard: {
        timing: [
          300,  // 1  chin on the bone
          380,  // 2  glances sideways
          420,  // 3  suspicious look
          200,  // 4  licks his nose
          440,  // 5  head down over it, guarding
          220,  // 6  happy again
          260,  // 7  tilt
          320,  // 8  looks away, smug
          380,  // 9  side glance
          220,  // 10 happy
          300,  // 11 chin back down
          1100  // 12 composed, final hold
        ]
      },
      cheekypeek: {
        timing: [
          360,  // 1  eyes over the edge
          260,  // 2  rising
          220,  // 3  up
          240,  // 4  fully up
          360,  // 5  looks away
          460,  // 6  nose in the air, aloof
          380,  // 7  side-eye back at you
          180,  // 8  a blep
          280,  // 9  smug
          260,  // 10 smug
          220,  // 11 grin
          1100  // 12 the wink, final hold
        ]
      },
      happyexpressions: {
        timing: [
          300,  // 1  eyes over the edge
          220,  // 2  up
          280,  // 3  glances aside
          280,  // 4  looks back
          200,  // 5  neutral
          220,  // 6  smile
          240,  // 7  tilted grin
          300,  // 8  tilt
          260,  // 9  a wink
          200,  // 10 smile
          220,  // 11 grin
          1100  // 12 final hold
        ]
      },
      sideeye: {
        timing: [
          300,  // 1  eyes over the edge
          260,  // 2  up
          320,  // 3  eyes slide left
          560,  // 4  the full side-eye
          200,  // 5  licks his nose
          280,  // 6  tilt
          420,  // 7  side-eye again
          360,  // 8  still side-eye
          380,  // 9  eyes shut, smug
          520,  // 10 side-eye away
          360,  // 11 side-eye, a blep
          1100  // 12 flat stare, final hold
        ]
      },
      thoughtfulpeek: {
        timing: [
          320,  // 1  eyes over the edge
          240,  // 2  rises
          220,  // 3  up, grinning
          340,  // 4  glances aside
          200,  // 5  licks his nose
          260,  // 6  wink, tongue out
          240,  // 7  tilt
          300,  // 8  a wave
          240,  // 9  paws up
          280,  // 10 glance
          240,  // 11 squinting grin
          1100  // 12 final hold
        ]
      }
    }
  }
};

/* Every occasion after Christmas comes from scripts/dogs/measure-sheets.py
   (dog-sheets.js, generated). Those sheets are RE-PACKED at import: each frame
   lifted out by its own pixels and laid base-down in a clean grid, so their
   windows never hold a neighbour and none carries a hand trim. Their cells are
   460px tall but drawn at Christmas's px size, so `cellScale` grows the box to
   match — one sheet px is the same size on the glass in every occasion.
   Same 4×3 grid as Christmas; a look performs on its dog's own peek timing
   unless CHOREOGRAPHY gives it its own. */
const peekFromSheets = (occasionId, looksByDog) => ({
  grid: { columns: 4, rows: 3 },
  anchor: "base",
  stillFrame: 11,
  holdMs: 2000,
  cellScale: CELL_SCALE,
  dogs: Object.fromEntries(Object.entries(looksByDog).map(([id, looks]) => [id, looks.map((l) => ({
    name: l.name,
    src: l.src,
    frames: windows(l, { cellW: l.cell.w, cellH: l.cell.h }),
    ...CHOREOGRAPHY[occasionId]?.[id]?.[l.name]
  }))]))
});

/* ── Occasions ──────────────────────────────────────────────────────────────
   occasion → mode → { grid, anchor, stillFrame, holdMs?, dogs: { id → [look…] } },
   each look `{ name, src, frames, timing?, holdMs? }`. Every look of one mode
   shares the grid; it shares its dog's timing and the mode's hold too unless
   it brings its own (see CHOREOGRAPHY).
   `anchor` is how a frame is placed in its box: "base" (paws on the bottom
   edge) or "centroid" (body level). `stillFrame` is the reduced-motion
   portrait. A dog absent from an occasion simply cannot be asked for in it. */
export const OCCASIONS = {
  christmas: {
    peek: {
      grid: { columns: 4, rows: 3 },
      anchor: "base",
      stillFrame: 11,               // the final, settled portrait
      holdMs: 2000,                 // after the last frame's own 1000/1100ms
      // All six sheets 1448×1086 → 362px cells. Looks 1 and 2 measured
      // 2026-09-26; a trimmed edge below is noted where the art touches a
      // neighbour's, and every final window (AIR included) holds ≤ 9 foreign
      // fringe px > alpha 24 — the same as look 0 always has.
      dogs: {
        benji: [
          {
            name: "santa",
            src: "/assets/dogs/christmas/benji_christmas_santa.png",
            frames: windows({
              top: [133, 97, 17, 28, -4, -7, -13, -10, -25, -20, -18, -24],
              base: [331, 335, 337, 338, 327, 324, 332, 333, 334, 334, 334, 335],
              left: [9, 11, 6, 21, 15, 13, 18, 17, 13, 10, 9, 16],
              right: [358, 346, 346, 359, 358, 354, 346, 353, 354, 352, 353, 351]
            }, { cellPx: 362 })
          },
          {
            name: "antlers",
            src: "/assets/dogs/christmas/benji_christmas_antlers.png",
            // Frame 10's antler tips reach the row above's paws (-35, alpha
            // 87): its top is -32 (measured -35), 7 own px.
            frames: windows({
              top: [161, 65, 13, 24, -5, 24, 9, 9, -26, -32, -9, -22],
              base: [353, 353, 354, 355, 329, 328, 330, 329, 308, 313, 311, 309],
              left: [25, 23, 11, 40, 23, 23, 18, 37, 26, 10, 35, 42],
              right: [349, 345, 342, 338, 356, 336, 339, 344, 348, 356, 343, 346]
            }, { cellPx: 362 })
          },
          {
            name: "elf",
            src: "/assets/dogs/christmas/benji_christmas_elf.png",
            frames: windows({
              top: [174, 26, 30, 58, 18, 18, 20, 19, -3, 8, 65, 0],
              base: [356, 356, 356, 356, 347, 347, 347, 344, 325, 325, 315, 325],
              left: [23, 14, 18, 24, 37, 18, 33, 33, 37, 31, 26, 23],
              right: [355, 350, 349, 340, 370, 358, 365, 352, 362, 352, 375, 347]
            }, { cellPx: 362 })
          }
        ],
        teddy: [
          {
            name: "santa",
            src: "/assets/dogs/christmas/teddy_christmas_santa.png",
            frames: windows({
              top: [194, 114, 35, 45, 11, 14, 10, 4, -14, -14, -26, -28],
              base: [346, 356, 357, 356, 326, 326, 326, 326, 304, 307, 304, 306],
              left: [32, 25, 21, 20, 32, 30, 24, 20, 30, 27, 16, 19],
              right: [367, 352, 352, 346, 390, 373, 360, 345, 376, 375, 358, 348]
            }, { cellPx: 362 })
          },
          {
            name: "holly",
            src: "/assets/dogs/christmas/teddy_christmas_holly.png",
            // Frame 10's ear reaches the row above's paws: top -6 (measured -9).
            frames: windows({
              top: [205, 86, 34, 44, 22, 33, 30, 34, -2, -6, 5, -6],
              base: [375, 377, 377, 378, 354, 354, 354, 354, 332, 332, 333, 332],
              left: [17, 19, 24, 26, 28, 25, 17, 17, 29, 13, 18, 19],
              right: [364, 354, 360, 344, 380, 359, 355, 345, 362, 357, 353, 344]
            }, { cellPx: 362 })
          },
          {
            name: "crown",
            src: "/assets/dogs/christmas/teddy_christmas_crown.png",
            // The crowded one: row 2's paws REST ON row 3's crowns, so frames
            // 5+9 and 6+10 are one blob. Cut at row 2's own base line (333):
            // 5 and 6 end there, 9 and 10 start below it. Row 3's crowns and
            // frames 6/7's tips also reach the paws above (tops -9, -11, -26,
            // -27, -27 from -13, -13, -181, -28, -32; ≤ 36 own px each), and
            // a crown finial pokes up into frame 8's paws — its base is 330
            // (measured 333), 3 px rows of paw at the glass edge.
            frames: windows({
              top: [117, 14, 6, 14, -4, -9, -11, 2, -27, -26, -27, -27],
              base: [348, 351, 349, 350, 333, 333, 333, 330, 332, 332, 331, 333],
              left: [9, 12, 6, 8, 9, 18, 23, 23, 9, 21, 9, 23],
              right: [355, 360, 338, 347, 359, 353, 356, 349, 354, 355, 356, 355]
            }, { cellPx: 362 })
          }
        ]
      }
    },
    run: {
      grid: { columns: 4, rows: 4 },
      anchor: "centroid",
      stillFrame: 0,
      dogs: {
        benji: [{
          name: "basic",
          src: "/assets/dogs/christmas/benji_christmas_run_basic.png",
          // 1254×1254 sheet → 313.5px cells; measured 2026-09-25. Frames 11
          // and 12 touch across their shared cell line — 11's forepaw is in
          // 12's window and 12's tail in 11's (alpha to 249) — so 11's right
          // is 315 (measured 318) and 12's left 7 (measured 4): each costs 7
          // of its own px and leaves 0 foreign px > alpha 24 in any window.
          frames: windows({
            top: [64, 49, 50, 53, 32, 38, 40, 26, 32, 36, 33, 28, 8, 16, 18, 12],
            base: [307, 304, 307, 300, 290, 248, 276, 290, 269, 272, 267, 266, 262, 258, 254, 250],
            left: [21, 26, 15, 0, 22, 20, 18, -2, 34, 26, 18, 7, 25, 20, 5, 12],
            right: [305, 300, 283, 282, 310, 304, 297, 282, 304, 294, 315, 288, 304, 306, 304, 292],
            cx: [167.9, 174.3, 152.8, 153.4, 170.1, 173.1, 155.5, 155.3, 174.6, 162.7, 169.2, 155.4, 167.0, 168.2, 163.1, 158.5],
            cy: [171.8, 167.1, 172.2, 168.4, 143.5, 139.0, 148.1, 141.1, 138.8, 140.5, 153.0, 136.9, 121.2, 123.4, 124.8, 126.2]
          }, { cellPx: 313.5, baseAir: AIR })
        }],
        teddy: [{
          name: "basic",
          src: "/assets/dogs/christmas/teddy_christmas_run_basic.png",
          frames: windows({
            top: [61, 49, 53, 46, 50, 48, 46, 48, 39, 39, 52, 50, 18, 28, 28, 32],
            base: [298, 299, 298, 299, 292, 282, 290, 294, 286, 287, 287, 284, 262, 266, 266, 260],
            left: [17, 16, 16, 18, 17, 24, 33, 26, 24, 26, 23, 24, 25, 18, 26, 18],
            right: [303, 300, 291, 298, 318, 320, 302, 306, 312, 302, 310, 304, 318, 314, 304, 296],
            cx: [175.0, 176.6, 165.9, 170.0, 181.9, 184.1, 177.6, 173.1, 179.3, 176.2, 178.1, 175.1, 183.3, 177.6, 175.7, 169.2],
            cy: [168.4, 167.6, 170.7, 163.5, 163.5, 157.2, 162.3, 161.8, 153.3, 156.4, 160.8, 163.1, 129.3, 133.1, 137.3, 138.5]
          }, { cellPx: 313.5, baseAir: AIR })
        }]
      }
    }
  },
  ...Object.fromEntries(Object.entries(SHEETS).map(([id, dogs]) => [id, { peek: peekFromSheets(id, dogs) }]))
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

/**
 * Choose a look for each dog: one draw per dog, so Benji's outfit says nothing
 * about Teddy's. `pinned` ({ id → index }) wins over the draw. `avoid`
 * ({ id → index }, the look each dog wore last time) is drawn again ONCE if
 * the draw lands on it — so a pool of five rarely repeats back to back but is
 * never forced into a pattern. Returns { id → index }, or null if a pinned
 * index is not a look this dog has.
 */
export function pickLooks(occasionId, { mode = "peek", dogs, pinned = {}, avoid = {}, random = Math.random } = {}) {
  const staged = OCCASIONS[occasionId]?.[mode];
  if (!staged) return null;
  const picks = {};
  const draw = (n) => Math.min(n - 1, Math.floor(random() * n));
  for (const id of dogs ?? Object.keys(staged.dogs)) {
    const looks = staged.dogs[id];
    if (!looks) return null;
    let i = pinned[id];
    if (i == null) {
      i = draw(looks.length);
      if (i === avoid[id] && looks.length > 1) i = draw(looks.length);
    }
    if (!Number.isInteger(i) || !looks[i]) return null;
    picks[id] = i;
  }
  return picks;
}

const allSrcs = (staged) => Object.values(staged.dogs).flat().map((l) => l.src);

/**
 * Warm an occasion's sheets so the next show() mounts without waiting. With
 * `looks` ({ id → index }, e.g. from pickLooks — then pass the same to
 * show()), only those; without, EVERY look — several MB of bitmap each.
 */
export function preload(occasionId, { mode = "peek", looks } = {}) {
  const staged = OCCASIONS[occasionId]?.[mode];
  if (!staged) return Promise.resolve(false);
  const srcs = looks
    ? Object.entries(looks).map(([id, i]) => staged.dogs[id]?.[i]?.src)
    : allSrcs(staged);
  if (srcs.some((s) => !s)) return Promise.resolve(false);
  return Promise.all(srcs.map(loadSheet)).then((all) => all.every(Boolean));
}

/* ── Run state ──────────────────────────────────────────────────────────── */

let run = null;        // the one live run, or null
let generation = 0;    // bumps on every hide(); a stale await sees it changed
let runs = 0;
/* The look each dog last wore on the glass, per occasion + mode ("generic/peek"
   → { id → index }): the next unpinned draw avoids it once. Recorded when the
   dogs MOUNT — a run that never reached the glass was never seen. */
const lastLooks = new Map();

function later(fn, ms) {
  if (!run) return null;
  const id = setTimeout(() => {
    run?.timers.delete(id);
    fn();
  }, ms);
  run.timers.add(id);
  return id;
}

function cancel(id) {
  if (id == null) return;
  clearTimeout(id);
  run?.timers.delete(id);
}

const reducedMotion = () =>
  Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

/* ── Frames ─────────────────────────────────────────────────────────────── */

/* The box every frame of one dog is painted in, in cells, and the point in it
   where each frame's anchor lands. Derived from the windows, never configured.

   base      one cell tall, (1 + 2·pad) cells wide with the cell centred: pad is
             the furthest any frame's own dog reaches past its cell's sides.
             Each frame's base sits on the box's bottom edge.
   centroid  as tall and wide as the furthest any frame reaches from its own
             centroid in each direction; each frame's centroid lands on the
             same point, and the lowest paw of the whole cycle touches the
             box's bottom edge. */
function padFor(frames) {
  return Math.max(0, ...frames.map((f) => Math.max(-f.left, f.right - 1)));
}

function layoutFor(frames, anchor) {
  if (anchor === "centroid") {
    const up = Math.max(...frames.map((f) => f.cy - f.top));
    const down = Math.max(...frames.map((f) => f.base - f.cy));
    const back = Math.max(...frames.map((f) => f.cx - f.left));
    const ahead = Math.max(...frames.map((f) => f.right - f.cx));
    return { w: back + ahead, h: up + down, ax: back, ay: up, pad: 0, at: (f) => [f.cx, f.cy] };
  }
  const pad = padFor(frames);
  return { w: 1 + 2 * pad, h: 1, ax: pad + 0.5, ay: 1, pad, at: (f) => [0.5, f.base] };
}

/* Show frame `i`: shift the sheet so this frame's anchor sits on the box's
   anchor point, then clip to its window. Both are transform / clip-path on
   elements that are their own layers — no layout, no repaint of anything else
   on the wall. */
function paintFrame(dog, i) {
  const { columns, rows } = dog.grid;
  const f = dog.frames[i];
  const L = dog.layout;
  const [fx, fy] = L.at(f);
  const col = i % columns;
  const row = Math.floor(i / columns);
  // Where this frame's cell's top-left lands in the box, in cells.
  const cellLeft = L.ax - fx;
  const cellTop = L.ay - fy;
  // translate % is of the SHEET, which is columns × rows cells.
  const x = ((cellLeft - col) / columns) * 100;
  const y = ((cellTop - row) / rows) * 100;
  dog.sheet.style.transform = `translate(${x}%, ${y}%)`;
  const pct = (v) => `${Math.max(0, v * 100).toFixed(3)}%`;
  const clipTop = (cellTop + f.top) / L.h;
  const clipBottom = 1 - (cellTop + f.base) / L.h;
  const clipLeft = (cellLeft + f.left) / L.w;
  const clipRight = 1 - (cellLeft + f.right) / L.w;
  dog.frame.style.clipPath = `inset(${pct(clipTop)} ${pct(clipRight)} ${pct(clipBottom)} ${pct(clipLeft)})`;
  // When, for state(): a spec stamping from its own observer measured a
  // late callback, not a paint (58ms "frames" from a chained 91ms loop).
  dog.paintedAt = performance.now();
  dog.el.dataset.frame = String(i);
}

function setPhase(dog, phase) {
  dog.phase = phase;
  dog.el.dataset.phase = phase;
}

/* Reduced motion, either mode: one portrait, faded in and out. */
function performStill(dog, stillFrame, resolve) {
  paintFrame(dog, stillFrame);
  setPhase(dog, "still");
  later(() => setPhase(dog, "fading"), STILL.fadeInMs + STILL.holdMs);
  later(resolve, STILL.fadeInMs + STILL.holdMs + STILL.fadeOutMs);
}

/* Peek: enter + faces, idle hold, exit. Resolves when it has left the glass. */
function performPeek(dog) {
  return new Promise((resolve) => {
    const m = dog.motion;
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
        later(() => setPhase(dog, "exiting"), dog.holdMs);
        later(resolve, dog.holdMs + m.exitMs);
      }, dog.timing[i]);
    };
    later(() => {
      setPhase(dog, "entering");
      step(0);
    }, m.delayMs);
  });
}

/* Run: the gait loops in place, chained like peek's frames, for exactly as
   long as the wrapper's one crossing takes; then the loop is cancelled and
   the dog is gone. The crossing itself is the CSS path — one animation, run
   once — and the timer, not animationend, says when it is over. */
function performRun(dog) {
  return new Promise((resolve) => {
    const m = dog.motion;
    const n = dog.timing.length;
    let next = null;
    const step = (i) => {
      paintFrame(dog, i);
      next = later(() => step((i + 1) % n), dog.timing[i]);
    };
    later(() => {
      setPhase(dog, "running");
      step(0);
      later(() => {
        cancel(next);
        setPhase(dog, "gone");
        resolve();
      }, m.crossMs);
    }, m.delayMs);
  });
}

function perform(dog, staged, still) {
  if (still) return new Promise((resolve) => performStill(dog, staged.stillFrame, resolve));
  return run.mode === "run" ? performRun(dog) : performPeek(dog);
}

function build(ids, staged, sizes) {
  const root = document.createElement("div");
  root.className = "dogs";
  root.dataset.mode = run.mode;
  root.setAttribute("aria-hidden", "true");

  const staging = STAGING[run.mode] ?? STAGING.peek;
  const byside = (a, b) => (DOGS[a].side === "left" ? -1 : 1) - (DOGS[b].side === "left" ? -1 : 1);
  // A run paints the nearer dog (the lower ground) last, so it passes in
  // front; a peek keeps left-to-right.
  const nearLast = (a, b) => MOTION[DOGS[b].motion].run.ground - MOTION[DOGS[a].motion].run.ground;
  const ordered = [...ids].sort(run.mode === "run" ? nearLast : byside);

  const dogs = ordered.map((id) => {
    const def = DOGS[id];
    const look = run.looks[id];
    const art = staged.dogs[id][look];
    const { width, height } = sizes.get(art.src);
    const { columns, rows } = staged.grid;
    const m = MOTION[def.motion][run.mode];
    const layout = layoutFor(art.frames, staged.anchor);

    const el = document.createElement("div");
    el.className = `dog dog--${id}`;
    el.dataset.dog = id;
    const x = ordered.length === 1 ? staging.single : staging.pair[def.side];
    const set = (k, v) => el.style.setProperty(k, v);
    set("--dog-x", `${x}%`);
    set("--dog-scale", String(def.scale * (staged.cellScale ?? 1)));
    // The box's aspect from the sheet itself — one cell's real aspect, never
    // assumed square — times the layout's size in cells.
    set("--dog-box-h", String(layout.h));
    set("--dog-aspect", String(((width / columns) * layout.w) / ((height / rows) * layout.h)));
    set("--dog-bob-px", `${m.bob.px}px`);
    set("--dog-bob-ms", `${m.bob.ms}ms`);
    set("--dog-fade-in-ms", `${STILL.fadeInMs}ms`);
    set("--dog-fade-out-ms", `${STILL.fadeOutMs}ms`);
    if (run.mode === "run") {
      set("--dog-path", m.path);
      set("--dog-cross-ms", `${m.crossMs}ms`);
      set("--dog-ground", `${m.ground}vh`);
    } else {
      set("--dog-enter", m.enter);
      set("--dog-enter-ms", `${m.enterMs}ms`);
      set("--dog-exit", m.exit);
      set("--dog-exit-ms", `${m.exitMs}ms`);
    }

    const body = document.createElement("div");
    body.className = "dog__body";
    const frame = document.createElement("div");
    frame.className = "dog__frame";
    const sheet = document.createElement("div");
    sheet.className = "dog__sheet";
    sheet.style.backgroundImage = `url("${art.src}")`;
    sheet.style.width = `${(columns / layout.w) * 100}%`;
    sheet.style.height = `${(rows / layout.h) * 100}%`;

    frame.append(sheet);
    body.append(frame);
    el.append(body);
    root.append(el);

    el.dataset.look = art.name;

    return {
      id, el, frame, sheet, layout, pad: layout.pad, phase: "waiting", look, lookName: art.name,
      grid: staged.grid, frames: art.frames, motion: m,
      // The look's own performance when it has one, else its dog's.
      timing: art.timing ?? def.timing[run.mode],
      timed: art.timing ? "look" : "dog",
      holdMs: art.holdMs ?? staged.holdMs
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
  // Release the decoded bitmaps — every look of this mode, not just the ones
  // shown: a preload() of all looks must not leave the unpicked ones decoded
  // until next year. A later show re-reads them from HTTP cache.
  for (const src of run.srcs) sheets.delete(src);
  run = null;
}

/* ── API ────────────────────────────────────────────────────────────────── */

/**
 * Put dogs on the glass for an occasion. Resolves when they have gone, with
 * `{ shown: true }`, or at once with `{ shown: false, reason }`. Never throws
 * and never rejects — a caller on a 24/7 kiosk must not need a catch.
 * A call while a run is live — in either mode — is IGNORED (reason "busy"),
 * never stacked. Each dog wears a look drawn at random per call, unless
 * `looks` ({ id → index }) pins it.
 */
export async function show(occasionId, { mode = "peek", dogs, looks: pinned } = {}) {
  if (run) return { shown: false, reason: "busy" };
  if (typeof document === "undefined") return { shown: false, reason: "no-document" };

  const staged = OCCASIONS[occasionId]?.[mode];
  if (!staged) return { shown: false, reason: "unknown-occasion" };
  const ids = [...new Set(dogs ?? Object.keys(staged.dogs))];
  if (!ids.length) return { shown: false, reason: "no-dogs" };
  for (const id of ids) {
    if (!DOGS[id] || !staged.dogs[id]?.length) return { shown: false, reason: `unknown-dog:${id}` };
    const frameCount = staged.grid.columns * staged.grid.rows;
    const timed = (l) => (l.timing ?? DOGS[id].timing[mode])?.length === frameCount;
    if (staged.dogs[id].some((l) => l.frames.length !== frameCount || !timed(l))
        || !MOTION[DOGS[id].motion]?.[mode]) {
      return { shown: false, reason: `bad-config:${id}` };
    }
    if (pinned?.[id] != null && !staged.dogs[id][pinned[id]]) return { shown: false, reason: `unknown-look:${id}` };
  }
  const worn = `${occasionId}/${mode}`;
  const looks = pickLooks(occasionId, { mode, dogs: ids, pinned, avoid: lastLooks.get(worn) });

  const gen = generation;
  const srcs = ids.map((id) => staged.dogs[id][looks[id]].src);
  run = {
    occasion: occasionId, mode, looks, timers: new Set(), root: null, dogs: [],
    srcs: allSrcs(staged), started: Date.now()
  };

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
  lastLooks.set(worn, { ...lastLooks.get(worn), ...looks });

  // hide() cancels every timer, so a performance it interrupts never resolves;
  // the race lets this call answer instead of hanging forever.
  const cancelled = new Promise((resolve) => { run.cancel = resolve; });
  await Promise.race([Promise.all(built.dogs.map((d) => perform(d, staged, still))), cancelled]);
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
    dogs: (run?.dogs ?? []).map((d) => ({
      id: d.id,
      phase: d.phase,
      look: d.look,
      lookName: d.lookName,
      timed: d.timed,
      frame: Number(d.el.dataset.frame ?? -1),
      pad: d.pad,
      paintedAt: d.paintedAt ?? null,
      box: { w: d.layout.w, h: d.layout.h, ax: d.layout.ax, ay: d.layout.ay }
    })),
    timers: run?.timers.size ?? 0,
    runs,
    lastLooks: Object.fromEntries(lastLooks)
  };
}

export const dogOccasion = { show, hide, preload, pickLooks, state };
