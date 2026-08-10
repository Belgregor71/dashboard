/* ═══════════════════════════════════════════════════════════════════════════
   SUBSTRATE — backend selection and the causes that drive it.

   Selection order is GL, then canvas 2D, and the fallback is silent by design:
   the surface above must never know or care which one it got.

   ── The ?__backend= seam ────────────────────────────────────────────────────
   `/v3/?__backend=canvas2d` boots the fallback on purpose. Headless Chromium
   and the G11 both always have WebGL2, so without a way to ASK for it the 2D
   backend is a hundred lines that never run anywhere — which is exactly how it
   came to be shipped broken (see below). The seam is the only way to look at
   the fallback on the glass, and it works over CDP for the same reason
   ?__boom= does.
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

/* The last resort, and it is a real object rather than a null. Everything above
   the substrate calls update() and setPaused() unconditionally — that is the
   whole "never know or care" contract — so a backend that could not be built
   must still answer them. A null here is an uncaught TypeError on every causes
   tick for as long as the page lives. */
const INERT = {
  backend: "none",
  renderer: "none",
  update() {},
  setPaused() {},
  stats: () => ({ frames: 0, seconds: 0, animating: false, paused: false }),
  destroy() {}
};

/**
 * ⚠ A CANVAS KEEPS ITS CONTEXT TYPE FOR LIFE. `getContext("2d")` on an element
 * that has ever held a webgl2 context returns **null**, lost context or not —
 * so the fallback cannot be built on the same node the shader was using. The
 * only way back to 2D is a different element.
 *
 * Cloned shallow, so the id, the class and the 480x270 backing store come with
 * it and the CSS that positions the field keeps matching. Nothing else in V3
 * holds a reference to the node after boot (main.js passes `el.substrate` in
 * and never touches it again) — if that ever changes, this is where it breaks.
 */
function freshCanvas(old) {
  const next = old.cloneNode(false);
  old.replaceWith(next);
  return next;
}

export function initSubstrate(canvas, { forceBackend = null } = {}) {
  let impl = null;

  // The live node, which is NOT necessarily the one that was passed in: the
  // context-loss path below swaps the element out.
  let surface = canvas;

  // Held here as well as in the backend, because the backend can be REPLACED
  // under us by the context-loss path below. A GPU reset at 3am that quietly
  // resumed a 15fps loop against a powered-down panel is exactly the class of
  // failure this phase exists to stop, and it would leave no trace by morning.
  let paused = false;

  if (forceBackend !== "canvas2d") impl = createGlSubstrate(surface);
  // A getContext("webgl2") that returned null leaves the element unclaimed, so
  // the cold-boot fallback can still use it — unlike the loss path below, where
  // the context was successfully created and the element is spent.
  if (!impl) impl = createCanvasSubstrate(surface);
  if (!impl) return null;

  // Context loss is not hypothetical on a box that runs for weeks: a GPU reset
  // or a driver hiccup takes the context away and it never comes back on its
  // own. Fall through to canvas 2D rather than leaving a dead black rectangle
  // where the atmosphere used to be.
  const onLost = (e) => {
    e.preventDefault();
    console.warn("substrate: WebGL context lost — falling back to canvas 2D");
    surface.removeEventListener("webglcontextlost", onLost);
    try { impl.destroy(); } catch { /* the context is already gone */ }
    surface = freshCanvas(surface);
    try {
      impl = createCanvasSubstrate(surface) ?? INERT;
    } catch (err) {
      // This rebuild runs inside an event dispatch, so a throw here is an
      // uncaught page error AND leaves the dead GL backend in place — a field
      // that has stopped and a console full of noise, from one bad frame.
      console.warn("substrate: canvas 2D refused after context loss", err);
      impl = INERT;
    }
    // Inherit the pause BEFORE the first update, or the replacement draws a
    // frame the dark panel cannot show and then starts its own loop.
    impl.setPaused(paused);
    impl.update({});
  };
  if (impl.backend === "webgl2") surface.addEventListener("webglcontextlost", onLost);

  window.__substrate = () => ({ backend: impl.backend, renderer: impl.renderer, ...impl.stats() });

  return {
    update: (causes) => impl.update(causes),
    setPaused(next) {
      paused = Boolean(next);
      impl.setPaused(paused);
    },
    get backend() { return impl.backend; },
    destroy() {
      surface.removeEventListener("webglcontextlost", onLost);
      impl.destroy();
    }
  };
}
