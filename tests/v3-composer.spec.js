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

  /* ⚠ THE OVERLAP CASE ABOVE WAS THE ONLY WAY validate() WAS EVER MADE TO FAIL,
     so its other three rules were unreached: a 2026-09-19 mutation sweep deleted
     the dominant-first check and this test stayed green. Each rule now has a
     case that fails for that rule and no other — none of these overlap. */
  expect(validate({ name: "no-dominant", cells: ["tall", "wide"] }), "slot 0 must be the dominant").toBe(false);
  expect(validate({ name: "too-few", cells: ["dominant"] }), "one cell is a glance, not a spread").toBe(false);
  expect(validate({ name: "too-many", cells: ["dominant", "tall", "wide", "side"] }), "past MAX_CELLS").toBe(false);
  expect(validate({ name: "dupe", cells: ["dominant", "tall", "tall"] }), "a repeated rectangle").toBe(false);
  expect(validate({ name: "ghost", cells: ["dominant", "nosuchrect"] }), "a rectangle that is not in RECTS").toBe(false);
  expect(validate(null), "no template at all").toBe(false);
  expect(validate({ name: "empty", cells: [] })).toBe(false);
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

/* ⚠ NO FIXTURE IN THIS FILE HAD EVER CARRIED A `title` OR A `sub`, so the
   composer's loudest warning — "`text` STAYS the line, rendering the title
   instead would silently throw the house's own voice away" — was untested:
   a 2026-09-19 mutation sweep changed the cell to render `title` and every test
   here stayed green, because every candidate had only a `text` to render.

   Production candidates carry all three. attentionEngine rewrites `text`
   through personality.phrase() and leaves `title` untouched, so the difference
   between them IS the house's voice, and this is the only place that says so. */
test("the cell renders the PHRASED line, never the raw title, and labels with `sub`", () => {
  const rich = {
    id: "commute", source: "commute", score: 42,
    title: "Commute",                        // the raw upstream label
    text: "You'll want to leave in ten.",    // what personality.phrase() made of it
    sub: "11 min · 18 min"                   // the context line
  };
  const composition = compose({ stack: [rich, cand({ id: "b", text: "Chicken fajitas" })] });
  const cell = composition.cells[0];

  expect(cell.text, "the raw title reached the glass instead of the house's line").toBe(rich.text);
  expect(cell.text).not.toBe(rich.title);
  expect(cell.label, "the context line is the candidate's `sub`, never its title").toBe(rich.sub);
  expect(cell.label).not.toBe(rich.title);

  // A candidate with no `sub` renders exactly as it did before `label` existed.
  expect(compose({ stack: [cand({ id: "a" }), cand({ id: "b" })] }).cells[0].label).toBeNull();
});

test("the deixis address is the candidate's SOURCE, with a named fallback", () => {
  /* When the voice names something on screen, that cell answers — so the
     address has to be the source, not the slot, or "what about the weather"
     would light whichever rectangle the weather happened to land in today. */
  const composition = compose({
    stack: [
      cand({ id: "w", source: "weather", text: "Rain by four." }),
      cand({ id: "m", source: "menu", text: "Chicken fajitas" })
    ]
  });
  expect(composition.cells.map((c) => c.ref)).toEqual(["weather", "menu"]);
  expect(composition.cells.map((c) => c.rect)).not.toEqual(composition.cells.map((c) => c.ref));

  // The fallback exists for a candidate that names no source; it is "house",
  // not undefined, because the deixis lookup has to find something addressable.
  const anon = compose({
    stack: [{ id: "a", text: "Something true", score: 50 }, cand({ id: "b" })]
  });
  expect(anon.cells[0].ref).toBe("house");
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
