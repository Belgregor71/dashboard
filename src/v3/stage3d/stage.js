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
attribute float shape;
varying vec4 vTint;
varying float vSpin;
varying float vShape;
void main() {
  vTint = tint;
  vSpin = spin;
  vShape = shape;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* shape, per particle: 0 snow (soft disc), 1 confetti (tumbling slip),
   2 spark (glow), 3 bat (silhouette; spin is the flap phase). The glass
   marks (Phase 2): 4 lick smear, 5 nose fog, 6 paw print; spin is their
   angle. WebGL cannot read the page behind it, so a mark is a translucent
   sheen with a highlight, never a refraction of the photo. */
const FRAG = `
uniform float uAlpha;
varying vec4 vTint;
varying float vSpin;
varying float vShape;
vec2 turn(vec2 p, float r) { float c = cos(r), s = sin(r); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
void main() {
  int uShape = int(vShape + 0.5);
  vec2 p = gl_PointCoord - 0.5;
  float a = 0.0;
  vec3 col = vTint.rgb;
  // Marks carry a faint dark edge as well as a light body, so they read over
  // black fur, white fur and the photo alike: light alone vanished on white.
  if (uShape == 4) {
    vec2 q = turn(p, vSpin);
    float e = length(vec2(q.x / 0.24, q.y / 0.48));
    float body = smoothstep(1.0, 0.6, e) * 0.24;
    float rim = smoothstep(0.1, 0.0, abs(e - 0.9));
    float glint = smoothstep(0.06, 0.0, abs(q.x + 0.08 + 0.06 * q.y)) * smoothstep(0.34, 0.06, abs(q.y)) * 0.3;
    col = mix(col, vec3(0.12), rim * 0.6);
    a = max(body + glint, rim * 0.22);
  } else if (uShape == 5) {
    float d = length(p) * (1.0 + 0.025 * sin(atan(p.y, p.x) * 5.0 + vSpin * 3.0));
    a = smoothstep(0.5, 0.1, d) * 0.5;
  } else if (uShape == 6) {
    vec2 q = turn(vec2(p.x, -p.y), vSpin);
    float d = length(vec2(q.x / 1.25, q.y + 0.13)) - 0.17;
    d = min(d, length(q - vec2(-0.29, 0.10)) - 0.085);
    d = min(d, length(q - vec2(-0.11, 0.27)) - 0.09);
    d = min(d, length(q - vec2(0.11, 0.27)) - 0.09);
    d = min(d, length(q - vec2(0.29, 0.10)) - 0.085);
    float fill = smoothstep(0.02, -0.02, d);
    float ring = smoothstep(0.03, 0.0, abs(d + 0.01));
    col = mix(col, vec3(0.1), ring * 0.7);
    a = max(fill * 0.3, ring * 0.38);
  } else if (uShape == 0) {
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
  gl_FragColor = vec4(col, vTint.a * clamp(a, 0.0, 1.0) * uAlpha);
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
  },
  /* Phase 2: marks on the glass. Every slot is dormant until mark() wakes it
     at a cue's point; it rises fast, holds, then dries away over its life.
     Fog lifts sooner than a lick dries; a paw print lingers. */
  glass: {
    count: 24, shape: 4,
    // Dormant: every field set, or the position buffer takes NaN.
    spawn(p) { Object.assign(p, { x: 0, y: 0, life: 0, maxLife: 1, size: 0, spin: 0, shape: 4, r: 0, g: 0, b: 0, a: 0 }); },
    step(p, dt) {
      if (p.life <= 0) return true;
      p.life -= dt;
      const age = p.maxLife - p.life;
      const left = Math.max(0, p.life) / p.maxLife;
      p.a = Math.min(1, age / 0.15) * Math.min(1, left / 0.45);
      if (p.shape === 5) p.size = p.full * (0.85 + 0.15 * left);
      if (p.life <= 0) { p.a = 0; p.size = 0; }
      return true;
    }
  }
};

const MARK = {
  smear: { shape: 4, life: 5, rgb: [0.92, 0.96, 1] },
  fog: { shape: 5, life: 3.2, rgb: [0.9, 0.93, 0.96] },
  paw: { shape: 6, life: 6, rgb: [0.88, 0.9, 0.93] }
};
// gl_PointSize beyond the driver's range is clamped silently; keep marks inside it.
const MARK_MAX_PX = 512;

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

/* One Points system (one geometry, one material) per effect in the moment. */
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
  const shape = new Float32Array(n);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("tint", new BufferAttribute(tint, 4));
  geometry.setAttribute("size", new BufferAttribute(size, 1));
  geometry.setAttribute("spin", new BufferAttribute(spin, 1));
  geometry.setAttribute("shape", new BufferAttribute(shape, 1));
  const material = new ShaderMaterial({
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uAlpha: { value: 0 } }
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { effect, def, parts, geometry, material, points, pos, tint, size, spin, shape, t: 0, nextBurst: 0, w, h };
}

function stepSystem(s, dt, alpha) {
  const { def, parts, w, h } = s;
  s.t += dt;
  def.tick?.call(def, s, w, h);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!def.step(p, dt, w, h)) def.spawn(p, w, h, false);
    s.pos[i * 3] = p.x; s.pos[i * 3 + 1] = p.y;
    s.tint[i * 4] = p.r; s.tint[i * 4 + 1] = p.g; s.tint[i * 4 + 2] = p.b; s.tint[i * 4 + 3] = p.a;
    s.size[i] = p.size; s.spin[i] = p.spin; s.shape[i] = p.shape ?? def.shape;
  }
  for (const k of ["position", "tint", "size", "spin", "shape"]) s.geometry.attributes[k].needsUpdate = true;
  s.material.uniforms.uAlpha.value = alpha;
}

function step(dt) {
  sys.t += dt;
  const fadeIn = Math.min(1, sys.t / FADE_IN_S);
  const fadeOut = sys.fadeFrom == null ? 1 : Math.max(0, 1 - (performance.now() - sys.fadeFrom) / FADE_OUT_MS);
  // A mark is a moment on the glass and rises on its own; only particles fade in.
  if (sys.particles) stepSystem(sys.particles, dt, fadeIn * fadeOut);
  if (sys.glass) stepSystem(sys.glass, dt, fadeOut);
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
    for (const s of [sys.particles, sys.glass]) {
      if (!s) continue;
      scene.remove(s.points);
      s.geometry.dispose();
      s.material.dispose();
    }
    sys = null;
    lastEnd = reason;
  }
  if (renderer) renderer.renderLists.dispose();
  if (canvas) canvas.style.display = "none";
}

/** Start a moment on the glass: the occasion's particles (`effect`, or null)
    and/or `glass`, the layer cue marks land on. False if the stage cannot
    (dead, unknown effect, nothing asked for). */
export function play(effect, deadlineMs, { glass = false } = {}) {
  if ((effect != null && (!EFFECTS[effect] || effect === "glass")) || (effect == null && !glass) || !ensure()) return false;
  teardown("replaced");
  moments += 1;
  renderer.setSize(innerWidth, innerHeight, false);
  Object.assign(camera, { left: 0, right: innerWidth, top: innerHeight, bottom: 0 });
  camera.updateProjectionMatrix();
  sys = {
    effect: effect ?? null,
    particles: effect ? build(effect) : null,
    glass: glass ? build("glass") : null,
    marked: 0, t: 0, fadeFrom: null, frames: 0
  };
  canvas.style.display = "block";
  last = 0;
  raf = requestAnimationFrame(loop);
  deadline = setTimeout(() => teardown("deadline"), deadlineMs);
  return true;
}

/** Leave a mark on the glass: `kind` smear | fog | paw, centred at (x, y) in
    page px with y measured DOWN from the top, `px` across, `angle` radians.
    False when no moment with a glass layer is live, or the moment is fading.
    With every slot awake, the oldest mark gives way. */
export function mark(kind, x, y, px, angle = 0) {
  const m = MARK[kind];
  if (!m || !sys?.glass || sys.fadeFrom != null || !(px > 0) || !Number.isFinite(x + y)) return false;
  const parts = sys.glass.parts;
  const slot = parts.find((p) => p.life <= 0) ?? parts.reduce((a, b) => (b.life < a.life ? b : a));
  const size = Math.min(MARK_MAX_PX, px);
  Object.assign(slot, { x, y: sys.glass.h - y, life: m.life, maxLife: m.life, size, full: size, spin: angle,
    shape: m.shape, r: m.rgb[0], g: m.rgb[1], b: m.rgb[2], a: 0 });
  sys.marked += 1;
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
  const glass = sys?.glass;
  return {
    loaded: true,
    live: Boolean(renderer),
    dead,
    effect: sys?.effect ?? null,
    particles: sys?.particles?.parts.length ?? 0,
    glass: Boolean(glass),
    // Marks landed this moment, and those still on the glass with their kinds.
    marked: sys?.marked ?? 0,
    marks: glass ? glass.parts.filter((p) => p.life > 0).map((p) => ({
      kind: Object.keys(MARK).find((k) => MARK[k].shape === p.shape), x: Math.round(p.x), y: Math.round(glass.h - p.y), px: Math.round(p.size)
    })) : [],
    frames: sys?.frames ?? 0,
    // What the last frame really drew: a loop that counts frames but draws
    // nothing, or draws at zero alpha, is not an effect on the glass.
    drawnPoints: sys?.frames ? renderer.info.render.points : 0,
    alpha: sys?.particles?.material.uniforms.uAlpha.value ?? sys?.glass?.material.uniforms.uAlpha.value ?? 0,
    running: raf !== null,
    shown: canvas?.style.display === "block",
    moments,
    lastEnd,
    memory: renderer ? { ...renderer.info.memory } : null
  };
}

export const EFFECT_NAMES = Object.keys(EFFECTS);
