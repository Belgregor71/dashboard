import { test, expect } from "@playwright/test";

import {
  createSoundDetector,
  percentile,
  toDb,
  SILENT_DB,
  MARGIN_DB,
  MIN_SAMPLES
} from "../server/services/soundPresence.js";

// Presence from the mic that is already open for the wake word. The detector's
// whole job is telling a PERSON from the Sonos, the rangehood and the
// dashboard's own voice — see soundPresence.js for why that is an excursion
// above an adaptive floor and not a threshold.

const T0 = Date.parse("2026-08-09T08:00:00Z");

/** Feed `count` seconds of a constant level, one sample per second. */
function feed(det, rms, count, startAt, opts = {}) {
  let last = null;
  for (let i = 0; i < count; i += 1) {
    last = det.push({ rms, at: startAt + i * 1000, ...opts });
  }
  return last;
}

const QUIET = 120; // room tone
const MUSIC = 2600; // Sonos at a normal level
const VOICE = 9000; // someone talking near the panel

test.describe("toDb", () => {
  test("silence is a floor, not -Infinity", () => {
    // log10(0) would poison the percentile and every excursion against it.
    expect(toDb(0)).toBe(SILENT_DB);
    expect(toDb(-5)).toBe(SILENT_DB);
    expect(toDb(NaN)).toBe(SILENT_DB);
  });

  test("full scale is 0 dB and quieter is negative", () => {
    expect(toDb(32768)).toBeCloseTo(0, 5);
    expect(toDb(3276.8)).toBeCloseTo(-20, 5);
    expect(toDb(QUIET)).toBeLessThan(-40);
  });
});

test.describe("percentile", () => {
  test("nearest rank, and an empty set does not throw", () => {
    expect(percentile([1, 2, 3, 4, 5], 20)).toBe(1);
    expect(percentile([1, 2, 3, 4, 5], 100)).toBe(5);
    expect(percentile([5, 1, 3], 50)).toBe(3);
    expect(percentile([], 20)).toBe(SILENT_DB);
  });
});

test.describe("it says nothing until it has a floor", () => {
  test("a loud first second after a restart is not presence", () => {
    // Otherwise every service restart fires on the first sound it hears.
    const det = createSoundDetector();
    const r = feed(det, VOICE, MIN_SAMPLES - 1, T0);
    expect(r.active).toBe(false);
    expect(r.emit).toBe(false);
    expect(r.samples).toBe(MIN_SAMPLES - 1);
  });
});

test.describe("the false positive that would sink it", () => {
  test("steady music NEVER triggers — the floor rises to meet it", () => {
    // The Sonos plays in this kitchen. A level threshold at any value would
    // read this as somebody standing there, permanently, and the surface would
    // never rest.
    const det = createSoundDetector();
    const r = feed(det, MUSIC, 600, T0);
    expect(r.active).toBe(false);
    expect(r.excursion).toBeCloseTo(0, 5);
  });

  test("a rangehood is the same shape and is equally ignored", () => {
    const det = createSoundDetector();
    expect(feed(det, 1500, 400, T0).active).toBe(false);
  });

  test("and it self-corrects if music starts in an empty room", () => {
    // Music STARTING is a real excursion and does trigger — which is usually
    // correct, because somebody pressed play. If it was a schedule, the floor
    // climbs to the music and the detector goes quiet again on its own.
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    const onset = feed(det, MUSIC, 5, T0 + 120_000);
    expect(onset.active).toBe(true);

    const settled = feed(det, MUSIC, 400, T0 + 125_000);
    expect(settled.active).toBe(false);
  });
});

test.describe("what it should catch", () => {
  test("someone talking in a quiet room", () => {
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    const r = feed(det, VOICE, 3, T0 + 120_000);
    expect(r.active).toBe(true);
    expect(r.excursion).toBeGreaterThan(MARGIN_DB);
  });

  test("someone talking OVER the music still clears the raised floor", () => {
    const det = createSoundDetector();
    feed(det, MUSIC, 400, T0); // floor is now the music
    const r = feed(det, VOICE, 3, T0 + 400_000);
    expect(r.active).toBe(true);
  });

  test("a conversation does not silence itself — speech is bursty", () => {
    // The reason the statistic is a LOW percentile: the gaps between sentences
    // keep the floor near room tone, so a long conversation keeps clearing it.
    // A mean would drift up and the detector would go deaf mid-chat.
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    const emits = [];
    for (let i = 0; i < 200; i += 1) {
      // ~2s of speech, ~2s of pause, for over three minutes.
      const talking = i % 4 < 2;
      const r = det.push({ rms: talking ? VOICE : QUIET, at: T0 + 120_000 + i * 1000 });
      if (r.emit) emits.push(i);
    }
    // NOT "active at the final instant" — the last sample is a pause, and an
    // instantaneous false there is correct. What matters is that it is STILL
    // firing three minutes in rather than having gone deaf as the floor drifted.
    expect(emits.length).toBeGreaterThan(8);
    expect(emits[emits.length - 1]).toBeGreaterThan(180);
  });
});

