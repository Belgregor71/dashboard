import { test, expect } from "@playwright/test";
import {
  SYSTEM_PROMPTS_TYPES,
  systemPromptFor,
  __CHARACTER_PROMPTS,
  __CHARACTER_PROMPTS_LOCKED,
  __buildPrompt,
} from "../server/routes/ai.js";

/* ═══════════════════════════════════════════════════════════════════════════
   BRIEFING_TOPIC_LOCK — a topic named in the prompt is a topic the house will
   find something to say about, whether or not it was given a line.

   Found live 2026-09-19 18:03, the third bin claim out of nothing in this lane:
   "The bins are out and gone tonight, so that's clear." /api/bins said
   {due:false} all evening, so buildPrompt printed no Bins line — and the
   ordering sentence still said "Cover tonight and tomorrow — BINS, tomorrow's
   weather and events first". The dismissal is the tell: told to cover a topic
   it had nothing on, the house closed the topic instead of skipping it.

   ⚠⚠ THE BIN INSTANCE IS THE RARE ONE. 58 live generations produced 0 bin
   mentions; the same prompt with the Weather line removed invented a forecast
   24/24. So these tests are about the MECHANISM — a named topic with no line —
   and the bin wording is only its most-caught instance.

   ⚠ WHAT EACH HALF GUARDS, because they fail for different reasons:
     · the SYSTEM half — the locked prompt names no topic to lead with.
     · the DATA half — buildPrompt closes with the labels it actually printed.
   The 09-05 suite had 14 tests on the system half and none on the data half,
   and the defect that shipped was in the data half. One without the other is
   the same blind spot again.

   ⚠ These read process.env, and node-side module state leaks between specs in
   a worker (reference-boot-module-state-leak). Every test restores it.
   ═══════════════════════════════════════════════════════════════════════════ */

const LOCK = "BRIEFING_TOPIC_LOCK";
const CHARACTER = "HOUSE_CHARACTER_BRIEFINGS";

function withEnv(values, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(values)) {
    saved.set(key, [Object.prototype.hasOwnProperty.call(process.env, key), process.env[key]]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, [had, prev]] of saved) {
      if (had) process.env[key] = prev;
      else delete process.env[key];
    }
  }
}

/* The evening payload the live failure had: bins not due, so no Bins line.
   Deliberately missing Weather too — that is the axis the invention actually
   reproduces on, and a fixture that carries every topic can never show a gap. */
const THIN_EVENING = {
  type: "evening",
  time: "Saturday evening, 6:02 pm, spring in Brisbane",
  chores: "Greg feeds the dogs tonight",
  home: "Greg is home, Brett is home",
};

test.describe("flag off — byte-identical to the prompt that shipped", () => {
  test("unset leaves the character prompt naming its topics, as before", () => {
    withEnv({ [CHARACTER]: "1", [LOCK]: undefined }, () => {
      expect(systemPromptFor("evening")).toBe(__CHARACTER_PROMPTS.evening);
      expect(systemPromptFor("morning")).toBe(__CHARACTER_PROMPTS.morning);
      // The invitation is still there with the flag off. If this ever stops
      // being true the rollback has stopped being a rollback.
      expect(__CHARACTER_PROMPTS.evening).toContain("bins, tomorrow's weather and events first");
      expect(__CHARACTER_PROMPTS.morning).toContain("weather warnings, bins, calendar events");
    });
  });

  test("unset adds nothing to the data half", () => {
    withEnv({ [LOCK]: undefined }, () => {
      const prompt = __buildPrompt(THIN_EVENING);
      expect(prompt).toBe(
        "Briefly summarise the rest of the evening and tomorrow for this family:\n" +
        "Time: Saturday evening, 6:02 pm, spring in Brisbane\n" +
        "Chores: Greg feeds the dogs tonight\n" +
        "Home: Greg is home, Brett is home"
      );
    });
  });

  test("a value of anything but 1 is off", () => {
    withEnv({ [LOCK]: "0" }, () => {
      expect(__buildPrompt(THIN_EVENING)).not.toContain("everything the house knows");
    });
    withEnv({ [LOCK]: "true" }, () => {
      expect(__buildPrompt(THIN_EVENING)).not.toContain("everything the house knows");
    });
  });
});

