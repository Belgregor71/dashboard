import { test, expect } from "./fixtures/coverage.js";
import { deflateSync } from "zlib";
import {
  framePosY,
  posYOf,
  setBias,
  currentBias,
  CENTRE,
  DEFAULT_BIAS,
  LANDSCAPE_MIN_ASPECT,
  PANEL_ASPECT
} from "../src/v3/core/framing.js";
import { coverRect } from "../src/v3/core/scrim.js";

/* GROUND FRAMING — where a landscape sits inside the crop it cannot avoid.
   Behind `groundFraming`, default-off.

   The measurement this exists for, taken 2026-08-24 over 681 deduped assets
   from /api/immich/browse across 2013-2023: 41.9% of this library is 4:3 and
   only SIX photographs out of 681 are 16:9 — the one shape a centred
   `object-fit: cover` loses nothing on. So the default framing is tuned for a
   library this house does not have, and 12.6% comes off the top of nearly every
   landscape it owns.

   Two halves that do not mix. The pure half pins the anchor's arithmetic and,
   more importantly, WHAT IT REFUSES TO MOVE. The DOM half pins the two things
   only a page can show: that flag-off leaves the element untouched, and that
   the legibility sampler follows the anchor rather than assuming the centre —
   which is the failure that would be silent everywhere else. */

// ── The pure half: what the anchor moves, and what it will not ──────────────

const withFlag = (on, fn) => {
  const had = "window" in globalThis;
  const prev = globalThis.window;
  globalThis.window = { CONFIG: { features: { groundFraming: on } } };
  try { return fn(); } finally {
    if (had) globalThis.window = prev; else delete globalThis.window;
  }
};

test("flag off: everything is centred — the rollback path", () => {
  withFlag(false, () => {
    /* Every shape, including the one the feature is for. If a 4:3 ever moves
       with the flag off, flipping it back has stopped being a rollback. */
    expect(framePosY(1.333)).toBe(CENTRE);
    expect(framePosY(1.5)).toBe(CENTRE);
    expect(framePosY(0.75)).toBe(CENTRE);
    expect(framePosY(null)).toBe(CENTRE);
  });
});

test("flag on: a 4:3 landscape is the case this moves", () => {
  withFlag(true, () => {
    expect(framePosY(4 / 3)).toBe(DEFAULT_BIAS);
    expect(framePosY(1.5)).toBe(DEFAULT_BIAS);        // 3:2, same family
    expect(framePosY(LANDSCAPE_MIN_ASPECT)).toBe(DEFAULT_BIAS);
  });
});

/* ⚠ THE REFUSALS ARE THE POINT OF THIS BLOCK. An anchor that slid everything
   would crop a portrait harder than doing nothing and would guess a direction
   for the ~4% of HEICs whose orientation Immich never recorded — the same guess
   `isKnownPortrait` refuses to make, for the same reason. */
test("flag on: it refuses everything it cannot justify moving", () => {
  withFlag(true, () => {
    // A portrait's overflow is enormous and the diptych is what handles it.
    expect(framePosY(0.75)).toBe(CENTRE);
    expect(framePosY(LANDSCAPE_MIN_ASPECT - 0.001)).toBe(CENTRE);

    // 16:9 and wider have NO vertical overflow — there is nothing to anchor.
    expect(framePosY(PANEL_ASPECT)).toBe(CENTRE);
    expect(framePosY(2.35)).toBe(CENTRE);

    // Unknown aspect: the HEICs. Not knowing is not evidence.
    expect(framePosY(null)).toBe(CENTRE);
    expect(framePosY(undefined)).toBe(CENTRE);
    expect(framePosY(0)).toBe(CENTRE);
    expect(framePosY(NaN)).toBe(CENTRE);

    // A diptych half is a 952-wide box, a different overflow entirely.
    expect(framePosY(4 / 3, true)).toBe(CENTRE);
  });
});

test("the lever is bounded, and centre stays reachable as the control arm", () => {
  try {
    expect(setBias(0.2)).toBe(0.2);
    expect(currentBias()).toBe(0.2);

    // Below centre only: sliding a photograph DOWN makes the top worse, which
    // is the opposite of the report this feature answers.
    expect(setBias(0.9)).toBe(0.2);
    expect(setBias(-0.1)).toBe(0.2);
    expect(setBias("nonsense")).toBe(0.2);

    // The A/B needs its control without a deploy.
    expect(setBias(CENTRE)).toBe(CENTRE);
    expect(setBias(0)).toBe(0);
  } finally {
    setBias(DEFAULT_BIAS);
  }
});

