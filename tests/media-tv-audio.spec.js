import { test, expect } from "@playwright/test";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { isTvAudio, NON_MEDIA_SOURCES } from "../src/js/services/mediaSource.js";

/* ═══════════════════════════════════════════════════════════════════════════
   TV AUDIO IS NOT "NOW PLAYING" — owner's call, 2026-08-09.

   The rule itself is four lines. What these specs are actually protecting is
   that there is only ONE of it. Three separate things in this house decide
   whether something is now-playing — the incumbent's panels (the surface the
   kiosk serves at `/`), houseSnapshot (all of V3), and voiceSnapshot (the
   spoken answer) — and they share no code path. services/mediaImage.js exists
   because that exact split shipped a bug once already: the artwork resolver
   lived in the panel and not in the snapshot, so V3 carried a URL that could
   never load, silently, for weeks.

   The shape of the match was MEASURED on the live house, not guessed, because
   the memory of this house is that the Apple TV entities lie about precisely
   this: media_player.living_room's source_list is ["TV", "12\" Classics", ...],
   one input named "TV" among music services.
   ═══════════════════════════════════════════════════════════════════════════ */

const src = (rel) =>
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", rel), "utf8");

const player = (source) => ({ entity_id: "media_player.living_room", state: "playing", attributes: { source } });

test("TV is TV, however Home Assistant happens to case or pad it", () => {
  expect(isTvAudio(player("TV"))).toBe(true);
  expect(isTvAudio(player("tv"))).toBe(true);
  expect(isTvAudio(player(" TV "))).toBe(true);
});

test("every other source is a music service and keeps playing", () => {
  /* ⚠ "TV Radio" is the case that rules out a substring match. It is a station
     in this house's own source_list, and a `includes("tv")` rule would have
     silenced it — a bug nobody would find until someone put that station on. */
  for (const source of ["Spotify Connect", "TV Radio", "Aussie Digital (Classic Rock)", "", null, undefined]) {
    expect(isTvAudio(player(source)), `source ${JSON.stringify(source)}`).toBe(false);
  }
});

test("a player with no attributes at all is not a crash and not TV", () => {
  expect(isTvAudio(null)).toBe(false);
  expect(isTvAudio(undefined)).toBe(false);
  expect(isTvAudio({})).toBe(false);
  expect(isTvAudio({ attributes: {} })).toBe(false);
});

test("the set is lower-cased, or the exact match silently never fires", () => {
  // The predicate lower-cases its input, so an upper-case member would be
  // unreachable — a rule that looks right and does nothing.
  for (const member of NON_MEDIA_SOURCES) expect(member).toBe(member.toLowerCase());
});

/* ── One authority, imported rather than copied ────────────────────────────
   A source-text assertion, which this repo already uses where two files must
   not drift (tests/v3-scrim.spec.js reads tokens.css for the same reason). It
   is the cheapest thing that fails when someone adds a second copy of the rule
   to whichever surface they happen to be looking at.
─────────────────────────────────────────────────────────────────────────── */

test("both readers import the one predicate", () => {
  /* ⚠⚠ THIS TEST NAMED THREE READERS AND CHECKED TWO, and the unchecked one had
     never had the rule at all. Measured on the live wall 2026-08-15:
     `media_player.living_room` sat `playing` with `source: "TV"`, the screen
     correctly showed nothing playing — and asked what was playing, the house
     said **"TV."** out loud. The header above had already written down what
     that costs; the assertion just did not cover the surface it was describing.

     A test that enumerates N things and asserts N-1 of them is worse than one
     that asserts nothing, because it reads as coverage.

     There were three readers until 2026-10-03: the incumbent's mediaPanels.js
     went with the incumbent. Two remain, and both are asserted. */
  const snapshot = src("src/js/services/houseSnapshot.js");
  const voice = src("src/js/services/voiceSnapshot.js");

  expect(snapshot, "the DOM-free reader — all of V3")
    .toMatch(/import \{ isTvAudio \} from "\.\/mediaSource\.js"/);
  expect(voice, "the fast lane — what the house SAYS")
    .toMatch(/import \{ isTvAudio \} from "\.\/mediaSource\.js"/);

  // And none carries its own copy of the literal the rule turns on.
  for (const [name, text] of [
    ["houseSnapshot.js", snapshot],
    ["voiceSnapshot.js", voice]
  ]) {
    expect(text.includes('Set(["tv"])'), `${name} must not re-declare the source set`).toBe(false);
  }
});

test("the spoken lane drops a TV-sourced player before it counts as playing", () => {
  /* The behavioural half, asserted against the source for the same reason the
     panel's is: `mediaFrom` is module-private and its only input is an entity
     cache with no seam a node spec can seed. The end-to-end proof — a TV player
     injected into the live cache, and the house declining to name it — is in
     tests/v3-subjects.spec.js, which has a page to do it on. */
  const voice = src("src/js/services/voiceSnapshot.js");
  expect(voice).toMatch(/e\.state === "playing" && !isTvAudio\(e\)/);
});

// "the incumbent hides the panel…" read mediaPanels.js, retired 2026-10-03.
