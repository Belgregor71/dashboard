import { mkdir, readdir, rename, stat, unlink, writeFile } from "fs/promises";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { fetchOriginal, liveMotionEnabled } from "./immichClient.js";

// Live Photo motion parts — the server half of features.ambientArchiveMotion.
//
// An Apple Live Photo is two assets in Immich: the still (type IMAGE, what the
// archive already shows) and a ~3s motion part (type VIDEO, referenced by
// livePhotoVideoId). This module turns that motion part into ONE small,
// normalised, faststart H.264 mp4 on local disk, keyed by the STILL's id.
//
// Why transcode rather than proxy Immich's bytes — all three measured against
// the live library on 2026-08-02, and every one of them is fatal on its own:
//
//   1. CODEC. The library is mixed: a 2015 motion part is avc1, but the 2021 and
//      2022 ones are hvc1 (HEVC). The kiosk's Chromium reports
//      `hvc1 supported=false, canPlayType=""` — it cannot decode HEVC at all.
//   2. CONTAINER. They are QuickTime (`ftyp = "qt  "`), and the same Chromium
//      reports `canPlayType("video/quicktime") === ""`.
//   3. FASTSTART. The `moov` atom trails the media data, so a browser must
//      download all 3.5-4.5 MB before it can show frame one.
//
// Immich is not fixing any of this for us: /video/playback returns bytes
// identical to /original, because its transcode policy leaves these alone.
//
// Everything here is fail-soft and runs OFF the render path. The kiosk only ever
// reads a finished file (routes/immich.js), so a sleeping NAS, a missing ffmpeg
// or a failed encode all degrade to exactly one thing: the memory is a still.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(__dirname, "..", "..", "data", "immich-cache");
export const CLIP_DIR = path.join(CACHE_DIR, "clips");

// Bounded by BYTES, not file count. The sibling thumb cache (routes/immich.js
// pruneCache) bounds by COUNT because 500 x ~47 KB jpegs is a meaningful ~25 MB
// ceiling. Clips are ~5x larger and vary, so a count would make the real ceiling
// anything between 25 MB and 150 MB — and would let a cold clip evict a warm
// still. Different unit, deliberately.
const CLIP_MAX_BYTES = 48 * 1024 * 1024;   // ≈ 5 days of daily sets, worst case

// The burst the client plays is bounded by a timer, and this is the guarantee
// that makes that timer the sole authority: the media can never outlast it.
// Measured motion parts are 2.3-3.1s, so this trims almost nothing in practice.
const CLIP_MAX_SECONDS = 3.5;

// Long edge, in pixels. NOT the card's 1040x585 — the clip is encoded at its
// SOURCE aspect and cropped by CSS exactly as the still is, so that when the
// card's geometry changes (the cropping work) both follow together and no clip
// needs re-encoding. 1040 is the card's long edge, so this is 1:1 at worst.
const CLIP_LONG_EDGE = 1040;

const FFMPEG_TIMEOUT_MS = 30_000;

const clipFile = (stillId) => path.join(CLIP_DIR, `${stillId}.mp4`);
const skipFile = (stillId) => path.join(CLIP_DIR, `${stillId}.none`);

/** Absolute path of a still's clip. Existence is NOT implied — stat it. */
export function clipPathFor(stillId) {
  return clipFile(stillId);
}

/**
 * Is there a playable clip on disk for this still, right now?
 *
 * This is what /api/immich/daily-set publishes as `motion`, and it is the whole
 * failure surface collapsed into one boolean: NAS asleep, HEVC, ffmpeg missing,
 * encode failed, cache evicted — all of them simply mean `false`, so the client
 * can never ask for a clip that isn't there.
 */
export async function hasClip(stillId) {
  if (!stillId) return false;
  try {
    const s = await stat(clipFile(stillId));
    return s.isFile() && s.size > 0;
  } catch {
    return false;
  }
}

// ── ffmpeg availability (resolved once, logged once) ───────────
let ffmpegProbe = null;   // Promise<boolean>, memoised
let warnedMissing = false;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: FFMPEG_TIMEOUT_MS, killSignal: "SIGKILL", ...opts }, (err, stdout, stderr) =>
      err ? reject(Object.assign(err, { stderr: String(stderr || "") })) : resolve({ stdout, stderr })
    );
  });
}

async function haveFfmpeg() {
  if (!ffmpegProbe) {
    ffmpegProbe = run("ffmpeg", ["-version"], { timeout: 5000 }).then(() => true).catch(() => false);
  }
  const ok = await ffmpegProbe;
  if (!ok && !warnedMissing) {
    warnedMissing = true;
    console.warn("[liveMotion] ffmpeg not found — Live Photo motion is off; memories stay stills. Install with: sudo apt install ffmpeg");
  }
  return ok;
}

