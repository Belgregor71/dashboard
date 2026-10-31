/* ═══════════════════════════════════════════════════════════════════════════
   THE DIORAMA — the house showing what just happened (features.v3Diorama).

   Two moments, a few seconds each, over whatever the wall is doing:

     arrival   the front of the house with the garage as it stands: whoever is
               already home is parked, and the car of the person who just got in
               rolls up the driveway.
     bins      the same view with the night's bins out at the kerb.

   It hangs off the attention tick rather than the arrival or bin code, because
   "this reached the glass" already carries every rule about quiet, decay and
   whether anyone is in the room. Nothing is spoken or written here, so the line
   underneath is there as soon as the plate fades.

   Full wall, not a corner: a spread can fill every corner, and at corner size the
   car is 50 px from across the room. Never at depth 3: someone asked for that.

   Plate, cars and positions are private: see server/routes/housePlan.js. With no
   diorama in the data the moment simply does not happen.
   ═══════════════════════════════════════════════════════════════════════════ */

import { DEPTH, onDepth } from "./depth.js";
import { occasionToday } from "./dog-schedule.js";
import { getEntity } from "../../js/services/homeAssistant/state.js";

const ROLL_DELAY_MS = 450;   // the fade in takes 350 of this
const ROLL_MS = 2800;
const FADE_IN_MS = 350;
const FADE_AT_MS = 5600;     // long enough to read it after the car stops
const FADE_MS = 700;
const BIN_STAGGER_MS = 260;

const BIN_INK = { red: "#a8281f", yellow: "#dcae12", green: "#2f7a36" };

let plate = null;            // { width, height, upBearing, crop, cars, bins, binSize }
let loading = null;
let showing = null;          // teardown of the moment on the glass
const seen = new Map();      // candidate id → key last played
const dressed = new Map();   // occasion → its decoded Image; held, so a moment never waits on one
let played = 0;

const dioramaOn = () => Boolean(globalThis.window?.CONFIG?.features?.v3Diorama);
const dressedOn = () => Boolean(globalThis.window?.CONFIG?.features?.v3DioramaDressed);

const layerUrl = (name) => `/api/house-plan/layer/${name}`;

/** What a candidate on the glass asks for, or null. Pure. */
export function momentFor(candidate) {
  const id = String(candidate?.id ?? "");
  if (id.startsWith("arrival:")) return { rolling: id.slice("arrival:".length) };
  if (/^bin-(night|last-chance|weather):/.test(id)) {
    const bins = String(candidate.text ?? "").toLowerCase().match(/\b(red|yellow|green)\b/g);
    return bins ? { bins: [...new Set(bins)] } : null;
  }
  return null;
}

/** Who to park: everyone home, bar the car that is rolling in. Pure. */
export function parkedCars(cars, rolling, stateOf) {
  return Object.keys(cars).filter((id) => id !== rolling && stateOf(id) === "home");
}

/** Lay a plate crop over the viewport, cover-fit. Pure. */
export function cropBox([x, y, w, h], vw, vh) {
  const scale = Math.max(vw / w, vh / h);
  return { scale, left: -x * scale, top: -y * scale };
}

function warm() {
  if (plate || loading || !dioramaOn()) return loading;
  const load = async () => {
    const res = await fetch("/api/house-plan");
    if (!res.ok) return;
    const meta = await res.json();
    const d = meta?.diorama;
    if (!d?.crop || !d.cars || !meta.width || !meta.height) return;
    const names = ["plan-empty", ...Object.values(d.cars).map((car) => car.layer)];
    await Promise.all(names.map((name) => {
      const image = new Image();
      image.src = layerUrl(name);
      return image.decode();
    }));
    plate = { width: meta.width, height: meta.height, upBearing: meta.upBearing ?? 0, ...d };
    /* One at a time and after the plate is ready: a dressed plate that is missing
       or broken costs that occasion its dress, and nothing else. */
    if (!dressedOn()) return;
    for (const [occasion, name] of Object.entries(d.dressed ?? {})) {
      const image = new Image();
      image.src = layerUrl(name);
      await image.decode().then(() => dressed.set(occasion, image), () => {});
    }
  };
  loading = load().then(() => { loading = null; }, () => { loading = null; });
  return loading;
}

