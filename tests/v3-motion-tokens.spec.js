import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { MOTION, EASE } from "../src/v3/core/motion.js";

/* core/motion.js carries the motion tokens for Web Animations code, which cannot
   read a custom property per keyframe. Two copies of a number drift; this is the
   check that they have not (the SCRIM_STOPS arrangement, tests/v3-scrim.spec.js). */

const css = readFileSync("src/v3/css/tokens.css", "utf8");
// The FIRST definition: the :root block, not the reduced-motion override below it.
const token = (name) => css.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim() ?? null;

test("motion.js durations are the tokens.css durations", () => {
  expect(Object.keys(MOTION).sort()).toEqual(["base", "calm", "quick", "scene"]);
  for (const [name, ms] of Object.entries(MOTION)) {
    expect(token(`m-${name}`), `--m-${name}`).toBe(`${ms}ms`);
  }
});

test("motion.js curves are the tokens.css curves", () => {
  expect(token("ease")).toBe(EASE.arrive);
  expect(token("ease-leave")).toBe(EASE.leave);
  expect(token("ease-drift")).toBe(EASE.drift);
});

test("reduced motion zeroes every duration token, the new one included", () => {
  const reduced = css.slice(css.indexOf("prefers-reduced-motion"));
  expect(reduced.length).toBeGreaterThan(50);
  for (const name of Object.keys(MOTION)) {
    expect(reduced, `--m-${name}`).toMatch(new RegExp(`--m-${name}:\\s*0ms;`));
  }
});
