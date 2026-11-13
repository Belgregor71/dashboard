/* ═══════════════════════════════════════════════════════════════════════════
   THE DEEP DIORAMA — features.v3DioramaDepth. The owner's plate, lit by the sun.

   Reached ONLY through the dynamic import() in core/diorama.js. It builds a
   `world` for the one stage (stage.js) and never owns a renderer of its own.
   docs/design/HANDOVER-threejs-stage.md, "Phase 3 results".

   Direction B (owner, 2026-11-14). The first build lifted the plate by the
   height map and the owner saw it on the wall: floors crumpled, every raised
   edge smeared, a black bar at the plate's edge. So the picture stays FLAT and
   crisp, and the depth comes from light and movement:

     · Walls cast soft shadows from the wall's real sun (--sun-az / --sun-alt,
       turned by the plate's upBearing as .plan__light turns its gradient).
       The height map (plan-depth) only says WHERE the walls are; furniture and
       hedges sit under its wall threshold and cast nothing.
     · The camera pushes in slowly and never pulls back past the crop, so the
       view stays on the plate.
     · Cars are the cut-outs with a shadow cast away from the sun; bins are
       drawn from above as the flat diorama draws them, and drop in the same
       way; the robot's run is painted on a canvas laid on the plate.
     · Rain is the stage's own particle layer over the world.
     · Phase 4 (features.v3DioramaNight): the owner's night plate, pixel-aligned
       with the day one, fades in as the sun goes down (`dusk`, 0 by day, 1 by
       full dark), the wall shadows fade out with the daylight, and the car
       rolling in has its headlights on. No night plate, or a dressed plate
       (which has no night version): the night tint, as before.
     · Every geometry, material and texture made here is disposed by dispose();
       the stage calls it at the end of every moment (info.memory back to 0).
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  Scene, Color, PerspectiveCamera, PlaneGeometry, ShaderMaterial, MeshBasicMaterial,
  Mesh, Group, Texture, CanvasTexture, SRGBColorSpace, Vector3, AdditiveBlending
} from "three";
import { play as stagePlay, stop as stageStop } from "./stage.js";

const FOV = 30;
const PUSH = 0.08;            // the push-in: from the crop (1.0) to 8% inside it
const WALL_PX = 22;           // a wall's height in plate pixels, for the shadow's length
const SHADOW_MAX_PX = 48;     // a low sun's shadow stops here rather than crossing a room
const SHADOW = 0.6;           // how dark a full shadow is
const STEPS = 12;            // offset copies of the wall mask that make one shadow
const SHADOW_SCALE = 0.5;     // the shadow canvas at half the plate: it is blurred anyway
const CAR_Z = 2;
const BIN_MS = 500;
const BACKDROP = 0x0b0d10;    // only ever seen if a crop is smaller than the wall

const VERT = `
uniform vec4 uRect;
varying vec2 vUv;
void main() {
  vUv = uRect.xy + uv * uRect.zw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/* The shadow is drawn once per moment (shadowCanvas), so the fragment shader
   reads it with one lookup: a march per pixel per frame cost the GPU for a sun
   that does not move in six seconds, and its steps showed as stripes. */
const FRAG = `
uniform sampler2D uPlate;
uniform sampler2D uShade;
uniform sampler2D uTrail;
uniform float uTrailOn;
uniform float uShadow;
uniform float uNight;
uniform sampler2D uNightPlate;
uniform float uDusk;
varying vec2 vUv;
void main() {
  vec3 col = texture2D(uPlate, vUv).rgb;
  col *= 1.0 - uShadow * texture2D(uShade, vUv).a;
  // The night plate: the same drawing with the lights on, faded in by the sun.
  col = mix(col, texture2D(uNightPlate, vUv).rgb, uDusk);
  if (uTrailOn > 0.5) {
    vec4 t = texture2D(uTrail, vUv);
    col = mix(col, t.rgb, t.a);
  }
  // As .plan__light at night: the plan-night shade at 68%.
  col = mix(col, vec3(0.05, 0.07, 0.13), uNight * 0.68);
  gl_FragColor = vec4(col, 1.0);
}`;

const easeOut = (t) => 1 - (1 - t) ** 3;                     // shortcut: stands in for the flat car's cubic-bezier(0.16,0.7,0.3,1); swap for a solver if the owner sees a difference
const easeInOut = (t) => 0.5 - 0.5 * Math.cos(Math.PI * t);
const clamp01 = (t) => Math.max(0, Math.min(1, t));

