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
// ── ⚠ THE LOUDNESS DETECTOR BELOW IS NOT THE DECISION ANY MORE ──────────────
//
// It was, and it FAILED against this actual kitchen (measured 2026-08-09).
// Kept because it is now the diagnostic baseline, and because the reasoning is
// worth not re-deriving:
//
//   real conversation   median 2.2 dB over floor, loudest 7.7 dB
//   EMPTY room          median 1.6 dB over floor, loudest 6.5 dB
//
// The distributions OVERLAP, so no MARGIN_DB separates them — the failure is in
// the statistic, not the threshold. Cause: capture gain is +22.5 dB so room tone
// already sits at ~-30 dBFS, and the mic compresses hard (a 6x louder stimulus
// moved the reading ~2 dB). Speech has nowhere to excurse to.
//
// The wake word scores 0.70 in that same room. It classifies SPECTRALLY, and
// that is the whole lesson: A LEVEL METER CANNOT SEE WHAT A SPEECH MODEL CAN.
// The decision is now silero's speech probability (see isSpeech below), which
// also makes the Sonos/rangehood problem mostly disappear on its own — a fan is
// loud and is not speech.
//
// ⚠ What it does NOT solve: sung vocals and TV dialogue ARE speech. The
// speaking-state drop handles the house's own voice; a television left on is a
// genuine open question and the reason this ships flag-off.
//
// The loudness path, retained as the baseline:
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
/* MEASURED on the G11 against this kitchen, 2026-08-09 — not silero's
   conventional 0.5, which was tried first and is too high for this room:
   26 s of real speech played across it crossed 0.5 exactly ONCE, so a 2-sample
   run could never form.
                          median    max
     quiet room (settled)  0.022    0.055
     speech across room    0.142    0.548   (a run of 3 ≥ 0.325)
   0.3 sits ~5x above the settled quiet ceiling and caught a 3-sample run, and a
   person actually in the room is a stronger stimulus than the speakers were.

   ⚠ The two highest "quiet" readings in that window (0.205, 0.182) were the
   FIRST TWO SAMPLES AFTER THE AGENT RESTARTED — silero is recurrent and its
   state needs a moment to settle. Both are still far below 0.3, and CONSECUTIVE
   already covers a lone spike, but do not mistake a warm-up artefact for the
   room's noise floor when re-tuning.

   Tune from `GET /api/voice/ambient?series=1`, never by nudging this in place:
   the loudness threshold was a guess, and guessing is what cost this feature
   its first attempt. */
export const SPEECH_THRESHOLD = 0.3;
/* ── ⚠ THE PROXIMITY GATE — speech alone is NOT presence ──────────────────────
   Measured 2026-08-09, and it took the owner to explain it: a 3.6-minute window
   read `active:true` with NOBODY IN THE KITCHEN, 76 samples over threshold and
   peaks of 0.988. The cause was CHILDREN PLAYING NEXT DOOR. The VAD was right —
   that is speech — and the presence verdict was wrong, because THIS MIC HEARS
   OUTSIDE THE HOUSE.

   Speech answers "is this a voice". Only level can answer "is it in THIS room",
   because that is a question about distance:

                                level              speech      gate firings
     quiet room                 -27..-33 dB        0.02-0.10        0
     neighbours (empty kitchen) -25..-30 dB        up to 0.99       0
     a person at the panel      -11..-25 dB        0.83-0.998   many (runs of 9)

   The neighbours DO produce isolated loud speech-positive samples (-12.9 dB at
   0.321, -18.7 at 0.988), so a level bar alone would fire on them. What
   separates a person is loud AND speech-shaped ON CONSECUTIVE SECONDS — outside
   noise arriving through a window does not sustain. That is why CONSECUTIVE is
   load-bearing here and not merely an impulse filter.

   ⚠ ABSOLUTE dBFS, deliberately, NOT an excursion above the floor: this encodes
   a physical fact about distance, not about how noisy the room happens to be.
   The consequence is that it is COUPLED TO THE MIC'S CAPTURE GAIN (+22.5 dB,
   23/30, `amixer -c Microphone`). If that gain is ever changed, this number is
   void and must be re-measured — an excursion-relative version would not have
   saved us either, since the loudest neighbour sample sat 16 dB above the floor,
   further than most human samples. */
