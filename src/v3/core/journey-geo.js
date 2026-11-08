/* ═══════════════════════════════════════════════════════════════════════════
   THE MEMORY JOURNEY — what the wall is allowed to claim (features.v3MemoryJourney)

   Pure: no DOM, no fetch. Every decision that could quietly put a false fact on
   the wall is here so it unit-tests in plain node — which words appear, and
   whether a map appears and at what precision. journey.js only paints answers.

   ⚠ NOTHING HERE INFERS. A place comes from Immich's own city/state/country, a
   name from the server's (already privacy-filtered) `people`, a year from
   `localDateTime`. No filename, no visual content, no guess from a city name.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Immich's country strings vs Natural Earth's short names. Immich has been
   seen sending plain English ("Thailand", "United Arab Emirates"); these cover
   the ISO-style long forms it can also produce. An unmatched name is not an
   error — it only means no country shape, and a point plan does not need one. */
const COUNTRY_ALIASES = {
  "united states": "United States of America",
  "usa": "United States of America",
  "viet nam": "Vietnam",
  "korea, republic of": "South Korea",
  "republic of korea": "South Korea",
  "korea, democratic people's republic of": "North Korea",
  "russian federation": "Russia",
  "czech republic": "Czechia",
  "bosnia and herzegovina": "Bosnia and Herz.",
  "dominican republic": "Dominican Rep.",
  "taiwan, province of china": "Taiwan",
  "iran, islamic republic of": "Iran",
  "lao people's democratic republic": "Laos",
  "tanzania, united republic of": "Tanzania",
  "ivory coast": "Côte d'Ivoire",
  "cote d'ivoire": "Côte d'Ivoire",
  "great britain": "United Kingdom",
  "england": "United Kingdom",
  "scotland": "United Kingdom",
  "wales": "United Kingdom",
  "syrian arab republic": "Syria",
  "bolivia, plurinational state of": "Bolivia",
  "venezuela, bolivarian republic of": "Venezuela",
  "moldova, republic of": "Moldova",
  "macedonia": "North Macedonia",
  "brunei darussalam": "Brunei",
  "solomon islands": "Solomon Is.",
  "central african republic": "Central African Rep.",
  "democratic republic of the congo": "Dem. Rep. Congo",
  "congo, the democratic republic of the": "Dem. Rep. Congo",
  "south sudan": "S. Sudan",
  "equatorial guinea": "Eq. Guinea",
  "falkland islands": "Falkland Is.",
  "western sahara": "W. Sahara"
};

const norm = (s) => String(s ?? "").trim().toLowerCase();

export const isAustralia = (country) => /austral/i.test(String(country ?? ""));

/* ── The world, decoded once ─────────────────────────────────────────────── */

/**
 * Decode journey-world.js's delta rings into absolute [x0,y0,x1,y1,...] lists
 * (tenths of a degree; x = (lon+180)*10, y = (90-lat)*10) with each country's
 * bounding box and its LARGEST ring's box — "France" framed on France, not on
 * France plus French Guiana.
 */
export function decodeWorld(countries) {
  return (countries ?? []).map(([name, rings]) => {
    const abs = rings.map((r) => {
      const out = new Array(r.length);
      let x = 0;
      let y = 0;
      for (let i = 0; i < r.length; i += 2) {
        x += r[i];
        y += r[i + 1];
        out[i] = x;
        out[i + 1] = y;
      }
      return out;
    });
    let main = null;
    let mainArea = -1;
    const all = [Infinity, Infinity, -Infinity, -Infinity];
    for (const r of abs) {
      const b = bbox(r);
      all[0] = Math.min(all[0], b[0]); all[1] = Math.min(all[1], b[1]);
      all[2] = Math.max(all[2], b[2]); all[3] = Math.max(all[3], b[3]);
      const area = (b[2] - b[0]) * (b[3] - b[1]);
      if (area > mainArea) { mainArea = area; main = b; }
    }
    return { name, key: norm(name), rings: abs, bbox: all, main };
  });
}

function bbox(r) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i];
    if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1];
    if (r[i + 1] > y1) y1 = r[i + 1];
  }
  return [x0, y0, x1, y1];
}

