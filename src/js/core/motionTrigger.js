import { startListening, isListening } from "./voiceCommands.js";

const CAPTURE_W = 160;
const CAPTURE_H = 90;
const CAPTURE_INTERVAL_MS = 500;

// Fraction of pixels that must change to count as motion (2% of 14 400 pixels = 288)
const MOTION_THRESHOLD = 0.02;
// Sum of R+G+B absolute diff per pixel to count as "changed"
const PIXEL_DIFF = 30;
// How long to suppress re-triggering after a motion event fires voice
const COOLDOWN_MS = 4000;

let canvas = null;
let ctx = null;
let video = null;
let prevFrame = null;
let cooldownUntil = 0;

function motionScore(prev, curr) {
  const d1 = prev.data;
  const d2 = curr.data;
  let changed = 0;
  const total = d1.length / 4;
  for (let i = 0; i < d1.length; i += 4) {
    if (
      Math.abs(d1[i]   - d2[i])   +
      Math.abs(d1[i+1] - d2[i+1]) +
      Math.abs(d1[i+2] - d2[i+2]) > PIXEL_DIFF
    ) {
      changed++;
    }
  }
  return changed / total;
}

function captureFrame() {
  if (!video || video.readyState < 2) return null;
  ctx.drawImage(video, 0, 0, CAPTURE_W, CAPTURE_H);
  return ctx.getImageData(0, 0, CAPTURE_W, CAPTURE_H);
}

function tick() {
  const now = Date.now();
  const frame = captureFrame();

  if (frame && prevFrame && now >= cooldownUntil && !isListening()) {
    const score = motionScore(prevFrame, frame);
    if (score >= MOTION_THRESHOLD) {
      cooldownUntil = now + COOLDOWN_MS;
      startListening();
    }
  }

  if (frame) prevFrame = frame;
}

export async function initMotionTrigger() {
  if (!navigator.mediaDevices?.getUserMedia) {
    console.info("Motion trigger: getUserMedia not available");
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { width: CAPTURE_W, height: CAPTURE_H, facingMode: "user" },
      audio: false,
    });
  } catch (err) {
    console.info("Motion trigger: camera unavailable or denied —", err.message);
    return;
  }

  canvas = document.createElement("canvas");
  canvas.width = CAPTURE_W;
  canvas.height = CAPTURE_H;
  ctx = canvas.getContext("2d", { willReadFrequently: true });

  video = document.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;

  video.addEventListener("loadedmetadata", () => {
    video.play();
    setInterval(tick, CAPTURE_INTERVAL_MS);
    console.info("Motion trigger active — move in front of the camera to activate voice");
  });
}
