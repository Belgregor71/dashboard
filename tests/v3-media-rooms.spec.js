import { test, expect } from "./fixtures/coverage.js";
import { roomsFrom, progressOf, formatClock, MAX_ROWS } from "../src/v3/core/media-rooms.js";
import { factsLine } from "../src/v3/subjects/media.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE ROOMS THAT ARE PLAYING.

   Two defects were reported on 2026-08-23 and both were reproduced on the live
   house within the hour, with two Plex streams running at once:

     "only 1 displays"  — three independent `return`s (nowPlayingFrom bailing at
       the first speaker, plexFrom taking sessions[0], playingFrom choosing
       between them) meant a house with music in one room and a film in another
       showed one of them and gave no sign the other existed.

     "it's currently saying Edge" — the eyebrow was a Plex CLIENT name, which is
       not a place anything is playing.

   What is worth pinning is not that two rows render. It is the handful of
   things that would each stay invisible until the wall had been up for a week:

     · the flag-off build is the build that shipped before it, and the two
       tenants of the bottom-right corner can never both mount
     · a room is never listed twice, and grouped Sonos zones are ONE row —
       otherwise the same song appears under two room names
     · an unmapped Plex client is DROPPED, never renamed to its device
     · the clock reads by CONTENT TYPE, not by duration — a feature-length
       episode is still an episode
     · the progress is derived from a reading TIMESTAMP, so it survives a page
       that has been up for hours without a timer running
     · artwork srcs are dropped before their nodes are detached

   Every /api/** is answered by this file. What is playing in the developer's
   living room is not a fixture — tests/v3-spread.spec.js paid for that once.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A 1x1 gif, so an <img> resolves rather than hanging. A pending request is
 *  not a failed one, and the teardown assertions want a settled DOM. */
const GIF = Buffer.from("R0lGODlhAQABAAAAACw=", "base64");

/* The two streams that were genuinely running on this house while the surface
   was designed, with their real numbers. */
const PIANO_MUSIC = {
  room: "Piano Room",
  cell: "nowPlaying",
  kind: "music",
  title: "Main Theme (From 'Metal Gear Solid 4')",
  meta: "Grissini Project",
  album: "Metal Gear Solid 4",
  playlist: "Grissini Project bests",
  image: "/api/image_proxy/media/mgs4.jpg",
  position: 81,
  duration: 319,
  readingAt: 0
};

const LOUNGE_FILM = {
  room: "Lounge Room",
  cell: "plex",
  kind: "video",
  contentType: "episode",
  title: "High Potential",
  meta: "S2 E10",
  image: "/api/plex/image?path=%2Flibrary%2F71252",
  position: 797.9,
  duration: 2560.5,
  readingAt: 0
};

const BOTH = { mediaRooms: [LOUNGE_FILM, PIANO_MUSIC] };
const EMPTY = { mediaRooms: [] };

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

/* ── The pure half ─────────────────────────────────────────────────────────
   No browser. The ordering, the cap and both clocks are decisions, and a
   decision that can only be checked by looking at a screenshot is a decision
   nothing is guarding.
─────────────────────────────────────────────────────────────────────────── */
test.describe("rooms, ordered and capped", () => {
  test("rows arrive in the order the snapshot gave them, and never more than two", () => {
    const rows = roomsFrom({ mediaRooms: [LOUNGE_FILM, PIANO_MUSIC, { ...PIANO_MUSIC, room: "Kitchen" }] });
    expect(rows).toHaveLength(MAX_ROWS);
    /* ⚠ THE CAP IS A SCRIM MEASUREMENT, NOT A PREFERENCE. core/scrim.js
       guarantees legibility only to y≈0.46; a third row leaves that band. */
    expect(rows.map((r) => r.room)).toEqual(["Lounge Room", "Piano Room"]);
  });

  test("a row with no room or no title is not a row", () => {
    expect(roomsFrom({ mediaRooms: [{ room: "Lounge Room" }, { title: "x" }] })).toHaveLength(0);
  });

  test("an absent snapshot is empty, not a throw", () => {
    expect(roomsFrom(null)).toEqual([]);
    expect(roomsFrom({})).toEqual([]);
  });
});

