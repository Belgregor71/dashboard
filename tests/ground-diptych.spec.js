import { test, expect } from "./fixtures/coverage.js";
import { buildItems, captionForFrame } from "../src/v3/core/ground.js";

/* THE PORTRAIT DIPTYCH — two portraits side by side instead of one, butchered.
   Behind `groundDiptych`, on top of `groundMemories`.

   The arithmetic this feature exists for, on the 1920x1080 panel: a 1440x1920
   preview full-bleed is upscaled 1.33x and cropped to ~42% of the picture; in a
   952x1080 half it is downscaled to 0.667x and keeps ~84%.

   Two halves of this file. The pure half pins the pairing rule and the merged
   caption with no DOM and no network. The DOM half pins the things that are
   only true on a page: that a pair is ONE frame (one latch, one caption, one
   scrim measurement, one settle), and that a frame which fails leaves exactly
   the DOM it started with — the invariant that keeps a wall running for weeks
   from accumulating half-built photographs. */

const portrait = (id, iso, extra = {}) => ({
  id,
  aspect: 0.75,
  localDateTime: iso,
  city: "Nudgee",
  country: "Australia",
  people: [],
  ...extra
});

const landscape = (id, iso, extra = {}) => portrait(id, iso, { aspect: 1.78, ...extra });

/** Every id in the built pool, whatever the frame shape. */
const idsIn = (items) => items.flat().map((a) => a.id);

// ── The pairing rule ────────────────────────────────────────────────────────

test("flag off: one photograph per frame, landscape first — the rollback path", () => {
  const items = buildItems(
    [portrait("p1", "2013-08-13T10:00:00Z"), landscape("l1", "2013-08-13T11:00:00Z")],
    false
  );

  // If this ever produces a pair, flipping the flag back has stopped being a
  // rollback and the feature is not reversible.
  expect(items.every((frame) => frame.length === 1)).toBe(true);
  expect(items[0][0].id).toBe("l1");
  expect(idsIn(items)).toEqual(["l1", "p1"]);
});

test("portraits pair within a year, nearest in time", () => {
  // Deliberately out of order in the input: the pairing must come from the
  // timestamps, not from the order the library happened to return.
  const items = buildItems(
    [
      portrait("noon", "2013-08-13T12:00:00Z"),
      portrait("dawn", "2013-08-13T06:00:00Z"),
      portrait("nine", "2013-08-13T09:00:00Z")
    ],
    true
  );

  const pair = items.find((frame) => frame.length === 2);
  // dawn/nine are 3h apart, nine/noon are 3h apart — but pairing walks the
  // sorted list from the start, so the earliest two are the moment.
  expect(pair.map((a) => a.id)).toEqual(["dawn", "nine"]);
});

test("the odd portrait is OMITTED — not repeated, not full-bleed, not held", () => {
  const items = buildItems(
    [
      portrait("a", "2013-08-13T06:00:00Z"),
      portrait("b", "2013-08-13T07:00:00Z"),
      portrait("lonely", "2016-08-13T06:00:00Z")
    ],
    true
  );

  /* All three of the rejected alternatives fail a different assertion here, and
     that is the point of testing it this way rather than by counting frames:
     repeating it would put "lonely" in twice, showing it full-bleed would leave
     a single-asset frame carrying a known portrait, and holding it for tomorrow
     is not representable in a pool that is drawn per day. */
  expect(idsIn(items)).not.toContain("lonely");
  expect(idsIn(items).filter((id) => id === "a")).toHaveLength(1);
  expect(items).toEqual([[expect.objectContaining({ id: "a" }), expect.objectContaining({ id: "b" })]]);
});

test("unknown orientation is never paired — it might be a landscape", () => {
  /* `aspect` is null when the caller did not request withExif. The ordering
     rule treats unknown as portrait (conservative — it gets seen last), but
     pairing must not: a landscape in a 952-wide half is a HEAVIER crop than the
     full-bleed it would otherwise have got, so an unknown asset would be made
     worse by the feature meant to improve it. */
  const items = buildItems(
    [
      portrait("unknown", "2013-08-13T06:00:00Z", { aspect: null }),
      portrait("known", "2013-08-13T07:00:00Z")
    ],
    true
  );

  const unknownFrame = items.find((frame) => frame.some((a) => a.id === "unknown"));
  expect(unknownFrame).toHaveLength(1);
  // And the real portrait it could have been paired with is now the odd one out.
  expect(idsIn(items)).not.toContain("known");
});

