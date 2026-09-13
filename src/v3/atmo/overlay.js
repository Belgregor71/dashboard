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

/** The panel the starfield is painted for — V3's fixed 1920x1080 stage. */
export const SKY_W = 1920;
export const SKY_H = 1080;
/** The incumbent's field (atmoFx/runtime.js STAR_COUNT). */
export const STAR_COUNT = 110;

/* A clear night's stars, painted ONCE (v3AtmoNightSky). The incumbent's field:
   110 stars in the top 2-72% of the sky, radius 0.5-1.5, alpha 0.2-0.7.
   Seeded for the same reason as the rain: a screenshot is comparable. Returns
   the image and the star positions, so a twinkle lands on a star that exists. */
export function starField(doc = document, seed = 11) {
  const c = doc.createElement("canvas");
  c.width = SKY_W;
  c.height = SKY_H;
  const g = c.getContext("2d");
  if (!g) return { url: "", stars: [] };
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const stars = [];
  for (let i = 0; i < STAR_COUNT; i++) {
    const x = rnd() * SKY_W;
    const y = (0.02 + rnd() * 0.70) * SKY_H;
    const r = 0.5 + rnd();
    const a = 0.2 + rnd() * 0.5;
    g.fillStyle = `rgba(236, 240, 250, ${a.toFixed(3)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    stars.push({ x, y });
  }
  return { url: c.toDataURL("image/png"), stars };
}

let stars = [];

const child = (cls) => {
  const el = document.createElement("div");
  el.className = cls;
  return el;
};

export const overlay = {
  name: "overlay",
  /** `opts` carries the step-3 flags the host read; a child is only built for
      an effect that is on, so a flag-off effect adds no node. */
  mount(opts = {}) {
    if (host) return;
    host = document.createElement("div");
    host.className = "atmo-overlay";
    host.setAttribute("aria-hidden", "true");
    const rain = child("atmo-overlay__rain");
    const tex = rainTexture();
    if (tex) rain.style.backgroundImage = `url(${tex})`;
    const layers = [child("atmo-overlay__warm")];
    if (opts.textures) layers.push(child("atmo-overlay__texture"), child("atmo-overlay__fog"), child("atmo-overlay__heat"));
    layers.push(rain, child("atmo-overlay__flash"));
    host.append(...layers);
    document.body.appendChild(host);

    if (opts.nightSky) {
      const field = starField();
      stars = field.stars;
      // On the ROOT, read by the archive's mat — the stars live behind the
      // card, never on the photograph (css/atmosphere.css, the night sky).
      if (field.url) document.documentElement.style.setProperty("--atmo-stars", `url(${field.url})`);
    }
  },
  /** The painted stars, for the twinkle to land on. */
  stars() {
    return stars;
  },
  unmount() {
    host?.remove();
    host = null;
    stars = [];
    document.documentElement.style.removeProperty("--atmo-stars");
  }
};
