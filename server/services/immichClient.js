import { fetchWithTimeout } from "../utils/fetch.js";
import { isHidden } from "./photoVeto.js";

// Read-only Immich client — Phase 9.5 (docs/vision/photo-source-immich.md). The
// house's photo source lives on the Synology (LAN, on-device). This module holds
// the API key (server-side ONLY, never sent to the browser) and speaks the small
// slice of Immich's REST API the memory engine + screensaver need:
//   POST /api/search/random   — random assets (ambient rotation)
//   POST /api/search/metadata — assets in a taken-date window (on-this-day)
//   GET  /api/assets/:id/thumbnail?size=preview — a server-side DOWNSCALED
//        rendition (~47 KB jpeg) so the Pi never decodes a full-res original.
//
// Everything is fail-soft: a sleeping/absent Synology returns []/null, never an
// error the kiosk has to render. Confirmed against the live v3.0.2 instance.
//
// ⚠ FAIL-SOFT HID A REAL DIFFERENCE, AND IT BLANKED THE WALL. Returning [] for
// both "Immich has nothing for this question" and "the fetch failed" is right
// for a renderer — it draws nothing either way — and wrong for a CACHE, which
// must keep the first and never keep the second. On 2026-08-30 one cold-start
// failure after a service restart was memoised for on-this-day's full HOUR, and
// the photo ground stayed empty while every health check read 200 OK.
//
// So each search has TWO views of one implementation:
//   searchRandom(n)        → Array          the old shape, every caller unchanged
//   searchRandomResult(n)  → { ok, assets } for the routes that memoise
// `ok:false` means the fetch failed. `ok:true` with an empty list is an answer.

const TIMEOUT_MS = 6000;
const DAY_MS = 86_400_000;

