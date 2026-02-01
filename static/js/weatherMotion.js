// static/js/weatherMotion.js
import { categoryForWeatherCode } from "./weatherPrompts.js";

let rafId = null;
let resizeHandler = null;

export function startWeatherMotion({ code }) {
  stopWeatherMotion();

  const category = categoryForWeatherCode(code);

  const canvas = document.getElementById("wx-particles");
  const flash = document.getElementById("wx-flash");
  if (!canvas || !flash) return;

  const ctx = canvas.getContext("2d", { alpha: true });

  const DPR = Math.min(window.devicePixelRatio || 1, 2); // keep Pi happy
  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = Math.floor(w * DPR);
    canvas.height = Math.floor(h * DPR);
  }
  resize();
  resizeHandler = resize;
  window.addEventListener("resize", resizeHandler, { passive: true });

  // Particle presets (tuned for performance)
  const presets = {
    drizzle: { count: 180, speed: 1.2, size: 1.0, angle: -0.35 },
    rain: { count: 320, speed: 2.4, size: 1.2, angle: -0.55 },
    showers: { count: 380, speed: 2.8, size: 1.3, angle: -0.7 },
    snow: { count: 220, speed: 0.7, size: 2.2, angle: -0.1, drift: 0.25 },
    fog: { count: 70, speed: 0.25, size: 18, angle: 0.0, fog: true },
    storms: { count: 360, speed: 2.6, size: 1.3, angle: -0.65, lightning: true }
  };

  const p = presets[category] || null;
  if (!p) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const particles = [];
  const W = () => canvas.width;
  const H = () => canvas.height;

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  for (let i = 0; i < p.count; i++) {
    particles.push({
      x: rand(0, W()),
      y: rand(0, H()),
      z: rand(0.3, 1), // depth factor
      w: rand(0.6, 1.4)
    });
  }

  let lastT = performance.now();

  function maybeLightning() {
    if (!p.lightning) return;
    // occasional flash
    if (Math.random() < 0.006) {
      flash.style.transition = "none";
      flash.style.background = "rgba(255,255,255,0.55)";
      requestAnimationFrame(() => {
        flash.style.transition = "background 180ms ease-out";
        flash.style.background = "rgba(255,255,255,0)";
      });
    }
  }

  function draw(now) {
    const dt = Math.min((now - lastT) / 16.67, 2);
    lastT = now;

    ctx.clearRect(0, 0, W(), H());

    // draw particles
    ctx.save();
    ctx.scale(1, 1);

    if (p.fog) {
      // cheap fog blobs
      for (const a of particles) {
        a.x += p.speed * dt * a.z;
        if (a.x > W() + 80) a.x = -80;
        const r = p.size * a.z * a.w;
        const grd = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, r);
        grd.addColorStop(0, "rgba(255,255,255,0.06)");
        grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (category === "snow") {
      for (const a of particles) {
        a.y += p.speed * dt * (0.8 + a.z);
        a.x += Math.sin((a.y / 120) + a.z) * p.drift * dt * 2;

        if (a.y > H() + 10) {
          a.y = -10;
          a.x = rand(0, W());
        }

        const r = p.size * a.z;
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      // rain/drizzle/showers/storms streaks
      const ang = p.angle;
      const vx = Math.cos(ang) * p.speed;
      const vy = Math.sin(ang) * p.speed;

      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;

      for (const a of particles) {
        a.x += vx * dt * (1 + a.z);
        a.y += -vy * dt * (2 + a.z); // inverted due to angle sign

        if (a.y > H() + 30 || a.x < -30) {
          a.x = rand(0, W());
          a.y = -30;
        }

        const len = (18 + 35 * a.z) * p.size;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(a.x + vx * len, a.y - vy * len);
        ctx.stroke();
      }
    }

    ctx.restore();

    maybeLightning();
    rafId = requestAnimationFrame(draw);
  }

  rafId = requestAnimationFrame(draw);
}

export function stopWeatherMotion() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;

  if (resizeHandler) {
    window.removeEventListener("resize", resizeHandler);
    resizeHandler = null;
  }

  const canvas = document.getElementById("wx-particles");
  if (canvas) {
    const ctx = canvas.getContext("2d", { alpha: true });
    ctx?.clearRect(0, 0, canvas.width, canvas.height);
  }
}