/** Toward the sun in world space (x right, y up the plate, z up). Pure.
    suncalc's azimuth is from south, west positive; +π is a compass bearing. */
export function sunVector(azRad, altDeg, upBearingDeg) {
  const b = azRad + Math.PI - (upBearingDeg * Math.PI) / 180;
  const e = (Math.max(altDeg, 8) * Math.PI) / 180; // a sun on the horizon would cast endless shadows
  return [Math.sin(b) * Math.cos(e), Math.cos(b) * Math.cos(e), Math.sin(e)];
}

/** How dark it is, 0 (sun 2° up or higher) to 1 (6° below the horizon, civil
    dusk's end). The wall's own night switch is at -2°, inside this ramp. Pure. */
export function duskOf(altDeg) {
  return clamp01((2 - altDeg) / 8);
}

/** How far a wall's shadow reaches across the floor, in plate px. Pure. */
export function shadowLength([x, y, z]) {
  return Math.min(SHADOW_MAX_PX, (WALL_PX * Math.hypot(x, y)) / Math.max(1e-3, z)); // height ÷ tan(elevation)
}

/** Camera distance that covers the viewport with the crop, as cropBox does. Pure. */
export function coverDistance(cw, ch, aspect, fovDeg = FOV) {
  const visibleH = cw / ch > aspect ? ch : cw / aspect;
  return visibleH / 2 / Math.tan((fovDeg * Math.PI) / 360);
}

function texture(image, srgb) {
  const t = new Texture(image);
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

/* Where the walls are, from the height map: walls only (furniture and hedges
   sit under 0.6). The map never changes, so this is made once per page. */
let wallMask = null;
function wallsOf(depth) {
  if (wallMask?.source === depth) return wallMask.canvas;
  const w = Math.round(depth.naturalWidth * SHADOW_SCALE), h = Math.round(depth.naturalHeight * SHADOW_SCALE);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(depth, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i] / 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 0;
    img.data[i + 3] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.6) / 0.3)));
  }
  ctx.putImageData(img, 0, 0);
  wallMask = { source: depth, canvas };
  return canvas;
}

/* The walls' shadow for this sun: the wall mask laid down again and again
   along the shadow's direction, fading with distance, blurred soft, with the
   wall tops themselves cut back out. Alpha is how dark. */
function shadowCanvas(depth, away, reach) {
  const walls = wallsOf(depth);
  const canvas = document.createElement("canvas");
  canvas.width = walls.width;
  canvas.height = walls.height;
  const ctx = canvas.getContext("2d");
  ctx.filter = `blur(${Math.max(1, reach * SHADOW_SCALE * 0.12).toFixed(1)}px)`;
  for (let i = 1; i <= STEPS; i++) {
    const k = i / STEPS;
    ctx.globalAlpha = 0.35 * (1 - 0.6 * k);
    // away is world space (y up); the canvas runs y down.
    ctx.drawImage(walls, away[0] * reach * k * SHADOW_SCALE, -away[1] * reach * k * SHADOW_SCALE);
  }
  ctx.filter = "none";
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(walls, 0, 0);
  return canvas;
}

/* Headlights from above: two warm beams widening ahead of the car, drawn
   once. The car art faces +x (it rolls in nose first), so the beams do too. */
