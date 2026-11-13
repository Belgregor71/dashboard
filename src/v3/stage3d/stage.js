/* ═══════════════════════════════════════════════════════════════════════════
   THE STAGE — features.v3DogFx. A three.js layer on the glass, over the dogs.

   Reached ONLY through the dynamic import() in core/dog-fx.js, so three lives
   in its own chunk and is never fetched while the flag is off.
   docs/design/HANDOVER-threejs-stage.md has the design and Phase 0's numbers.

   Rules, each one measured or paid for elsewhere:
     · ONE renderer for the life of the page, made on the first moment. A WebGL
       context per popup (2-10 an hour, for weeks) is how a context leak starts.
     · Between moments: canvas display:none, loop stopped, scene EMPTY. Every
       geometry and material is disposed at the end of every moment, and the
       proof is renderer.info.memory back to { geometries: 0, textures: 0 }.
     · The loop is rAF capped at 30 fps (Phase 0: +2.9 gpu at 30, +6.9 at 60,
       ceiling 25). The cap is 4 ms under the period, or 60 Hz vsync rounds a
       33 ms gap down to 20 fps.
     · Every moment has a setTimeout deadline that tears it down, because rAF
       does not fire behind display:none and the caller's end() may never come.
     · webglcontextlost marks the stage dead for this page load; the dogs carry
       on without it.
     · No textures at all: every shape is drawn in the fragment shader.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  WebGLRenderer, Scene, OrthographicCamera, BufferGeometry, BufferAttribute, Points, ShaderMaterial
} from "three";

const FRAME_GAP_MS = 1000 / 30 - 4;
const FADE_IN_S = 0.8;
const FADE_OUT_MS = 600;

const VERT = `
attribute vec4 tint;
attribute float size;
attribute float spin;
varying vec4 vTint;
varying float vSpin;
void main() {
  vTint = tint;
  vSpin = spin;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* uShape: 0 snow (soft disc), 1 confetti (tumbling slip), 2 spark (glow),
   3 bat (silhouette; spin is the flap phase). */
const FRAG = `
uniform int uShape;
uniform float uAlpha;
varying vec4 vTint;
varying float vSpin;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float a = 0.0;
  if (uShape == 0) {
    a = smoothstep(0.5, 0.15, length(p));
  } else if (uShape == 1) {
    float c = cos(vSpin), s = sin(vSpin);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float w = 0.42 * abs(cos(vSpin * 1.7)) + 0.06;
    a = step(abs(q.x), w) * step(abs(q.y), 0.18);
  } else if (uShape == 2) {
    float d = length(p);
    a = exp(-d * d * 14.0) + smoothstep(0.16, 0.0, d);
  } else {
    p.y = -p.y;
    float flap = 0.5 + 0.5 * sin(vSpin);
    float ax = abs(p.x);
    float body = step(length(vec2(p.x * 2.6, p.y * 1.4)), 0.16);
    float top = 0.02 + flap * 0.22 * smoothstep(0.05, 0.48, ax);
    float scallop = 0.06 * abs(sin(ax * 22.0));
    float wing = step(ax, 0.48) * step(p.y, top) * step(top - 0.14 - scallop, p.y);
    a = max(body, wing);
  }
  gl_FragColor = vec4(vTint.rgb, vTint.a * clamp(a, 0.0, 1.0) * uAlpha);
}`;

const rand = (a, b) => a + Math.random() * (b - a);
const CONFETTI = [[0.96, 0.36, 0.42], [0.99, 0.78, 0.29], [0.38, 0.78, 0.62], [0.35, 0.6, 0.95], [0.86, 0.5, 0.92]];

/* Each effect: a particle count, a shape, a spawn and a per-frame step over one
   particle `p` ({ x, y, vx, vy, size, spin, vspin, life, r, g, b, a }).
   y runs UP from the bottom edge (the camera is 0..w × 0..h). */
