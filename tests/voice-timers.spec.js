import { test, expect } from "@playwright/test";
import { matchIntent, parseDuration, ACTING_INTENT_IDS } from "../src/js/services/localIntents.js";
import { durationPhrase, remainingPhrase, clockText } from "../src/v3/core/timer-words.js";

/* The timer matcher (features.voiceTimers) — pure, so node-side. The two things
   that matter most are the COLLISIONS: these patterns run before the mutation
   guard and before every answerer, so a greedy one steals "how long's my
   commute" or "what's on the shopping list" from a lane that owns it. */

const withFlag = (on, fn) => {
  const prior = globalThis.window;
  try {
    globalThis.window = { CONFIG: { features: { voiceTimers: on, voiceListWrites: true, choreRoster: true } } };
    return fn();
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
};

test.describe("parseDuration", () => {
  test("digits, words, compounds and halves", () => {
    expect(parseDuration("10 minutes")).toBe(600_000);
    expect(parseDuration("ten minutes")).toBe(600_000);
    expect(parseDuration("twenty-five minutes")).toBe(1_500_000);
    expect(parseDuration("an hour and a half")).toBe(5_400_000);
    expect(parseDuration("half an hour")).toBe(1_800_000);
    expect(parseDuration("1 hour 30 minutes")).toBe(5_400_000);
    expect(parseDuration("two and a half minutes")).toBe(150_000);
    expect(parseDuration("90 seconds")).toBe(90_000);
  });
  test("nothing it cannot read exactly", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("a while")).toBeNull();
    expect(parseDuration("soon")).toBeNull();
  });
});