/** Even-odd ray cast. Rings are closed implicitly. */
function inRing(r, x, y) {
  let inside = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Which country polygon contains the point, or null (at sea, on a coast the
 *  1:110m outline misses, or no world loaded). Unwrapped rings are tried at
 *  x and x+3600 so Chukotka and eastern Fiji still answer. */
export function countryAt(world, x, y) {
  for (const c of world ?? []) {
    for (const xx of [x, x + 3600]) {
      if (xx < c.bbox[0] || xx > c.bbox[2] || y < c.bbox[1] || y > c.bbox[3]) continue;
      if (c.rings.some((r) => inRing(r, xx, y))) return c;
    }
  }
  return null;
}

export function findCountry(world, name) {
  const key = norm(name);
  if (!key) return null;
  const want = norm(COUNTRY_ALIASES[key] ?? key);
  return (world ?? []).find((c) => c.key === want) ?? null;
}

/** Real coordinates, or null. (0,0) is "null island" — a GPS fault, not Africa. */
export function pointOf(asset) {
  const { lat, lng } = asset ?? {};
  if (typeof lat !== "number" || typeof lng !== "number") return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null;
  return { x: (lng + 180) * 10, y: (90 - lat) * 10, lat, lng };
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * WHETHER A MAP APPEARS, AND HOW PRECISE IT MAY CLAIM TO BE.
 *
 *   point    coordinates we trust, outside Australia → framed on the region,
 *            a pin, a gentle move towards it
 *   country  a non-Australian country we can draw but no coordinates → the
 *            country's shape lit, NO pin (a pin would claim precision we lack)
 *   null     anything else — no map, the photograph arrives on its own
 *
 * Refusals, each deliberate:
 *   · no country and no coordinates                → null
 *   · country says Australia                       → null (not overseas)
 *   · coordinates land inside Australia's outline  → null, whatever the
 *     country string says: the two disagree, and disagreement is not confidence
 *   · no country string, coordinates at sea or on a coast the 1:110m outline
 *     misses                                       → null
 *   · country-only and the name matches no shape   → null
 *
 * Frames are { cx, cy, w } in tenths of a degree (w = visible longitude span).
 *
 * @param {object} asset  one on-this-day asset
 * @param {Array} world   decodeWorld() output, or null when it is not loaded
 */
export function mapPlan(asset, world) {
  if (!asset || !world?.length) return null;
  const pt = pointOf(asset);
  const named = asset.country ? String(asset.country).trim() : "";
  if (named && isAustralia(named)) return null;

  if (pt) {
    const under = countryAt(world, pt.x, pt.y);
    if (under && isAustralia(under.name)) return null;
    // A named country is trusted as the source; with none, the point must
    // land on land we can name.
    const country = (named && findCountry(world, named)) || (!named ? under : null);
    if (!named && !under) return null;

    const box = country?.main;
    const span = box ? box[2] - box[0] : 200;
    const w = clamp(span * 1.8, 180, 700);
    // Start on the country (if the point is in it) so the move reads as
    // arriving at somewhere within somewhere.
    let cx = pt.x;
    let cy = pt.y;
    if (box && pt.x >= box[0] - 20 && pt.x <= box[2] + 20) {
      cx = (box[0] + box[2]) / 2;
      cy = (box[1] + box[3]) / 2;
    }
    return {
      precision: "point",
      country: country?.name ?? null,
      point: { x: pt.x, y: pt.y },
      start: { cx, cy, w },
      mini: { cx: pt.x, cy: pt.y, w: clamp(span * 2.6, 260, 1000) }
    };
  }

  const country = named ? findCountry(world, named) : null;
  if (!country) return null;
  const b = country.main;
  const span = b[2] - b[0];
  const frame = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, w: clamp(span * 1.7, 120, 900) };
  return {
    precision: "country",
    country: country.name,
    point: null,
    start: frame,
    mini: { ...frame, w: clamp(span * 2.4, 200, 1100) }
  };
}

/**
 * The SVG for a frame: viewBox in world units, local aspect corrected by the
 * frame's own latitude (an equirectangular map is honest about adjacency and
 * this keeps shapes from looking stretched at Europe's latitudes).
 *
 * @returns {{viewBox:string, kx:number, ky:number, x0:number, y0:number, paths:Array<{d:string, lit:boolean}>}}
 */
export function frameGeometry(world, frame, pxW, pxH, litName = null) {
  const lat = 90 - frame.cy / 10;
  const cos = clamp(Math.cos((lat * Math.PI) / 180), 0.35, 1);
  const w = frame.w;
  const kx = pxW / w;
  const ky = kx / cos;
  const h = pxH / ky;
  const x0 = frame.cx - w / 2;
  const y0 = frame.cy - h / 2;
  const x1 = x0 + w;
  const y1 = y0 + h;
  const paths = [];
  for (const c of world ?? []) {
    // Only what can be seen — a frame over Thailand builds ~15 paths, not 176.
    let d = "";
    for (const shift of [0, -3600, 3600]) {
      for (const r of c.rings) {
        const b = bbox(r);
        if (b[2] + shift < x0 || b[0] + shift > x1 || b[3] < y0 || b[1] > y1) continue;
        d += "M" + r[0] + shift + " " + r[1];
        for (let i = 2; i < r.length; i += 2) d += "L" + (r[i] + shift) + " " + r[i + 1];
        d += "Z";
      }
    }
    if (d) paths.push({ d, lit: litName !== null && c.name === litName });
  }
  return { viewBox: `${x0} ${y0} ${w} ${h}`, kx, ky, x0, y0, paths };
}

/* ── The words ──────────────────────────────────────────────────────────── */

/** The memory's year, from the ISO string only — never a sliced number. */
export function yearOf(asset) {
  const raw = asset?.localDateTime;
  const y = typeof raw === "string" ? raw.slice(0, 4) : "";
  return /^\d{4}$/.test(y) ? y : null;
}

const MAX_PLACE_PART = 32;

/**
 * "Ko Samui, Thailand" overseas, "Nudgee, Queensland" at home. Each part only
 * if real; a part that repeats another is dropped ("Singapore, Singapore");
 * an over-long city (Immich sometimes sends a suburb like "Paris 16 Passy" or
 * a resort strip) yields to the region rather than wrapping. Never "Unknown".
 */
export function placeLine(asset) {
  const clean = (s) => String(s ?? "").trim();
  const city = clean(asset?.city);
  const state = clean(asset?.state);
  const country = clean(asset?.country);
  const overseas = country && !isAustralia(country);
  const parts = [];
  const okCity = city && city.length <= MAX_PLACE_PART ? city : "";
  if (overseas) {
    // No city: the state still says where in the country ("Surat Thani").
    parts.push(okCity || state, country);
  } else {
    parts.push(okCity, state || (!okCity ? country : ""));
  }
  const out = [];
  for (const p of parts) {
    if (!p) continue;
    // Exact repeats only: "Île-de-France, France" is two facts, not one twice.
    if (out.some((q) => norm(q) === norm(p))) continue;
    out.push(p);
  }
  return out.length ? out.join(", ") : null;
}

const MAX_NAMES = 3;

/**
 * "Greg · Brett". The server has already removed hidden names and may have
 * rewritten a set of names into one phrase ("our niece Melanie"); this only
 * trims, de-duplicates and caps — it never adds a name.
 */
export function namesLine(people) {
  const names = [...new Set((people ?? []).map((p) => String(p ?? "").trim()).filter(Boolean))];
  if (!names.length) return null;
  if (names.length <= MAX_NAMES) return names.join(" · ");
  const rest = names.length - MAX_NAMES;
  return `${names.slice(0, MAX_NAMES).join(" · ")} and ${rest} other${rest === 1 ? "" : "s"}`;
}

/* ── The photograph's box ───────────────────────────────────────────────── */

/* Within this band a cover crop loses at most ~18% of one axis, which a
   photograph composed for 3:2 or 16:9 survives. Outside it (4:3, square,
   portrait, panorama) the whole picture is shown on its own colour. */
export const COVER_MIN = 1.45;
export const COVER_MAX = 2.2;

/**
 * How the photograph sits on a W×H wall. `cover` fills it; `contain` shows all
 * of it centred over the photograph's own blurred colour. No focal point is
 * guessed: without reliable subject data, keeping the whole frame is the honest
 * choice.
 * @returns {{mode:"cover"|"contain", x:number, y:number, w:number, h:number}}
 */
export function photoFit(aspect, W = 1920, H = 1080) {
  const a = Number(aspect);
  if (!Number.isFinite(a) || a <= 0) return { mode: "contain", x: 0, y: 0, w: W, h: H };
  if (a >= COVER_MIN && a <= COVER_MAX) {
    const w = Math.max(W, H * a);
    const h = Math.max(H, W / a);
    return { mode: "cover", x: (W - w) / 2, y: (H - h) / 2, w, h };
  }
  const w = Math.min(W, H * a);
  const h = Math.min(H, W / a);
  return { mode: "contain", x: (W - w) / 2, y: (H - h) / 2, w, h };
}