const EFFECTS = {
  snow: {
    count: 260, shape: 0,
    spawn(p, w, h, first) {
      Object.assign(p, { x: rand(0, w), y: first ? rand(0, h) : h + 10, vx: 0, vy: -rand(30, 90),
        size: rand(3, 9), spin: rand(0, 6.28), r: 1, g: 1, b: 1, a: rand(0.5, 0.9) });
    },
    step(p, dt, w, h) {
      p.spin += dt;
      p.x += Math.sin(p.spin) * 12 * dt;
      p.y += p.vy * dt;
      return p.y > -10;
    }
  },
  confetti: {
    count: 220, shape: 1,
    spawn(p, w, h, first) {
      const [r, g, b] = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
      Object.assign(p, { x: rand(0, w), y: first ? rand(h * 0.4, h * 1.4) : h + 20, vx: rand(-20, 20), vy: -rand(60, 160),
        size: rand(10, 16), spin: rand(0, 6.28), vspin: rand(-5, 5), r, g, b, a: 0.95 });
    },
    step(p, dt) {
      p.spin += p.vspin * dt;
      p.x += (p.vx + Math.sin(p.spin * 0.5) * 25) * dt;
      p.y += p.vy * dt;
      return p.y > -20;
    }
  },
  fireworks: {
    count: 360, shape: 2, burst: 72, gapS: 1.1,
    // Dormant: every field set, or the position buffer takes NaN.
    spawn(p) { Object.assign(p, { x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 1, size: 0, spin: 0, r: 0, g: 0, b: 0, a: 0 }); },
    step(p, dt) {
      if (p.life <= 0) return true; // dormant, waiting for a burst
      p.life -= dt;
      p.vy -= 70 * dt;
      p.vx *= 1 - 0.8 * dt; p.vy *= 1 - 0.8 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.a = Math.max(0, p.life / p.maxLife);
      if (p.life <= 0) { p.a = 0; p.size = 0; }
      return true;
    },
    // A burst wakes `burst` dormant sparks at one point, one colour family.
    tick(sys, w, h) {
      if (sys.t < sys.nextBurst) return;
      sys.nextBurst = sys.t + rand(0.5, 1.1);
      const cx = rand(w * 0.2, w * 0.8), cy = rand(h * 0.55, h * 0.85);
      const [r, g, b] = CONFETTI[Math.floor(Math.random() * CONFETTI.length)];
      let woken = 0;
      for (const p of sys.parts) {
        if (woken >= this.burst) break;
        if (p.life > 0) continue;
        const ang = rand(0, Math.PI * 2), sp = rand(120, 300);
        Object.assign(p, { x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: rand(1.4, 2.2), size: rand(9, 15), r: Math.min(1, r + 0.2), g: Math.min(1, g + 0.2), b: Math.min(1, b + 0.2), a: 1 });
        p.maxLife = p.life;
        woken++;
      }
    }
  },
  bats: {
    count: 9, shape: 3,
    spawn(p, w, h, first) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      Object.assign(p, { x: first ? rand(0, w) : (dir > 0 ? -40 : w + 40), y: rand(h * 0.5, h * 0.92), vx: dir * rand(90, 170), vy: 0,
        base: 0, size: rand(38, 58), spin: rand(0, 6.28), vspin: rand(14, 20), r: 0.08, g: 0.06, b: 0.1, a: 0.92 });
      p.base = p.y;
    },
    step(p, dt, w) {
      p.spin += p.vspin * dt;
      p.x += p.vx * dt;
      p.y = p.base + Math.sin(p.x * 0.012) * 26;
      return p.x > -60 && p.x < w + 60;
    }
  }
};

let renderer = null;
let canvas = null;
let scene = null;
let camera = null;
let dead = false;
let sys = null;          // the live moment, or null
let raf = null;
let last = 0;
let deadline = null;
let fadeTimer = null;
let moments = 0;
let lastEnd = null;

function ensure() {
  if (dead) return false; // a lost context keeps its renderer object; it is still dead
  if (renderer) return true;
  canvas = document.createElement("canvas");
  canvas.className = "stage3d";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;z-index:16;display:none;pointer-events:none";
  document.body.append(canvas);
  try {
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    canvas.remove();
    canvas = null;
    dead = true;
    return false;
  }
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  canvas.addEventListener("webglcontextlost", () => { dead = true; teardown("context-lost"); });
  scene = new Scene();
  camera = new OrthographicCamera(0, 1, 1, 0, -10, 10);
  return true;
}

