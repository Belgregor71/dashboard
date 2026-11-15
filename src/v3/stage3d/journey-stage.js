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
  WebGLRenderer, Scene, OrthographicCamera, PlaneGeometry, Mesh, ShaderMaterial, CanvasTexture, LinearFilter, Vector2,
  BufferGeometry, BufferAttribute, Points,
  PerspectiveCamera, SphereGeometry, TubeGeometry, CatmullRomCurve3, RingGeometry, MeshBasicMaterial, Vector3, Color,
  BackSide, DoubleSide, SRGBColorSpace
} from "three";
import { lonLatVec, GLOBE_FAR, GLOBE_NEAR } from "../core/journey-geo.js";

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
    // alpha: the rain (v3RainGlass) is transparent between drops; a transition still draws opaque.
    renderer = new WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
  } catch {
    canvas = null;
    dead = true;
    return false;
  }
  renderer.setPixelRatio(1);
  canvas.addEventListener("webglcontextlost", () => { dead = true; end("context-lost"); globeEnd("context-lost"); rainStop({ dry: true }); });
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
  globeEnd("replaced");
  rainStop();
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

/* ═══ RAIN ON THE GLASS — features.v3RainGlass (Phase D) ════════════════════
   Drops on the glass in front of the photograph, each a small inverted lens of the
   picture around it. Same canvas, same place (in the top frame, under the grade, so
   the hour's light tints the drops too), transparent between drops.
     · Drawn in BURSTS: a few drops land every few seconds and, now and then, a big
       one slides down and swallows what it meets. Between bursts NOTHING renders:
       the canvas keeps its last frame. Rain lasts hours; idle costs one timer.
     · ONE texture while it rains (the top frame, composed), released on every stop:
       memory back to 0. The drops themselves survive a photograph change; dry
       weather clears them. */

const RAIN_MAX = 40;
const RAIN_GAP_MS = 1000 / 15 - 4;
const SLIDE_MAX_PX_S = 260;