test.describe("the clock reads by content type", () => {
  /* Owner's call, 2026-08-23: a movie in hours and minutes, everything else in
     minutes and seconds. Seconds on a two-hour film are noise. */
  test("a movie is h:mm and a track is m:ss", () => {
    expect(formatClock(4217, "movie")).toBe("1:10");   // Practical Magic, remaining
    expect(formatClock(238, "music")).toBe("3:58");    // the track, remaining
    expect(formatClock(1762, "episode")).toBe("29:22");
  });

  /* ⚠ THE TYPE DECIDES, NOT THE LENGTH. This is the assertion that stops
     someone "simplifying" the formatter into a duration threshold: a
     feature-length episode is still an episode, and a short film is still a
     film. A threshold gets both backwards. */
  test("a 92-minute episode is not promoted to hours, and a 41-second film is not demoted", () => {
    expect(formatClock(5535, "episode")).toBe("92:15");
    expect(formatClock(41, "movie")).toBe("0:00");
  });

  test("an absent or negative duration has no clock at all", () => {
    expect(formatClock(null, "movie")).toBeNull();
    expect(formatClock(-1, "music")).toBeNull();
  });
});

test.describe("progress is derived, never sampled", () => {
  test("elapsed advances from the instant the position was MEASURED", () => {
    /* This is the whole reason the surface needs no timer: the reading carries
       its own timestamp, so elapsed is computable at any later moment. */
    const at = Date.now() - 60_000;
    const p = progressOf({ position: 81, duration: 319, readingAt: at });
    expect(p.elapsed).toBeGreaterThan(140);
    expect(p.elapsed).toBeLessThan(142);
  });

  test("a reading with no timestamp is used as-is rather than guessed forward", () => {
    const p = progressOf({ position: 81, duration: 319, readingAt: 0 });
    expect(p.elapsed).toBe(81);
    expect(p.fraction).toBeCloseTo(0.2539, 3);
  });

  /* ⚠ A STALE READING MUST NOT RESTART THE RING. An animation-delay longer than
     its own duration wraps to the beginning, so a track that has just ended
     would read as one that has just started — the most misleading state this
     surface can enter. */
  test("elapsed past the end clamps to the end", () => {
    const p = progressOf({ position: 318, duration: 319, readingAt: Date.now() - 600_000 });
    expect(p.elapsed).toBe(319);
    expect(p.fraction).toBe(1);
  });

  test("no duration is no progress — a live stream has no end to draw", () => {
    expect(progressOf({ position: 10, duration: 0 })).toBeNull();
    expect(progressOf({ position: 10, duration: null })).toBeNull();
    expect(progressOf(null)).toBeNull();
  });
});

