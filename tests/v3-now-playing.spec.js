import { test, expect } from "./fixtures/coverage.js";
import { playingFrom } from "../src/v3/core/now-playing.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE AMBIENT NOW-PLAYING SURFACE.

   V3 has had a media surface since Phase 4 and nobody has ever seen it, because
   subjects/media.js is depth 3 and voice-summoned. This is the half that was
   missing: the band that appears at depth 0 BECAUSE MUSIC STARTED.

   What is worth pinning here is not that a title renders — that is one
   textContent read, and reading textContent is exactly what let seven defects
   through the wall in Phase 5. It is the four things that would each be
   invisible until the wall had been running for a week:

     · the flag-off build is the build that shipped before it
     · the two tenants of the bottom-right corner can never be on the glass
       together, and the hour does not move when music starts
     · the glass is written when the ANSWER changes, not per entity update —
       Sonos pushes several a second while a track plays
     · the artwork's src is dropped when the music stops, because a hidden <img>
       that keeps one keeps its decoded bitmap for the life of the page

   Every /api/** is answered by this file. What is playing in the developer's
   living room is not a fixture, and tests/v3-spread.spec.js already paid for
   that lesson once.
   ═══════════════════════════════════════════════════════════════════════════ */

const TRACK = {
  nowPlayingActive: true,
  nowPlayingTitle: "Wichita Lineman",
  nowPlayingSub: "Glen Campbell",
  nowPlayingImage: "/api/image_proxy/media/lineman.jpg",
  plexActive: false,
  plexText: null,
  plexImage: null
};

const EMPTY = { nowPlayingActive: false, plexActive: false };

/** A 1x1 gif, so an <img> in these specs resolves rather than hanging. A pending
 *  request is not a failed one, and the blank/teardown assertions want a settled
 *  DOM. */
const GIF = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");

async function bootV3(page, { flags = {} } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    const body = (await res.text()) +
      Object.entries(flags).map(([k, v]) => `\nwindow.CONFIG.features.${k} = ${JSON.stringify(v)};`).join("");
    await route.fulfill({ response: res, body });
  });

  /* ⚠ Registered FIRST. Playwright checks route handlers in REVERSE
     registration order, so a catch-all registered last swallows everything
     after it — the trap tests/v3-display.spec.js documents. */
  await page.route("**/api/**", (route) => {
    if (/\.(jpg|png|gif|webp)$/i.test(new URL(route.request().url()).pathname)) {
      return route.fulfill({ status: 200, contentType: "image/gif", body: GIF });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return pageErrors;
}

/** Where the band actually is on the glass, and whether it is actually visible.
 *  Boxes and computed styles, never textContent alone. */
const readBand = () =>
  ({
    shown: document.getElementById("now-playing")?.dataset.shown ?? null,
    visibility: getComputedStyle(document.getElementById("now-playing")).visibility,
    opacity: getComputedStyle(document.getElementById("now-playing")).opacity,
    sub: document.getElementById("now-playing-sub").textContent,
    title: document.getElementById("now-playing-title").textContent,
    artSrc: document.getElementById("now-playing-art").getAttribute("src"),
    artBlank: document.getElementById("now-playing-art").dataset.blank ?? null,
    box: document.getElementById("now-playing").getBoundingClientRect().toJSON(),
    hourBox: document.getElementById("hour").getBoundingClientRect().toJSON()
  });

/* ── The precedence, without a browser ─────────────────────────────────────
   The same order subjects/media.js uses, and the reason the two surfaces can
   never describe different music.
─────────────────────────────────────────────────────────────────────────── */

test("a configured media_player outranks a Plex session", () => {
  const both = playingFrom({ ...TRACK, plexActive: true, plexText: "The Other Woman" });
  expect(both.cell).toBe("nowPlaying");
  expect(both.title).toBe("Wichita Lineman");
});

test("Plex is the fallback, not the primary", () => {
  const plex = playingFrom({ nowPlayingActive: false, plexActive: true, plexText: "The Other Woman", plexImage: "/x.jpg" });
  expect(plex.cell).toBe("plex");
  expect(plex.title).toBe("The Other Woman");
});

test("a Plex session names the ROOM above the title, not the word 'Playing'", () => {
  /* Seen on the glass 2026-08-13 as "Colin from Accounts" with no room. The
     band and the composed cell read the same field for the same reason the two
     share houseSnapshot at all — a surface that named the room while the other
     said "Playing" would be the mediaImage.js divergence in a new shape. */
  const named = playingFrom({
    nowPlayingActive: false, plexActive: true,
    plexText: "Colin from Accounts", plexSub: "Lounge Room TV"
  });
  expect(named.sub).toBe("Lounge Room TV");

  // A client Plex cannot name keeps the old word rather than an empty line.
  const unnamed = playingFrom({ nowPlayingActive: false, plexActive: true, plexText: "Arrival" });
  expect(unnamed.sub).toBe("Playing");
});

test("nothing playing is null, and so is a cold house", () => {
  expect(playingFrom(EMPTY)).toBeNull();
  expect(playingFrom(null)).toBeNull();
  // Active with no title is not an answer — houseSnapshot's own reader requires
  // one, and a band that said "" would be worse than no band.
  expect(playingFrom({ nowPlayingActive: true, nowPlayingTitle: null })).toBeNull();
});

test("a track with no artist still names itself, in the subject's own word", () => {
  expect(playingFrom({ nowPlayingActive: true, nowPlayingTitle: "Untitled", nowPlayingSub: null }).sub).toBe("Playing");
});

/* ── Flag off ──────────────────────────────────────────────────────────────*/

test("flag off: no subscription, no handle, nothing on the glass", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: false } });

  const seen = await page.evaluate(() => ({
    handle: typeof window.__v3NowPlaying,
    setter: typeof window.__v3NowPlayingSet,
    state: window.__v3().nowPlaying
  }));
  const band = await page.evaluate(readBand);

  expect(seen.handle).toBe("undefined");
  expect(seen.setter).toBe("undefined");
  expect(seen.state).toBeNull();
  // Never written to, so the attribute the CSS keys off does not exist at all.
  expect(band.shown).toBeNull();
  expect(band.visibility).toBe("hidden");
  expect(band.artSrc).toBeNull();
  expect(errors).toEqual([]);
});