test("pairs and landscapes are shuffled TOGETHER, not deferred", () => {
  /* The behaviour change the flag makes to ordering. Once a portrait pair is
     the best-rendered thing on the wall there is no reason left to show it
     last — and last, on a day you glance at the wall twice, means never. */
  const assets = [
    landscape("l1", "2013-08-13T06:00:00Z"),
    landscape("l2", "2013-08-13T07:00:00Z"),
    portrait("p1", "2013-08-13T08:00:00Z"),
    portrait("p2", "2013-08-13T09:00:00Z")
  ];

  const pairFirst = Array.from({ length: 50 }, () => buildItems(assets, true))
    .some((items) => items[0].length === 2);
  // 50 shuffles of a 3-frame pool: a landscape-first implementation fails this
  // every time, a shuffled one fails it with probability ~1e-9.
  expect(pairFirst).toBe(true);

  // Flag off, the same assets keep the old deferral exactly.
  expect(buildItems(assets, false)[0][0].aspect).toBe(1.78);
});

test("a pool that cannot pair anything builds to nothing rather than to junk", () => {
  // Three portraits, three different years. Every one of them is an odd one.
  const items = buildItems(
    [
      portrait("a", "2013-08-13T06:00:00Z"),
      portrait("b", "2016-08-13T06:00:00Z"),
      portrait("c", "2019-08-13T06:00:00Z")
    ],
    true
  );
  /* Empty is the honest answer, and ground.js is what must not adopt it — an
     empty pool pinned to today's day key would leave the wall on the random
     fallback until midnight with no way back. */
  expect(items).toEqual([]);
});

// ── The merged caption ──────────────────────────────────────────────────────

test("a pair from one moment reads exactly like one photograph", () => {
  // Same place, same year, no named faces — the common case by a wide margin
  // (measured on the live library: 85 of 116 had a city, 7 had a named face).
  expect(captionForFrame([
    portrait("a", "2013-08-13T06:00:00Z"),
    portrait("b", "2013-08-13T07:00:00Z")
  ])).toBe("Nudgee · 2013");
});

test("what the halves do not share is merged, not repeated", () => {
  expect(captionForFrame([
    portrait("a", "2013-08-13T06:00:00Z", { city: "Nudgee", people: ["Greg"] }),
    portrait("b", "2013-08-13T07:00:00Z", { city: "Ashgrove", people: ["Korina"] })
  ])).toBe("Greg & Korina · Nudgee & Ashgrove · 2013");

  // The same person in both halves is one person, not two.
  expect(captionForFrame([
    portrait("a", "2013-08-13T06:00:00Z", { people: ["Greg"] }),
    portrait("b", "2013-08-13T07:00:00Z", { people: ["Greg"] })
  ])).toBe("Greg · Nudgee · 2013");
});

test("a one-photograph frame captions exactly as it always did", () => {
  const solo = portrait("a", "2013-08-13T06:00:00Z", { people: ["Greg"] });
  expect(captionForFrame([solo])).toBe("Greg · Nudgee · 2013");
  expect(captionForFrame([])).toBe("");
  expect(captionForFrame(null)).toBe("");
});

test("differing years are stated, never quietly picked from one half", () => {
  /* Only reachable through the unknown-date bucket, since pairing is same-year
     — but a caption that names one half's year over a photograph from another
     year is a lie the wall has no way to correct. */
  expect(captionForFrame([
    portrait("a", "2013-08-13T06:00:00Z"),
    portrait("b", "2016-08-13T06:00:00Z")
  ])).toBe("Nudgee · 2013 & 2016");
});

// ── On the page ─────────────────────────────────────────────────────────────

/* A 1x1 PNG. The specs need `load` to fire and naturalWidth to be non-zero so
   the scrim can sample; nothing here asserts what the picture looks like. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const POOL = [
  portrait("a", "2013-08-13T06:00:00Z"),
  portrait("b", "2013-08-13T07:00:00Z"),
  portrait("c", "2013-08-13T08:00:00Z"),
  portrait("d", "2013-08-13T09:00:00Z")
];

/**
 * Boot V3 with both flags pinned and Immich served from a fixture.
 *
 * Pinned, never inherited: flipping either flag back is the rollback path, so
 * both states have to keep being tested after a default moves.
 */
