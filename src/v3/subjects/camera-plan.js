/* ═══════════════════════════════════════════════════════════════════════════
   THE CAMERA PLAN — where on the property am I looking? (features.v3CameraPlan)

   A camera fills the wall with no sense of where it is. This lays the illustrated
   plan of the house over a camera subject, in one of two shapes:

     dive     asked for ("show me the driveway"): the whole property, then down
              onto what that camera sees, dissolving into the picture.
     locator  the reflex lane (doorbell, side gate): a small corner plan and
              nothing else. A door must not wait for a flourish.

   Both sit ON TOP of a camera that has already mounted, so neither delays it: the
   still and the stream load underneath exactly as they do with the flag off. A
   missing plan, or a camera with no position, simply adds nothing.

   The plan and positions are not in this repo: see server/routes/housePlan.js.
   ═══════════════════════════════════════════════════════════════════════════ */

const SVG = "http://www.w3.org/2000/svg";

const HOLD_MS = 700;        // the depth fade takes 350 of this; the rest reads as the house
const DIVE_MS = 2200;       // the owner's eye on the wall: 1500 was a touch quick
const DIVE_SCALE = 2.4;
const FADE_MS = 700;
const FADE_AT_MS = 2250;    // starts before the dive lands, so the soft end is short
const LOCATOR_MS = 8000;    // long enough to place it, then give the corner back

let plan = null;            // { meta, src }
let loading = null;

const planOn = () => Boolean(globalThis.window?.CONFIG?.features?.v3CameraPlan);

/** Fetch and decode once, ahead of need: the answer path has no time for it. */
export function warmCameraPlan() {
  if (plan || loading || !planOn()) return loading;
  const load = async () => {
    const res = await fetch("/api/house-plan");
    if (!res.ok) return;
    const meta = await res.json();
    if (!meta?.cameras || !meta.width || !meta.height) return;
    const image = new Image();
    image.src = "/api/house-plan/image";
    await image.decode();
    plan = { meta, src: image.src };
  };
  loading = load().then(() => { loading = null; }, () => { loading = null; });
  return loading;
}

/** The middle of what a camera sees, as fractions of the plate. */
export function fovCentre(fov) {
  return [0, 1].map((axis) => fov.reduce((sum, point) => sum + point[axis], 0) / fov.length);
}

/** The plate contained in the viewport, in px. */
export function containBox(vw, vh, aspect) {
  const width = Math.min(vw, vh * aspect);
  const height = width / aspect;
  return { width, height, left: (vw - width) / 2, top: (vh - height) / 2 };
}

/** Translate that centres a plate fraction at `scale`, stopping at the plate's
 *  edge: the driveway sits on it, and centring it left a third of the wall black. */
export function diveOffset([fx, fy], box, vw, vh, scale) {
  const fit = (want, start, size, view) => Math.min(-start, Math.max(view - start - size, want));
  return {
    x: fit(vw / 2 - box.left - fx * box.width * scale, box.left, box.width * scale, vw),
    y: fit(vh / 2 - box.top - fy * box.height * scale, box.top, box.height * scale, vh)
  };
}

function wedge(fov) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "plan__fov");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("preserveAspectRatio", "none");
  const polygon = document.createElementNS(SVG, "polygon");
  polygon.setAttribute("points", fov.map(([x, y]) => `${x * 100},${y * 100}`).join(" "));
  svg.append(polygon);
  return svg;
}

/**
 * Lay the plan over a camera subject, under `caption`.
 * @returns {null|function} teardown, or null when there is nothing to lay.
 */
export function attachCameraPlan(wrap, caption, cameraId, { reflex = false } = {}) {
  if (!planOn()) return null;
  warmCameraPlan();
  const camera = plan?.meta.cameras[cameraId];
  if (!camera?.fov) return null;

  const { width, height, upBearing = 0 } = plan.meta;
  const overlay = document.createElement("div");
  overlay.className = `plan ${reflex ? "plan--locator" : "plan--dive"}`;
  overlay.style.setProperty("--plan-up", `${upBearing}deg`);

  const world = document.createElement("div");
  world.className = "plan__world";

  const image = document.createElement("img");
  image.className = "plan__image";
  image.alt = "";
  image.decoding = "sync";
  image.src = plan.src;

  const light = document.createElement("div");
  light.className = "plan__light";

  world.append(image, light, wedge(camera.fov));
  overlay.append(world);
  wrap.insertBefore(overlay, caption);

  const animations = [];
  let goneAt = LOCATOR_MS + FADE_MS;
  if (reflex) {
    overlay.style.aspectRatio = `${width} / ${height}`;
    animations.push(overlay.animate({ opacity: [1, 0] }, { delay: LOCATOR_MS, duration: FADE_MS, fill: "forwards" }));
  } else {
    /* The viewport, not the wrap: this runs before the mount, and a detached node
       measures 0. Depth 3 is full bleed, so the two are the same box. */
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const box = containBox(vw, vh, width / height);
    Object.assign(world.style, {
      width: `${box.width}px`,
      height: `${box.height}px`,
      left: `${box.left}px`,
      top: `${box.top}px`
    });
    const { x, y } = diveOffset(fovCentre(camera.fov), box, vw, vh, DIVE_SCALE);
    animations.push(
      world.animate(
        { transform: ["translate(0, 0) scale(1)", `translate(${x}px, ${y}px) scale(${DIVE_SCALE})`] },
        { delay: HOLD_MS, duration: DIVE_MS, easing: "cubic-bezier(0.45, 0, 0.2, 1)", fill: "forwards" }
      ),
      overlay.animate({ opacity: [1, 0] }, { delay: FADE_AT_MS, duration: FADE_MS, fill: "forwards" })
    );
    goneAt = Math.max(HOLD_MS + DIVE_MS, FADE_AT_MS + FADE_MS);
  }

  /* A timer rather than `finished`: animation events do not fire behind a
     display:none ancestor, and on this wall that is most ancestors. */
  let done = false;
  const remove = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    image.src = "";
    overlay.remove();
  };
  const timer = setTimeout(remove, goneAt + 50);
  return remove;
}