/* ── The surface ───────────────────────────────────────────────────────────*/

test("music starting puts it on the glass; silence takes it off again", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });

  /* A cold house is not a quiet one, but neither of them is music — and
     "nothing is playing" writes NOTHING, so a flag-on silent wall is the same
     glass as a flag-off one. */
  const cold = await page.evaluate(readBand);
  expect(cold.shown).toBeNull();
  expect(cold.visibility).toBe("hidden");

  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);
  const playing = await page.evaluate(readBand);

  expect(playing.shown).toBe("1");
  expect(playing.visibility).toBe("visible");
  expect(playing.title).toBe("Wichita Lineman");
  expect(playing.sub).toBe("Glen Campbell");
  expect(playing.artSrc).toContain("lineman.jpg");
  expect(playing.artBlank).toBeNull();
  // Inside the bottom 216px of the panel — the part of the frame the scrim
  // covers at >=85% of the opacity core/scrim.js solved for. Every other corner
  // would have been a new contrast problem.
  expect(playing.box.bottom).toBeLessThanOrEqual(1080 - 96 + 1);
  expect(1080 - playing.box.top).toBeLessThanOrEqual(240);

  await page.evaluate(() => window.__v3NowPlayingSet(null));
  expect((await page.evaluate(readBand)).shown).toBe("0");
  /* Polled, not read straight away, and the reason is the mechanism: the
     visibility transition carries a --m-calm DELAY so the band fades out before
     it stops being painted. Asserting it instantly would be asserting that
     there is no fade. */
  await expect
    .poll(async () => (await page.evaluate(readBand)).visibility, { timeout: 4000 })
    .toBe("hidden");
  expect(errors).toEqual([]);
});

test("the artwork's src is dropped after the fade, not left on a hidden node", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });

  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);
  expect((await page.evaluate(readBand)).artSrc).toContain("lineman.jpg");

  await page.evaluate(() => window.__v3NowPlayingSet(null));

  /* It survives the fade — emptying the band in front of the room and THEN
     fading an empty rectangle is the wrong order — and is gone after it. The
     clear is a setTimeout on purpose: this node lives inside .depth--field,
     which is `visibility: hidden` at every other depth, and a transition event
     does not fire on a hidden subtree. */
  expect((await page.evaluate(readBand)).artSrc).toContain("lineman.jpg");

  await expect
    .poll(async () => (await page.evaluate(readBand)).artSrc, { timeout: 4000 })
    .toBeNull();

  const cleared = await page.evaluate(readBand);
  expect(cleared.title).toBe("");
  expect(cleared.artBlank).toBe("1");
  expect(errors).toEqual([]);
});

test("artwork that 404s closes the row rather than leaving a broken glyph", async ({ page }) => {
  await page.route("**/api/image_proxy/**", (route) => route.fulfill({ status: 404, body: "" }));
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });

  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);
  await expect
    .poll(async () => (await page.evaluate(readBand)).artBlank, { timeout: 4000 })
    .toBe("1");

  // The words still stand. A missing cover is not a missing answer.
  const seen = await page.evaluate(readBand);
  expect(seen.shown).toBe("1");
  expect(seen.title).toBe("Wichita Lineman");
  expect(errors).toEqual([]);
});