function beamCanvas() {
  const w = 256, h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.filter = "blur(7px)"; // soft-edged pools of light, not drawn cones
  for (const y of [0.3, 0.7]) {
    const g = ctx.createRadialGradient(0, h * y, 2, 0, h * y, w);
    g.addColorStop(0, "rgba(255,244,214,0.9)");
    g.addColorStop(0.35, "rgba(255,236,190,0.35)");
    g.addColorStop(1, "rgba(255,230,180,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, h * y - h * 0.05);
    ctx.lineTo(w, h * y - h * 0.32);
    ctx.lineTo(w, h * y + h * 0.32);
    ctx.lineTo(0, h * y + h * 0.05);
    ctx.closePath();
    ctx.fill();
  }
  return canvas;
}

const token = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function trailCanvas(robot, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const { trail, at, size, error } = robot;
  ctx.lineCap = ctx.lineJoin = "round";
  if (trail.length > 1) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = token("--robot-trail", "#82dcff");
    ctx.lineWidth = size * 0.55;
    ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(at[0], at[1], size, 0, Math.PI * 2);
  ctx.fillStyle = error ? token("--robot-error", "#ff7a3c") : token("--ink", "#fff");
  ctx.fill();
  ctx.lineWidth = size * 0.35;
  ctx.strokeStyle = error ? token("--ink", "#fff") : token("--robot-ring", "#1e8ceb");
  ctx.stroke();
  return canvas;
}

/* A wheelie bin from above, as compose.css's .diorama__bin draws it: a
   charcoal body, the coloured lid inset with a sheen, the hinge bar along the
   house side. */
function binCanvas(colour) {
  const w = 60, h = 76;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const round = (x, y, rw, rh, r) => { ctx.beginPath(); ctx.roundRect(x, y, rw, rh, r); ctx.fill(); };
  ctx.fillStyle = token("--bin-body", "#23272a");
  round(0, 0, w, h, 8);
  ctx.fillStyle = colour;
  round(w * 0.08, h * 0.08, w * 0.76, h * 0.84, 6);
  const sheen = ctx.createLinearGradient(0, 0, w, h);
  sheen.addColorStop(0, "rgba(255,255,255,0.28)");
  sheen.addColorStop(0.45, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = sheen;
  round(w * 0.08, h * 0.08, w * 0.76, h * 0.84, 6);
  ctx.fillStyle = token("--bin-hinge", "#15181a");
  round(w * 0.89, h * 0.16, w * 0.06, h * 0.68, 2);
  return canvas;
}

function world(o) {
  return (w, h) => {
    const owned = [];
    const keep = (x) => { owned.push(x); return x; };
    const { width: W, height: H } = o.plate;
    const [cx, cy, cw, ch] = o.crop;
    const scene = new Scene();
    scene.background = new Color(BACKDROP);

    const sun = sunVector(o.sunAz, o.sunAlt, o.plate.upBearing ?? 0);
    const reach = shadowLength(sun);
    const flat = Math.hypot(sun[0], sun[1]) || 1;
    const away = [-sun[0] / flat, -sun[1] / flat];       // shadows fall this way, unit length
    // With the night plate the sun fades the day out; without it, the night switch tints.
    const dusk = o.nightPlate ? o.dusk : 0;
    const tinted = !o.nightPlate && o.night;
    const light = tinted ? 0.45 : 1 - 0.4 * dusk;
    const shadow = tinted ? 0 : SHADOW * (1 - dusk);     // no sun, no sun shadows

    // The plate: one flat quad over exactly the crop. The push-in only ever moves closer.
    const trail = o.robot ? keep(new CanvasTexture(trailCanvas(o.robot, W, H))) : null;
    const shade = keep(new CanvasTexture(shadowCanvas(o.depth, away, reach)));
    const plane = new Mesh(
      keep(new PlaneGeometry(cw, ch)),
      keep(new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPlate: { value: keep(texture(o.base, false)) },
          uShade: { value: shade },
          uTrail: { value: trail ?? shade },
          uTrailOn: { value: trail ? 1 : 0 },
          uRect: { value: [cx / W, 1 - (cy + ch) / H, cw / W, ch / H] },
          uShadow: { value: shadow },
          uNight: { value: tinted ? 1 : 0 },
          uNightPlate: { value: o.nightPlate ? keep(texture(o.nightPlate, false)) : shade },
          uDusk: { value: dusk }
        }
      }))
    );
    plane.position.set(cx + cw / 2, -(cy + ch / 2), 0);
    scene.add(plane);

    // A cut-out with its shadow cast away from the sun. No depth test: it sits on top, as it does flat.
    const cutout = (map, box, z, shade) => {
      const geometry = keep(new PlaneGeometry(box.w, box.h));
      const group = new Group();
      const under = new Mesh(geometry, keep(new MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0.45 * shade, depthWrite: false, depthTest: false })));
      under.position.set(away[0] * 6, away[1] * 6, z - 1);
      const body = new Mesh(geometry, keep(new MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false })));
      body.material.color.setScalar(light);
      body.position.z = z;
      under.userData.alpha = 0.45 * shade;
      body.userData.alpha = 1;
      group.add(under, body);
      group.position.set(box.x + box.w / 2, -(box.y + box.h / 2), 0);
      scene.add(group);
      return group;
    };
    const car = ({ image, box }) => cutout(keep(texture(image, true)), box, CAR_Z, 1);
    o.parked.forEach(car);
    const rolling = o.rolling ? car(o.rolling) : null;
    const rollFrom = o.rolling ? -(o.rolling.box.x + o.rolling.box.w + 20) : 0;
    // Headlights on the car rolling in, once the night plate is fading in. Additive, so they light.
    let beams = null;
    if (rolling && dusk > 0) {
      const { w: bw, h: bh } = o.rolling.box;
      const map = keep(new CanvasTexture(beamCanvas()));
      map.colorSpace = SRGBColorSpace;
      // Short, so they light the drive and the garage floor rather than the rooms past its wall.
      beams = new Mesh(keep(new PlaneGeometry(bw * 0.8, bh * 1.0)),
        keep(new MeshBasicMaterial({ map, transparent: true, opacity: 0.85 * dusk, blending: AdditiveBlending, depthWrite: false, depthTest: false })));
      beams.position.set(bw / 2 + bw * 0.4 - 2, 0, CAR_Z - 0.5);
      rolling.add(beams);
    }
    const restX = rolling?.position.x ?? 0;

    // Bins drop in as the flat ones do: from 24% of their height above, fading in.
    const bins = o.bins.map(({ colour, box }) => {
      const map = keep(new CanvasTexture(binCanvas(colour)));
      map.colorSpace = SRGBColorSpace;
      const group = cutout(map, box, CAR_Z + 1, 1);
      group.visible = false;
      return { group, restY: group.position.y, drop: box.h * 0.24 };
    });

    const camera = new PerspectiveCamera(FOV, w / h, 1, 50000);
    const cover = coverDistance(cw, ch, w / h);
    const centre = new Vector3(cx + cw / 2, -(cy + ch / 2), 0);
    const glideS = (o.timing.fadeAt + 700) / 1000;
    let zoom = 1;

    const step = (t) => {
      const ms = t * 1000;
      zoom = 1 / (1 - PUSH * easeInOut(clamp01(t / glideS)));
      camera.position.set(centre.x, centre.y, cover / zoom);
      camera.lookAt(centre);
      const rolled = clamp01((ms - o.timing.rollDelay) / o.timing.roll);
      if (rolling) rolling.position.x = restX + rollFrom * (1 - easeOut(rolled));
      // The lights go off as the car comes to rest, over the last quarter of the roll.
      if (beams) beams.material.opacity = 0.85 * dusk * (1 - clamp01((rolled - 0.75) / 0.25));
      bins.forEach(({ group, restY, drop }, i) => {
        const k = clamp01((ms - o.timing.rollDelay - i * o.timing.binStagger) / BIN_MS);
        group.visible = ms >= o.timing.rollDelay + i * o.timing.binStagger;
        group.position.y = restY + drop * (1 - easeOut(k));
        for (const mesh of group.children) mesh.material.opacity = mesh.userData.alpha * k;
      });
    };
    step(0);

    return {
      scene,
      camera,
      step,
      dispose: () => { for (const x of owned) x.dispose(); owned.length = 0; },
      info: () => ({
        name: "diorama",
        cars: o.parked.length + (rolling ? 1 : 0),
        // Read off the mesh, not the eased number, so a car that never moves reads so. Never -0.
        rolling: rolling ? Math.round(rolling.position.x - restX) || 0 : null,
        bins: bins.filter((b) => b.group.visible).length,
        trail: Boolean(trail),
        night: Boolean(o.night),
        nightPlate: Boolean(o.nightPlate),
        dusk: Math.round(dusk * 100) / 100,
        headlights: Boolean(beams?.visible && beams.material.opacity > 0),
        shadowPx: Math.round(reach * (shadow > 0 ? 1 : 0)),
        zoom: Math.round(zoom * 1000) / 1000
      })
    };
  };
}

/** Play the deep diorama for `deadlineMs`. False when the stage cannot (dead,
    or the dogs hold it): the caller plays the flat one instead. */
export function playDeep(o, deadlineMs) {
  return stagePlay(o.raining ? "rain" : null, deadlineMs, { world: world(o), owner: "diorama" });
}

/** Fade the deep diorama out. Leaves a dogs' moment alone. */
export const stopDeep = () => stageStop("diorama");

export { state } from "./stage.js";