export const NEAR_DB = -24;
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
  repeatMs = REPEAT_MS,
  speechThreshold = SPEECH_THRESHOLD,
  nearDb = NEAR_DB
} = {}) {
  const samples = []; // ascending [{ at, db, speech }]
  let run = 0;
  let speechRun = 0;
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
    push({ rms, speech = null, speaking = false, at = Date.now() } = {}) {
      const db = toDb(rms);
      // A number, not truthiness: 0.0 is a legitimate reading meaning "certainly
      // not speech", and `speech || null` would turn it into "no VAD present" —
      // which reads as the opposite thing to every branch below.
      const speechProb = typeof speech === "number" && Number.isFinite(speech) ? speech : null;
      const hasSpeech = speechProb !== null;

      if (speaking) {
        return { active, changed: false, emit: false, db, speech: speechProb, floor: null, excursion: null, samples: samples.length, speaking: true };
      }

      samples.push({ at, db, speech: speechProb });
      const cutoff = at - windowMs;
      let drop = 0;
      while (drop < samples.length && samples[drop].at < cutoff) drop += 1;
      if (drop) samples.splice(0, drop);

      const floor = percentile(samples.map((s) => s.db), FLOOR_PERCENTILE);
      const excursion = db - floor;

      /* ⚠ minSamples guards the FLOOR, which needs history before it means
         anything. A speech probability needs none — it is an absolute judgement
         about one frame — so when the VAD is reporting, the detector is useful
         from its first second instead of blind for thirty. */
      if (!hasSpeech && samples.length < minSamples) {
        run = 0;
        speechRun = 0;
        const changed = active;
        active = false;
        return { active, changed, emit: false, db, speech: speechProb, floor, excursion, samples: samples.length };
      }

      /* Both, together, or it is not somebody in this room. ⚠ This REVERSES an
         earlier rule in this file that said speech and loudness must never be
         combined. That rule was about loudness as the PRIMARY signal, where it
         measured wrong; as a proximity gate it does a different job — see
         NEAR_DB. The neighbours' children are what forced the change. */
      const near = db >= nearDb;
      speechRun = hasSpeech && speechProb >= speechThreshold && near ? speechRun + 1 : 0;
      run = excursion >= marginDb ? run + 1 : 0;
      /* Speech (gated by proximity) is the verdict when the agent reports it;
         loudness alone is only the fallback for an agent too old to send it. */
      const next = hasSpeech ? speechRun >= consecutive : run >= consecutive;
      const changed = next !== active;
      active = next;

      // Emit on the rising edge, then at most every repeatMs while it holds.
      let emit = false;
      if (active && (changed || at - lastEmitAt >= repeatMs)) {
        emit = true;
        lastEmitAt = at;
      }

      return { active, changed, emit, db, speech: speechProb, floor, excursion, samples: samples.length };
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
      const speeches = samples.map((s) => s.speech).filter((s) => typeof s === "number");
      const out = {
        active,
        samples: samples.length,
        floorDb: round(percentile(dbs, FLOOR_PERCENTILE)),
        medianDb: round(percentile(dbs, 50)),
        peakDb: round(percentile(dbs, 100)),
        lastDb: dbs.length ? round(dbs[dbs.length - 1]) : null,
        marginDb,
        ageMs: samples.length ? at - samples[0].at : 0,
        /* Which statistic is actually deciding. Without this, a silent fallback
           to loudness — an agent that failed to load the VAD — looks exactly
           like a working install from the outside. */
        decidedBy: speeches.length ? "speech" : "loudness",
        speechThreshold,
        nearDb,
        speechSamples: speeches.length,
        lastSpeech: speeches.length ? speeches[speeches.length - 1] : null,
        peakSpeech: speeches.length ? Math.max(...speeches) : null,
        speechOverThreshold: speeches.filter((s) => s >= speechThreshold).length
      };
      // Ages, not wall-clock timestamps: the consumer is replaying a window, and
      // a relative offset survives the reader's clock disagreeing with the box's.
      // Both statistics per entry, so the two stay comparable on IDENTICAL audio
      // — the comparison that showed loudness was the wrong choice.
      if (series) out.series = samples.map((s) => [at - s.at, round(s.db), s.speech]);
      return out;
    }
  };
}

function round(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
}