async function bootV3(page, { groundMemories = true, groundDiptych = true, pool = POOL } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.groundMemories = ${groundMemories};` +
        `\nwindow.CONFIG.features.groundDiptych = ${groundDiptych};\n`
    });
  });

  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG })
  );

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");
  return pageErrors;
}

const groundShown = (page) =>
  expect.poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 }).toBe(true);

test("a pair arrives as ONE frame: two images, one layer, one caption", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await groundShown(page);

  const probe = await page.evaluate(() => ({
    ...window.__ground(),
    caption: document.getElementById("ground-caption").textContent,
    diptych: document.querySelector(".photo").dataset.diptych,
    halves: window.__scrim().halves,
    scrimReason: window.__scrim().reason
  }));

  expect(probe.pair).toBe(true);
  expect(probe.assetIds).toHaveLength(2);
  expect(probe.imgs).toBe(2);
  /* ⚠ `layers` MUST STAY 1. It is the soak metric the cutover doc reads to
     decide whether the ground is leaking; if a diptych started reading as 2 at
     rest, every future soak would report a leak that is not there. */
  expect(probe.layers).toBe(1);
  expect(probe.inFlight).toBe(false);

  // One line for the pair, because the two halves are one moment.
  expect(probe.caption).toBe("Nudgee · 2013");

  // And the scrim measured the WHOLE wall, not the left half of it.
  expect(probe.scrimReason).toBe("measured");
  expect(probe.halves).toBe(2);

  expect(pageErrors).toEqual([]);
});

test("the halves sit side by side with the substrate showing between them", async ({ page }) => {
  await bootV3(page);
  await groundShown(page);

  const rects = await page.evaluate(() =>
    [...document.querySelectorAll(".photo img")].map((img) => {
      const r = img.getBoundingClientRect();
      return { x: Math.round(r.x), w: Math.round(r.width), h: Math.round(r.height) };
    })
  );

  expect(rects).toHaveLength(2);
  const [left, right] = rects;
  // 1920 = 952 + 16 + 952. Measured rather than asserted from the stylesheet:
  // the gap is a var() inside a calc() and a typo in either would still parse.
  expect(left.x).toBe(0);
  expect(left.w).toBe(right.w);
  expect(right.x - (left.x + left.w)).toBe(16);
  expect(right.x + right.w).toBe(1920);
  expect(left.h).toBe(1080);

  // Each half is 952 wide: a 1440x1920 preview lands at 0.667x, DOWN not up.
  expect(left.w).toBe(952);
});

test("flag off: one full-bleed photograph, and nothing positioned", async ({ page }) => {
  const pageErrors = await bootV3(page, { groundDiptych: false });
  await groundShown(page);

  const probe = await page.evaluate(() => {
    const img = document.getElementById("ground");
    const r = img.getBoundingClientRect();
    return {
      ...window.__ground(),
      diptych: document.querySelector(".photo").dataset.diptych ?? null,
      halfAttr: img.dataset.half ?? null,
      position: getComputedStyle(img).position,
      w: Math.round(r.width)
    };
  });

  // The rollback state, asserted on the glass rather than in the module: one
  // photograph filling the wall, no half markers, no positioning, and — the
  // thing a screenshot would not show — the scrim measuring one image.
  expect(probe.pair).toBe(false);
  expect(probe.imgs).toBe(1);
  expect(probe.layers).toBe(1);
  expect(probe.diptych).toBeNull();
  expect(probe.halfAttr).toBeNull();
  expect(probe.position).toBe("static");
  expect(probe.w).toBe(1920);
  expect(await page.evaluate(() => window.__scrim().halves)).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("a half that never arrives takes the whole frame down and leaves the DOM as it was", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) +
        "\nwindow.CONFIG.features.groundMemories = true;\nwindow.CONFIG.features.groundDiptych = true;\n"
    });
  });
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: POOL }) })
  );
  // Every thumb 404s. Half a diptych is worse than no photograph, so the frame
  // must fail whole — and the extra <img> it built must not survive it.
  await page.route("**/api/immich/asset/*/thumb", (route) => route.fulfill({ status: 404 }));

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");

  /* The failure that matters on a page that runs for weeks is a stuck latch:
     `inFlight` true forever means the ground never retries and the wall stays
     empty until someone reloads it. */
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight), { timeout: 10_000 })
    .toBe(false);

  const probe = await page.evaluate(() => ({
    ...window.__ground(),
    diptych: document.querySelector(".photo").dataset.diptych ?? null,
    halfAttr: document.getElementById("ground").dataset.half ?? null
  }));

  expect(probe.shown).toBe(false);
  expect(probe.assetId).toBeNull();
  // Exactly the DOM index.html shipped: the created half is gone, #ground is
  // still #ground, and the container is not left in diptych mode.
  expect(probe.imgs).toBe(1);
  expect(probe.layers).toBe(1);
  expect(probe.halfAttr).toBeNull();
  expect(probe.diptych).toBeNull();
  expect(pageErrors).toEqual([]);
});

test("a stalled rotation drops both new halves and keeps the pair on the glass", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await groundShown(page);
  const before = await page.evaluate(() => window.__ground().assetIds);

  /* The sleeping-NAS case, which is the one this file is shaped around: an
     <img> that fires NEITHER load NOR error. Registered AFTER the fulfilling
     route on purpose — page.route matches last-registered first. */
  await page.route("**/api/immich/asset/*/thumb", () => { /* never resolves */ });

  // Drive the stall rather than sitting out 30 seconds.
  await page.evaluate(() => window.__groundDissolve(20, 80));
  await expect.poll(() => page.evaluate(() => window.__ground().inFlight), { timeout: 5000 })
    .toBe(false);

  const probe = await page.evaluate(() => ({
    ...window.__ground(),
    diptych: document.querySelector(".photo").dataset.diptych
  }));

  // Both half-built nodes gone, the living pair untouched, and still a diptych.
  expect(probe.imgs).toBe(2);
  expect(probe.layers).toBe(1);
  expect(probe.assetIds).toEqual(before);
  expect(probe.pair).toBe(true);
  expect(probe.diptych).toBe("1");
  expect(pageErrors).toEqual([]);
});

test("a pair settling into a single photograph does not jump on top of it", async ({ page }) => {
  /* ⚠ THE TRAP THE CSS IS SHAPED AROUND, and the only place it can be caught.
     A positioned element paints ABOVE a static sibling whatever the DOM order,
     so if the container's diptych flag were cleared when the INCOMING frame is
     a single photograph, the outgoing pair would still be absolute, would still
     be fully opaque for the length of the settle, and would sit on top of the
     photograph fading in underneath it. The settle becomes a cut, a minute
     late, with the wrong picture on the glass in between.

     Driven deterministically: a pool of exactly one pair, so the first frame
     must be the pair, then a pool of exactly one landscape, so the rotation
     must be a single. */
  const pool = [POOL[0], POOL[1]];
  const pageErrors = await bootV3(page, { pool });
  await groundShown(page);
  expect(await page.evaluate(() => window.__ground().pair)).toBe(true);

  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ assets: [{ ...pool[0], id: "wide", aspect: 1.78 }] })
    })
  );

  // A long settle, so the assertion lands DURING it rather than after.
  await page.evaluate(() => window.__groundDissolve(3000, 5000));
  await expect.poll(() => page.evaluate(() => window.__ground().assetId), { timeout: 10_000 })
    .toBe("wide");

  const during = await page.evaluate(() => {
    const imgs = [...document.querySelector(".photo").querySelectorAll("img")];
    return {
      diptych: document.querySelector(".photo").dataset.diptych ?? null,
      count: imgs.length,
      positions: imgs.map((i) => getComputedStyle(i).position),
      // The incoming photograph must be LAST, because among positioned siblings
      // at z-index auto the last one paints on top.
      incomingIsLast: imgs.at(-1).dataset.half === undefined
    };
  });

  expect(during.count).toBe(3);                       // the old pair + the new one
  expect(during.diptych).toBe("1");                   // still positioned, all three
  expect(during.positions).toEqual(["absolute", "absolute", "absolute"]);
  expect(during.incomingIsLast).toBe(true);

  // And once the pair is off the glass the flag clears, so the ground goes back
  // to being the plain full-bleed <img> it is when no diptych exists.
  await expect.poll(() => page.evaluate(() => window.__ground().imgs), { timeout: 10_000 }).toBe(1);
  const after = await page.evaluate(() => ({
    diptych: document.querySelector(".photo").dataset.diptych ?? null,
    position: getComputedStyle(document.getElementById("ground")).position,
    width: Math.round(document.getElementById("ground").getBoundingClientRect().width)
  }));
  expect(after.diptych).toBeNull();
  expect(after.position).toBe("static");
  expect(after.width).toBe(1920);
  expect(pageErrors).toEqual([]);
});

test("a rotation replaces BOTH halves — the leak a diptych invites", async ({ page }) => {
  const pageErrors = await bootV3(page);
  await groundShown(page);
  const before = await page.evaluate(() => window.__ground().assetIds);

  // A 20ms settle, then past the cleanup buffer.
  await page.evaluate(() => window.__groundDissolve(20, 5000));
  await expect.poll(() => page.evaluate(() => window.__ground().assetIds.join(",")), { timeout: 10_000 })
    .not.toBe(before.join(","));

  /* ⚠ THE ASSERTION THIS WHOLE SPEC EXISTS FOR. The old frame is two elements;
     a teardown that removes only the first leaks one <img> per rotation, which
     on a ten-minute tick is 144 a day on a page that runs for weeks. It would
     never look like anything until the wall died. */
  await expect.poll(() => page.evaluate(() => window.__ground().imgs), { timeout: 10_000 }).toBe(2);

  const probe = await page.evaluate(() => ({
    ...window.__ground(),
    grounded: document.getElementById("ground") !== null,
    caption: document.getElementById("ground-caption").textContent
  }));
  expect(probe.layers).toBe(1);
  expect(probe.pair).toBe(true);
  // #ground still names the photograph on the glass — the left half of it —
  // rather than a detached node from the frame before.
  expect(probe.grounded).toBe(true);
  expect(probe.caption).toBe("Nudgee · 2013");
  expect(pageErrors).toEqual([]);
});