test.describe("impulses are not people", () => {
  test("a single loud sample does not trigger", () => {
    // A door slamming elsewhere, a dropped pan, a car horn.
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    const bang = det.push({ rms: VOICE, at: T0 + 120_000 });
    expect(bang.active).toBe(false);
    const after = det.push({ rms: QUIET, at: T0 + 121_000 });
    expect(after.active).toBe(false);
  });
});

test.describe("the house must not hear itself", () => {
  test("samples while the house is speaking are DROPPED, not recorded", () => {
    // Recording them as data would be wrong twice over: as noise they would
    // raise the floor and deafen the detector, and as signal they are the
    // house detecting its own voice — the exact bug that had it answering
    // itself on 2026-08-08.
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    const before = det.state(T0 + 120_000);

    const r = feed(det, VOICE, 30, T0 + 120_000, { speaking: true });
    expect(r.active).toBe(false);
    expect(r.emit).toBe(false);
    expect(r.speaking).toBe(true);

    const after = det.state(T0 + 150_000);
    expect(after.samples).toBe(before.samples); // nothing was recorded
    expect(after.floorDb).toBe(before.floorDb); // the floor did not move
  });

  test("a reply does not leave the room looking silent afterwards", () => {
    // Dropping is not the same as writing silence: if speaking samples were
    // recorded as SILENT_DB they would drag the floor down and the next normal
    // sound would read as a huge excursion.
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);
    feed(det, VOICE, 60, T0 + 120_000, { speaking: true });
    const r = det.push({ rms: QUIET, at: T0 + 180_000 });
    expect(r.active).toBe(false);
  });
});

test.describe("emission is an edge plus a heartbeat", () => {
  test("rising edge emits once, then at most every 10s while it holds", () => {
    const det = createSoundDetector();
    feed(det, QUIET, 120, T0);

    const emits = [];
    for (let i = 0; i < 25; i += 1) {
      const at = T0 + 120_000 + i * 1000;
      const r = det.push({ rms: VOICE, at });
      if (r.emit) emits.push(at - T0 - 120_000);
    }
    // The edge lands on the SECOND sample (CONSECUTIVE = 2), which sits at
    // offset 1000 because the first is at offset 0. Then ~10s apart, not 23
    // frames.
    expect(emits.length).toBeLessThanOrEqual(4);
    expect(emits[0]).toBe(1000);
    expect(emits[1] - emits[0]).toBeGreaterThanOrEqual(10_000);
  });
});

test.describe("bounded for a process that runs for weeks", () => {
  test("the sample window prunes to its retention", () => {
    const det = createSoundDetector();
    feed(det, QUIET, 3000, T0); // 50 minutes at 1 Hz
    // 5-minute window: 300 samples, never 3000.
    expect(det.state(T0 + 3_000_000).samples).toBeLessThanOrEqual(301);
  });
});

/* The loudness detector above was MEASURED against the real kitchen and lost:
   a conversation sat 2.2 dB over the floor (max 7.7) and the EMPTY room reached
   6.5 dB, so the distributions overlap and no margin separates them. Silero's
   speech probability is the verdict now. These specs pin the switch. */
test.describe("speech probability is the verdict", () => {
  test("quiet-but-noisy is not a person: loud, not speech", () => {
    // The rangehood, exactly. Loudness would have called this somebody.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const res = feed(det, VOICE, 6, T0 + 40_000, { speech: 0.02 });
    expect(res.active).toBe(false);
    expect(det.state().decidedBy).toBe("speech");
  });

  test("quiet speech IS a person: soft, but speech", () => {
    // The case the level meter provably could not see — someone talking across
    // the kitchen, barely above room tone.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const res = feed(det, QUIET * 1.1, 2, T0 + 40_000, { speech: 0.93 });
    expect(res.active).toBe(true);
  });

  test("one speech-ish frame is not a conversation", () => {
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const one = det.push({ rms: VOICE, speech: 0.9, at: T0 + 40_000 });
    expect(one.active).toBe(false);
  });

  test("speech needs no warm-up, because it is not a floor", () => {
    // The 30-sample minimum exists to protect the PERCENTILE. An absolute
    // judgement about one frame needs no history, so a fresh restart is useful
    // immediately instead of deaf for half a minute.
    const det = createSoundDetector();
    const res = feed(det, QUIET, 2, T0, { speech: 0.88 });
    expect(res.active).toBe(true);
    expect(det.state().samples).toBeLessThan(MIN_SAMPLES);
  });

  test("0.0 is a reading, not a missing VAD", () => {
    // `speech || null` would turn "certainly not speech" into "no VAD present"
    // and silently hand the decision back to loudness — which is measured wrong.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const res = feed(det, VOICE, 6, T0 + 40_000, { speech: 0 });
    expect(res.active).toBe(false);
    expect(det.state().decidedBy).toBe("speech");
  });

  test("an agent too old to send speech still works, on loudness", () => {
    // The agent lives outside the repo and is copied by hand, so a dashboard
    // newer than the agent is a real state — it must degrade, not go silent.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const res = feed(det, VOICE, 4, T0 + 40_000);
    expect(res.active).toBe(true);
    expect(det.state().decidedBy).toBe("loudness");
  });

  test("the house's own voice is still dropped, and now it matters MORE", () => {
    // Its own TTS is unambiguously speech: a VAD would score it ~1.0 and the
    // house would hold itself present forever. This is the 2026-08-08 bug's
    // exact shape, one layer down.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    const res = feed(det, VOICE, 8, T0 + 40_000, { speech: 0.99, speaking: true });
    expect(res.active).toBe(false);
    expect(res.speaking).toBe(true);
    // and it must not have polluted the record either
    expect(det.state().speechOverThreshold).toBe(0);
  });

  test("speech and loudness are not combined", () => {
    // An OR would give the measured-wrong statistic a veto; an AND would make
    // the good one wait on the bad one.
    const det = createSoundDetector();
    feed(det, QUIET, 40, T0);
    // loud enough to clear the margin, but not speech
    const res = feed(det, VOICE * 4, 6, T0 + 40_000, { speech: 0.05 });
    expect(res.active).toBe(false);
  });

  test("the series carries both statistics on identical audio", () => {
    // The head-to-head has to stay sweepable, or the next threshold question
    // needs another person holding another conversation in the kitchen.
    const det = createSoundDetector();
    feed(det, QUIET, 5, T0, { speech: 0.1 });
    const s = det.state(T0 + 5000, { series: true });
    expect(s.series[0]).toHaveLength(3);
    expect(s.series.every(([, , sp]) => sp === 0.1)).toBe(true);
    expect(s.peakSpeech).toBe(0.1);
  });
});

