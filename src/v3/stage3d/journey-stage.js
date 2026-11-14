/* ═══════════════════════════════════════════════════════════════════════════
   PHOTO TRANSITIONS — features.v3PhotoTransitions. One photograph becomes the next
   on the journey wall through a shader: a developing print, a light leak, or a
   wipe from the sun's side (docs/design/HANDOVER-threejs-ambient-build.md, Phase C;
   each look approved from a still on 2026-11-14).

   Reached ONLY through a dynamic import() in core/journey.js, so three is never
   fetched with the flag off. Same rules as stage3d/stage.js, each paid for there:
     · ONE renderer for the life of the page, made on the first transition.
     · The canvas lives INSIDE the incoming journey frame, over its photograph and
       UNDER its grade layer, so the hour's light and the corner shades sit on top
       exactly as they do on the photograph itself. The frame is opaque from the
       first GL frame, which already draws the OUTGOING picture: no dip, no snap.
     · uT = 0 is the outgoing composition and uT = 1 the incoming one, exactly, in
       every look; at the deadline the canvas hides over the very same pixels (the
       photograph under it, held at the same scale until then).
     · rAF capped at 30; a setTimeout deadline ends the moment, because rAF does not
       fire behind display:none. Both textures disposed every time: the proof is
       renderer.info.memory back to { geometries: 0, textures: 0 }.
     · webglcontextlost marks it dead for the page; the journey falls back to its wash.
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, Mesh, ShaderMaterial, CanvasTexture, LinearFilter, Vector2
} from "three";

const FRAME_GAP_MS = 1000 / 30 - 4;
export const LOOKS = Object.freeze({ print: 0, leak: 1, wipe: 2 });

const VERT = `varying vec2 v; void main() { v = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* Every look is mix(old, new, m) plus a light term that is 0 at both ends, and m is
   exactly 0 at uT = 0 and exactly 1 at uT = 1 over the whole wall. */
const FRAG = `
uniform sampler2D uOld, uNew;
uniform float uT;
uniform int uLook;
uniform vec2 uDir;
uniform float uAspect;
varying vec2 v;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec3 a = texture2D(uOld, v).rgb;
  vec3 b = texture2D(uNew, v).rgb;
  float t = clamp(uT, 0.0, 1.0);
  float glow = sin(3.14159265 * t);
  vec2 q = vec2(v.x * uAspect, v.y);
  vec3 col;
  if (uLook == 0) {
    // Developing print: the new picture surfaces through grain, pale at first, then develops.
    float k = n(q * 4.0) * 0.6 + n(q * 19.0) * 0.4;
    float edge = t * 1.3 - 0.15;
    float m = 1.0 - smoothstep(edge - 0.15, edge + 0.15, k);
    float dev = smoothstep(0.2, 1.0, t);
    float l = dot(b, vec3(0.2126, 0.7152, 0.0722));
    vec3 pale = mix(vec3(0.93, 0.9, 0.84), vec3(l), 0.35);
    col = mix(a, mix(pale, b, dev), m);
  } else if (uLook == 1) {
    // Light leak: warm light spills in from the top-right, the pictures cross under it.
    float d = distance(q, vec2(uAspect * 1.05, 0.95));
    float leak = exp(-d * d * 1.6) * glow;
    col = mix(a, b, smoothstep(0.2, 0.8, t));
    col = 1.0 - (1.0 - col) * (1.0 - vec3(1.0, 0.62, 0.3) * leak * 0.75);
  } else {
    // Sun wipe: a soft front crosses from the sun's side, with a glint on its edge.
    float s = dot(v - 0.5, uDir);
    float front = mix(-0.85, 0.85, t);
    float m = 1.0 - smoothstep(front - 0.12, front + 0.12, s);
    float line = exp(-pow((s - front) / 0.05, 2.0)) * glow;
    col = mix(a, b, m) + vec3(1.0, 0.85, 0.6) * line * 0.3;
  }
  // The ends are the pictures, exactly: no light term survives at 0 or 1.
  if (t <= 0.0) col = a;
  if (t >= 1.0) col = b;
  gl_FragColor = vec4(col, 1.0);
}`;

