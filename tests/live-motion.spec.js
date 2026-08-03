import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(root, "server/services/liveMotion.js"), "utf8");

// The Live Photo transcoder's concurrency guard (2026-08-03).
//
// warmClip is fired from a warm pass that its caller does not await, so two
// passes genuinely overlap — the hourly scheduler tick and an on-demand
// /api/immich/daily-set request. The `inFlight` set is the only thing standing
// between that and two ffmpeg processes writing the same temp paths.
//
// It failed on the live box: the check was three awaits above the add, both
// passes read an empty set, and because `stamp` was `pid-Date.now()` and they
// started in the same millisecond the temp paths collided outright. Each deleted
// the other's output mid-encode ("Unable to re-open ... output file for shifting
// data"), and two assets were left holding BOTH a finished .mp4 and a .none
// tombstone. Source-level, in the photo-reload.spec.js style: warmClip does real
// IO and spawns ffmpeg, so the ordering cannot be exercised directly.

function warmClipBody() {
  const start = src.indexOf("export async function warmClip(");
  expect(start, "warmClip() was renamed or removed").toBeGreaterThan(-1);
  const end = src.indexOf("\n}", start);
  return src.slice(start, end)
    // Comments first — the function carries a long note about this very
    // invariant, and the word "await" inside it would read as the first await.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

test("warmClip claims the asset before its first await", () => {
  const body = warmClipBody();
  const check = body.indexOf("inFlight.has(");
  const claim = body.indexOf("inFlight.add(");
  const firstAwait = body.indexOf("await");

  expect(check, "warmClip no longer reads inFlight").toBeGreaterThan(-1);
  expect(claim, "warmClip no longer joins inFlight").toBeGreaterThan(-1);
  expect(firstAwait, "warmClip no longer awaits — re-verify this guard").toBeGreaterThan(-1);

  // THE invariant. An async body runs synchronously to its first await, so
  // check-then-add on the same tick is atomic against every other caller. Put a
  // single await between them and two passes transcode the same asset again.
  expect(claim, "inFlight must be read AFTER the check").toBeGreaterThan(check);
  expect(claim, "inFlight must be claimed BEFORE the first await").toBeLessThan(firstAwait);
});

test("the temp path cannot collide with a same-millisecond sibling", () => {
  const body = warmClipBody();
  const stamp = body.match(/const stamp = ([^;]+);/);
  expect(stamp, "the temp-path stamp is gone").not.toBeNull();
  // Date.now() alone is not unique — that is precisely how the collision
  // happened. Something monotonic has to be in there too.
  expect(stamp[1], "a Date.now()-only stamp collides within a millisecond")
    .toContain("seq");
});

test("a successful encode retracts an earlier tombstone", () => {
  const body = warmClipBody();
  const rename = body.indexOf("rename(out, clipFile(stillId))");
  const retract = body.indexOf("unlink(skipFile(stillId))");
  expect(rename).toBeGreaterThan(-1);
  // Otherwise the pair outlives the clip: prune evicts the .mp4 by age, the
  // 0-byte .none never reaches the byte budget and stays, and the asset is a
  // still forever despite having encoded cleanly.
  expect(retract, "a success must clear the .none marker").toBeGreaterThan(rename);
});

test("hasSkip and hasClip are both exported — motionPending needs the pair", () => {
  // `!hasClip` alone cannot distinguish "the clip is coming" from "the clip is
  // never coming", and the daily-set route publishes exactly that distinction.
  expect(src).toMatch(/export async function hasClip\(/);
  expect(src).toMatch(/export async function hasSkip\(/);
});