// Strip a wrapping quote pair (the HA_TOKEN .env gotcha — values are often
// double-quoted on the Pi).
function envVal(key) {
  const raw = process.env[key];
  if (!raw) return null;
  return raw.trim().replace(/^["']|["']$/g, "");
}

function config() {
  const base = envVal("IMMICH_URL");
  const key = envVal("IMMICH_API_KEY");
  if (!base || !key) return null;
  return { base: base.replace(/\/$/, ""), key };
}

export function isConfigured() {
  return config() != null;
}

function headers(key, json = true) {
  const h = { "x-api-key": key, Accept: "application/json" };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

/**
 * Screenshots are not photographs, and on the ambient substrate they wreck the
 * premise — the live rotation served a car-configurator web page (browser
 * chrome, cursor, price list) as Mode-0 wallpaper.
 *
 * Every cheaper signal was tried against the real library and rejected on
 * evidence, so do not "simplify" this back to one of them:
 *
 *  - Filename is useless. iOS names screenshots `IMG_1234.PNG`, identical to
 *    camera shots, and a library-wide search for "screenshot"/"Screen" returns
 *    literally zero (control: "IMG_1012" returns 4, so the search works).
 *  - "No camera EXIF make" is far too aggressive: 58 no-make stills are real
 *    photographs — 3024x4032 camera frames, forwarded and resized family
 *    pictures whose EXIF messaging apps stripped.
 *  - "PNG + no make" LOOKED exact on a 621-image random sample (9/9 were true
 *    screenshots) and is still wrong. Checked against a fixed date window it
 *    dropped 58 assets, and inspecting them by eye found two genuine memories:
 *    a 360-degree equirectangular panorama of a park (4096x2048) and a photo of
 *    the dog on the grass (540x540). Both are PNGs with no EXIF whatsoever.
 *  - Camera-detail EXIF (fNumber/focalLength/iso/exposureTime/lensModel) cannot
 *    rescue it: on these assets every one of those fields is null, for genuine
 *    photographs and true screenshots alike. PNG conversion stripped the lot.
 *
 * So dimensions are the only signal left, and the rule is deliberately
 * PRECISION-favouring: drop only a pixel-exact match to a known device panel.
 * That keeps the panorama and the dog, at the cost of missing odd-sized grabs
 * (a 625x7465 scrolling capture, a photographed business card). Losing one real
 * memory off the wall is far worse than an occasional screenshot surviving —
 * "does this make the next glance more useful, calmer, or more delightful?"
 *
 * Exported for the contract test (pickSensorPath precedent).
 *
 * ⚠ Requires exifInfo for the dimensions, so every caller must request
 * `withExif`. `searchRandom` now asks for it when the flag is on (only then —
 * flag-off stays byte-identical). An earlier revision of this comment claimed
 * doing so would start rendering place captions on the ambient substrate; that
 * was wrong. Both consumers of /api/immich/random read `a.id` and nothing else
 * (background.js:54, screensaver.js:191), and the ambient captions come from the
 * Daily Memories set on a different route entirely.
 */
// Exact device screen sizes, both orientations. A screenshot is a pixel-for-pixel
// copy of a panel, so it lands on one of these precisely; a photograph does not.
// Built from what this library actually contains (1024x768 x24, 1170x2532 x17,
// 1668x2388 x3, 2048x1536) plus the other common iOS panels, since the household
// is 71% Apple.
const DEVICE_SCREENS = new Set([
  "640x1136", "750x1334", "828x1792", "1080x2340", "1125x2436", "1170x2532",
  "1179x2556", "1206x2622", "1242x2208", "1242x2688", "1290x2796", "1320x2868",
  "768x1024", "1024x768", "1536x2048", "2048x1536", "1488x2266", "1620x2160",
  "1640x2360", "1668x2224", "1668x2388", "2048x2732", "1024x1366"
]);

export function isScreenshot(a) {
  const mime = String(a?.originalMimeType || "").toLowerCase();
  if (!mime.includes("png")) return false;
  // A PNG that kept its camera EXIF is a photograph, not a screen grab.
  if (String(a?.exifInfo?.make || "").trim()) return false;

  const w = Number(a?.exifInfo?.exifImageWidth) || 0;
  const h = Number(a?.exifInfo?.exifImageHeight) || 0;
  if (!w || !h) return false; // unknown size → keep it; never drop on a guess
  return DEVICE_SCREENS.has(`${w}x${h}`) || DEVICE_SCREENS.has(`${h}x${w}`);
}

// Read env INSIDE the function, never at module load: ES imports hoist above
// server.js's dotenv.config(), so a module-level read freezes to its default and
// the documented knob is silently unsettable (the KOKORO_VOICE / VAULT_ENABLED
// trap, documented at display.js:31-34).
function excludeScreenshots() {
  return String(process.env.IMMICH_EXCLUDE_SCREENSHOTS || "").trim() === "1";
}

/**
 * Live Photo motion parts — features.ambientArchiveMotion's server half.
 *
 * Read INSIDE the function for the same reason as excludeScreenshots above.
 * Off → slim() is key-for-key identical to the pre-motion build, nothing is
 * transcoded, and no clip ever reaches the disk, so the client flag alone can
 * never cause NAS load. Exported for the contract test.
 */
export function liveMotionEnabled() {
  return String(process.env.IMMICH_LIVE_MOTION || "").trim() === "1";
}

/**
 * A displayable still: a real image, not trashed/archived, with an id.
 *
 * ⚠ `type === "IMAGE"` is load-bearing and must stay. A Live Photo IS an IMAGE
 * (its motion half is a SEPARATE asset, referenced by livePhotoVideoId and
 * carried by slim below), so motion costs this filter nothing. What the filter
 * keeps out is standalone VIDEO assets, which are a different feature with a
 * different design argument entirely — see §7 of the ambient-motion plan. Relax
 * this and full-length videos start appearing in every rotation by accident.
 */
/* The panel is 1920 wide and the ambient ground overscans it, so anything whose
   ORIGINAL long edge is under this was always going to be upscaled mush.

   ⚠ MEASURED BEFORE IT WAS CHOSEN, because two earlier filters here were built
   on reasoning and rejected for dropping real memories. Sample of 250 assets
   across the on-this-day range on the live library (2026-08-12): long edge
   min 1136 · p5 1920 · p50 3238 · max 7493 — exactly ONE asset under 1200.
   So this threshold removes ~0.4% and cannot be the cause of a soft-looking
   wall. It is a guard against genuine outliers, not a sharpness fix.

   🔑 THE REAL CAUSE OF SOFTNESS IS DELIVERY, NOT SOURCE: fetchRendition asks
   for `size=preview` (~1440px long edge) with the stated reason "so the Pi
   never decodes a full-res original" — and the Pi was replaced by the G11 on
   2026-08-01. A 1440px rendition upscaled onto an overscanned 1920 panel is
   soft no matter how sharp the original is.

   ⚠ Zero dimensions mean the caller did not ask for `withExif`, NOT a small
   photo. Fail open — the same trap isScreenshot documents. */
const MIN_LONG_EDGE = 1200;

export function isLowResolution(a) {
  const w = Number(a?.exifInfo?.exifImageWidth) || 0;
  const h = Number(a?.exifInfo?.exifImageHeight) || 0;
  if (!w || !h) return false; // unknown is not small
  return Math.max(w, h) < MIN_LONG_EDGE;
}

function usableImage(a) {
  if (!(a && a.id && a.type === "IMAGE" && !a.isTrashed && !a.isArchived)) return false;
  if (excludeScreenshots() && isScreenshot(a)) return false;
  if (isLowResolution(a)) return false;
  /* The one filter that is not a guess: the room said no to this photograph out
     loud. Applied here rather than per-route because this is the single choke
     point every search passes through — a veto spoken at the ambient ground
     also has to hold on the screensaver and in Daily Memories, or the same
     photograph comes back on a different surface an hour later. Unconditional
     because the list starts empty and filters nothing until something is in
     it. See services/photoVeto.js. */
  if (isHidden(a.id)) return false;
  return true;
}

/* ⚠⚠ THE EXIF DIMENSIONS ARE PRE-ROTATION AND THE RENDITION IS NOT. This is the
   whole of F6 — "heads are being cropped, tops of cocktails being left off."

   An iPhone stores a portrait photograph as a LANDSCAPE 4032x3024 buffer plus
   `orientation: 6` ("rotate 90° CW to display"). Immich applies that when it
   generates the preview, so the jpeg the wall actually loads is 1440x1920 —
   while `exifImageWidth/Height` still describe the sensor. Deriving the aspect
   from them therefore reports 1.333 for a picture that is 0.750 on the glass.

   🔑 MEASURED ON THE LIVE LIBRARY, 2026-08-15, by fetching every preview in the
   day's on-this-day pool and reading its SOF marker — not reasoned about:

     202 assets · 111 are portrait as delivered · the exif pair said so for 47
     ⇒ 64 misclassified, THIRTY-TWO PERCENT of the pool

   And a misclassified portrait is not a cosmetic error, it is the worst frame
   the ground can draw: `isKnownPortrait` rejects it, so the diptych — the
   feature that exists precisely to protect portraits — never pairs it, and it
   goes full-bleed instead, where 0.75 into 1.78 keeps 42% of the picture and
   throws away the rest from the centre outwards. Faces live near the top of a
   portrait frame. That is the report, exactly.

   THE FIX IS A FIELD THAT WAS ALWAYS IN THE PAYLOAD. `width`/`height` sit at the
   TOP LEVEL of the asset, beside `exifInfo` rather than inside it, and Immich
   writes them POST-rotation. Measured against the delivered jpeg across the same
   202: the top-level pair agrees for 194, the exif pair for 138. Present on
   `search/random` too, with and without `withExif` (checked both).

   ⚠ THE RESIDUAL 8 ARE NOT A BUG HERE AND CANNOT BE FIXED ON THIS SIDE. They are
   HEICs whose `orientation` is null, where Immich reports 4032x3024 in EVERY
   field it has and still delivers 1440x1920. The server has no way to know
   without decoding the rendition; the browser does, via naturalWidth on the
   loaded <img>, which is exactly where `archiveModel.js:110` says to read it.
   4% of the pool, and they fail the way they always did.

   ⚠ Fails to null rather than to a guess, and unknown is NOT portrait — the
   callers all treat null as "leave it full-bleed", which is the conservative
   end (see ground.js's isKnownPortrait). */
export function displayAspect(a) {
  const round = (v) => Math.round(v * 1000) / 1000;

  const w = Number(a?.width) || 0;
  const h = Number(a?.height) || 0;
  if (w && h) return round(w / h);

  // Older Immich, or any payload without the top-level pair: fall back to the
  // exif dimensions AND apply the orientation they are missing. 5-8 are the four
  // transposed values; 1-4 leave the axes alone.
  const ew = Number(a?.exifInfo?.exifImageWidth) || 0;
  const eh = Number(a?.exifInfo?.exifImageHeight) || 0;
  if (!ew || !eh) return null;
  const o = Number(a?.exifInfo?.orientation);
  const transposed = o >= 5 && o <= 8;
  return round(transposed ? eh / ew : ew / eh);
}

export function slim(a) {
  // Location rides along from exifInfo when present (the Daily Memories caption +
  // travel-map need it); absent/GPS-less photos just come back null → year-only
  // caption, no map. Kept null-safe so the random/browse callers are unaffected.
  const ex = a.exifInfo || {};
  return {
    id: a.id,
    localDateTime: a.localDateTime || a.fileCreatedAt || null,
    city: ex.city ?? null,
    state: ex.state ?? null,
    country: ex.country ?? null,
    lat: ex.latitude ?? null,
    lng: ex.longitude ?? null,
    // Named faces, for the caption's "· Joe and Lee" tail. Immich carries a
    // person record for every recognised face cluster and leaves `name` empty
    // until someone tags it, so unnamed clusters are dropped here — they can't
    // caption anything. Only the daily-memories windows ask for withPeople, so
    // this is [] for the random/browse callers.
    people: (a.people || []).map((p) => String(p?.name || "").trim()).filter(Boolean),
    /* Orientation, for the ambient ground. A PORTRAIT photograph on a 32"
       landscape wall is the worst case twice over: object-fit cover must scale
       a 1440x1920 preview by 1.33 to fill 1920 wide (the only upscale in the
       whole path — a landscape preview lands at exactly 1.0), and it crops away
       ~58% of the picture doing it. Null when nothing here knows the shape,
       which callers must treat as unknown, never as portrait. */
    aspect: displayAspect(a),
    // The id of this photo's motion half, when it has one and the knob is on.
    // Spread conditionally so the knob-off object keeps exactly the eight keys
    // it has always had (asserted in the contract test).
    //
    // ⚠ This id is INTERNAL. It reaches the frozen daily set on disk, because
    // that is what the overnight transcoder reads — but /api/immich/daily-set
    // strips it and publishes a `motion` BOOLEAN instead, meaning "a playable
    // clip is on local disk right now". See routes/immich.js.
    ...(liveMotionEnabled() ? { motionId: a.livePhotoVideoId || null } : {})
  };
}

/** Random still images, as a bare array — the long-standing shape. */
export async function searchRandom(count = 12) {
  return (await searchRandomResult(count)).assets;
}

/** Random still images. Over-fetches then filters, since videos/trashed slip in. */
export async function searchRandomResult(count = 12) {
  const cfg = config();
  // Unconfigured is not an answer about the library, so it must not be cached
  // as one — a box that gains its key later would otherwise serve [] until TTL.
  if (!cfg) return { ok: false, assets: [] };
  try {
    // withExif ONLY when the screenshot filter is on: isScreenshot needs the
    // pixel dimensions, and without them it is inert. Requested conditionally so
    // the flag-off request is byte-identical to before, and so the larger
    // response is only paid for when something consumes it.
    //
    // Safe to populate: both consumers of /api/immich/random use `a.id` and
    // nothing else (background.js:54, screensaver.js:191), so slim()'s
    // city/state/country riding along changes no rendering. The ambient
    // substrate's captions come from the Daily Memories set, a different path.
    const body = { size: Math.min(count * 3, 100) };
    if (excludeScreenshots()) body.withExif = true;
    const res = await fetchWithTimeout(
      `${cfg.base}/api/search/random`,
      { method: "POST", headers: headers(cfg.key), body: JSON.stringify(body) },
      TIMEOUT_MS
    );
    if (!res.ok) return { ok: false, assets: [] };
    const arr = await res.json();
    const items = Array.isArray(arr) ? arr : (arr?.assets?.items ?? []);
    // ok:true even when the filter removes everything — Immich answered, and
    // "the draw held no usable stills" is a real answer worth not re-asking.
    return { ok: true, assets: items.filter(usableImage).slice(0, count).map(slim) };
  } catch {
    return { ok: false, assets: [] };
  }
}

// One taken-date window (metadata search is a contiguous range, so on-this-day
// is one query per past year). The window is ±halfWindowDays around the local
// calendar day — ±1 for the classic on-this-day (absorbs TZ slop), wider for the
// Daily Memories set so neighbouring-date candidates are actually fetched. The
// exact month/day match + nearest-day widening is done by the pure frontend
// filters (photoMemory.js) on localDateTime. withExif carries location along.
// Returns { ok, items } — one year's fetch can fail while its neighbours answer,
// and memoriesFeed needs to know that happened. See the header.
async function windowForYear(cfg, year, month, day, halfWindowDays = 1) {
  const after = new Date(year, month, day - halfWindowDays);
  const before = new Date(year, month, day + halfWindowDays + 1);
  try {
    const res = await fetchWithTimeout(
      `${cfg.base}/api/search/metadata`,
      {
        method: "POST",
        headers: headers(cfg.key),
        body: JSON.stringify({
          takenAfter: after.toISOString(),
          takenBefore: before.toISOString(),
          size: Math.min(20 + halfWindowDays * 20, 250),
          withExif: true,
          // Named faces ride along on the search that already runs — Immich
          // returns them inline, so captioning who is in a photo costs zero
          // extra requests (a per-asset lookup would have cost one each).
          withPeople: true
        })
      },
      TIMEOUT_MS
    );
    if (!res.ok) return { ok: false, items: [] };
    const data = await res.json();
    return { ok: true, items: (data?.assets?.items ?? []).filter(usableImage).map(slim) };
  } catch {
    return { ok: false, items: [] };
  }
}

/**
 * Assets taken around today's month/day across prior years — the raw feed for
 * "on this day" and the Daily Memories set. Over-fetched ±halfWindowDays around
 * each day; the caller (pure photoMemory.js) makes the exact match + widening.
 * Empty when unconfigured/down.
 */
export async function memoriesFeed(now = new Date(), opts = {}) {
  return (await memoriesFeedResult(now, opts)).assets;
}

/** memoriesFeed, plus whether every year's fetch actually succeeded. */
export async function memoriesFeedResult(now = new Date(), { yearsBack = 15, halfWindowDays = 1 } = {}) {
  const cfg = config();
  if (!cfg) return { ok: false, assets: [] };
  const month = now.getMonth();
  const day = now.getDate();
  const thisYear = now.getFullYear();

  const years = [];
  for (let y = thisYear - 1; y >= thisYear - yearsBack; y--) years.push(y);

  const perYear = await Promise.all(years.map((y) => windowForYear(cfg, y, month, day, halfWindowDays)));
  // Dedupe by id (a window can overlap another's edge).
  const seen = new Set();
  const out = [];
  for (const { items } of perYear) {
    for (const a of items) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  /* ⚠ ANY year failing makes the whole feed uncacheable, not just an empty one.
     A partial day — nine years answered, six timed out — is a plausible-looking
     result that would be pinned for an hour, and "some of your photos" is a
     harder failure to notice than none of them. */
  return { ok: perYear.every((r) => r.ok), assets: out };
}

// The classic on-this-day feed (±1 day) — kept as a thin wrapper so the existing
// /api/immich/on-this-day route and its callers are unchanged.
export function onThisDay(now = new Date(), opts = {}) {
  return memoriesFeed(now, { ...opts, halfWindowDays: 1 });
}

/** onThisDay, plus whether every year's fetch actually succeeded. */
export function onThisDayResult(now = new Date(), opts = {}) {
  return memoriesFeedResult(now, { ...opts, halfWindowDays: 1 });
}

/**
 * Assets taken within an explicit [after, before) window, newest first — the feed
 * the authoring portal browses by month. Same metadata search as on-this-day, just
 * over a caller-chosen range. Empty when unconfigured/down.
 * @param {string} afterISO  inclusive lower bound (ISO timestamp)
 * @param {string} beforeISO exclusive upper bound (ISO timestamp)
 * @param {number} size      max assets to return (Immich caps the page)
 * @returns {Promise<Array<{id:string, localDateTime:string|null}>>}
 */
export async function searchTaken(afterISO, beforeISO, size = 250) {
  return (await searchTakenResult(afterISO, beforeISO, size)).assets;
}

/** searchTaken, plus whether the fetch actually succeeded. */
export async function searchTakenResult(afterISO, beforeISO, size = 250) {
  const cfg = config();
  if (!cfg) return { ok: false, assets: [] };
  try {
    const res = await fetchWithTimeout(
      `${cfg.base}/api/search/metadata`,
      {
        method: "POST",
        headers: headers(cfg.key),
        body: JSON.stringify({ takenAfter: afterISO, takenBefore: beforeISO, size: Math.min(size, 1000) })
      },
      TIMEOUT_MS
    );
    if (!res.ok) return { ok: false, assets: [] };
    const data = await res.json();
    const items = (data?.assets?.items ?? []).filter(usableImage).map(slim);
    // Newest first — the way a person scans a month.
    items.sort((a, b) => String(b.localDateTime || "").localeCompare(String(a.localDateTime || "")));
    return { ok: true, assets: items };
  } catch {
    return { ok: false, assets: [] };
  }
}

/**
 * Every named person in the library. Only the names matter here — which given
 * names are shared, so a caption knows when "Mark" names nobody in particular.
 * Ids are not needed: the metadata search already carries each photo's people
 * inline. [] when unconfigured, unreachable, or when the API key lacks the
 * `person.read` permission (a 403), which the caller treats as "assume every
 * name is ambiguous" rather than guessing.
 */
export async function fetchPeopleNames() {
  const cfg = config();
  if (!cfg) return [];
  try {
    const res = await fetchWithTimeout(
      `${cfg.base}/api/people?withHidden=false&size=1000`,
      { headers: headers(cfg.key, false) },
      TIMEOUT_MS
    );
    if (!res.ok) return [];
    const data = await res.json();
    const list = Array.isArray(data?.people) ? data.people : [];
    return list.map((p) => String(p?.name || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Fetch a downscaled rendition (default the ~47 KB preview jpeg). Returns
 * { status, contentType, buffer } or null on failure. Never fetches the original.
 */
export async function fetchRendition(id, size = "preview") {
  const cfg = config();
  if (!cfg || !id) return null;
  try {
    const res = await fetchWithTimeout(
      `${cfg.base}/api/assets/${encodeURIComponent(id)}/thumbnail?size=${encodeURIComponent(size)}`,
      { headers: headers(cfg.key, false) },
      TIMEOUT_MS
    );
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    return { status: res.status, contentType: res.headers.get("content-type") || "image/jpeg", buffer };
  } catch {
    return null;
  }
}

/**
 * The untouched bytes of an asset — used ONLY by the overnight Live Photo
 * transcoder (services/liveMotion.js), never by anything on the render path.
 *
 * `/original`, deliberately, not `/video/playback`: measured on the live library
 * 2026-08-02, Immich serves them byte-identically (its transcode policy leaves
 * these alone), so `/original` avoids a pointless double-encode and any
 * dependence on that policy staying put.
 *
 * ⚠ Its own timeout, NOT the module's 6s TIMEOUT_MS. fetchWithTimeout's
 * AbortController aborts the BODY read too, and a motion part is 3.5-4.5 MB off
 * a Synology that may be spinning up — 6s kills it halfway through.
 */
const ORIGINAL_TIMEOUT_MS = 25_000;

export async function fetchOriginal(id) {
  const cfg = config();
  if (!cfg || !id) return null;
  try {
    const res = await fetchWithTimeout(
      `${cfg.base}/api/assets/${encodeURIComponent(id)}/original`,
      { headers: headers(cfg.key, false) },
      ORIGINAL_TIMEOUT_MS
    );
    if (!res.ok) return null;
    return { status: res.status, contentType: res.headers.get("content-type") || "", buffer: Buffer.from(await res.arrayBuffer()) };
  } catch {
    return null;
  }
}