test.describe("route contract", () => {
  test("GET /api/voice/ambient reports the tuning statistics", async ({ request }) => {
    const res = await request.get("/api/voice/ambient");
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.active).toBe("boolean");
    expect(typeof body.samples).toBe("number");
    expect(typeof body.marginDb).toBe("number");
  });

  test("POST /api/voice/ambient rejects a malformed rms", async ({ request }) => {
    // null must not sail through as silence — Number(null) is 0.
    const res = await request.post("/api/voice/ambient", { data: { rms: null } });
    expect(res.status()).toBe(400);
  });

  test("POST /api/voice/ambient accepts a real sample", async ({ request }) => {
    const res = await request.post("/api/voice/ambient", { data: { rms: 140 } });
    expect(res.status()).toBe(204);
  });

  test("the raw series is absent by default and present on request", async ({ request }) => {
    // It is ~300 numbers, and only a tuner wants them.
    const plain = await (await request.get("/api/voice/ambient")).json();
    expect(plain.series).toBeUndefined();

    await request.post("/api/voice/ambient", { data: { rms: 140 } });
    const withSeries = await (await request.get("/api/voice/ambient?series=1")).json();
    expect(Array.isArray(withSeries.series)).toBe(true);
    expect(withSeries.series.length).toBe(withSeries.samples);

    // [ageMs, db] — ages, not wall clock, so a replay survives clock skew
    // between the reader and the box. Ages must be non-negative and the series
    // ordered oldest-first, or a trailing-window replay reads the wrong samples.
    const ages = withSeries.series.map(([age]) => age);
    expect(ages.every((a) => typeof a === "number" && a >= 0)).toBe(true);
    for (let i = 1; i < ages.length; i += 1) expect(ages[i]).toBeLessThanOrEqual(ages[i - 1]);
    expect(withSeries.series.every(([, db]) => typeof db === "number")).toBe(true);
  });

  test("?series=1 carries loudness only — nothing about what was said", async ({ request }) => {
    // The privacy claim is load-bearing: the mic is open 24/7, and the reason
    // this is acceptable is that only a float leaves the box. A diagnostic that
    // quietly widened that would break the promise the whole feature rests on.
    await request.post("/api/voice/ambient", { data: { rms: 140, speech: 0.2 } });
    const body = await (await request.get("/api/voice/ambient?series=1")).json();
    for (const entry of body.series) {
      // [ageMs, db, speech|null] — three numbers, and null where an older agent
      // sent no VAD reading. Nothing here can say what was SAID, which is the
      // whole basis on which a 24/7 mic is acceptable.
      expect(entry).toHaveLength(3);
      const [age, db, speech] = entry;
      expect(typeof age).toBe("number");
      expect(typeof db).toBe("number");
      expect(speech === null || typeof speech === "number").toBe(true);
    }
  });

  test("POST /api/voice/ambient takes a speech probability, and refuses nonsense", async ({ request }) => {
    expect((await request.post("/api/voice/ambient", { data: { rms: 140, speech: 0.87 } })).status()).toBe(204);
    // Out of range is DROPPED, not clamped: a 7 from a mismatched agent means
    // something we do not understand, and clamping to 1 would assert
    // "definitely a person" forever. The sample still counts for loudness.
    expect((await request.post("/api/voice/ambient", { data: { rms: 140, speech: 7 } })).status()).toBe(204);
    expect((await request.post("/api/voice/ambient", { data: { rms: 140, speech: "loud" } })).status()).toBe(204);
    const body = await (await request.get("/api/voice/ambient")).json();
    expect(body.speechThreshold).toBeGreaterThan(0);
  });
});
