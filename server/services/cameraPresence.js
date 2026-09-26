// Camera as a presence signal — "is a PERSON in the living room", from the
// webcam on the G11 (tools/camera-presence/camera_presence.py).
//
// The agent scores one frame a second with a person detector and POSTs only
// { person, count, score } over loopback — no image ever reaches this process.
// This file decides what that stream MEANS, the same split as soundPresence.js:
// the agent measures, the server decides, and the page hears transitions.
//
// ── ONE FRAME IS NOT A PERSON ────────────────────────────────────────────────
// A small detector at 1 fps will now and then score a coat on a chair, a dog
// mid-leap or a reflection. A person is 2 of the last 3 frames. That costs at
// most one second on a real arrival and removes the lone false frame entirely.
//
// ── TRANSITIONS, NOT SAMPLES ─────────────────────────────────────────────────
// The page's presence runs a linger (5 min by day) from the last sighting, so
// it needs to hear "someone is here" often enough to keep that alive and no
// more: a rising edge at once, then at most one every REPEAT_MS while the room
// stays occupied. A person sitting on the couch for an hour is ~120 events,
// not 3,600. Absence is never sent — as with sound, absence is the linger's job.
//
// ── A GAP IS A RESTART ───────────────────────────────────────────────────────
// Frames stop at 22:00, on an unplug, or while the agent restarts. Two frames
// either side of a gap are not "2 of 3", so a gap longer than GAP_MS clears the
// window.

export const CONFIRM = { of: 3, need: 2 };
export const REPEAT_MS = 30_000;
export const GAP_MS = 10_000;

export function createCameraDetector({ confirm = CONFIRM, repeatMs = REPEAT_MS, gapMs = GAP_MS } = {}) {
  let window = [];
  let lastFrameAt = 0;
  let lastEmitAt = 0;
  let confirmed = false;
  let frames = 0;
  let personFrames = 0;
  let emits = 0;
  let lastPersonAt = 0;

  function push({ person, count = 0, score = 0 }, now = Date.now()) {
    if (lastFrameAt && now - lastFrameAt > gapMs) {
      window = [];
      confirmed = false;
    }
    lastFrameAt = now;
    frames += 1;
    const seen = person === true;
    if (seen) { personFrames += 1; lastPersonAt = now; }
    window.push(seen);
    if (window.length > confirm.of) window.shift();

    const wasConfirmed = confirmed;
    confirmed = window.filter(Boolean).length >= confirm.need;
    const emit = confirmed && (!wasConfirmed || now - lastEmitAt >= repeatMs);
    if (emit) { lastEmitAt = now; emits += 1; }
    return { emit, confirmed, rising: confirmed && !wasConfirmed, count, score };
  }

  function state(now = Date.now()) {
    return {
      confirmed,
      frames,
      personFrames,
      emits,
      lastFrameAgoMs: lastFrameAt ? now - lastFrameAt : null,
      lastPersonAgoMs: lastPersonAt ? now - lastPersonAt : null,
      // A camera that has stopped sending is the failure worth seeing from
      // outside: "nobody's here" and "the camera is dead" look identical to
      // the page. (This is the lesson of 22 hours lost to a dead motion sensor.)
      live: Boolean(lastFrameAt) && now - lastFrameAt <= gapMs
    };
  }

  return { push, state };
}
