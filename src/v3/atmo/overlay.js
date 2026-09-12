/* ═══ Direction A — THE OVERLAY (features.v3AtmoOverlay) ═════════════════════
   The incumbent's answer, moved down the stack. The incumbent drew its weather
   at z390/400 — above everything, text included. Here it is one thin layer at
   z4: above the archive (3) and the full-bleed photograph (1), below the
   presence cool (5), the ground caption (6) and the stage (10). So the weather
   falls across the card AND the mat, like rain on the pane in front of a
   picture, and never across a word.

   Three children, all driven by the host's root variables in css/atmosphere.css:
     __rain   one tiled streak texture, painted ONCE here, then translated by a
              compositor-only keyframe while `data-atmo-raining` is set. No rAF,
              no per-frame JS (§5.4): "motion implemented in JS per frame is the
              wrong implementation".
     __warm   a warm wash from the top, its opacity following --atmo-warmth.
     __flash  the incumbent strike curve on a cool horizon glow, one-shot.
   No mix-blend-mode anywhere: a blend over a moving layer is the measured
   3.0-4.3-point defect this surface has already paid for (HOST-BASELINES.md).
   ═══════════════════════════════════════════════════════════════════════════ */

/** Tile size of the rain texture — the fall keyframe moves exactly one tile. */
export const RAIN_TILE = 512;

let host = null;

/* Streaks, painted once into a canvas and handed to CSS as an image. Seeded, so
   the pane is the same pane on every boot and a screenshot is comparable. */
export function rainTexture(doc = document, seed = 7) {
  const c = doc.createElement("canvas");
  c.width = RAIN_TILE;
  c.height = RAIN_TILE;
  const g = c.getContext("2d");
  if (!g) return "";
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.lineCap = "round";
  for (let i = 0; i < 70; i++) {
    const x = rnd() * RAIN_TILE;
    const y = rnd() * RAIN_TILE;
    const len = 28 + rnd() * 60;
    const a = 0.10 + rnd() * 0.22;
    g.strokeStyle = `rgba(215, 228, 245, ${a.toFixed(3)})`;
    g.lineWidth = 0.8 + rnd() * 1.1;
    // A slight lean, drawn into the texture: the keyframe moves straight down,
    // so the tile stays seamless and the slant costs nothing per frame.
    for (const dy of [0, -RAIN_TILE, RAIN_TILE]) {
      g.beginPath();
      g.moveTo(x, y + dy);
      g.lineTo(x - len * 0.14, y + dy + len);
      g.stroke();
    }
  }
  return c.toDataURL("image/png");
}

export const overlay = {
  name: "overlay",
  mount() {
    if (host) return;
    host = document.createElement("div");
    host.className = "atmo-overlay";
    host.setAttribute("aria-hidden", "true");
    const rain = document.createElement("div");
    rain.className = "atmo-overlay__rain";
    const tex = rainTexture();
    if (tex) rain.style.backgroundImage = `url(${tex})`;
    const warm = document.createElement("div");
    warm.className = "atmo-overlay__warm";
    const flash = document.createElement("div");
    flash.className = "atmo-overlay__flash";
    host.append(warm, rain, flash);
    document.body.appendChild(host);
  },
  unmount() {
    host?.remove();
    host = null;
  }
};
