/* ═══════════════════════════════════════════════════════════════════════════
   SUBSTRATE — backend selection and the causes that drive it.

   Selection order is GL, then canvas 2D, and the fallback is silent by design:
   the surface above must never know or care which one it got.
   ═══════════════════════════════════════════════════════════════════════════ */

import { createGlSubstrate } from "./gl.js";
import { createCanvasSubstrate } from "./canvas2d.js";

/**
 * Map real-world readings onto the substrate's causes. Pure — this is the whole
 * translation layer between "what the weather is doing" and "what the field
 * looks like", and it holds the invariant that every visual property traces to
 * something the room can independently verify by looking out of a window.
 *
 * @param {object} src
 * @param {number} src.sunAltitudeDeg  from suncalc
 * @param {number} src.sunAzimuthRad   from suncalc
 * @param {number} src.windKph
 * @param {number|null} src.windBearingDeg  meteorological (direction wind comes FROM); null = unknown
 * @param {number|null} src.cloudPct        0-100; null = unknown, derive from category
 * @param {string} src.category        "clear" | "cloudy" | "rain" | "storm" | "fog" | ...
 * @param {string} src.intensity       "light" | "moderate" | "heavy" | null
 */
export function toCauses({
  sunAltitudeDeg = 0,
  sunAzimuthRad = 0,
  windKph = 0,
  windBearingDeg = null,
  cloudPct = null,
  category = null,
  intensity = null
} = {}) {
  // Altitude normalised so the interesting band (horizon to ~35 degrees, which
  // is the whole of a Brisbane winter day's useful light) uses most of the range.
  const sunAlt = Math.max(-1, Math.min(1, sunAltitudeDeg / 35));

  // Meteorological bearing is where wind comes FROM; the drift goes the other
  // way. Getting this backwards is invisible in review and obvious on the wall
  // to anyone who has just walked in out of the actual wind.
  // An UNKNOWN direction produces no drift at all, rather than a plausible
  // default one. A field drifting steadily north-east because that is what 0
  // happens to mean would be decoration wearing the costume of a cause — and
  // the whole contract of this surface is that nothing moves for a reason the
  // room cannot independently see.
  const known = typeof windBearingDeg === "number" && Number.isFinite(windBearingDeg);
  const rad = known ? ((windBearingDeg + 180) * Math.PI) / 180 : 0;
  const speed = known ? Math.max(0, Math.min(1, windKph / 45)) : 0;

  // The shader places the sun with cos(uSunAz), and suncalc measures azimuth
  // from SOUTH going west. Rotating by a quarter turn here makes that cos()
  // behave as sin(azimuth) — east on the left, west on the right, which is what
  // you see facing north, which is where the sun is from this hemisphere.
  // Done here rather than in the shader on purpose: the shader is byte-identical
  // to the version that was measured on the kiosk, and changing it voids that.
  const sunAz = sunAzimuthRad - Math.PI / 2;

  const rain = intensity === "heavy" ? 1 : intensity === "moderate" ? 0.6 : intensity === "light" ? 0.3 : 0;

  // Cloud, when the percentage is unavailable, comes from the condition
  // CATEGORY — coarser, but still real information rather than an invention.
  const BY_CATEGORY = { clear: 0.05, cloudy: 0.6, fog: 0.85, rain: 0.8, storm: 0.95, snow: 0.9 };
  const cloud = typeof cloudPct === "number" && Number.isFinite(cloudPct)
    ? Math.max(0, Math.min(1, cloudPct / 100))
    : (BY_CATEGORY[category] ?? 0.3);

  return {
    sunAlt,
    sunAz,
    wind: [Math.sin(rad) * speed, Math.cos(rad) * speed],
    cloud,
    rain
  };
}

export function initSubstrate(canvas, { forceBackend = null } = {}) {
  let impl = null;

  if (forceBackend !== "canvas2d") impl = createGlSubstrate(canvas);
  if (!impl) impl = createCanvasSubstrate(canvas);
  if (!impl) return null;

  // Context loss is not hypothetical on a box that runs for weeks: a GPU reset
  // or a driver hiccup takes the context away and it never comes back on its
  // own. Fall through to canvas 2D rather than leaving a dead black rectangle
  // where the atmosphere used to be.
  const onLost = (e) => {
    e.preventDefault();
    console.warn("substrate: WebGL context lost — falling back to canvas 2D");
    canvas.removeEventListener("webglcontextlost", onLost);
    try { impl.destroy(); } catch { /* the context is already gone */ }
    impl = createCanvasSubstrate(canvas);
    if (impl) impl.update({});
  };
  if (impl.backend === "webgl2") canvas.addEventListener("webglcontextlost", onLost);

  window.__substrate = () => ({ backend: impl.backend, renderer: impl.renderer, ...impl.stats() });

  return {
    update: (causes) => impl.update(causes),
    get backend() { return impl.backend; },
    destroy() {
      canvas.removeEventListener("webglcontextlost", onLost);
      impl.destroy();
    }
  };
}