const DROP_VERT = `
attribute float aSize;
varying vec2 vC;
varying float vS;
void main() { vC = position.xy * 0.5 + 0.5; vS = aSize; gl_PointSize = aSize; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

const DROP_FRAG = `
uniform sampler2D uPhoto;
uniform vec2 uRes;
varying vec2 vC;
varying float vS;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  p.y = -p.y;
  // A drop sags: fuller below its middle than above.
  vec2 q = vec2(p.x, p.y * (p.y < 0.0 ? 0.9 : 1.15));
  float r = length(q);
  if (r > 1.0) discard;
  float z = sqrt(1.0 - r * r);
  // A lens: the picture around the drop, about 2.5x its size, upside down.
  vec3 col = texture2D(uPhoto, vC - q * (vS * 1.25) / uRes).rgb;
  col *= mix(0.62, 1.0, z);
  // NEVER brighter than the photograph under this very pixel: the corner shades are solved
  // against the photograph, so a drop that lightened it could take the hour below 3:1
  // (the contrast sweep found 2.39:1 with a glint, 11-14). Drops darken or keep, only.
  col = min(col, texture2D(uPhoto, gl_FragCoord.xy / uRes).rgb);
  float a = 1.0 - smoothstep(0.86, 1.0, r);
  gl_FragColor = vec4(col * a, a);
}`;

let rainLive = null;   // { mesh, texture, key, W, H }
let drops = [];        // { x, y, r, vy } in wall px, y down
let rainAmount = 0.5;
let rainTimer = null;
let rainRaf = null;
let rainLast = 0;
let rainFrames = 0;

const gapMs = () => 9000 - 6000 * rainAmount;

function spawn(n, W, H) {
  for (let i = 0; i < n; i++) {
    const big = Math.random() < 0.12;
    drops.push({ x: Math.random() * W, y: Math.random() * H * 0.95, r: big ? 9 + Math.random() * 6 : 3 + Math.random() * 5, vy: 0 });
  }
  while (drops.length > RAIN_MAX) drops.shift(); // the oldest dries
}

function drawRain() {
  const { mesh, W, H } = rainLive;
  const pos = mesh.geometry.attributes.position;
  const size = mesh.geometry.attributes.aSize;
  drops.forEach((d, i) => {
    pos.array[i * 3] = (d.x / W) * 2 - 1;
    pos.array[i * 3 + 1] = 1 - (d.y / H) * 2;
    size.array[i] = d.r * 2;
  });
  pos.needsUpdate = true;
  size.needsUpdate = true;
  mesh.geometry.setDrawRange(0, drops.length);
  renderer.render(scene, camera);
  rainFrames += 1;
}

/* One step of the sliders: they speed up, wander a little, swallow what they touch. */
function slide(dt) {
  const { H } = rainLive;
  for (const d of drops.filter((x) => x.vy > 0)) {
    d.vy = Math.min(SLIDE_MAX_PX_S, d.vy + 500 * dt);
    d.y += d.vy * dt;
    d.x += Math.sin(d.y * 0.03) * 0.4;
    drops = drops.filter((o) => {
      if (o === d || o.vy > 0 || Math.hypot(o.x - d.x, o.y - d.y) > d.r + o.r) return true;
      d.r = Math.min(18, Math.hypot(d.r, o.r * 0.7));
      return false;
    });
  }
  drops = drops.filter((d) => d.y - d.r <= H);
}

function rainLoop(now) {
  rainRaf = null;
  if (!rainLive) return;
  if (now - rainLast >= RAIN_GAP_MS) {
    slide(Math.min(0.2, (now - rainLast) / 1000));
    rainLast = now;
    drawRain();
  }
  // The canvas keeps its last frame once nothing moves.
  if (drops.some((d) => d.vy > 0)) rainRaf = requestAnimationFrame(rainLoop);
}

function burst() {
  rainTimer = setTimeout(burst, gapMs());
  spawn(1 + Math.round(rainAmount * 3), rainLive.W, rainLive.H);
  if (Math.random() < 0.2 + 0.4 * rainAmount) {
    const big = drops.filter((d) => d.vy === 0 && d.r >= 9).sort((a, b) => b.r - a.r)[0];
    if (big) big.vy = 1;
  }
  drawRain();
  if (!rainRaf && drops.some((d) => d.vy > 0)) {
    rainLast = performance.now();
    rainRaf = requestAnimationFrame(rainLoop);
  }
}

/**
 * Rain on the glass in `host` (the top journey frame), before `before` (its grade).
 * `photo()` returns a wall-sized 2D canvas of the frame as the wall shows it; it is
 * only called when `key` changes (a new photograph, night coming on). Refused while
 * a transition holds the canvas: the caller asks again when the reveal ends.
 *
 * @returns {boolean}
 */
export function rain({ host, before = null, photo, key, amount = 0.5 }) {
  rainAmount = Math.max(0, Math.min(1, Number(amount) || 0));
  if (!host || typeof photo !== "function" || live || globeLive || !ensure()) return false;
  if (rainLive && rainLive.key === key && canvas.parentNode === host) return true;
  rainStop();
  const src = photo();
  if (!src) return false;
  const W = src.width;
  const H = src.height;
  renderer.setSize(W, H, false);
  host.insertBefore(canvas, before);
  const tex = texture(src);
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(RAIN_MAX * 3), 3));
  geo.setAttribute("aSize", new BufferAttribute(new Float32Array(RAIN_MAX), 1));
  const material = new ShaderMaterial({
    vertexShader: DROP_VERT,
    fragmentShader: DROP_FRAG,
    transparent: true,
    premultipliedAlpha: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { uPhoto: { value: tex }, uRes: { value: new Vector2(W, H) } }
  });
  const mesh = new Points(geo, material);
  mesh.frustumCulled = false;
  scene.add(mesh);
  rainLive = { mesh, texture: tex, key, W, H };
  if (!drops.length) spawn(4 + Math.round(rainAmount * 8), W, H);
  drawRain();
  canvas.style.display = "block";
  rainTimer = setTimeout(burst, gapMs());
  return true;
}

/** Stop the rain and let go of its texture. `dry` also clears the drops off the glass. */
export function rainStop({ dry = false } = {}) {
  if (dry) drops = [];
  if (rainRaf) cancelAnimationFrame(rainRaf);
  rainRaf = null;
  clearTimeout(rainTimer);
  rainTimer = null;
  if (!rainLive) return;
  const { mesh, texture: tex } = rainLive;
  canvas.style.display = "none";
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  tex.dispose();
  renderer.renderLists.dispose();
  rainLive = null;
}

/* ═══ THE GLOBE — features.v3JourneyGlobe (Phase F) ═════════════════════════
   An overseas memory arrives as a flight: the globe centred on home, a turn along the
   great circle with the arc drawing itself, the destination country lit gold, a dive
   until it sits in the middle of the wall, then the photograph opening OUT OF THE PIN.
   Approved from stills on 2026-11-14 (docs/design/HANDOVER-threejs-ambient-build.md).
     · Same canvas, same place, same rules as the transition: one renderer, the first
       frame drawn synchronously (the outgoing picture, which fades to the globe over
       400 ms), a setTimeout deadline, and EVERYTHING disposed at the end: memory 0.
     · The land texture is painted once per page from the journey's own outlines and
       repainted only when the lit country changes. Nothing leaves the house.
     · The terminator is the photo's own moment (subsolar(), journey-geo.js). */

const TEX_W = 4096;
const TEX_H = 2048;
const BLOOM_FEATHER_PX = 260;

const EARTH_VERT = `varying vec2 vUv; varying vec3 vN;
void main() { vUv = uv; vN = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// Night dimmed, not black. The dusk band is narrow: wide, it read as a vertical stripe at whole-globe zoom (stills, 11-14).
const EARTH_FRAG = `uniform sampler2D map; uniform vec3 sun; varying vec2 vUv; varying vec3 vN;
void main() {
  vec3 c = texture2D(map, vUv).rgb;
  float d = dot(vN, sun);
  float day = smoothstep(-0.06, 0.1, d);
  vec3 dusk = vec3(1.0, 0.55, 0.25) * exp(-pow(d * 16.0, 2.0)) * 0.22;
  gl_FragColor = vec4(c * mix(0.42, 1.05, day) + dusk, 1.0);
  #include <colorspace_fragment>
}`;
const RIM_VERT = `varying vec3 vN; varying vec3 vV;
void main() { vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const RIM_FRAG = `varying vec3 vN; varying vec3 vV;
void main() { float f = pow(1.0 - abs(dot(vN, vV)), 5.0); gl_FragColor = vec4(0.95, 0.78, 0.55, f * 0.3); }`;
const ARC_VERT = `varying vec3 vW;
void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
// Past the horizon the lifted arc poked out beyond the limb (stills, 11-14): it fades there.
// The horizon of a unit globe seen from distance D is dot(p, camera) = 1 / D.
const ARC_FRAG = `uniform float uA; uniform float uHorizon; varying vec3 vW;
void main() {
  float f = smoothstep(uHorizon - 0.08, uHorizon + 0.08, dot(normalize(vW), normalize(cameraPosition)));
  gl_FragColor = vec4(0.965, 0.76, 0.48, uA * f);
}`;
// The outgoing picture over the globe for the first 400 ms; the incoming one opening from the pin.
const BLOOM_FRAG = `uniform sampler2D uOld, uNew; uniform float uFade, uR; uniform vec2 uO, uRes; varying vec2 v;
void main() {
  vec2 px = vec2(v.x, 1.0 - v.y) * uRes;
  float m = uR > 0.0 ? 1.0 - smoothstep(uR - ${BLOOM_FEATHER_PX.toFixed(1)}, uR, distance(px, uO)) : 0.0;
  float a = max(uFade, m);
  if (a <= 0.0) discard;
  gl_FragColor = vec4(m > 0.0 ? texture2D(uNew, v).rgb : texture2D(uOld, v).rgb, a);
}`;

let earthCanvas = null;
let earthLit;            // the country painted gold now (undefined = never painted)
let globeLive = null;
let globeRaf = null;
let globeDeadline = null;
let globeLast = 0;
let globeMoments = 0;
let globeLastEnd = null;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const outCubic = (t) => 1 - Math.pow(1 - t, 3);
const vec = (p, r = 1) => new Vector3(...lonLatVec(p.lat, p.lng)).multiplyScalar(r);

function paintCountry(g, c, lit) {
  const k = TEX_W / 3600; // = TEX_H / 1800
  g.beginPath();
  // Rings unwrapped past the antimeridian (Chukotka, eastern Fiji) are drawn again a world to the left.
  for (const shift of c.bbox[2] > 3600 ? [0, -3600] : [0]) {
    for (const r of c.rings) {
      for (let i = 0; i < r.length; i += 2) {
        const x = (r[i] + shift) * k;
        const y = r[i + 1] * k;
        if (i) g.lineTo(x, y); else g.moveTo(x, y);
      }
      g.closePath();
    }
  }
  g.fillStyle = lit ? "#c9a46a" : "#5a5146";
  g.fill("evenodd");
  g.lineWidth = lit ? 3 : 1.5;
  g.strokeStyle = lit ? "#f0cf94" : "#7a6f60";
  g.stroke();
}

/* The approved still's palette. Repainted whole when the lit country changes: an overpaint
   of the old gold leaves its anti-aliased rim, and this runs a few times a day. */
function earthFor(world, litName) {
  if (!earthCanvas) {
    earthCanvas = document.createElement("canvas");
    earthCanvas.width = TEX_W;
    earthCanvas.height = TEX_H;
  }
  if (earthLit === litName) return earthCanvas;
  const g = earthCanvas.getContext("2d");
  g.fillStyle = "#1f2a33";
  g.fillRect(0, 0, TEX_W, TEX_H);
  let lit = null;
  for (const c of world) {
    if (c.name === litName) lit = c;
    else paintCountry(g, c, false);
  }
  if (lit) paintCountry(g, lit, true); // last, so its edge sits over its neighbours'
  earthLit = litName;
  return earthCanvas;
}

function globeDraw(e) {
  const L = globeLive;
  const B = L.beats;
  const tt = inOut(clamp01((e - B.turnFrom) / B.turnMs));
  const dv = inOut(clamp01((e - B.diveFrom) / B.diveMs));
  const bl = clamp01((e - B.bloomFrom) / B.bloomMs);
  const look = L.omega > 1e-4
    ? L.a.clone().multiplyScalar(Math.sin((1 - tt) * L.omega)).add(L.b.clone().multiplyScalar(Math.sin(tt * L.omega))).divideScalar(Math.sin(L.omega)).normalize()
    : L.b.clone();
  const dist = GLOBE_FAR + B.lift * Math.sin(Math.PI * tt) - dv * (GLOBE_FAR - L.near);
  L.cam.position.copy(look).multiplyScalar(dist);
  L.cam.up.set(0, 1, 0);
  L.cam.lookAt(0, 0, 0);
  L.cam.updateMatrixWorld();
  L.arc.geometry.setDrawRange(0, Math.floor((L.arcCount * Math.min(1, tt * 1.05)) / 6) * 6);
  L.arc.material.uniforms.uA.value = 0.95 * (1 - dv * 0.7);
  L.arc.material.uniforms.uHorizon.value = 1 / dist;
  const landed = L.pin && tt > 0.97;
  L.destPin.visible = landed;
  L.ring.visible = landed;
  L.ring.scale.setScalar(1 + dv * 0.6);
  L.ring.material.opacity = 0.9 - dv * 0.4;
  renderer.clear();
  renderer.render(L.scene, L.cam);
  // The bloom opens from where the pin (or the country's middle) is on the glass now.
  const s = L.b.clone().project(L.cam);
  const o = [((s.x + 1) / 2) * L.W, ((1 - s.y) / 2) * L.H];
  const far = Math.max(...[[0, 0], [L.W, 0], [0, L.H], [L.W, L.H]].map(([x, y]) => Math.hypot(x - o[0], y - o[1])));
  const u = L.bloom.material.uniforms;
  u.uFade.value = 1 - smooth(0, 400, e);
  u.uR.value = bl > 0 ? outCubic(bl) * (far + BLOOM_FEATHER_PX) : 0;
  u.uO.value.set(o[0], o[1]);
  renderer.render(L.overlay, camera);
  L.origin = o;
  L.t = e;
  L.frames += 1;
}

function globeLoop(now) {
  globeRaf = requestAnimationFrame(globeLoop);
  if (now - globeLast < FRAME_GAP_MS) return;
  globeLast = now;
  globeDraw(performance.now() - globeLive.t0);
}

function globeEnd(reason) {
  if (globeRaf) cancelAnimationFrame(globeRaf);
  globeRaf = null;
  clearTimeout(globeDeadline);
  globeDeadline = null;
  if (!globeLive) return;
  const L = globeLive;
  canvas.style.display = "none";
  for (const sc of [L.scene, L.overlay]) {
    sc.traverse((o) => {
      o.geometry?.dispose();
      o.material?.dispose();
    });
    sc.clear();
  }
  for (const t of L.textures) t.dispose();
  renderer.renderLists.dispose();
  renderer.autoClear = true;
  renderer.setClearColor(0x000000, 0); // the rain needs a transparent canvas between drops
  globeLive = null;
  globeLastEnd = reason;
  L.onEnd?.(reason);
}

/**
 * Fly the globe from `home` to `place` ({ lat, lng }) inside `host` (the incoming journey
 * frame), before `before` (its grade). `from` / `to`: wall-sized 2D canvases of the outgoing
 * and incoming pictures, as for run(). `world`: decodeWorld() output; `litName`: the country
 * lit gold; `pin`: false for a country-only memory (no pin, no ring: it claims no point).
 * `sun`: the subsolar { lat, lng }. `sea`: sRGB [r, g, b] 0..1, the space around the globe.
 * `beats`: globeBeats(). `near`: diveDistance(). False = the caller keeps the flat map.
 *
 * @returns {boolean}
 */
export function globe({ host, before = null, from, to, world, home, place, litName = null, pin = true, sun, sea = [0.06, 0.06, 0.06], beats, near = GLOBE_NEAR, onEnd = null }) {
  if (!host || !from || !to || !world?.length || !home || !place || !sun || !(beats?.total > 0) || !ensure()) return false;
  end("replaced");
  globeEnd("replaced");
  rainStop();
  const W = from.width;
  const H = from.height;
  renderer.setSize(W, H, false);
  host.insertBefore(canvas, before);

  const earthTex = new CanvasTexture(earthFor(world, litName));
  earthTex.colorSpace = SRGBColorSpace;
  earthTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = [earthTex, texture(from), texture(to)];

  const scene3 = new Scene();
  scene3.add(new Mesh(new SphereGeometry(1, 128, 96), new ShaderMaterial({
    vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG,
    uniforms: { map: { value: earthTex }, sun: { value: vec(sun).normalize() } }
  })));
  scene3.add(new Mesh(new SphereGeometry(1.025, 64, 48), new ShaderMaterial({
    vertexShader: RIM_VERT, fragmentShader: RIM_FRAG, transparent: true, side: BackSide, depthWrite: false
  })));

  const a = vec(home);
  const b = vec(place);
  const omega = a.angleTo(b);
  const N = 240;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const p = omega > 1e-4
      ? a.clone().multiplyScalar(Math.sin((1 - t) * omega)).add(b.clone().multiplyScalar(Math.sin(t * omega))).divideScalar(Math.sin(omega))
      : a.clone().lerp(b, t);
    // Lifted mid-way on a long hop only, as the camera is.
    pts.push(p.normalize().multiplyScalar(1.004 + (beats.lift > 0 ? 0.22 : 0.05) * Math.sin(Math.PI * t)));
  }
  const arc = new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), N, 0.0045, 8, false), new ShaderMaterial({
    vertexShader: ARC_VERT, fragmentShader: ARC_FRAG, transparent: true, depthWrite: false,
    uniforms: { uA: { value: 0.95 }, uHorizon: { value: 1 / GLOBE_FAR } }
  }));
  scene3.add(arc);
  const dot = (p, color, size) => {
    const m = new Mesh(new SphereGeometry(size, 24, 16), new MeshBasicMaterial({ color }));
    m.position.copy(p).multiplyScalar(1.006);
    scene3.add(m);
    return m;
  };
  dot(a, 0xe8dccb, 0.009);
  const destPin = dot(b, 0xffc070, 0.012);
  const ring = new Mesh(new RingGeometry(0.02, 0.026, 48), new MeshBasicMaterial({ color: 0xffc070, transparent: true, side: DoubleSide }));
  ring.position.copy(b).multiplyScalar(1.007);
  ring.lookAt(b.clone().multiplyScalar(2));
  scene3.add(ring);

  const overlay = new Scene();
  const bloom = new Mesh(new PlaneGeometry(2, 2), new ShaderMaterial({
    vertexShader: VERT, fragmentShader: BLOOM_FRAG, transparent: true, depthTest: false, depthWrite: false,
    uniforms: {
      uOld: { value: textures[1] }, uNew: { value: textures[2] },
      uFade: { value: 1 }, uR: { value: 0 }, uO: { value: new Vector2() }, uRes: { value: new Vector2(W, H) }
    }
  }));
  bloom.frustumCulled = false;
  overlay.add(bloom);

  renderer.autoClear = false;
  renderer.setClearColor(new Color().setRGB(sea[0], sea[1], sea[2], SRGBColorSpace), 1);
  globeMoments += 1;
  globeLive = {
    scene: scene3, overlay, bloom, arc, arcCount: arc.geometry.index.count, destPin, ring, textures,
    cam: new PerspectiveCamera(30, W / H, 0.01, 100),
    a, b, omega, pin, near, beats, W, H, world, litName,
    t0: performance.now(), t: 0, frames: 0, origin: null, onEnd
  };
  globeDraw(0);
  canvas.style.display = "block";
  globeLast = 0;
  globeRaf = requestAnimationFrame(globeLoop);
  globeDeadline = setTimeout(() => globeEnd("done"), beats.total);
  return true;
}