function build(effect) {
  const def = EFFECTS[effect];
  const w = innerWidth, h = innerHeight;
  const n = def.count;
  const parts = Array.from({ length: n }, () => ({}));
  for (const p of parts) def.spawn(p, w, h, true);
  const pos = new Float32Array(n * 3);
  const tint = new Float32Array(n * 4);
  const size = new Float32Array(n);
  const spin = new Float32Array(n);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("tint", new BufferAttribute(tint, 4));
  geometry.setAttribute("size", new BufferAttribute(size, 1));
  geometry.setAttribute("spin", new BufferAttribute(spin, 1));
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uShape: { value: def.shape }, uAlpha: { value: 0 } }
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { effect, def, parts, geometry, material, points, pos, tint, size, spin, t: 0, nextBurst: 0, fadeFrom: null, frames: 0, w, h };
}

function step(dt) {
  const { def, parts, w, h } = sys;
  sys.t += dt;
  def.tick?.call(def, sys, w, h);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!def.step(p, dt, w, h)) def.spawn(p, w, h, false);
    sys.pos[i * 3] = p.x; sys.pos[i * 3 + 1] = p.y;
    sys.tint[i * 4] = p.r; sys.tint[i * 4 + 1] = p.g; sys.tint[i * 4 + 2] = p.b; sys.tint[i * 4 + 3] = p.a;
    sys.size[i] = p.size; sys.spin[i] = p.spin;
  }
  for (const k of ["position", "tint", "size", "spin"]) sys.geometry.attributes[k].needsUpdate = true;
  const fadeIn = Math.min(1, sys.t / FADE_IN_S);
  const fadeOut = sys.fadeFrom == null ? 1 : Math.max(0, 1 - (performance.now() - sys.fadeFrom) / FADE_OUT_MS);
  sys.material.uniforms.uAlpha.value = fadeIn * fadeOut;
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_GAP_MS) return;
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 30;
  last = now;
  step(dt);
  renderer.render(scene, camera);
  sys.frames++;
}

function teardown(reason) {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  clearTimeout(deadline); deadline = null;
  clearTimeout(fadeTimer); fadeTimer = null;
  if (sys) {
    scene.remove(sys.points);
    sys.geometry.dispose();
    sys.material.dispose();
    sys = null;
    lastEnd = reason;
  }
  if (renderer) renderer.renderLists.dispose();
  if (canvas) canvas.style.display = "none";
}

/** Start an effect on the glass. False if the stage cannot (dead, unknown). */
export function play(effect, deadlineMs) {
  if (!EFFECTS[effect] || !ensure()) return false;
  teardown("replaced");
  moments += 1;
  renderer.setSize(innerWidth, innerHeight, false);
  Object.assign(camera, { left: 0, right: innerWidth, top: innerHeight, bottom: 0 });
  camera.updateProjectionMatrix();
  sys = build(effect);
  canvas.style.display = "block";
  last = 0;
  raf = requestAnimationFrame(loop);
  deadline = setTimeout(() => teardown("deadline"), deadlineMs);
  return true;
}

/** Fade the effect out and empty the stage. The fade's end is a setTimeout,
    not the loop, so it tears down even if rAF never fires again. */
export function stop() {
  if (!sys || sys.fadeFrom != null) return;
  sys.fadeFrom = performance.now();
  fadeTimer = setTimeout(() => teardown("stopped"), FADE_OUT_MS);
}

/** Readout for __v3().stage and the specs. */
export function state() {
  return {
    loaded: true,
    live: Boolean(renderer),
    dead,
    effect: sys?.effect ?? null,
    particles: sys?.parts.length ?? 0,
    frames: sys?.frames ?? 0,
    // What the last frame really drew: a loop that counts frames but draws
    // nothing, or draws at zero alpha, is not an effect on the glass.
    drawnPoints: sys?.frames ? renderer.info.render.points : 0,
    alpha: sys?.material.uniforms.uAlpha.value ?? 0,
    running: raf !== null,
    shown: canvas?.style.display === "block",
    moments,
    lastEnd,
    memory: renderer ? { ...renderer.info.memory } : null
  };
}

export const EFFECT_NAMES = Object.keys(EFFECTS);