/* ── The surface ───────────────────────────────────────────────────────────── */
test.describe("the band on the glass", () => {
  test("flag-off mounts NOTHING — no rows, no hooks, no attribute", async ({ page }) => {
    const errors = await bootV3(page, { flags: { v3MediaRooms: false } });
    expect(await page.evaluate(() => typeof window.__v3MediaRooms)).toBe("undefined");
    expect(await page.locator("#media-rooms").evaluate((n) => n.children.length)).toBe(0);
    expect(await page.locator("#media-rooms").getAttribute("data-shown")).toBe("0");
    expect(errors).toEqual([]);
  });

  /* ⚠ THE INTERLOCK, FROM BOTH SIDES. Both surfaces own the bottom-right corner
     of depth 0. Two of them mounted is not a layout bug, it is two stacks of
     text overlapping on a photograph — and an interlock only one side honours
     is not an interlock. */
  test("the two tenants of the corner are mutually exclusive", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true, v3NowPlaying: true } });
    expect(await page.evaluate(() => typeof window.__v3MediaRooms)).toBe("function");
    // The older band stood down: its hooks were never registered.
    expect(await page.evaluate(() => typeof window.__v3NowPlaying)).toBe("undefined");

    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    await expect(page.locator("#media-rooms .mroom")).toHaveCount(2);
    // …and the surface it replaced is still empty.
    expect(await page.locator("#now-playing").getAttribute("data-shown")).not.toBe("1");
  });

  test("both rooms render, in order, each named by its ROOM", async ({ page }) => {
    const errors = await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);

    await expect(page.locator("#media-rooms")).toHaveAttribute("data-shown", "1");
    /* ⚠ THE REPORTED BUG, and the assertion is on the WHOLE LIST rather than a
       substring: `toContain` on a rendered string is not an identity check
       (reference-assertion-substring-false-pass), and "does not say Edge" would
       also pass on an empty wall. The eyebrow used to be "APPLE TV" and, over
       the webplayer, "Edge" — a Plex client, which is not a place.

       ⚠ The text is title case here on purpose. `text-transform: uppercase` is
       CSS, so textContent is what the data says and the glass is what the eye
       sees; asserting "LOUNGE ROOM" would be asserting the stylesheet through
       the wrong instrument. */
    await expect(page.locator("#media-rooms .mroom__where")).toHaveText(["Lounge Room", "Piano Room"]);
    expect(errors).toEqual([]);
  });

  test("music draws a record and video draws a frame", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);

    const lounge = page.locator('#media-rooms .mroom[data-room="Lounge Room"]');
    const piano = page.locator('#media-rooms .mroom[data-room="Piano Room"]');
    /* A 16:9 still centre-cropped into a circle read as a rendering fault on
       the glass once already (compose.css:351). The two objects are not
       interchangeable and neither may borrow the other's shape. */
    await expect(lounge.locator(".mframe")).toHaveCount(1);
    await expect(lounge.locator(".mdisc")).toHaveCount(0);
    await expect(piano.locator(".mdisc")).toHaveCount(1);
    await expect(piano.locator(".mframe")).toHaveCount(0);
  });

  /* ⚠ NO CLOCK AT DEPTH 0 — owner's call, 2026-08-23. The ring and the rule
     carry the proportion; the numbers wait for depth 2. This is the assertion
     that catches someone helpfully adding them back. */
  test("depth 0 shows no numbers", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    const text = await page.locator("#media-rooms").innerText();
    expect(text).not.toMatch(/\d+:\d\d/);
  });

  test("a row with a clock animates; the same row without one does not", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), { mediaRooms: [PIANO_MUSIC] });
    await expect(page.locator("#media-rooms .mdisc")).toHaveAttribute("data-timed", "1");

    /* A live stream reports no duration. A ring pinned at zero would be a lie
       about a track that has no end, so the whole progress affordance goes. */
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), {
      mediaRooms: [{ ...PIANO_MUSIC, duration: null, title: "Radio Paradise" }]
    });
    await expect(page.locator("#media-rooms .mdisc")).not.toHaveAttribute("data-timed", "1");
  });

  /* ⚠ THE GLASS IS WRITTEN WHEN THE ANSWER CHANGES, NOT PER UPDATE. Sonos
     pushes an entity update every few seconds while a track plays (position,
     volume). Re-setting an identical src re-decodes a bitmap for a wall that
     did not change. */
  test("an identical answer does not rebuild the rows", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    const renders = async () => (await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH)).renders;
    const first = await renders();
    await renders();
    await renders();
    expect(await renders()).toBe(first);
  });

  /* ⚠ A DETACHED <img> THAT KEEPS A src KEEPS ITS DECODED BITMAP, and this page
     runs for weeks with a track changing every few minutes. Blob memory does
     not show in the JS heap; this is the assertion that stands in for it. */
  test("artwork srcs are dropped when the music stops", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    await expect(page.locator("#media-rooms img")).toHaveCount(2);

    await page.evaluate((h) => window.__v3MediaRoomsSet(h), EMPTY);
    await expect(page.locator("#media-rooms")).toHaveAttribute("data-shown", "0");
    // The rows outlive the fade (CLEAR_MS), then go entirely.
    await expect(page.locator("#media-rooms img")).toHaveCount(0, { timeout: 4000 });
  });

  test("the hour does not move when music starts", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    const before = await page.locator("#hour").boundingBox();
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    await expect(page.locator("#media-rooms .mroom")).toHaveCount(2);
    expect(await page.locator("#hour").boundingBox()).toEqual(before);
  });

  /* ⚠ THE BAND MUST STAY INSIDE THE SCRIM'S MEASURED BAND. core/scrim.js only
     guarantees legibility to y≈0.46 of the viewport height from the bottom
     (BAND_MIN_COVERAGE = 0.6). Two rows was measured at y≈0.40. This is the
     test that fails when someone adds a fourth line to a row. */
  test("two rows stay inside the band the scrim was solved for", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    await expect(page.locator("#media-rooms .mroom")).toHaveCount(2);

    const y = await page.evaluate(() => {
      const box = document.getElementById("media-rooms").getBoundingClientRect();
      return (window.innerHeight - box.top) / window.innerHeight;
    });
    expect(y).toBeLessThan(0.46);
  });

  test("the right edge sits on the safe inset, both rows", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await page.evaluate((h) => window.__v3MediaRoomsSet(h), BOTH);
    const edges = await page.locator("#media-rooms .mroom").evaluateAll((nodes) =>
      nodes.map((n) => Math.round(window.innerWidth - n.getBoundingClientRect().right))
    );
    expect(edges).toEqual([96, 96]);
  });
});

/* ═══ DEPTH 3 ═══════════════════════════════════════════════════════════════
   Both tests below are regressions this rebuild INTRODUCED and then fixed, and
   both were invisible to every other assertion in the file. They are the reason
   "it renders" is not a verification.
─────────────────────────────────────────────────────────────────────────── */

