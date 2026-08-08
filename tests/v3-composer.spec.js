import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  RECTS,
  TEMPLATES,
  MIN_CELLS,
  MAX_CELLS,
  PEER_MIN_SCORE,
  chooseTemplate,
  overlaps,
  validate
} from "../src/v3/core/grammar.js";
import { compose } from "../src/v3/core/composer.js";

/* Phase 2 — the composer, tested where it lives: in plain node, no browser, no
   server, no DOM. That is not a convenience. grammar.js and composer.js are pure
   BY CONTRACT (docs/design/V3-MIGRATION.md 2.1/2.2), and the day either of them
   needs a page is the day the layer has regressed into the rendering it was
   split away from. The DOM half is tests/v3-spread.spec.js.

   Three properties carry most of the file:

   1. THE CSS IS THE TRUTH. A rectangle named in the grammar with no matching
      class in compose.css is an invisible cell — content placed nowhere, no
      error anywhere. So the stylesheet is parsed and compared, rather than
      trusted to have been transcribed correctly.
   2. A `must` IS NEVER DROPPED. The plan names this one explicitly. Ranking
      already makes it true by accident (interrupts score 90+); the composer
      makes it true on purpose, and this asserts the purpose.
   3. THE COMPOSER DOES NOT AUTHOR. Layout by rules, language by the model — the
      whole defence against slop. A composer that "helpfully" tidies a line has
      broken it, so the text out must be identical to the text in. */

const cand = (over = {}) => ({ id: "x", source: "spec", text: "Something true", score: 50, ...over });

/* ── The lattice agrees with the stylesheet ────────────────────────────────── */

/** `grid-column: 1 / 8` → [1, 8]; `1 / -1` → [1, cols + 1]. */
function parseTrack(decl, span) {
  const m = decl.match(/^\s*(-?\d+)\s*\/\s*(-?\d+)\s*$/);
  if (!m) return null;
  const resolve = (n) => (Number(n) < 0 ? span + 1 + Number(n) + 1 : Number(n));
  return [resolve(m[1]), resolve(m[2])];
}

function rulesFromCss() {
  const css = readFileSync(
    fileURLToPath(new URL("../src/v3/css/compose.css", import.meta.url)),
    "utf8"
  );
  const out = {};
  for (const m of css.matchAll(/\.(cell--[a-z]+)\s*\{([^}]*)\}/g)) {
    const body = m[2];
    const col = body.match(/grid-column:\s*([^;]+);/);
    const row = body.match(/grid-row:\s*([^;]+);/);
    if (!col || !row) continue;
    out[m[1]] = { cols: parseTrack(col[1], 12), rows: parseTrack(row[1], 7) };
  }
  return out;
}

test("every rectangle in the grammar is a real class in compose.css, at the same coordinates", () => {
  const css = rulesFromCss();

  for (const rect of Object.values(RECTS)) {
    const shipped = css[rect.className];
    expect(shipped, `${rect.className} is not defined in compose.css`).toBeTruthy();
    expect(shipped.cols, `${rect.name} columns`).toEqual(rect.cols);
    expect(shipped.rows, `${rect.name} rows`).toEqual(rect.rows);
  }
});

test("no template ever prints one cell on top of another", () => {
  for (const template of Object.values(TEMPLATES)) {
    expect(validate(template), `${template.name} is not a legal template`).toBe(true);
  }

  // And the validator can actually fail — a green test that passes with the
  // check neutered is worth nothing.
  expect(validate({ name: "bad", cells: ["dominant", "full"] })).toBe(false);
  expect(overlaps(RECTS.dominant, RECTS.full)).toBe(true);
  expect(overlaps(RECTS.dominant, RECTS.tall)).toBe(false);
  expect(overlaps(RECTS.wide, RECTS.side)).toBe(false);
});

test("cell--rail is deliberately not a composition rectangle", () => {
  // It exists in the CSS, and it is excluded on purpose: it spans rows 7-8 and
  // so overlaps both `wide` and `side`, and depth 2 already prints the
  // vocabulary rail in that corner. If someone adds it to RECTS, this says why.
  expect(RECTS.rail).toBeUndefined();
  expect(rulesFromCss()["cell--rail"]).toBeTruthy();
});

/* ── Choosing a shape ──────────────────────────────────────────────────────── */

test("a spread of one is a glance, and there is no template for it", () => {
  expect(chooseTemplate(0)).toBeNull();
  expect(chooseTemplate(1)).toBeNull();
  expect(chooseTemplate(MAX_CELLS + 1)).toBeNull();
  expect(MIN_CELLS).toBe(2);
});

test("a peer stands beside the dominant; a readout sits under it", () => {
  expect(chooseTemplate(2, { peer: true }).cells).toEqual(["dominant", "tall"]);
  expect(chooseTemplate(2, { peer: false }).cells).toEqual(["dominant", "wide"]);
  expect(chooseTemplate(3, { peer: true }).cells).toEqual(["dominant", "tall", "wide"]);
  expect(chooseTemplate(3, { peer: false }).cells).toEqual(["dominant", "wide", "side"]);
});

