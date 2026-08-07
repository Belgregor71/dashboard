/* ═══════════════════════════════════════════════════════════════════════════
   SUBSTRATE — canvas 2D backend. THE FALLBACK, AND IT IS BUILT FIRST.

   This exists so the surface is never hostage to the shader. If WebGL is
   unavailable, if the context is lost and does not come back, or if the GL
   backend ever loses its measurement, this takes over and nothing above it
   changes — same 480x270 backing store, same cause-driven redraw contract,
   same field, slightly less depth in it.

   Canvas 2D at DPR 1 has already A/B'd at 0.0% marginal cost in this house, so
   this is the known-safe floor rather than a theoretical one.
   ═══════════════════════════════════════════════════════════════════════════ */

const DEFAULTS = { sunAlt: 0, sunAz: 0, wind: [0, 0], cloud: 0.3, rain: 0 };

export function createCanvasSubstrate(canvas) {
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return null;

  const W = canvas.width;
  const H = canvas.height;

  /* One tiled noise sheet, generated once. The dither is not decoration: large
     near-black vertical gradients band visibly on an 8-bit panel, and the
     banding is more distracting than the gradient is pleasant. */
  const noise = document.createElement("canvas");
  noise.width = noise.height = 64;
  const nctx = noise.getContext("2d");
  const img = nctx.createImageData(64, 64);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 118 + Math.random() * 20;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 8;
  }
  nctx.putImageData(img, 0, 0);
  const noisePattern = ctx.createPattern(noise, "repeat");

  let causes = { ...DEFAULTS };
  let raf = null;
  let last = 0;
  let frames = 0;
  const t0 = performance.now();

  const moving = () => causes.rain > 0.02 || Math.hypot(causes.wind[0], causes.wind[1]) > 0.05;

  function draw() {
    const t = (performance.now() - t0) / 1000;
    const drift = (causes.wind[0] * t * 0.9) % W;

    // Horizon: warm below, cool above, hinged on real sun altitude.
    const g = ctx.createLinearGradient(0, H, 0, 0);
    const lift = Math.max(-0.2, Math.min(1, causes.sunAlt));
    g.addColorStop(0, `rgb(${74 - causes.rain * 20}, ${51 - causes.rain * 10}, ${33})`);
    g.addColorStop(0.55 + lift * 0.12, "rgb(38, 36, 40)");
    g.addColorStop(1, "rgb(20, 23, 33)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // The sun's own light, placed by real azimuth. Drawn only when it is up.
    if (causes.sunAlt > -0.15) {
      const sx = W * (0.5 + Math.cos(causes.sunAz) * 0.42) + drift * 0.04;
      const sy = H * (1 - (lift * 0.7 + 0.12));
      const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, W * 0.42);
      const a = 0.30 * (1 - causes.cloud * 0.7) * Math.min(1, (causes.sunAlt + 0.15) / 0.5);
      sg.addColorStop(0, `rgba(214, 143, 71, ${a.toFixed(3)})`);
      sg.addColorStop(1, "rgba(214, 143, 71, 0)");
      ctx.fillStyle = sg;
      ctx.fillRect(0, 0, W, H);
    }

    // Cloud: two slow offset veils, both moved by the actual wind vector.
    if (causes.cloud > 0.02) {
      for (let i = 0; i < 2; i++) {
        const cx = ((drift * (0.6 + i * 0.5)) % (W * 1.5)) - W * 0.25;
        const cy = H * (0.28 + i * 0.3);
        const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.55);
        cg.addColorStop(0, `rgba(33, 34, 39, ${(causes.cloud * 0.34).toFixed(3)})`);
        cg.addColorStop(1, "rgba(33, 34, 39, 0)");
        ctx.fillStyle = cg;
        ctx.fillRect(0, 0, W, H);
      }
    }

    // Vignette by plain alpha — never mix-blend-mode. An `overlay` vignette was
    // measured in this house at 4.3% of a core for a texture that never
    // changes, because it forces the whole stack beneath to re-blend per frame.
    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, W * 0.72);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.55)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);

    if (noisePattern) {
      ctx.fillStyle = noisePattern;
      ctx.fillRect(0, 0, W, H);
    }
    frames++;
  }

  const FRAME_MS = 66;
  function loop(now) {
    if (!moving()) { raf = null; return; }
    if (now - last >= FRAME_MS) { last = now; draw(); }
    raf = requestAnimationFrame(loop);
  }

  return {
    backend: "canvas2d",
    renderer: "canvas2d",
    update(next) {
      causes = { ...causes, ...next };
      draw();
      if (moving() && raf === null) raf = requestAnimationFrame(loop);
    },
    stats: () => ({ frames, seconds: (performance.now() - t0) / 1000, animating: raf !== null }),
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    }
  };
}