test.describe("matchIntent with voiceTimers ON", () => {
  test("the set phrasings, with and without a name", () => {
    withFlag(true, () => {
      expect(matchIntent("set a timer for 10 minutes")).toEqual({ id: "timer.set", slots: { ms: 600_000, label: null } });
      expect(matchIntent("Set a timer for ten minutes.")).toEqual({ id: "timer.set", slots: { ms: 600_000, label: null } });
      expect(matchIntent("set a pasta timer for 12 minutes")).toEqual({ id: "timer.set", slots: { ms: 720_000, label: "pasta" } });
      expect(matchIntent("set a timer for 12 minutes for the pasta")).toEqual({ id: "timer.set", slots: { ms: 720_000, label: "pasta" } });
      // ⚠ the duration-first shape must not become a timer NAMED "10 minute"
      expect(matchIntent("set a 10 minute timer")).toEqual({ id: "timer.set", slots: { ms: 600_000, label: null } });
      expect(matchIntent("set a twenty-five minute pasta timer")).toEqual({ id: "timer.set", slots: { ms: 1_500_000, label: "pasta" } });
      expect(matchIntent("can you set a timer for 90 seconds")).toMatchObject({ id: "timer.set", slots: { ms: 90_000 } });
      expect(matchIntent("5 minute timer")).toMatchObject({ id: "timer.set", slots: { ms: 300_000 } });
      // No duration: claimed with ms null, so the lane can teach the phrasing.
      expect(matchIntent("set a timer")).toEqual({ id: "timer.set", slots: { ms: null, label: null } });
    });
  });

  test("⚠ the NAME can come before the duration — said at the wall, and it fell through", () => {
    /* REGRESSION, 2026-09-16. "set a timer for pasta for 30 seconds" was spoken
       at the kiosk on the day voiceTimers was flipped on, transcribed CORRECTLY,
       and matched nothing: every shape wanted the name in front of "timer" or
       after the duration. Assist took it and answered "I don't have a timer
       function". The flip's own CDP proof missed it because it used the
       phrasing the patterns were written for — the fixture, not a person. */
    withFlag(true, () => {
      expect(matchIntent("set a timer for pasta for 30 seconds"))
        .toEqual({ id: "timer.set", slots: { ms: 30_000, label: "pasta" } });
      expect(matchIntent("set a timer for the pasta for 30 seconds"))
        .toEqual({ id: "timer.set", slots: { ms: 30_000, label: "pasta" } });
      expect(matchIntent("start a timer for the eggs for two minutes"))
        .toEqual({ id: "timer.set", slots: { ms: 120_000, label: "eggs" } });

      /* ⚠⚠ THE OTHER DIRECTION: a bare duration must never become the NAME of a
         timer that has none — a silent, plausible-looking pill that never rings.
         ⚠ Be honest about this pair's teeth: three things independently prevent
         it (the `for (DURATION)$` anchor, this pattern sitting below the
         duration-first one, and matchTimer's `if (ms === null) continue`), and
         injection on 2026-09-16 could not turn these two lines red even with the
         first two removed. They pin the BEHAVIOUR, not any one mechanism —
         matchTimer's `continue` is what a rewrite must not drop. */
      expect(matchIntent("set a timer for 30 seconds"))
        .toEqual({ id: "timer.set", slots: { ms: 30_000, label: null } });
      expect(matchIntent("set a timer for 12 minutes for the pasta"))
        .toEqual({ id: "timer.set", slots: { ms: 720_000, label: "pasta" } });
    });
  });

  test("the STT's own mishearing is NOT absorbed into the grammar", () => {
    /* The same evening the box heard "Set a timer for 30 seconds" as "Send a
       timer for 30 seconds" and the lane declined it — correctly. "send" is not
       a timer verb, and widening SET_VERB to cover a transcription defect would
       move the fix into the grammar and hide the STT problem this house is
       already measuring (the moonshine shadow). Pinned so nobody "helpfully"
       adds it later without re-reading that decision. */
    withFlag(true, () => {
      expect(matchIntent("send a timer for 30 seconds")).toBeNull();
    });
  });

  test("reminders need a relative duration; a wall-clock time is declined", () => {
    withFlag(true, () => {
      expect(matchIntent("remind me in 20 minutes to check the oven"))
        .toEqual({ id: "reminder.set", slots: { ms: 1_200_000, text: "check the oven" } });
      expect(matchIntent("remind me to check the oven in 20 minutes"))
        .toEqual({ id: "reminder.set", slots: { ms: 1_200_000, text: "check the oven" } });
      expect(matchIntent("remind me to call mum")).toBeNull();
      expect(matchIntent("remind me at five to call mum")).toBeNull();
    });
  });

  test("query, cancel, and the bare stop", () => {
    withFlag(true, () => {
      expect(matchIntent("how long is left on the timer")?.id).toBe("timer.query");
      expect(matchIntent("how much time is left")?.id).toBe("timer.query");
      expect(matchIntent("how's the pasta timer")).toEqual({ id: "timer.query", slots: { label: "pasta" } });
      expect(matchIntent("cancel the pasta timer")).toMatchObject({ id: "timer.cancel", slots: { label: "pasta", named: true, bare: false } });
      expect(matchIntent("cancel all timers")).toMatchObject({ id: "timer.cancel", slots: { all: true } });
      expect(matchIntent("turn off the alarm")).toMatchObject({ id: "timer.cancel", slots: { named: false } });
      expect(matchIntent("stop")).toMatchObject({ id: "timer.cancel", slots: { bare: true } });
      expect(matchIntent("ok thanks")).toMatchObject({ id: "timer.cancel", slots: { bare: true } });
    });
  });

  test("⚠ COLLISIONS: the phrases other lanes own stay theirs", () => {
    withFlag(true, () => {
      expect(matchIntent("what time does the sun set")?.id).toBe("time.sunset");
      expect(matchIntent("how long's my commute")?.id).toBe("self.commute");
      expect(matchIntent("what's on the shopping list")?.id).toBe("list.shopping");
      expect(matchIntent("put bread on the list")?.id).toBe("list.add");
      expect(matchIntent("what time is it")?.id).toBe("time.now");
      expect(matchIntent("stop the music")).toBeNull();
      expect(matchIntent("set the lounge to 22")).toBeNull();
      expect(matchIntent("turn on the backyard light")).toBeNull();
    });
  });
});

test("flag OFF: nothing is claimed — the historical fall-through to Assist", () => {
  withFlag(false, () => {
    for (const said of ["set a timer for 10 minutes", "remind me in 20 minutes to check the oven",
      "cancel the timer", "how long left", "set a pasta timer for 12 minutes"]) {
      expect(matchIntent(said), said).toBeNull();
    }
    // A bare "stop" is not claimed either; with the flag off it is Assist's.
    expect(matchIntent("stop")).toBeNull();
  });
});

test("the timer ids are in the acting roster", () => {
  for (const id of ["timer.set", "timer.cancel", "timer.query", "reminder.set"]) {
    expect(ACTING_INTENT_IDS).toContain(id);
  }
});

test.describe("the words", () => {
  test("spoken durations and the pill clock", () => {
    expect(durationPhrase(720_000)).toBe("12 minutes");
    expect(durationPhrase(90_000)).toBe("1 minute 30 seconds");
    expect(durationPhrase(5_400_000)).toBe("1 hour 30 minutes");
    expect(remainingPhrase(61_000)).toBe("2 minutes");
    expect(remainingPhrase(59_000)).toBe("59 seconds");
    expect(clockText(725_000)).toBe("12:05");
    expect(clockText(3_725_000)).toBe("1:02:05");
    expect(clockText(0)).toBe("0:00");
  });
});
