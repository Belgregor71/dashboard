/* ═══════════════════════════════════════════════════════════════════════════
   THE DEEP DIORAMA — features.v3DioramaDepth. The owner's plate with depth.

   Reached ONLY through the dynamic import() in core/diorama.js. It builds a
   `world` for the one stage (stage.js) and never owns a renderer of its own.
   docs/design/HANDOVER-threejs-stage.md, "How the diorama gets depth".

     · The plate is a plane over the crop (plus a margin for the glide),
       lifted in the vertex shader by the height map (plan-depth, from the
       box's data/house-plan/). Relief is shaded in the fragment shader from
       the map's own slope, relative to flat ground, so the painted light of
       the illustration is kept and only walls and hedges gain a sunny and a
       shaded side. three's displacementMap leaves the normals flat (Phase 0).
     · The sun is the wall's: --sun-az / --sun-alt, stamped by main.js, turned
       by the plate's upBearing exactly as .plan__light turns its gradient.
     · Cars are cut-out quads with a shadow cast away from the sun; bins are
       boxes with a coloured lid; the robot's run is painted on a canvas laid
       on the plate, so it follows the floor.
     · Rain is the stage's own particle layer over the world.
     · Every geometry, material and texture made here is disposed by dispose();
       the stage calls it at the end of every moment (info.memory back to 0).
   ═══════════════════════════════════════════════════════════════════════════ */

import {
  Scene, Color, PerspectiveCamera, PlaneGeometry, BoxGeometry, ShaderMaterial, MeshBasicMaterial,
  MeshLambertMaterial, Mesh, Group, Texture, CanvasTexture, SRGBColorSpace, LinearFilter,
  AmbientLight, DirectionalLight, Vector3
} from "three";
import { play as stagePlay, stop as stageStop } from "./stage.js";

const FOV = 30;
const TILT_DEG = 6;          // the handover: 8° or less; the picture has its own perspective painted in
const LIFT = 0.035;          // wall height as a share of the plate's width (Phase 0's still)
const MARGIN = 0.25;         // plane beyond the crop on each side, for the glide and the tilt
const SEGMENTS = 720;        // across the plane; Phase 0's 750 kept the walls clean
const CAR_Z = 2;
const BIN_DROP = 120;
const BIN_MS = 500;
const BACKDROP = 0x0b0d10;   // under the plate's edges, near --scrim-base

const VERT = `
uniform sampler2D uDepth;
uniform vec4 uRect;
uniform float uLift;
varying vec2 vUv;
void main() {
  vUv = uRect.xy + uv * uRect.zw;
  vec3 p = position;
  p.z += texture2D(uDepth, vUv).r * uLift;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAG = `
uniform sampler2D uPlate;
uniform sampler2D uDepth;
uniform sampler2D uTrail;
uniform float uTrailOn;
uniform vec2 uTexel;
uniform float uSlope;
uniform vec3 uSun;
uniform float uNight;
varying vec2 vUv;
void main() {
  float hx = texture2D(uDepth, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDepth, vUv - vec2(uTexel.x, 0.0)).r;
  float hy = texture2D(uDepth, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDepth, vUv - vec2(0.0, uTexel.y)).r;
  vec3 n = normalize(vec3(-hx * uSlope, -hy * uSlope, 1.0));
  // Relative to flat ground: the floor keeps the illustration's own light.
  float shade = clamp(max(dot(n, uSun), 0.0) / max(uSun.z, 0.25), 0.45, 1.25);
  vec3 col = texture2D(uPlate, vUv).rgb * mix(1.0, shade, 0.7);
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
  const e = (Math.max(altDeg, 8) * Math.PI) / 180; // below 8° the walls would black out the plate
  return [Math.sin(b) * Math.cos(e), Math.cos(b) * Math.cos(e), Math.sin(e)];
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

function trailCanvas(robot, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const { trail, at, size, error } = robot;
  ctx.lineCap = ctx.lineJoin = "round";
  if (trail.length > 1) {
    ctx.globalAlpha = 0.8;
    ctx.strokeStyle = token("--robot-trail");
    ctx.lineWidth = size * 0.55;
    ctx.beginPath();
    trail.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.beginPath();
  ctx.arc(at[0], at[1], size, 0, Math.PI * 2);
  ctx.fillStyle = error ? token("--robot-error") : token("--ink") || "#fff";
  ctx.fill();
  ctx.lineWidth = size * 0.35;
  ctx.strokeStyle = error ? token("--ink") || "#fff" : token("--robot-ring");
  ctx.stroke();
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
    const light = o.night ? 0.45 : 1;

    // The plate: a plane over the crop and its margin, clamped to the plate.
    const x0 = Math.max(0, cx - cw * MARGIN), x1 = Math.min(W, cx + cw * (1 + MARGIN));
    const y0 = Math.max(0, cy - ch * MARGIN), y1 = Math.min(H, cy + ch * (1 + MARGIN));
    const pw = x1 - x0, ph = y1 - y0;
    const lift = LIFT * W;
    const depth = keep(texture(o.depth, false));
    depth.minFilter = LinearFilter;
    depth.generateMipmaps = false;
    const trail = o.robot ? keep(new CanvasTexture(trailCanvas(o.robot, W, H))) : null;
    const plane = new Mesh(
      keep(new PlaneGeometry(pw, ph, SEGMENTS, Math.max(1, Math.round((SEGMENTS * ph) / pw)))),
      keep(new ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: {
          uPlate: { value: keep(texture(o.base, false)) },
          uDepth: { value: depth },
          uTrail: { value: trail ?? depth },
          uTrailOn: { value: trail ? 1 : 0 },
          uRect: { value: [x0 / W, 1 - y1 / H, pw / W, ph / H] },
          uLift: { value: lift },
          uTexel: { value: [1 / o.depth.naturalWidth, 1 / o.depth.naturalHeight] },
          // Height change across two texels, in world units per world unit.
          uSlope: { value: lift / (2 * (W / o.depth.naturalWidth)) },
          uSun: { value: new Vector3(...sun) },
          uNight: { value: o.night ? 1 : 0 }
        }
      }))
    );
    plane.position.set(x0 + pw / 2, -(y0 + ph / 2), 0);
    scene.add(plane);

    scene.add(new AmbientLight(0xffffff, 0.9 * light));
    const sunLight = new DirectionalLight(0xffffff, 1.6 * light);
    sunLight.position.set(...sun);
    scene.add(sunLight);

    // Cars: the cut-out, and its shadow cast away from the sun.
    const away = [-sun[0] * 6, -sun[1] * 6];
    // No depth test: the flat cut-out sits on top as it does flat, even where the map lifts the drive.
    const car = ({ image, box }) => {
      const map = keep(texture(image, true));
      const geometry = keep(new PlaneGeometry(box.w, box.h));
      const group = new Group();
      const shadow = new Mesh(geometry, keep(new MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false, depthTest: false })));
      shadow.position.set(away[0], away[1], CAR_Z - 1);
      const body = new Mesh(geometry, keep(new MeshBasicMaterial({ map, transparent: true, depthWrite: false, depthTest: false })));
      body.material.color.setScalar(light);
      body.position.z = CAR_Z;
      group.add(shadow, body);
      group.position.set(box.x + box.w / 2, -(box.y + box.h / 2), 0);
      scene.add(group);
      return group;
    };
    o.parked.forEach(car);
    const rolling = o.rolling ? car(o.rolling) : null;
    const rollFrom = o.rolling ? -(o.rolling.box.x + o.rolling.box.w + 20) : 0;
    const restX = rolling?.position.x ?? 0;

    // Bins: a charcoal body, the coloured lid on top (BoxGeometry face 4 is +z).
    const bins = o.bins.map(({ colour, box }) => {
      const tall = box.h * 0.9;
      const body = keep(new MeshLambertMaterial({ color: 0x23272a }));
      const lid = keep(new MeshLambertMaterial({ color: colour }));
      const mesh = new Mesh(keep(new BoxGeometry(box.w, box.h, tall)), [body, body, body, body, lid, body]);
      mesh.position.set(box.x + box.w / 2, -(box.y + box.h / 2), tall / 2);
      mesh.visible = false;
      scene.add(mesh);
      return { mesh, rest: tall / 2 };
    });

    const camera = new PerspectiveCamera(FOV, w / h, 1, 50000);
    const near = coverDistance(cw, ch, w / h);
    const centre = new Vector3(cx + cw / 2, -(cy + ch / 2), 0);
    const glideS = (o.timing.fadeAt + 700) / 1000;
    let rollX = rollFrom;
    let tilt = 0;

    const step = (t) => {
      const ms = t * 1000;
      const p = easeInOut(clamp01(t / glideS));
      tilt = TILT_DEG * p;
      const dist = near * (1.1 - 0.14 * p); // ends 4% inside the crop, so the tilt's far edge stays on the plate
      const r = (tilt * Math.PI) / 180;
      camera.position.set(centre.x, centre.y - dist * Math.sin(r), dist * Math.cos(r));
      camera.lookAt(centre);
      if (rolling) {
        rollX = rollFrom * (1 - easeOut(clamp01((ms - o.timing.rollDelay) / o.timing.roll)));
        rolling.position.x = restX + rollX;
      }
      bins.forEach(({ mesh, rest }, i) => {
        const k = (ms - o.timing.rollDelay - i * o.timing.binStagger) / BIN_MS;
        mesh.visible = k >= 0;
        mesh.position.z = rest + BIN_DROP * (1 - easeOut(clamp01(k)));
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
        bins: bins.filter((b) => b.mesh.visible).length,
        trail: Boolean(trail),
        night: Boolean(o.night),
        tilt: Math.round(tilt * 10) / 10
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