test("posYOf reads the element back, and an unmarked one is centre", () => {
  expect(posYOf({ dataset: { posY: "0.35" } })).toBe(0.35);
  expect(posYOf({ dataset: {} })).toBe(CENTRE);
  expect(posYOf({})).toBe(CENTRE);
  expect(posYOf(null)).toBe(CENTRE);
  // Out of range on the element is corruption, not an instruction.
  expect(posYOf({ dataset: { posY: "9" } })).toBe(CENTRE);
  expect(posYOf({ dataset: { posY: "-1" } })).toBe(CENTRE);
});

/* ── coverRect, the sampler's model of the glass ────────────────────────────
   The numbers here are the ones in the config comment, and they are the whole
   argument for the feature: 360 source pixels of overflow on a 4:3 preview,
   180 off each end centred, 126/234 anchored. */

test("coverRect: the anchor moves the source window by its share of the overflow", () => {
  const centred = coverRect(1920, 1440, 1920, 1080);
  expect(centred.sh).toBe(1080);
  expect(centred.sy).toBe(180);            // half of 360

  const anchored = coverRect(1920, 1440, 1920, 1080, 0.35);
  expect(anchored.sy).toBeCloseTo(126, 6); // 0.35 of 360
  expect(anchored.sh).toBe(1080);          // the window's SIZE never changes
  expect(anchored.sx).toBe(centred.sx);    // horizontal is untouched

  // 54 source pixels of the top band recovered, which on a 1.0-scale 4:3
  // preview is 54 pixels on the wall.
  expect(centred.sy - anchored.sy).toBeCloseTo(54, 6);
});

test("coverRect: the default argument is exactly the old behaviour", () => {
  /* The 4-argument call is every caller that existed before the anchor. If this
     ever diverges, the anchor has changed the wall with its own flag off. */
  for (const [w, h] of [[3000, 2000], [1000, 2000], [1920, 1080], [1920, 1440]]) {
    expect(coverRect(w, h, 1920, 1080)).toEqual(coverRect(w, h, 1920, 1080, CENTRE));
  }
});

test("coverRect: no vertical overflow means the anchor is a no-op", () => {
  // 16:9 into 16:9 — nothing to slide, at any setting.
  for (const posY of [0, 0.25, CENTRE]) {
    expect(coverRect(1920, 1080, 1920, 1080, posY).sy).toBe(0);
  }
});

// ── The DOM half: the element, and the sampler that has to agree with it ────

/**
 * A greyscale PNG with a dark top half and a light bottom half.
 *
 * 🔑 A FIXTURE THAT CANNOT PRODUCE THE DEFECT CANNOT CATCH IT. The coupling
 * under test is that scrim.js samples the band the glass actually shows; a flat
 * or 1x1 image would sample identically wherever the anchor put it, and the
 * test would pass just as happily against a sampler that ignored the anchor
 * entirely. Two bands of different luminance are what make the mean move.
 */
function bandedPng(w, h, topGray, bottomGray) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 0;    // colour type: greyscale
  // 10..12 = compression, filter, interlace — all zero.

  const raw = Buffer.alloc(h * (w + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0;   // filter: none
    raw.fill(y < h / 2 ? topGray : bottomGray, y * (w + 1) + 1, (y + 1) * (w + 1));
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

// 4:3 — the measured 41.9% of the library, and the shape the anchor is for.
const FOUR_THREE = bandedPng(400, 300, 0x11, 0xee);

const landscape43 = (id, iso) => ({
  id,
  aspect: 4 / 3,
  localDateTime: iso,
  city: "Nudgee",
  country: "Australia",
  people: []
});

const POOL = [
  landscape43("l1", "2013-08-24T06:00:00Z"),
  landscape43("l2", "2013-08-24T11:00:00Z")
];

async function bootV3(page, { groundFraming = true, pool = POOL, png = FOUR_THREE } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body:
        (await res.text()) +
        `\nwindow.CONFIG.features.groundMemories = true;` +
        `\nwindow.CONFIG.features.groundDiptych = false;` +
        `\nwindow.CONFIG.features.groundFraming = ${groundFraming};\n`
    });
  });
  await page.route("**/api/immich/on-this-day", (route) =>
    route.fulfill({ contentType: "application/json", body: JSON.stringify({ assets: pool }) })
  );
  await page.route("**/api/immich/asset/*/thumb", (route) =>
    route.fulfill({ contentType: "image/png", body: png })
  );

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__ground === "function");
  await expect
    .poll(() => page.evaluate(() => window.__ground().shown), { timeout: 10_000 })
    .toBe(true);
  return pageErrors;
}

const groundEl = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".photo img");
    return {
      posY: window.__ground().posY,
      dataset: el.dataset.posY ?? null,
      // The INLINE style, not the computed one: flag-off must leave the element
      // untouched rather than carry a declaration that computes to the same
      // thing. "Byte-identical when off" is the house rule being pinned.
      inline: el.style.objectPosition || null,
      computed: getComputedStyle(el).objectPosition
    };
  });