// ── prune (bounded by total bytes, oldest first) ───────────────
export async function pruneClips() {
  try {
    const files = await readdir(CLIP_DIR);
    const withMeta = await Promise.all(
      files.map(async (f) => {
        try {
          const s = await stat(path.join(CLIP_DIR, f));
          return { f, t: s.mtimeMs, size: s.size };
        } catch {
          return null;
        }
      })
    );
    const live = withMeta.filter(Boolean).sort((a, b) => b.t - a.t);   // newest first
    let total = 0;
    const drop = [];
    for (const e of live) {
      total += e.size;
      if (total > CLIP_MAX_BYTES) drop.push(e.f);                       // everything past the budget
    }
    await Promise.all(drop.map((f) => unlink(path.join(CLIP_DIR, f)).catch(() => {})));
  } catch { /* best-effort */ }
}

// ── the encode ─────────────────────────────────────────────────
function ffmpegArgs(src, out) {
  return [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", src,
    "-an",                                   // never audio. A screensaver that
                                             // speaks is a different product.
    "-t", String(CLIP_MAX_SECONDS),
    // Long edge to CLIP_LONG_EDGE, short edge auto and forced even (-2).
    // ffmpeg applies the container's rotation matrix before the filter chain, so
    // iw/ih here are already the upright dimensions — which matters because every
    // motion part measured carried `orientation: 6` (portrait shot, stored
    // landscape). It also resets the display matrix on output, so the browser
    // does not rotate a second time.
    "-vf", `scale='if(gt(iw,ih),${CLIP_LONG_EDGE},-2)':'if(gt(iw,ih),-2,${CLIP_LONG_EDGE})',fps=24`,
    "-c:v", "libx264",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",                   // the only chroma the kiosk decodes reliably
    "-crf", "26",
    "-preset", "veryfast",                   // this runs on the box driving the panel
    "-movflags", "+faststart",               // moov first, or frame one waits for the whole file
    out
  ];
}

/**
 * Produce `clips/<stillId>.mp4` from a Live Photo's motion part, if it isn't
 * already there. Idempotent, sequential, and never throws into its caller.
 *
 * Called from the Daily Memories warm pass, which runs while the NAS is awake
 * and (via the evening tick) while the panel is DPMS-off. It is bounded at ≤12
 * assets/day of which roughly a third to a half carry motion, each ~3s of source
 * — single-digit seconds of one core per night, at nice 19.
 */
export async function warmClip(stillId, motionId) {
  if (!liveMotionEnabled() || !stillId || !motionId) return;
  if (await hasClip(stillId)) return;

  // Negative cache: an asset that cannot be encoded (corrupt, unreadable) must
  // not be retried every night forever.
  try { await stat(skipFile(stillId)); return; } catch { /* no marker → proceed */ }

  // ⚠ Checked BEFORE any .none is written, and deliberately never marked: a
  // missing ffmpeg is a property of the box, not of the asset. Marking here
  // would mean installing ffmpeg later silently did nothing until someone
  // wiped the cache by hand.
  if (!(await haveFfmpeg())) return;

  const src = path.join(CLIP_DIR, `${stillId}.src.tmp`);
  const out = path.join(CLIP_DIR, `${stillId}.out.tmp`);
  let markSkip = false;
  try {
    await mkdir(CLIP_DIR, { recursive: true });

    const original = await fetchOriginal(motionId);
    if (!original || !original.buffer?.length) return;   // NAS asleep → try again tomorrow, no marker
    await writeFile(src, original.buffer);

    const nice = process.platform === "win32" ? null : "nice";
    await (nice
      ? run(nice, ["-n", "19", "ffmpeg", ...ffmpegArgs(src, out)])
      : run("ffmpeg", ffmpegArgs(src, out)));

    const produced = await stat(out);
    if (!produced.size) throw new Error("ffmpeg produced an empty file");

    // Atomic: a half-written file that merely LOOKS complete is worse than none,
    // because hasClip() would publish motion:true for something unplayable.
    await rename(out, clipFile(stillId));
    void pruneClips();
  } catch (err) {
    // The asset itself is the problem (ffmpeg exists and refused it) → mark it.
    markSkip = true;
    console.warn(`[liveMotion] clip failed for ${stillId}: ${err?.stderr?.trim() || err?.message || err}`);
  } finally {
    // Every terminal path — success, encode error, timeout. The 24/7 memory rule,
    // applied to disk: these are 3.5-4.5 MB each.
    await unlink(src).catch(() => {});
    await unlink(out).catch(() => {});
    if (markSkip) await writeFile(skipFile(stillId), "").catch(() => {});
  }
}
