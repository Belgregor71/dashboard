// Sound as a presence signal — "is this room in use", from the mic that is
// already listening for the wake word.
//
// WHY. V3 reads presence from `binary_sensor.kitchen_motion_detected`, and that
// camera's detection gets deliberately switched off by a member of the
// household. recoveryService guard 1 re-arms it, which means the house has been
// quietly undoing a person's deliberate choice — the wrong behaviour, and the
// reason to source presence from somewhere else entirely.
//
// The mic is already open 24/7 (openWakeWord reads every frame). Nothing new
// listens; the agent simply reports a loudness number it was already computing.
// No audio and no transcript leave the box: one float, over loopback, and the
// endpoint neither logs nor persists it.
//
// ── THE HARD PART IS NOT LOUDNESS, IT IS "IS THAT A PERSON" ──────────────────
//
// A fixed threshold is useless in this kitchen. The Sonos plays here; so does
// the rangehood, the dishwasher and the dashboard's own voice through the HDMI
// speakers. Any of them pins a level meter high indefinitely, and a surface
// that thinks someone is always present never rests — the calm law's plainest
// violation, and the sound-shaped twin of "the driveway camera fires on cars".
//
// So the statistic is an EXCURSION ABOVE AN ADAPTIVE FLOOR, in dB:
//
//   floor      = a low percentile of the last few minutes
//   active     = current dB exceeds that floor by MARGIN_DB, for CONSECUTIVE samples
//
// Why a LOW percentile is the load-bearing choice, and not a mean:
//   - Steady noise (music, an extractor fan) raises the floor to its own level,
//     so it stops counting within one window. Self-cancelling, with no need to
//     know the Sonos is playing.
//   - Speech does NOT raise it, because speech is bursty — the gaps between
//     words and sentences keep the 20th percentile down near the room tone
//     even mid-conversation. That asymmetry between stationary noise and human
//     activity IS the detector.
//   - A person talking OVER music still clears the raised floor.
//
// ⚠ This reports ACTIVITY, not occupancy. Somebody reading the screen in
// silence produces nothing — exactly as they trip no PIR. Absence stays the
// client's linger timer's job; this only ever says "something just happened".

/* One sample per second from the agent. Fast enough to catch a sentence, slow
   enough that the floor window is a few hundred numbers rather than thousands. */
export const WINDOW_MS = 5 * 60 * 1000;
export const FLOOR_PERCENTILE = 20;
export const MARGIN_DB = 9;
export const CONSECUTIVE = 2; // 2s — rejects a single door-slam impulse
/* Below this many samples there is no floor worth trusting, and a detector that
   guesses during its first seconds would fire on the first sound after every
   restart. Silence is the safe answer while it learns. */
export const MIN_SAMPLES = 30;
/* Re-announce while activity continues so the client's linger keeps being
   re-armed, without spending an SSE frame every second on a long conversation. */
export const REPEAT_MS = 10_000;

/* int16 full scale. rms 0 is silence, and log10(0) is -Infinity — which would
   poison the percentile and every excursion computed against it. */
const FULL_SCALE = 32768;
export const SILENT_DB = -90;

export function toDb(rms) {
  if (!Number.isFinite(rms) || rms <= 0) return SILENT_DB;
  const db = 20 * Math.log10(rms / FULL_SCALE);
  return db < SILENT_DB ? SILENT_DB : db;
}

/** Nearest-rank percentile over an unsorted array. */
export function percentile(values, p) {
  if (!values.length) return SILENT_DB;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

export function createSoundDetector({
  windowMs = WINDOW_MS,
  marginDb = MARGIN_DB,
  consecutive = CONSECUTIVE,
  minSamples = MIN_SAMPLES,
  repeatMs = REPEAT_MS
} = {}) {
  const samples = []; // ascending [{ at, db }]
  let run = 0;
  let active = false;
  let lastEmitAt = 0;

  return {
    /**
     * @param speaking true while the house's OWN reply is playing through the
     *   HDMI speakers. Those samples are dropped entirely rather than recorded
     *   as silence: they are neither the room's noise floor nor a person, and
     *   feeding them to either side of the comparison is how the house ends up
     *   detecting itself — the same trap that had it answering its own voice.
     * @returns {{active, changed, emit, db, floor, excursion, samples}}
     */
    push({ rms, speaking = false, at = Date.now() } = {}) {
      const db = toDb(rms);

      if (speaking) {
        return { active, changed: false, emit: false, db, floor: null, excursion: null, samples: samples.length, speaking: true };
      }

      samples.push({ at, db });
      const cutoff = at - windowMs;
      let drop = 0;
      while (drop < samples.length && samples[drop].at < cutoff) drop += 1;
      if (drop) samples.splice(0, drop);

      const floor = percentile(samples.map((s) => s.db), FLOOR_PERCENTILE);
      const excursion = db - floor;

      if (samples.length < minSamples) {
        run = 0;
        const changed = active;
        active = false;
        return { active, changed, emit: false, db, floor, excursion, samples: samples.length };
      }

      run = excursion >= marginDb ? run + 1 : 0;
      const next = run >= consecutive;
      const changed = next !== active;
      active = next;

      // Emit on the rising edge, then at most every repeatMs while it holds.
      let emit = false;
      if (active && (changed || at - lastEmitAt >= repeatMs)) {
        emit = true;
        lastEmitAt = at;
      }

      return { active, changed, emit, db, floor, excursion, samples: samples.length };
    },

    /** Diagnostic seam — what the thresholds should be tuned against.
     *
     * ⚠ `series` is not a nicety. Summary statistics CANNOT tune `consecutive`:
     * a peak 12 dB over the floor and two adjacent samples 9 dB over are the
     * same `peakDb` and different verdicts, so a margin swept against summaries
     * is a guess wearing a measurement's clothes. Measured 2026-08-09: a real
     * kitchen conversation peaked 12.6 dB above the floor and still never fired,
     * because it never did it twice in a row.
     *
     * Off by default because it is ~300 numbers, and asked for by the tuner —
     * the alternative is making somebody hold another conversation every time a
     * candidate threshold needs testing. Still only loudness: no audio, no
     * transcript, nothing that says what was said. */
    state(at = Date.now(), { series = false } = {}) {
      const dbs = samples.map((s) => s.db);
      const out = {
        active,
        samples: samples.length,
        floorDb: round(percentile(dbs, FLOOR_PERCENTILE)),
        medianDb: round(percentile(dbs, 50)),
        peakDb: round(percentile(dbs, 100)),
        lastDb: dbs.length ? round(dbs[dbs.length - 1]) : null,
        marginDb,
        ageMs: samples.length ? at - samples[0].at : 0
      };
      // Ages, not wall-clock timestamps: the consumer is replaying a window, and
      // a relative offset survives the reader's clock disagreeing with the box's.
      if (series) out.series = samples.map((s) => [at - s.at, round(s.db)]);
      return out;
    }
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}