/* The lit country's box on the glass right now, from its outline points on the near side. */
function countryBox(L) {
  const c = L.world.find((x) => x.name === L.litName);
  if (!c) return null;
  const camDir = L.cam.position.clone().normalize();
  const horizon = 1 / L.cam.position.length();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const p = new Vector3();
  for (const r of c.rings) {
    for (let i = 0; i < r.length; i += 2) {
      p.set(...lonLatVec(90 - r[i + 1] / 10, r[i] / 10 - 180));
      if (p.dot(camDir) < horizon) continue;
      p.project(L.cam);
      const x = ((p.x + 1) / 2) * L.W;
      const y = ((1 - p.y) / 2) * L.H;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1].map((v) => Math.round(v)) : null;
}

/** Stop now (depth change, a newer photograph): the photograph under it is already right. */
export function stop() {
  end("stopped");
  globeEnd("stopped");
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
    memory: renderer ? { ...renderer.info.memory } : null,
    rain: {
      on: Boolean(rainLive),
      drops: drops.length,
      sliding: drops.filter((d) => d.vy > 0).length,
      running: rainRaf !== null,
      frames: rainFrames
    },
    globe: {
      on: Boolean(globeLive),
      running: globeRaf !== null,
      t: globeLive ? Math.round(globeLive.t) : null,
      frames: globeLive?.frames ?? 0,
      pin: globeLive ? globeLive.pin : null,
      origin: globeLive?.origin?.map((v) => Math.round(v)) ?? null,
      countryBox: globeLive ? countryBox(globeLive) : null,
      moments: globeMoments,
      lastEnd: globeLastEnd
    }
  };
}
