/* ═══════════════════════════════════════════════════════════════════════════
   THE DAY IN 20 SECONDS — "how was today?" (features.v3DayLapse)

   The empty plan of the house with the day playing across it: a pulse wherever a
   camera saw something, the door, bin night, the rain coming through, each with a
   small mark left behind so the last frame is where the day happened.

   Answered, never announced: the matcher is the only way in. What it may show is
   decided on the server (services/dayBeats.js), and no person is in it. The plate
   is plan-empty on purpose: a parked car would be a claim about who was home.

   Plan and positions are private: see server/routes/housePlan.js. With no plan on
   the box, or nothing to play, this declines and the question falls through.
   ═══════════════════════════════════════════════════════════════════════════ */

import { containBox, fovCentre } from "./camera-plan.js";

export const RUN_MS = 20_000;
const LEAD_MS = 1000;        // the depth fade takes 350 of this; the rest reads as the house
const PULSE_MS = 1800;
const SKY_MS = 3200;
const NOTE_MS = 2600;
const TICK_MS = 200;
const REST_OPACITY = 0.5;    // what a pulse leaves behind

const NOTES = { door: () => "The door", bins: () => "Bin night", sky: (beat) => beat.to };

const clockText = (ms) => new Date(ms)
  .toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit", hour12: true })
  .replace(/\s/g, " ");

/** Where the run begins: the hour of the first beat, so a quiet morning is not 15 s of nothing. Pure. */
export function lapseStart(beats, to) {
  return beats.length ? new Date(beats[0].at).setMinutes(0, 0, 0) : to;
}

/** A moment of the day as a share of the run, 0 to 1. Pure. */
export const lapseShare = (at, start, to) => Math.min(1, (at - start) / Math.max(1, to - start));

/** A beat's place on the plate as fractions, null for one with no place. Pure. */
export function spotFor(beat, plan) {
  if (beat.kind === "bins") {
    const bin = plan.diorama?.bins?.[0];
    return bin ? [bin.x / plan.width, bin.y / plan.height] : null;
  }
  const fov = plan.cameras?.[beat.kind === "door" ? "doorbell" : beat.camera]?.fov;
  return fov ? fovCentre(fov) : null;
}

/** The size a pulse settles at, by how many have landed on that spot: 16 on the
 *  driveway has to read as a busy driveway, not one dot. Pure. */
export const restScale = (nth) => Math.min(1, 0.4 + nth * 0.1);

async function json(url) {
  const res = await fetch(url);
  return res.ok ? res.json() : null;
}

function pulseNode(beat, [fx, fy], delay, nth, animations) {
  const pulse = document.createElement("div");
  pulse.className = `lapse__pulse lapse__pulse--${beat.kind}`;
  pulse.style.left = `${fx * 100}%`;
  pulse.style.top = `${fy * 100}%`;
  // A share of the plate. Busier windows read bigger; one trigger still has to be seen from the couch.
  pulse.style.setProperty("--size", `${11 + Math.min(beat.n ?? 1, 10)}%`);
  animations.push(pulse.animate(
    [
      { opacity: 0, transform: "translate(-50%, -50%) scale(0.3)" },
      { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.25 },
      // Each fainter than the last: at full strength a stack sets into a flat disc.
      { opacity: REST_OPACITY / (1 + nth * 0.4), transform: `translate(-50%, -50%) scale(${restScale(nth)})` }
    ],
    { delay, duration: PULSE_MS, easing: "ease-out", fill: "both" }
  ));
  return pulse;
}

export async function showLapse() {
  const [plan, day] = await Promise.all([json("/api/house-plan"), json("/api/house/day")]);
  if (!plan?.width || !plan.height || !plan.cameras || !day?.beats) return null;

  const beats = day.beats.filter((beat) => beat.kind === "sky" || spotFor(beat, plan));
  if (!beats.length) return null;

  const image = new Image();
  image.className = "plan__image";
  image.alt = "";
  image.src = "/api/house-plan/layer/plan-empty";
  await image.decode();

  const start = lapseStart(beats, day.to);
  const wrap = document.createElement("div");
  wrap.className = "lapse";
  wrap.style.setProperty("--plan-up", `${plan.upBearing ?? 0}deg`);

  const box = containBox(window.innerWidth, window.innerHeight, plan.width / plan.height);
  const world = document.createElement("div");
  world.className = "lapse__world";
  Object.assign(world.style, {
    width: `${box.width}px`,
    height: `${box.height}px`,
    left: `${box.left}px`,
    top: `${box.top}px`
  });
  const light = document.createElement("div");
  light.className = "plan__light";
  world.append(image, light);

  const animations = [];
  const delayOf = (at) => LEAD_MS + lapseShare(at, start, day.to) * RUN_MS;
  const landed = new Map();   // spot → pulses so far; the door and the doorbell camera are one spot
  for (const beat of beats) {
    if (beat.kind === "sky") {
      const sky = document.createElement("div");
      sky.className = "lapse__sky";
      animations.push(sky.animate({ opacity: [0, 1, 0] }, { delay: delayOf(beat.at), duration: SKY_MS, fill: "backwards" }));
      world.append(sky);
    } else {
      const spot = spotFor(beat, plan);
      const nth = landed.get(spot.join()) ?? 0;
      landed.set(spot.join(), nth + 1);
      world.append(pulseNode(beat, spot, delayOf(beat.at), nth, animations));
    }
  }

  const clock = document.createElement("div");
  clock.className = "lapse__clock";
  clock.textContent = clockText(start);
  const note = document.createElement("div");
  note.className = "lapse__note";
  wrap.append(world, clock, note);

  /* One clock for everything: the pulses run off the same timeline, so the time on
     the wall cannot drift from them. Nothing here waits on an animation event. */
  const run = wrap.animate([], { duration: LEAD_MS + RUN_MS, fill: "forwards" });
  animations.push(run);
  const noted = beats.filter((beat) => NOTES[beat.kind]);
  const tick = () => {
    const elapsed = Math.min(Number(run.currentTime) || 0, LEAD_MS + RUN_MS);
    const now = start + (Math.max(0, elapsed - LEAD_MS) / RUN_MS) * (day.to - start);
    clock.textContent = clockText(now);
    while (noted.length && delayOf(noted[0].at) <= elapsed) {
      const beat = noted.shift();
      note.textContent = NOTES[beat.kind](beat);
      animations.push(note.animate({ opacity: [0, 1, 1, 0] }, { duration: NOTE_MS }));
    }
    if (elapsed >= LEAD_MS + RUN_MS) clearInterval(timer);
  };
  const timer = setInterval(tick, TICK_MS);

  return {
    node: wrap,
    speech: "Here's today.",
    refs: [],
    teardown: () => {
      clearInterval(timer);
      for (const animation of animations) animation.cancel();
      image.src = "";
    }
  };
}
