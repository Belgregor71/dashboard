/* ═══════════════════════════════════════════════════════════════════════════
   THE ROBOT'S MOMENTS — heading out, finished, stuck (features.v3RobotPlan).

   Reads the run the server keeps (/api/robot/track) and announces what changed
   as ordinary candidates, so quiet, decay and "is anyone in the room" are the
   attention engine's rules and not a second set here. The diorama draws the
   plan for whichever of them reaches the glass (core/diorama.js).

   Heading out and finished are events: only a change seen between two readings
   counts, so a page that loads mid-clean says nothing. Stuck is a state: it is
   announced whenever it is found, and withdrawn when the robot moves again.
   ═══════════════════════════════════════════════════════════════════════════ */

import { announce } from "./attention.js";
import { robotTrack } from "./robot-layer.js";

const POLL_MS = 30_000;
const MOMENT_MS = 3 * 60_000;
const STUCK_MS = 30 * 60_000;
const STUCK_ID = "robot-stuck:vacuum";
/* None of these interrupts, so an empty room is never shown one: the engine
   passes only interrupts there. A stuck robot waits in the queue for its half
   hour and, in the high band, is the first thing whoever walks in is shown. */
const MOMENT_SCORE = 55;
const STUCK_SCORE = 70;
const STUCK_TEXT = "The vacuum's stopped and needs a hand.";

const card = (id, text, score, at, life) => ({
  id,
  source: "robot",
  icon: "🤖",
  text,
  score,
  evidence: { key: "robot", at, event: true },
  expiresAt: at + life
});

/** What changed between two readings of the run, as candidates. Pure. */
export function robotMoments(before, now, at) {
  if (!now) return [];
  const out = [];
  if (before && now.startedAt && now.startedAt !== before.startedAt) {
    out.push(card(`robot-start:${now.startedAt}`, "The vacuum's heading out.", MOMENT_SCORE, at, MOMENT_MS));
  }
  if (before && now.endedAt && now.endedAt !== before.endedAt) {
    out.push(card(`robot-done:${now.endedAt}`, "The vacuum's finished.", MOMENT_SCORE, at, MOMENT_MS));
  }
  if (now.state === "error" && before?.state !== "error") {
    out.push(card(STUCK_ID, STUCK_TEXT, STUCK_SCORE, at, STUCK_MS));
  }
  // Already over: the same id, expired, is how an announcement is withdrawn.
  if (before?.state === "error" && now.state !== "error") {
    out.push(card(STUCK_ID, STUCK_TEXT, STUCK_SCORE, at, -1));
  }
  return out;
}

let before = null;
let polls = 0;

async function poll() {
  const now = await robotTrack();
  polls += 1;
  for (const candidate of robotMoments(before, now, Date.now())) announce(candidate);
  if (now) before = now;
}

/** For __v3(). */
export function robotWatchState() {
  return { polls, state: before?.state ?? null, startedAt: before?.startedAt ?? null, endedAt: before?.endedAt ?? null };
}

export function initRobotWatch() {
  if (!globalThis.window?.CONFIG?.features?.v3RobotPlan) return false;
  window.__v3RobotPoll = poll;   // the spec's clock, and a way to look without waiting 30 s
  setInterval(poll, POLL_MS);
  poll();
  return true;
}
