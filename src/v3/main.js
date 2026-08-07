/* ═══════════════════════════════════════════════════════════════════════════
   V3 BOOT.

   Phase 1 scope: the substrate, the tokens, the type, and depths 0 and 1.
   The composer (depth 2), the subjects (depth 3) and the voice lanes land in
   later phases — the mounts for them exist in index.html and are empty.
   ═══════════════════════════════════════════════════════════════════════════ */

import { getPosition } from "../js/vendor/suncalc.js";
import { initSubstrate, toCauses } from "./substrate/index.js";
import { initDepth, setDepth, DEPTH } from "./core/depth.js";
import { initPresenceLight } from "./core/presence-light.js";

/* Sun position only. City-level Brisbane, deliberately coarse: this repo is
   PUBLIC and its bundle is tracked, so no house-precise coordinate may appear
   in it. Solar altitude and azimuth differ by well under a thousandth of a
   degree across the whole metro area, so precision costs nothing here and
   would cost privacy. Weather comes from the server, which has the real ones. */
const CITY = { lat: -27.47, lon: 153.02 };

const el = {
  substrate: document.getElementById("substrate"),
  hour: document.getElementById("hour"),
  ground: document.getElementById("ground")
};

let substrate = null;
let weather = null;

/* ── The hour ───────────────────────────────────────────────────────────────
   Depth 0's only text. Ticks on the minute rather than the second: a seconds
   display on an always-on wall is a 1Hz repaint forever, and nobody in a
   kitchen has ever needed it.
─────────────────────────────────────────────────────────────────────────── */
function paintHour() {
  const d = new Date();
  const h = d.getHours() % 12 || 12;
  el.hour.textContent = `${h}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ── Night ──────────────────────────────────────────────────────────────────
   Driven by sun altitude, never by clock time. A cloudy 5pm in June and a
   clear 5pm in December are different rooms, and the screen should agree with
   whichever one you are standing in.
─────────────────────────────────────────────────────────────────────────── */
function sun() {
  const p = getPosition(new Date(), CITY.lat, CITY.lon);
  return { altitudeDeg: (p.altitude * 180) / Math.PI, azimuthRad: p.azimuth };
}

function syncSun() {
  const s = sun();
  const root = document.documentElement;

  // Night begins as the sun goes down, and the transition is a ramp rather
  // than a switch so nothing snaps in the corner of your eye.
  const night = s.altitudeDeg < -2;
  if (night) root.dataset.night = "1";
  else delete root.dataset.night;

  // Sun-agreed light: shadows on the surface point where the real sun is.
  root.style.setProperty("--sun-az", `${s.azimuthRad}rad`);
  root.style.setProperty("--sun-alt", s.altitudeDeg.toFixed(2));
  root.style.setProperty("--sun-warmth", Math.max(0, Math.min(1, (s.altitudeDeg + 6) / 18)).toFixed(3));

  return s;
}

function pushCauses() {
  const s = syncSun();
  if (!substrate) return;
  substrate.update(toCauses({
    sunAltitudeDeg: s.altitudeDeg,
    sunAzimuthRad: s.azimuthRad,
    windKph: weather?.now?.wind_kph ?? 0,
    // wind_bearing and cloud_pct DO NOT EXIST on /api/weather/now yet — the
    // route returns wind_kph but not direction, and no cloud cover at all.
    // Both are already in the Open-Meteo response the server throws away, so
    // this is an additive server change (with its contract test) rather than a
    // new upstream. Until it lands these fall back, and the fallback is stated
    // rather than hidden: a fixed bearing would make the drift LOOK caused
    // while being decorative, which is the one thing the substrate must not do.
    windBearingDeg: weather?.now?.wind_bearing ?? null,
    cloudPct: weather?.now?.cloud_pct ?? null,
    // condition.icon, not condition.code: the WMO tuple is
    // [label, category, intensity, thunder] and weatherService destructures
    // position 1 into a field it calls `icon`, but the value is the CATEGORY
    // string ("clear", "cloudy", "rain"...). `code` is the raw numeric code.
    category: weather?.now?.condition?.icon ?? null,
    intensity: weather?.now?.condition?.intensity ?? null
  }));
}

async function loadWeather() {
  try {
    const res = await fetch("/api/weather/now");
    if (!res.ok) return;
    weather = await res.json();
    pushCauses();
  } catch {
    // Upstreams are allowed to be down. The substrate keeps its last causes;
    // an atmosphere that freezes is far better than one that lies.
  }
}

function boot() {
  initDepth();
  initPresenceLight();

  substrate = initSubstrate(el.substrate);
  paintHour();
  pushCauses();
  loadWeather();

  // Init-once intervals only. Per-event timers are where this house has leaked
  // before; these are registered exactly once at startup and never re-created.
  setInterval(paintHour, 20_000);   // cheap, and keeps the minute honest
  setInterval(pushCauses, 60_000);  // sun moves; the field follows it
  setInterval(loadWeather, 600_000);

  setDepth(DEPTH.FIELD, "boot");

  window.__v3 = () => ({
    depth: window.__depth?.(),
    substrate: window.__substrate?.(),
    presence: window.__presenceLight?.(),
    weather: weather?.now?.condition?.label ?? null
  });

  console.info("V3 ready —", substrate?.backend ?? "no substrate");
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