test.describe("the deepest rung", () => {
  /* ⚠ DRIVEN THROUGH THE REAL PLEX ROUTE, not through __v3MediaRoomsSet.
     `showMedia()` reads houseSnapshot() itself — the registry entry passes it
     no snapshot — so injecting into the depth-0 band reaches nothing here. A
     stubbed session with a `room` is the only honest way in, and it exercises
     the route's parse and the reader on the way. */
  async function playing(page, session) {
    await page.route("**/api/plex/sessions", (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify({ sessions: [session] })
    }));
    await page.evaluate(() => window.__v3Refresh());
    await page.evaluate(async () => { await window.__v3Subject("show.media", {}); });
  }

  const TRACK = { title: "Main Theme (From 'Metal Gear Solid 4')", type: "track",
                  thumb: "/library/art", room: "Lounge Room", position: 81, duration: 319 };
  const EPISODE = { title: "2026-01-20", grandparentTitle: "High Potential", type: "episode",
                    thumb: "/library/71252", room: "Lounge Room",
                    position: 797.9, duration: 2560.5, index: 10, parentIndex: 2 };

  /* ⚠ THE RECORD AND THE CAPTION WERE PRINTING ON TOP OF EACH OTHER.
     `.subject__over` is a full-width band pinned to the bottom of the frame and
     the record is pinned to the left and vertically centred, so the room name
     and the track title were laid over the artwork. SEEN in a screenshot; not
     one assertion in this file could have caught it, because every one of them
     was about text content and DOM shape. */
  test("the music caption starts clear of the record", async ({ page }) => {
    await bootV3(page, { flags: { v3MediaRooms: true } });
    await playing(page, TRACK);

    const boxes = await page.evaluate(() => {
      const n = document.querySelector("#subject-mount .subject--media");
      const rec = n?.querySelector(".subject__record")?.getBoundingClientRect();
      const over = n?.querySelector(".subject__over")?.getBoundingClientRect();
      return rec && over ? { recordRight: rec.right, captionLeft: over.left } : null;
    });

    expect(boxes, "a music row must draw both a record and a caption").not.toBeNull();
    expect(boxes.captionLeft).toBeGreaterThan(boxes.recordRight);
  });

  /* ⚠ THE CAPTION MUST STAY INSIDE THE BAND THAT MAKES IT LEGIBLE. compose.css
     sizes `.subject--media::after` and says in as many words that it is "SIZED
     TO THE TALLEST CAPTION, NOT TO TASTE" — a title and one line. This rebuild
     added the clock, so the caption grew past it: MEASURED over a real
     photograph, the eyebrow fell to 4.02:1 against 5.94:1 on the flag-off
     build, and for music to 1.88:1. css/media.css re-sizes the band per kind;
     this is what goes red if the caption grows again. */
  for (const [kind, session] of [["music", TRACK], ["video", EPISODE]]) {
    test(`the ${kind} caption stays inside its band's plateau`, async ({ page }) => {
      await bootV3(page, { flags: { v3MediaRooms: true } });
      await playing(page, session);

      const fit = await page.evaluate(() => {
        const n = document.querySelector("#subject-mount .subject--media");
        const over = n?.querySelector(".subject__over")?.getBoundingClientRect();
        if (!over) return null;
        const band = parseFloat(getComputedStyle(n, "::after").height);
        // The gradient holds ~full opacity to 60% of the band's height.
        return { captionTop: window.innerHeight - over.top, plateau: band * 0.6 };
      });

      expect(fit, "the subject must mount").not.toBeNull();
      expect(fit.captionTop).toBeLessThanOrEqual(fit.plateau);
    });
  }
});

/* ── The facts line ────────────────────────────────────────────────────────
   Pure, so the "only what was actually reported" rule is checkable without a
   browser. A wall that prints "Album —" has said something untrue about the
   record.
─────────────────────────────────────────────────────────────────────────── */
test.describe("factsLine", () => {
  test("composes only from fields the source actually reported", () => {
    expect(factsLine(PIANO_MUSIC))
      .toBe("1:21 of 5:19 · Metal Gear Solid 4 · Grissini Project bests");
  });

  test("a row with no album and no playlist is just the clock", () => {
    expect(factsLine({ ...PIANO_MUSIC, album: null, playlist: null })).toBe("1:21 of 5:19");
  });

  test("an album that merely repeats the title is not a fact", () => {
    // Sonos reports media_album_name == media_title for a great many singles.
    const same = { ...PIANO_MUSIC, album: PIANO_MUSIC.title, playlist: null };
    expect(factsLine(same)).toBe("1:21 of 5:19");
  });

  test("a movie's clock reads in hours and minutes here too", () => {
    expect(factsLine({ contentType: "movie", position: 2033, duration: 6250, readingAt: 0 }))
      .toBe("0:33 of 1:44");
  });

  test("nothing reported is an empty string, never a dash", () => {
    expect(factsLine({})).toBe("");
    expect(factsLine(null)).toBe("");
  });
});
