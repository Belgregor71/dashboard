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

test("both surfaces import the one predicate", () => {
  const panels = src("src/js/modules/mediaPanels.js");
  const snapshot = src("src/js/services/houseSnapshot.js");

  expect(panels, "the incumbent's panels — the surface the kiosk serves at /")
    .toMatch(/import \{ isTvAudio \} from "\.\.\/services\/mediaSource\.js"/);
  expect(snapshot, "the DOM-free reader — all of V3")
    .toMatch(/import \{ isTvAudio \} from "\.\/mediaSource\.js"/);

  // And neither carries its own copy of the literal the rule turns on.
  for (const [name, text] of [["mediaPanels.js", panels], ["houseSnapshot.js", snapshot]]) {
    expect(text.includes('Set(["tv"])'), `${name} must not re-declare the source set`).toBe(false);
  }
});

test("the incumbent hides the panel rather than titling it 'Now Playing'", () => {
  /* The defect this closes, stated as the code that produced it: renderPanel
     showed a panel for ANY playing entity and fell back to the literal string
     "Now Playing" when there was no media_title — and TV audio has no title,
     no artist and no artwork. So the wall showed a Lounge Room panel that said
     nothing, about the one thing the household asked not to see.

     Asserted against the source because renderPanel is module-private and the
     entity cache has no seam a spec can seed; the behaviour it guards is the
     ordering of the guard, which is exactly what the text shows. */
  const panels = src("src/js/modules/mediaPanels.js");
  expect(panels).toMatch(/entity\.state !== "playing" \|\| isTvAudio\(entity\)/);
  // And it must not merely be hidden at render — a TV-sourced player must not
  // win its group either, or it speaks for a sibling that IS playing music.
  expect(panels).toMatch(/entity\.state === "playing" && !isTvAudio\(entity\)/);
});