test("flag off: the element is untouched, and cover stays centred", async ({ page }) => {
  const pageErrors = await bootV3(page, { groundFraming: false });
  const el = await groundEl(page);

  expect(el.dataset).toBe(null);
  expect(el.inline).toBe(null);
  expect(el.computed).toBe("50% 50%");
  expect(el.posY).toEqual([CENTRE]);
  expect(pageErrors).toEqual([]);
});

test("flag on: a 4:3 landscape is anchored, and both marks are written together", async ({ page }) => {
  const pageErrors = await bootV3(page);
  const el = await groundEl(page);

  expect(el.posY).toEqual([DEFAULT_BIAS]);
  expect(el.dataset).toBe(String(DEFAULT_BIAS));
  /* ⚠ BOTH, ALWAYS. The style is what the eye sees and the dataset is what the
     sampler reads; one without the other is the silent half-failure.

     Read numerically rather than as a string: the browser normalises whatever
     is written ("35.00%" comes back "35%"), so a literal would be pinning
     Chromium's formatter instead of the anchor. */
  const [x, y] = el.inline.split(" ");
  expect(x).toBe("50%");
  expect(parseFloat(y)).toBeCloseTo(DEFAULT_BIAS * 100, 6);
  expect(el.computed).toBe(el.inline);
  expect(pageErrors).toEqual([]);
});

/* ⚠⚠ THE ASSET LIES AND THE RENDITION DOES NOT — the defect this shipped with,
   caught on the wall within a minute of the flag going default-on.

   Immich's top-level width/height are post-rotation for almost everything, which
   is what d710e99 fixed. For the ~4% of HEICs whose `orientation` it never
   recorded they are NOT: it reports landscape in every field it has and still
   delivers a rotated PORTRAIT preview. Seen live on 2026-08-25 — server
   `aspect: 1.333`, rendered 0.75 — and the anchor slid a photograph that already
   loses 58% to `cover` even further up. Strictly worse than doing nothing, on
   precisely the assets F6 identified as unfixable server-side.

   The fixture is the defect: the pool says 4/3, the bytes are 3:4. A spec that
   trusted the pool's own number could not tell the two apart. */
test("an asset that CLAIMS landscape but renders portrait is left alone", async ({ page }) => {
  const PORTRAIT = bandedPng(300, 400, 0x11, 0xee);
  const lying = [
    { ...landscape43("liar-1", "2013-08-24T06:00:00Z") },
    { ...landscape43("liar-2", "2013-08-24T11:00:00Z") }
  ];

  const pageErrors = await bootV3(page, { pool: lying, png: PORTRAIT });
  const el = await page.evaluate(() => {
    const img = document.querySelector(".photo img");
    return {
      claimed: 4 / 3,
      rendered: +(img.naturalWidth / img.naturalHeight).toFixed(3),
      inline: img.style.objectPosition || null,
      dataset: img.dataset.posY ?? null,
      posY: window.__ground().posY
    };
  });

  // The premise: the fixture really does disagree with itself.
  expect(el.rendered).toBe(0.75);

  // The assertion: the RENDITION wins, so this is a portrait and stays centred.
  expect(el.inline).toBe(null);
  expect(el.dataset).toBe(null);
  expect(el.posY).toEqual([CENTRE]);
  expect(pageErrors).toEqual([]);
});

/* 🔑 THE COUPLING, AND THE ONLY TEST HERE THAT WOULD CATCH ITS FAILURE.
   scrim.js models `object-fit: cover` itself to decide how much scrim the text
   needs. If the ground slides a photograph up and the sampler keeps reading the
   centre, the scrim solves for a band of the picture that is NOT on the glass —
   and nothing else in this suite, or on the wall, would say so.

   Neuter check: drop `posYOf(el)` from the sampleCells call in scrim.js and
   this test goes red while every other test in this file stays green. */
test("the legibility sampler follows the anchor rather than assuming the centre", async ({ page }) => {
  await bootV3(page);

  const read = () => page.evaluate(() => window.__scrim().meanLuminance);

  const atDefault = await read();

  // Top-anchored: the sampler should now see MORE of the dark top band and less
  // of the light bottom one, so the measured mean has to fall.
  const top = await page.evaluate(() => window.__groundBias(0));
  expect(top).toBe(0);
  const atTop = await read();

  // Centre — the control arm, and the value the flag-off wall uses.
  const centre = await page.evaluate(() => window.__groundBias(0.5));
  expect(centre).toBe(CENTRE);
  const atCentre = await read();

  expect(atTop).toBeLessThan(atCentre);
  expect(atDefault).toBeLessThan(atCentre);
  expect(atTop).toBeLessThan(atDefault);

  /* Not a rounding wobble. The fixture is half 0x11 and half 0xee, so moving
     the window by a quarter of its overflow moves real luminance. */
  expect(atCentre - atTop).toBeGreaterThan(0.02);
});
