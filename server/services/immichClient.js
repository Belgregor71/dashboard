import { fetchWithTimeout } from "../utils/fetch.js";

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

// A displayable still: a real image, not trashed/archived, with an id.
function usableImage(a) {
  if (!(a && a.id && a.type === "IMAGE" && !a.isTrashed && !a.isArchived)) return false;
  if (excludeScreenshots() && isScreenshot(a)) return false;
  return true;
}

function slim(a) {
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
    people: (a.people || []).map((p) => String(p?.name || "").trim()).filter(Boolean)
  };
}

/** Random still images. Over-fetches then filters, since videos/trashed slip in. */
export async function searchRandom(count = 12) {
  const cfg = config();
  if (!cfg) return [];
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
    if (!res.ok) return [];
    const arr = await res.json();
    const items = Array.isArray(arr) ? arr : (arr?.assets?.items ?? []);
    return items.filter(usableImage).slice(0, count).map(slim);
  } catch {
    return [];
  }
}

// One taken-date window (metadata search is a contiguous range, so on-this-day
// is one query per past year). The window is ±halfWindowDays around the local
// calendar day — ±1 for the classic on-this-day (absorbs TZ slop), wider for the
// Daily Memories set so neighbouring-date candidates are actually fetched. The
// exact month/day match + nearest-day widening is done by the pure frontend
// filters (photoMemory.js) on localDateTime. withExif carries location along.
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
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.assets?.items ?? []).filter(usableImage).map(slim);
  } catch {
    return [];
  }
}

/**
 * Assets taken around today's month/day across prior years — the raw feed for
 * "on this day" and the Daily Memories set. Over-fetched ±halfWindowDays around
 * each day; the caller (pure photoMemory.js) makes the exact match + widening.
 * Empty when unconfigured/down.
 */
export async function memoriesFeed(now = new Date(), { yearsBack = 15, halfWindowDays = 1 } = {}) {
  const cfg = config();
  if (!cfg) return [];
  const month = now.getMonth();
  const day = now.getDate();
  const thisYear = now.getFullYear();

  const years = [];
  for (let y = thisYear - 1; y >= thisYear - yearsBack; y--) years.push(y);

  const perYear = await Promise.all(years.map((y) => windowForYear(cfg, y, month, day, halfWindowDays)));
  // Dedupe by id (a window can overlap another's edge).
  const seen = new Set();
  const out = [];
  for (const list of perYear) {
    for (const a of list) {
      if (seen.has(a.id)) continue;
      seen.add(a.id);
      out.push(a);
    }
  }
  return out;
}

// The classic on-this-day feed (±1 day) — kept as a thin wrapper so the existing
// /api/immich/on-this-day route and its callers are unchanged.
export function onThisDay(now = new Date(), opts = {}) {
  return memoriesFeed(now, { ...opts, halfWindowDays: 1 });
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
  const cfg = config();
  if (!cfg) return [];
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
    if (!res.ok) return [];
    const data = await res.json();
    const items = (data?.assets?.items ?? []).filter(usableImage).map(slim);
    // Newest first — the way a person scans a month.
    items.sort((a, b) => String(b.localDateTime || "").localeCompare(String(a.localDateTime || "")));
    return items;
  } catch {
    return [];
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