function place(node, { x, y, w, h }, scale) {
  Object.assign(node.style, {
    left: `${x * scale}px`,
    top: `${y * scale}px`,
    width: `${w * scale}px`,
    height: `${h * scale}px`
  });
  return node;
}

function carNode(car, scale) {
  const image = document.createElement("img");
  image.className = "diorama__car";
  image.alt = "";
  image.decoding = "sync";
  image.src = layerUrl(car.layer);
  return place(image, car, scale);
}

function play(moment) {
  const host = document.querySelector(".stage");
  if (!host) return;

  const { scale, left, top } = cropBox(plate.crop, window.innerWidth, window.innerHeight);
  const overlay = document.createElement("div");
  overlay.className = "diorama";
  overlay.style.setProperty("--plan-up", `${plate.upBearing}deg`);

  const world = document.createElement("div");
  world.className = "diorama__world";
  Object.assign(world.style, {
    left: `${left}px`,
    top: `${top}px`,
    width: `${plate.width * scale}px`,
    height: `${plate.height * scale}px`
  });

  const base = document.createElement("img");
  base.className = "diorama__plate";
  base.alt = "";
  base.decoding = "sync";
  base.src = dressed.get(occasionToday())?.src ?? layerUrl("plan-empty");
  world.append(base);

  for (const id of parkedCars(plate.cars, moment.rolling, (entity) => getEntity(entity)?.state)) {
    world.append(carNode(plate.cars[id], scale));
  }

  const animations = [overlay.animate({ opacity: [0, 1] }, { duration: FADE_IN_MS, fill: "backwards" })];

  const car = plate.cars[moment.rolling];
  if (car) {
    const node = carNode(car, scale);
    world.append(node);
    const from = -(car.x + car.w + 20) * scale;   // clear of the plate's street edge
    animations.push(node.animate(
      { transform: [`translateX(${from}px)`, "translateX(0)"] },
      { delay: ROLL_DELAY_MS, duration: ROLL_MS, easing: "cubic-bezier(0.16, 0.7, 0.3, 1)", fill: "backwards" }
    ));
  }

  (moment.bins ?? []).forEach((colour, i) => {
    const spot = plate.bins?.[i];
    if (!spot || !BIN_INK[colour]) return;
    const bin = document.createElement("div");
    bin.className = "diorama__bin";
    bin.dataset.colour = colour;
    bin.style.setProperty("--bin", BIN_INK[colour]);
    world.append(place(bin, { ...spot, ...plate.binSize }, scale));
    animations.push(bin.animate(
      { opacity: [0, 1], transform: ["translateY(-24%)", "translateY(0)"] },
      { delay: ROLL_DELAY_MS + i * BIN_STAGGER_MS, duration: 500, easing: "ease-out", fill: "backwards" }
    ));
  });

  const light = document.createElement("div");
  light.className = "plan__light";
  world.append(light);
  overlay.append(world);
  host.append(overlay);

  animations.push(overlay.animate({ opacity: [1, 0] }, { delay: FADE_AT_MS, duration: FADE_MS, fill: "forwards" }));

  // A timer, as in camera-plan.js: animation events do not fire behind display:none.
  const remove = () => {
    if (showing !== remove) return;
    showing = null;
    clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    overlay.remove();
  };
  const timer = setTimeout(remove, FADE_AT_MS + FADE_MS + 50);
  showing = remove;
  played += 1;
}

/**
 * Called by the attention tick with the candidates on the glass. A candidate stays
 * there across ticks, so each plays once; a second arrival by the same person
 * carries a new expiresAt and plays again. One that loses to a moment already
 * showing is not marked, so the next tick gets it.
 */
export function dioramaSee(candidates) {
  if (!dioramaOn() || !plate || showing) return;
  for (const candidate of candidates) {
    const moment = momentFor(candidate);
    if (!moment) continue;
    const key = `${candidate.expiresAt ?? ""}`;
    if (seen.get(candidate.id) === key) continue;
    if (seen.size > 32) seen.clear();
    seen.set(candidate.id, key);
    play(moment);
    return;
  }
}

/** For __v3(). */
export function dioramaState() {
  return { ready: Boolean(plate), showing: Boolean(showing), played, dressed: [...dressed.keys()] };
}

export function initDiorama() {
  warm();
  onDepth((next) => {
    if (next === DEPTH.SUBJECT) showing?.();
  });
}