/* ── Composing ─────────────────────────────────────────────────────────────── */

test("nothing to lay out returns null rather than an empty composition", () => {
  // The caller must be able to tell "no spread" from "an empty spread", because
  // deepening on the second one is how e3e9630 blacked the wall out mid-sentence.
  expect(compose(null)).toBeNull();
  expect(compose({ stack: [] })).toBeNull();
  expect(compose({ stack: [cand()] })).toBeNull();
});

test("a candidate with nothing to say does not get a cell", () => {
  // An empty rectangle reads as a thing that failed to load. Two candidates, one
  // of them silent, is a spread of one — which is not a spread.
  expect(compose({ stack: [cand({ id: "a" }), cand({ id: "b", text: "  " })] })).toBeNull();
  expect(compose({ stack: [cand({ id: "a" }), cand({ id: "b", text: null })] })).toBeNull();

  const three = compose({
    stack: [cand({ id: "a" }), cand({ id: "b", text: "" }), cand({ id: "c" }), cand({ id: "d" })]
  });
  expect(three.cells.map((c) => c.id)).toEqual(["a", "c", "d"]);
});

test("the ordinary day composes as a dominant over a footer, and the type law follows the rectangle", () => {
  const composition = compose({
    stack: [
      cand({ id: "commute", source: "commute", text: "23 min to work", score: 42 }),
      cand({ id: "menu", source: "menu", text: "Chicken fajitas", score: 40 })
    ]
  });

  expect(composition.template).toBe("pair-note");
  expect(composition.cells.map((c) => c.rect)).toEqual(["dominant", "wide"]);

  // The house speaking is set in the serif; a readout is set in the sans. That
  // is a placement decision, not a per-candidate one — same candidate in the
  // dominant slot would be `said`.
  expect(composition.cells[0].voice).toBe("said");
  expect(composition.cells[1].voice).toBe("measured");
});

test("a supporting candidate that nearly earned the screen on its own gets the tall column", () => {
  const peer = compose({
    stack: [cand({ id: "a", score: 80 }), cand({ id: "b", score: PEER_MIN_SCORE })]
  });
  expect(peer.template).toBe("pair");

  const belowByOne = compose({
    stack: [cand({ id: "a", score: 80 }), cand({ id: "b", score: PEER_MIN_SCORE - 1 })]
  });
  expect(belowByOne.template).toBe("pair-note");

  // An interrupt is a peer whatever it scores.
  const interrupt = compose({
    stack: [cand({ id: "a", score: 80 }), cand({ id: "b", score: 10, interrupt: true })]
  });
  expect(interrupt.template).toBe("pair");
});

test("a must is never dropped, even when the ranking would have cut it", () => {
  // Four candidates for three cells, with the interrupt last and scored below
  // everything. Ranking alone would drop it; the composer promotes it.
  const composition = compose({
    stack: [
      cand({ id: "a", score: 60 }),
      cand({ id: "b", score: 55 }),
      cand({ id: "c", score: 50 }),
      cand({ id: "door", score: 5, interrupt: true })
    ]
  });

  expect(composition.cells.map((c) => c.id)).toContain("door");
  // And it takes the dominant cell — a thing that must be seen is what the
  // spread is about, not a footnote to the commute.
  expect(composition.cells[0].id).toBe("door");
  expect(composition.cells).toHaveLength(MAX_CELLS);
});

test("the composer places words, it does not write them", () => {
  // The whole Phase 2 invariant in one assertion. Text arrives already phrased —
  // by Haiku through attentionEngine's /api/ai/brief, or by personality.phrase()
  // when the model is down — and the composer must be incapable of touching it.
  const messy = "  don't forget the bins are out AGAIN  ";
  const input = { stack: [cand({ id: "a", text: messy }), cand({ id: "b", text: "x" })] };
  const before = JSON.stringify(input);

  const composition = compose(input);

  expect(composition.cells[0].text).toBe(messy);   // verbatim, untidied
  expect(JSON.stringify(input)).toBe(before);      // and the input is untouched
});

test("grammar and composer stay pure — no DOM, no IO, no model", () => {
  /* The migration audit sorted the whole house by DOM references, and the one
     file with 40 of them is what blocked V3 for eleven phases. This is that
     audit, run automatically, on the two files whose purity is the reason the
     spread can be reasoned about at all. */
  for (const name of ["grammar.js", "composer.js"]) {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/v3/core/${name}`, import.meta.url)),
      "utf8"
    ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

    for (const forbidden of ["document", "window", "fetch(", "localStorage", "setTimeout"]) {
      expect(src.includes(forbidden), `${name} references ${forbidden}`).toBe(false);
    }
  }
});