test.describe("flag on — the system half names no topic to lead with", () => {
  test("the locked ordering sentence has no topic words in it", () => {
    withEnv({ [CHARACTER]: "1", [LOCK]: "1" }, () => {
      for (const type of ["morning", "evening"]) {
        const text = systemPromptFor(type);
        expect(text).toBe(__CHARACTER_PROMPTS_LOCKED[type]);
        /* ⚠ NOT a whole-prompt search for "bins". houseCharacter() says "bins,
           arvo, tradie" as register guidance and "the wheelie bin genuinely is
           the news" as its comedy rule, and both belong there — the character
           is allowed to know the word. What must not survive is an INSTRUCTION
           to lead with the topic. So this asserts on the two sentences that
           carried it, by their own text. */
        expect(text).not.toContain("bins, tomorrow's weather and events first");
        expect(text).not.toContain("weather warnings, bins, calendar events");
        expect(text).not.toContain("no Bins line, no Traffic line");
      }
    });
  });

  test("the locked absent-topic guard bans the dismissal, not just the mention", () => {
    withEnv({ [CHARACTER]: "1", [LOCK]: "1" }, () => {
      const text = systemPromptFor("evening");
      /* The live sentence was "the bins are out and gone tonight, so that's
         clear" — a tidy-up, not a reminder. A guard that only says "do not
         mention it" reads as satisfied by clearing it away. */
      expect(text).toContain("not that it is clear");
      expect(text).toContain("not that it is done");
      /* And the rule the unlocked prompt states as "it does not exist today" is
         still stated, in the wording that survives a dismissal. Losing this is
         how a fix for the wording deletes the rule. */
      expect(text).toContain("you know NOTHING about");
      expect(text).toContain("Say nothing about it in any form");
    });
  });

  test("both maps still offer every type the route will validate", () => {
    for (const type of SYSTEM_PROMPTS_TYPES) {
      expect(typeof __CHARACTER_PROMPTS_LOCKED[type]).toBe("string");
      expect(__CHARACTER_PROMPTS_LOCKED[type].length).toBeGreaterThan(0);
    }
    expect(Object.keys(__CHARACTER_PROMPTS_LOCKED).sort())
      .toEqual(Object.keys(__CHARACTER_PROMPTS).sort());
  });

  test("the lock is independent of the character flag", () => {
    // Character off is the rollback target and must stay the frozen string.
    withEnv({ [CHARACTER]: undefined, [LOCK]: "1" }, () => {
      expect(systemPromptFor("evening")).toContain("Kath & Kim energy");
    });
  });
});

test.describe("flag on — the data half closes with the labels it printed", () => {
  test("a thin payload names only the lines it has", () => {
    withEnv({ [LOCK]: "1" }, () => {
      const prompt = __buildPrompt(THIN_EVENING);
      expect(prompt).toContain("Those lines are everything the house knows right now — Time, Chores, Home.");
      // The absent ones are absent from the list, which is the whole point:
      // the list is derived from the payload, not written down in the prompt.
      expect(prompt).not.toContain("Bins");
      expect(prompt).not.toContain("Weather");
      expect(prompt).not.toContain("Traffic");
    });
  });

  test("a full payload names all of them, in the printed order", () => {
    withEnv({ [LOCK]: "1" }, () => {
      const prompt = __buildPrompt({
        type: "morning",
        time: "Thursday morning, 7:10 am, spring in Brisbane",
        weather: "now 13°, clear",
        events: "Dentist 9:00",
        bins: "out now, truck's due this morning: Red + Yellow",
        chores: "Greg feeds the dogs tonight",
        commute: "Greg's drive 31 min",
        fuel: "cheapest unleaded 164c/L",
        news: "A headline",
        home: "Greg is home",
      });
      expect(prompt).toContain(
        "Those lines are everything the house knows right now — " +
        "Time, Weather, Calendar, Bins, Chores, Traffic, Fuel, News headlines, Home."
      );
    });
  });

  test("the closing line is the LAST thing in the prompt", () => {
    /* It has to sit under the data it describes. Moved above the lines it is a
       promise about a list the model has not read yet, which is the same
       too-far-from-the-evidence shape as the guard it replaces. */
    withEnv({ [LOCK]: "1" }, () => {
      const lines = __buildPrompt(THIN_EVENING).split("\n");
      expect(lines.at(-1)).toContain("everything the house knows right now");
      expect(lines.at(-2)).toBe("Home: Greg is home, Brett is home");
    });
  });

  test("a Time-only payload still closes honestly", () => {
    withEnv({ [LOCK]: "1" }, () => {
      const prompt = __buildPrompt({ type: "evening", time: "Saturday evening, 6:02 pm, spring in Brisbane" });
      expect(prompt).toContain("Those lines are everything the house knows right now — Time.");
    });
  });
});