let renderer = null;
let canvas = null;
let scene = null;
let camera = null;
let dead = false;
let live = null;      // { mesh, textures, t0, ms, look, frames, onEnd }
let raf = null;
let last = 0;
let deadline = null;
let moments = 0;
let lastEnd = null;

function ensure() {
  if (dead) return false;
  if (renderer) return true;
  canvas = document.createElement("canvas");
  canvas.className = "journey__gl";
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.display = "none";
  try {
    renderer = new WebGLRenderer({ canvas, alpha: false, antialias: false, powerPreference: "low-power" });
  } catch {
    canvas = null;
    dead = true;
    return false;
  }
  renderer.setPixelRatio(1);
  canvas.addEventListener("webglcontextlost", () => { dead = true; end("context-lost"); });
  scene = new Scene();
  camera = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  return true;
}

function texture(src) {
  const t = new CanvasTexture(src);
  t.minFilter = LinearFilter;
  t.magFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function draw(t) {
  live.mesh.material.uniforms.uT.value = t;
  renderer.render(scene, camera);
  live.frames += 1;
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  if (now - last < FRAME_GAP_MS) return;
  last = now;
  draw(Math.min(1, (performance.now() - live.t0) / live.ms));
}

/** Tear the moment down: hide (the photograph under it IS the uT = 1 picture), dispose. */
function end(reason) {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  clearTimeout(deadline);
  deadline = null;
  if (!live) return;
  const { mesh, textures, onEnd } = live;
  canvas.style.display = "none";
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  for (const t of textures) t.dispose();
  renderer.renderLists.dispose();
  live = null;
  lastEnd = reason;
  onEnd?.(reason);
}

/**
 * Run one transition inside `host` (the incoming journey frame), before `before`
 * (its grade node, or null). `from` / `to` are wall-sized 2D canvases holding the
 * outgoing and incoming pictures exactly as the frames show them. The first frame is
 * drawn synchronously, so the caller may reveal the frame in the same task.
 * False when the stage cannot (dead, no host); the caller keeps its own wash then.
 *
 * @returns {boolean}
 */
export function run({ host, before = null, from, to, ms, look = "print", dir = [1, 0], onEnd = null }) {
  if (!host || !from || !to || !(ms > 0) || !ensure()) return false;
  end("replaced");
  const W = from.width;
  const H = from.height;
  renderer.setSize(W, H, false);
  host.insertBefore(canvas, before);
  const textures = [texture(from), texture(to)];
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uOld: { value: textures[0] },
      uNew: { value: textures[1] },
      uT: { value: 0 },
      uLook: { value: LOOKS[look] ?? 0 },
      uDir: { value: new Vector2(dir[0], dir[1]).normalize() },
      uAspect: { value: W / H }
    }
  });
  const mesh = new Mesh(new PlaneGeometry(2, 2), material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  moments += 1;
  live = { mesh, textures, t0: performance.now(), ms, look, frames: 0, onEnd };
  draw(0);
  canvas.style.display = "block";
  last = 0;
  raf = requestAnimationFrame(loop);
  deadline = setTimeout(() => end("done"), ms);
  return true;
}

/** Stop now (depth change, a newer photograph): the photograph under it is already right. */
export function stop() {
  end("stopped");
}

/** Readout for __journey().transition and the specs. */
export function state() {
  return {
    live: Boolean(renderer),
    dead,
    running: raf !== null,
    shown: canvas?.style.display === "block",
    look: live?.look ?? null,
    t: live ? live.mesh.material.uniforms.uT.value : null,
    frames: live?.frames ?? 0,
    moments,
    lastEnd,
    memory: renderer ? { ...renderer.info.memory } : null
  };
}