/* ── The corner rule ───────────────────────────────────────────────────────
   Four corners, one owner each. This surface takes the rail's, and the claim
   that they can never collide is structural — which is exactly the kind of
   claim that quietly stops being true.
─────────────────────────────────────────────────────────────────────────── */

test("the hour does not move when music starts", async ({ page }) => {
  await bootV3(page, { flags: { v3NowPlaying: true } });

  const before = (await page.evaluate(readBand)).hourBox;
  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);
  const after = await page.evaluate(readBand);

  expect(after.hourBox).toEqual(before);
  // And the two bottom corners do not touch each other.
  expect(after.box.left).toBeGreaterThan(after.hourBox.right);
});

test("the band and the vocabulary rail are never both on the glass", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });
  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);

  const seen = [];
  for (const depth of [0, 1, 2, 3]) {
    await page.evaluate((d) => window.__setDepth(d, "spec"), depth);
    /* Past the depth exchange before reading. `.depth` transitions visibility
       with a --m-calm DELAY, so for 350ms after the change the outgoing layer is
       still painted — reading immediately would report the depth we just left. */
    await page.waitForTimeout(600);
    seen.push(
      await page.evaluate(() => {
        /* ⚠ checkVisibility, NOT getComputedStyle. Opacity does not inherit, so
           a child of a layer at `opacity: 0` still computes its own `1` — the
           band would have read as visible at every depth and this spec would
           have passed while proving nothing. checkVisibility walks the
           ancestors, which is the question actually being asked. */
        const visible = (node) =>
          node.checkVisibility({ opacityProperty: true, visibilityProperty: true });
        return {
          band: visible(document.getElementById("now-playing")),
          rail: visible(document.querySelector(".rail-slot"))
        };
      })
    );
  }

  // Depth 0: the band, no rail. Depths 1-2: the rail, no band. Depth 3: neither.
  expect(seen[0]).toEqual({ band: true, rail: false });
  expect(seen[1].band).toBe(false);
  expect(seen[2].band).toBe(false);
  expect(seen[3].band).toBe(false);
  expect(seen.filter((s) => s.band && s.rail)).toEqual([]);
  expect(errors).toEqual([]);
});

/* ── The cost at rest ──────────────────────────────────────────────────────*/

test("the glass is written when the answer changes, not per entity update", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });

  await page.evaluate((track) => window.__v3NowPlayingSet(track), TRACK);
  const first = await page.evaluate(() => window.__v3NowPlaying().renders);

  /* Forty updates for the same track — which is roughly a minute of Sonos
     reporting media_position while one song plays. Nothing about the answer
     moved, so nothing about the glass may. */
  await page.evaluate((track) => {
    for (let i = 0; i < 40; i++) window.__v3NowPlayingSet(track);
  }, TRACK);
  expect(await page.evaluate(() => window.__v3NowPlaying().renders)).toBe(first);

  // A new track is a new answer, and the room can hear that it changed.
  await page.evaluate((track) => window.__v3NowPlayingSet({ ...track, nowPlayingTitle: "Galveston" }), TRACK);
  expect(await page.evaluate(() => window.__v3NowPlaying().renders)).toBe(first + 1);
  expect((await page.evaluate(readBand)).title).toBe("Galveston");
  expect(errors).toEqual([]);
});

test("a media_player update drives it without waiting for a tick", async ({ page }) => {
  const errors = await bootV3(page, { flags: { v3NowPlaying: true } });

  /* The real path: the entity feed puts HA state on the bus and this module
     re-reads. The house it re-reads is the live entity cache, which this spec
     deliberately does not seed — so the assertion is that the BUS reaches the
     module at all, i.e. that a media_player event settles into exactly one
     evaluation rather than none or forty. */
  const before = await page.evaluate(() => window.__v3NowPlaying().at);
  await page.evaluate(() => {
    for (let i = 0; i < 12; i++) window.__emitHaState({ entity_id: "media_player.living_room", state: "playing" });
  });

  await expect
    .poll(async () => (await page.evaluate(() => window.__v3NowPlaying().at)) !== before, { timeout: 4000 })
    .toBe(true);

  // A non-media entity must not wake it at all.
  const settled = await page.evaluate(() => window.__v3NowPlaying().at);
  await page.evaluate(() => window.__emitHaState({ entity_id: "binary_sensor.kitchen_motion_detected", state: "on" }));
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.__v3NowPlaying().at)).toBe(settled);
  expect(errors).toEqual([]);
});
