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

export function getPosition(date, lat, lon) {
  const lw = rad * -lon;
  const phi = rad * lat;
  const d = toDays(date);
  const M = solarMeanAnomaly(d);
  const L = eclipticLongitude(M);
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  return { altitude: altitude(H, phi, dec) };
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
