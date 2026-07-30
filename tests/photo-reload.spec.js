import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "src/js/modules/screensaver.js"), "utf8");

// Audit 2026-07-26 SS1/M4 claimed syncNight()'s fire-and-forget loadPhotos()
// needs an in-flight guard. It does not — but only because of two structural
// properties that are easy to destroy by accident. Both are pinned here.
// Source-level checks, because loadPhotos() is buried in a DOM module that
// cannot be imported in the node process (immich.spec.js style is unavailable).

function loadPhotosBody() {
  const start = src.indexOf("async function loadPhotos()");
  expect(start, "loadPhotos() was renamed or removed — re-verify SS1").toBeGreaterThan(-1);
  // Function ends at the first brace back in column 0.
  const end = src.indexOf("\n}", start);
  // Comments must go before we scan for `await`: the function carries a comment
  // explaining this very invariant, and the word inside it would otherwise read
  // as the first await and make the ordering check pass/fail on prose.
  return src.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("loadPhotos() claims the day before its first await", () => {
  const body = loadPhotosBody();
  const claim = body.indexOf("loadedDay =");
  const firstAwait = body.indexOf("await");

  expect(claim, "loadPhotos() no longer assigns loadedDay").toBeGreaterThan(-1);
  expect(firstAwait, "loadPhotos() no longer awaits — re-verify this guard").toBeGreaterThan(-1);

  // THE invariant. An async body runs synchronously up to its first await, so
  // assigning here means syncNight's `toDateString() !== loadedDay` check is
  // already false by the time the promise comes back — that day check IS the
  // in-flight guard, and a slow Immich fetch spanning the 60s tick cannot
  // start a second load. Move this assignment below an await and the race the
  // audit describes becomes real.
  expect(claim, "loadedDay must be claimed BEFORE the first await (audit SS1)")
    .toBeLessThan(firstAwait);
});

test("the two repeating loadPhotos callers can never both be armed", () => {
  // syncNight's day-rollover rebuild: Daily Memories only.
  expect(src).toContain("if (dailyMemoriesEnabled && new Date().toDateString() !== loadedDay) loadPhotos();");
  // The 6-hourly reshuffle: explicitly NOT under Daily Memories. If this gate
  // ever loses its negation, two independent repeating callers are live at once
  // and the day check no longer covers them.
  expect(src).toContain("if (immichEnabled && !dailyMemoriesEnabled) setInterval(loadPhotos,");
});
