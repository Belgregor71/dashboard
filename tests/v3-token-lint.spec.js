import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";

/* tokens.css says "nothing in V3 may introduce a colour, a size or a duration
   that is not here". Nothing enforced it, and the 2026-11-12 visual audit found
   the late features had drifted (a 26px line, eleven hex colours, seven radii).
   This holds the parts that are cheap to hold: type sizes, radii, hex colours,
   and viewport units on a panel that is exactly 1920x1080. */

const DIR = "src/v3/css";
// Comments blanked but newlines kept, so a reported line number is the file's.
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, " "));
const tokens = strip(readFileSync(`${DIR}/tokens.css`, "utf8"));
const sheets = readdirSync(DIR)
  .filter((f) => f.endsWith(".css") && f !== "tokens.css")
  .map((f) => ({ f, lines: strip(readFileSync(`${DIR}/${f}`, "utf8")).split(/\r?\n/) }));

const decls = (prop) => sheets.flatMap(({ f, lines }) =>
  lines.flatMap((line, i) => [...line.matchAll(new RegExp(`(?:^|[\\s;{])${prop}:\\s*([^;}]+)`, "g"))]
    .map((m) => ({ at: `${f}:${i + 1}`, value: m[1].trim() }))));

test("the sweep is reading the stylesheets", () => {
  expect(sheets.length).toBeGreaterThanOrEqual(9);
  expect(decls("font-size").length).toBeGreaterThan(20);
  expect(decls("border-radius").length).toBeGreaterThan(10);
});

test("every type size is a --t-* token", () => {
  const off = decls("font-size").filter((d) => !/^var\(--t-[a-z0-9-]+\)$/.test(d.value));
  expect(off.map((d) => `${d.at} ${d.value}`)).toEqual([]);
});

test("every corner is a --r-* token, a circle, or a drawn percentage shape", () => {
  const off = decls("border-radius").filter((d) => !/^var\(--r-[a-z]+\)$/.test(d.value) && !/^[\d.]+%( \/ [\d.]+%)?$/.test(d.value));
  expect(off.map((d) => `${d.at} ${d.value}`)).toEqual([]);
});

test("no hex colour outside tokens.css (a mask's #000 is alpha, not colour)", () => {
  const off = sheets.flatMap(({ f, lines }) => lines
    .map((line, i) => ({ at: `${f}:${i + 1}`, line }))
    .filter(({ line }) => /#[0-9a-fA-F]{3,8}\b/.test(line) && !/mask|gradient\(/.test(line)));
  expect(off.map((d) => `${d.at} ${d.line.trim()}`)).toEqual([]);
});

test("viewport units only move things across the glass; they never size them", () => {
  const off = sheets.flatMap(({ f, lines }) => lines
    .map((line, i) => ({ at: `${f}:${i + 1}`, line }))
    .filter(({ line }) => /\d(vw|vh)\b/.test(line) && !/translateX\(/.test(line)));
  expect(off.map((d) => `${d.at} ${d.line.trim()}`)).toEqual([]);
});

test("every design token a sheet uses is defined in tokens.css", () => {
  const used = new Set(sheets.flatMap(({ lines }) => lines.flatMap((l) =>
    [...l.matchAll(/var\((--(?:t|r|lift|plan|lapse|robot|bin)-[a-z0-9-]+)/g)].map((m) => m[1]))));
  expect(used.size).toBeGreaterThan(8);
  // `--plan-up` is written by camera-plan.js, per camera; it is geometry, not a design token.
  const missing = [...used].filter((name) => name !== "--plan-up" && !new RegExp(`${name}\\s*:`).test(tokens));
  expect(missing).toEqual([]);
});
