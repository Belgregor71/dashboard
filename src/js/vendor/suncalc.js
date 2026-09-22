/* ═══ V3-SHARED-RUNTIME ═════════════════════════════════════════════════════
   Loaded by BOTH surfaces: the incumbent (/) and V3 (/v3/).
   `src/js/` is not the old dashboard — it is V3's runtime library. A cleanup
   that retires "the legacy tree" takes this file out from under V3 with it.
   docs/design/V3-CUTOVER.md §1 · guarded by tests/v3-closure.spec.js
   ════════════════════════════════════════════════════════════════════════ */

/*
 * SunCalc minimal module (times only), adapted from Vladimir Agafonkin's SunCalc (MIT).
 * https://github.com/mourner/suncalc
 */

const PI = Math.PI;
const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const atan2 = Math.atan2;
const acos = Math.acos;
const rad = PI / 180;

const dayMs = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;
const e = rad * 23.4397;

function toJulian(date) {
  return date.valueOf() / dayMs - 0.5 + J1970;
}

function fromJulian(j) {
  return new Date((j + 0.5 - J1970) * dayMs);
}

function toDays(date) {
  return toJulian(date) - J2000;
}

function rightAscension(l, b) {
  return atan2(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
}

function declination(l, b) {
  return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
}

function solarMeanAnomaly(d) {
  return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M) {
  const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
  const P = rad * 102.9372;
  return M + C + P + PI;
}

function julianCycle(d, lw) {
  return Math.round(d - 0.0009 - lw / (2 * PI));
}

function approxTransit(Ht, lw, n) {
  return 0.0009 + (Ht + lw) / (2 * PI) + n;
}

function solarTransitJ(ds, M, L) {
  return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
}

function hourAngle(h, phi, d) {
  return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));
}

function observerAngle(height) {
  return -2.076 * Math.sqrt(height) / 60;
}

function getSetJ(h, lw, phi, dec, n, M, L) {
  const w = hourAngle(h, phi, dec);
  const a = approxTransit(w, lw, n);
  return solarTransitJ(a, M, L);
}

// Sun altitude above the horizon (radians), the standard SunCalc getPosition
// reduced to the altitude we need for the ambient-clock dim curve. Positive =
// above the horizon (day), negative = below (twilight → night).
function siderealTime(d, lw) {
  return rad * (280.16 + 360.9856235 * d) - lw;
}

function altitude(H, phi, dec) {
  return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
}

// Restored from upstream SunCalc — this trimmed copy had dropped it, so
// getPosition() returned altitude only and any caller reading `.azimuth` got
// undefined rather than an error. Measured from SOUTH, going west (upstream's
// convention), so: south 0, west +PI/2, east -PI/2.
function azimuth(H, phi, dec) {
  return atan2(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
}

export function getPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  // Additive: existing callers destructure `.altitude` and are unaffected.
  return { altitude: altitude(H, phi, dec), azimuth: azimuth(H, phi, dec) };
}

/* ── The moon — restored from upstream SunCalc (MIT) for the field's moon
   (features.v3FieldCauses, Living Window 2.0 Stage 3). Same conventions as
   getPosition above: radians, azimuth from SOUTH going west. Upstream's `atan`
   is atan2. Nothing here is new maths; it is the part of the file the trim
   had dropped. */
function sunCoords(d) {
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  return { dec: declination(L, 0), ra: rightAscension(L, 0) };
}

// Geocentric ecliptic coordinates of the moon.
function moonCoords(d) {
  const L = rad * (218.316 + 13.176396 * d); // ecliptic longitude
  const M = rad * (134.963 + 13.064993 * d); // mean anomaly
  const F = rad * (93.272 + 13.229350 * d);  // mean distance
  const l = L + rad * 6.289 * sin(M);         // longitude
  const b = rad * 5.128 * sin(F);             // latitude
  const dt = 385001 - 20905 * cos(M);         // distance to the moon, km
  return { ra: rightAscension(l, b), dec: declination(l, b), dist: dt };
}

// Atmospheric refraction near the horizon (radians in, radians out).
function astroRefraction(h) {
  if (h < 0) h = 0;
  return 0.0002967 / tan(h + 0.00312536 / (h + 0.08901179));
}

export function getMoonPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const c = moonCoords(d);
  const H = siderealTime(d, lw) - c.ra;
  let h = altitude(H, phi, c.dec);
  h += astroRefraction(h);
  return { azimuth: azimuth(H, phi, c.dec), altitude: h, distance: c.dist };
}

/** fraction: 0 new .. 1 full. phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter. */
export function getMoonIllumination(date) {
  const d = toDays(date);
  const s = sunCoords(d);
  const m = moonCoords(d);
  const sdist = 149598000; // distance from Earth to the sun, km
  const phi = acos(sin(s.dec) * sin(m.dec) + cos(s.dec) * cos(m.dec) * cos(s.ra - m.ra));
  const inc = atan2(sdist * sin(phi), m.dist - sdist * cos(phi));
  const angle = atan2(cos(s.dec) * sin(s.ra - m.ra), sin(s.dec) * cos(m.dec) - cos(s.dec) * sin(m.dec) * cos(s.ra - m.ra));
  return { fraction: (1 + cos(inc)) / 2, phase: 0.5 + 0.5 * inc * (angle < 0 ? -1 : 1) / PI, angle };
}

export function getTimes(date, lat, lon, height = 0) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const dh = observerAngle(height);
  const d = toDays(date);
  const n = julianCycle(d, lw);
  const ds = approxTransit(0, lw, n);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);

  const Jnoon = solarTransitJ(ds, M, L);
  const h0 = (0 + dh) * rad;
  const Jset = getSetJ(h0, lw, phi, dec, n, M, L);
  const Jrise = Jnoon - (Jset - Jnoon);

  return {
    sunrise: fromJulian(Jrise),
    sunset: fromJulian(Jset),
    solarNoon: fromJulian(Jnoon)
  };
}
