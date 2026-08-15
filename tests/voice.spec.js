import { test, expect } from "@playwright/test";
import {
  shapeAssistResponse,
  buildConverseMessages,
  buildConverseSystem,
  todayLine,
  HOUSE_TIME_ZONE,
  GRIEF_LINE,
  SPEAKER_UNKNOWN_LINE,
  MAX_TURNS,
  MAX_TURN_CHARS
} from "../server/services/voiceShape.js";
import { houseCharacter } from "../server/services/character.js";
import { converseSystem } from "../server/routes/voice.js";
import { VOICE_REGISTER } from "../server/routes/ai.js";

// Pure unit tests — voiceShape.js has no imports, no I/O, so these run
// straight in the Playwright node process (insights.spec.js style).
// Phase 4: docs/vision/phase-4-voice.md.

test.describe("shapeAssistResponse — the HA Assist reply contract", () => {
  test("action_done with speech → handled, speech trimmed, id passed through", () => {
    const out = shapeAssistResponse({
      response: {
        response_type: "action_done",
        speech: { plain: { speech: "  Turned on the kitchen light  " } }
      },
      conversation_id: "abc123"
    });
    expect(out).toEqual({ handled: true, speech: "Turned on the kitchen light", conversationId: "abc123" });
  });

  test("query_answer is handled too", () => {
    const out = shapeAssistResponse({
      response: { response_type: "query_answer", speech: { plain: { speech: "It is 21 degrees." } } }
    });
    expect(out.handled).toBe(true);
    expect(out.speech).toBe("It is 21 degrees.");
    expect(out.conversationId).toBeNull();
  });

  test("response_type error → not handled (falls through to converse)", () => {
    const out = shapeAssistResponse({
      response: {
        response_type: "error",
        speech: { plain: { speech: "Sorry, I couldn't understand that" } }
      }
    });
    expect(out.handled).toBe(false);
  });

  test("malformed / empty payloads are never handled and never throw", () => {
    for (const payload of [null, undefined, {}, { response: null }, { response: { speech: "x" } }, "nope", 42]) {
      const out = shapeAssistResponse(payload);
      expect(out.handled).toBe(false);
      expect(out.speech).toBeNull();
      expect(out.conversationId).toBeNull();
    }
  });

  test("blank speech becomes null even when handled", () => {
    const out = shapeAssistResponse({
      response: { response_type: "action_done", speech: { plain: { speech: "   " } } }
    });
    expect(out.handled).toBe(true);
    expect(out.speech).toBeNull();
  });
});

test.describe("buildConverseMessages — bounded rolling context", () => {
  test("no history → a single user message", () => {
    expect(buildConverseMessages("hello there", undefined)).toEqual([
      { role: "user", content: "hello there" }
    ]);
    expect(buildConverseMessages("hello", "not-an-array")).toEqual([
      { role: "user", content: "hello" }
    ]);
  });

  test("alternating history is preserved and the current text lands last as user", () => {
    const history = [
      { role: "user", text: "what's the weather" },
      { role: "assistant", text: "Sunny, 24 degrees." }
    ];
    const out = buildConverseMessages("and tomorrow?", history);
    expect(out).toEqual([
      { role: "user", content: "what's the weather" },
      { role: "assistant", content: "Sunny, 24 degrees." },
      { role: "user", content: "and tomorrow?" }
    ]);
  });

  test("history is bounded to the last MAX_TURNS turns", () => {
    const history = [];
    for (let i = 0; i < MAX_TURNS + 4; i++) {
      history.push({ role: i % 2 ? "assistant" : "user", text: `turn ${i}` });
    }
    const out = buildConverseMessages("current", history);
    // MAX_TURNS kept + the current text merged/appended; older turns gone.
    expect(JSON.stringify(out)).not.toContain("turn 0");
    expect(JSON.stringify(out)).not.toContain(`turn ${3}`);
    expect(out[out.length - 1].role).toBe("user");
    expect(out[out.length - 1].content).toContain("current");
  });

  test("a leading assistant turn is dropped (messages must start with user)", () => {
    const out = buildConverseMessages("next", [{ role: "assistant", text: "orphan reply" }]);
    expect(out).toEqual([{ role: "user", content: "next" }]);
  });

  test("consecutive same-role turns merge; blank turns are skipped", () => {
    const out = buildConverseMessages("three", [
      { role: "user", text: "one" },
      { role: "user", text: "two" },
      { role: "assistant", text: "   " }
    ]);
    expect(out).toEqual([{ role: "user", content: "one\ntwo\nthree" }]);
  });

  test("every turn is clamped to MAX_TURN_CHARS", () => {
    const long = "x".repeat(MAX_TURN_CHARS * 3);
    const out = buildConverseMessages(long, [{ role: "user", text: long }]);
    for (const msg of out) {
      for (const line of msg.content.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(MAX_TURN_CHARS);
      }
    }
  });
});

// Regression: the concierge carried no date, so it aged a dog born 20 May 2022
// to "two years old" when asked in July 2026. Anchored to a fixed instant so
// this asserts the real thing rather than restating Date's own behaviour.
test.describe("todayLine — the concierge has to know what day it is", () => {
  test("states the date, in the house's own words", () => {
    const line = todayLine(new Date("2026-07-27T06:00:00Z"));
    expect(line).toContain("Monday 27 July 2026");
    expect(line).toMatch(/how long ago/i); // the instruction, not just the date
  });

  test("Brisbane, not UTC — a UTC evening is already tomorrow here", () => {
    // 15:00Z on the 27th is 01:00 on the 28th in Brisbane. Getting this wrong
    // would make the house a day behind itself for ten hours of every day.
    expect(todayLine(new Date("2026-07-27T15:00:00Z"))).toContain("28 July 2026");
  });

  test("defaults to now, so the route never has to pass a clock", () => {
    expect(todayLine()).toMatch(/^Today is \w+ \d{1,2} \w+ \d{4}\./);
  });

  // Regression, 2026-08-09: asked how the night had gone, the concierge said it
  // had access to neither the sleep data nor the time. The second half was
  // true — this line carried the date and no clock, so "later today",
  // "tonight" and "have I got time" were all unanswerable from the prompt.
  test("carries the clock, not just the calendar", () => {
    const line = todayLine(new Date("2026-07-27T06:00:00Z")); // 16:00 Brisbane
    expect(line).toMatch(/it is 4:00 pm right now/i);
  });

  test("the clock is Brisbane's too, not UTC's", () => {
    // 22:30Z is 08:30 the next morning here. A concierge an hour out is
    // merely wrong; one ten hours out greets the morning at bedtime.
    expect(todayLine(new Date("2026-07-27T22:30:00Z"))).toMatch(/it is 8:30 am right now/i);
  });
});

// The house voice is deliberately loud, and the knowledge base now names real
// deaths including two children. This pins the wording and that it survives
// composition; whether the model actually obeys it is proved live, not here.
test.describe("GRIEF_LINE — the comedy stops at a death", () => {
  test("instructs plainness, and scopes it to part of the answer", () => {
    expect(GRIEF_LINE).toMatch(/has died/i);
    expect(GRIEF_LINE).toMatch(/no joke/i);
    // Scope matters: "who are Greg's brothers" lists four, one of whom died.
    // Flattening the whole reply would be its own kind of wrong.
    expect(GRIEF_LINE).toMatch(/rest of the reply/i);
  });

  test("survives into the composed prompt, with and without vault context", () => {
    const base = ["You are the voice of a home.", GRIEF_LINE];
    expect(buildConverseSystem(base, "")).toContain(GRIEF_LINE);
    expect(buildConverseSystem(base, "<note title=\"x\">y</note>")).toContain(GRIEF_LINE);
  });
});

// The mic carries no speaker identity, so "your sister" is a coin flip between
// two men. It was landing wrong often enough to garble ("your brother's sister").
test.describe("SPEAKER_UNKNOWN_LINE — never guess who is talking", () => {
  test("names both residents and forbids guessing", () => {
    expect(SPEAKER_UNKNOWN_LINE).toContain("Greg");
    expect(SPEAKER_UNKNOWN_LINE).toContain("Brett");
    expect(SPEAKER_UNKNOWN_LINE).toMatch(/never guess/i);
  });

  // Scope is the whole point: a flat ban on "you" would gut the practical half
  // of the voice, so the rule must apply to relationships only.
  test("restricts the rule to relationships, not to the word 'you'", () => {
    expect(SPEAKER_UNKNOWN_LINE).toMatch(/related/i);
    expect(SPEAKER_UNKNOWN_LINE).toMatch(/still fine/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOUSE'S CHARACTER — docs/design/CHARACTER.md

   Two properties matter here and neither is "the prose is good":

     1. Flag OFF is byte-identical to the pre-character prompt. That is the
        rollback path, and a rollback nothing asserts is one nobody should
        trust.
     2. The block is CONSTANT across calls. It heads the cacheable prefix, so
        one varying byte anywhere in it drops the cache read to zero on every
        turn — silently, with no error and nothing in the response to notice.

   ⚠ These mutate process.env, and node-side module state leaks between specs
   in a worker (reference-boot-module-state-leak). Every test restores it.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("houseCharacter — who is speaking", () => {
  test("is the same string on every call (it heads a cacheable prefix)", () => {
    expect(houseCharacter()).toBe(houseCharacter());
  });

  // The whole point of the rewrite. A character defined as a pointer to
  // somebody else's character cannot be made consistent, and the show name
  // reaching a prompt is the regression that says the pointer came back.
  test("names no external property — it is originated, not referenced", () => {
    const text = houseCharacter().toLowerCase();
    for (const ghost of ["kath", "kim", "sharon", "brett and kath"]) {
      expect(text).not.toContain(ghost);
    }
  });

  test("carries the traits the page says are load-bearing", () => {
    const text = houseCharacter();
    expect(text).toMatch(/fact comes first/i);      // never a joke before the number
    expect(text).toMatch(/8:41/);                    // the counting habit, by example
    expect(text).toMatch(/specific or be silent/i);  // the anti-vagueness rule
    expect(text).toMatch(/never scold/i);            // VOICE.md rule 10, carried over
    expect(text).toMatch(/side gate/i);              // VOICE.md rule 7, carried over
  });

  // The counting habit is the sharpest trait in the file and "you've forgotten
  // the bins three times" is exactly what it degrades into unsupervised.
  test("blunts its own sharpest trait — a count is never evidence against a person", () => {
    expect(houseCharacter()).toMatch(/never as a correction/i);
    expect(houseCharacter()).toMatch(/evidence against/i);
  });

  // ⚠ Not "contains no time-shaped text" — the mechanics line quotes "8:20 am"
  // as the en-AU formatting example, which is static copy and belongs here.
  // "1 August 2026" and "2011" are biography and belong here too. The actual
  // invalidator is a LIVE clock, so compare against the live clock: anything
  // todayLine() would render today must be absent from a block that claims to
  // be constant.
  test("carries no live clock or date — only static copy and biography", () => {
    const text = houseCharacter();
    const now = new Date();
    const today = now.toLocaleDateString("en-AU", {
      timeZone: HOUSE_TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
    const time = now.toLocaleTimeString("en-AU", {
      timeZone: HOUSE_TIME_ZONE, hour: "numeric", minute: "2-digit"
    });
    expect(text).not.toContain(today);
    expect(text).not.toContain(time);
    expect(todayLine()).toContain(time);   // the clock lives there, and only there
  });
});

test.describe("converseSystem — the flag-off prompt is unchanged", () => {
  const KEY = "HOUSE_CHARACTER_ENABLED";
  let saved;
  test.beforeEach(() => { saved = process.env[KEY]; });
  test.afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  test("flag off → the old register, and no character text at all", () => {
    delete process.env[KEY];
    const out = converseSystem("what's the weather", []);
    expect(out).toContain(VOICE_REGISTER);
    expect(out).not.toContain("only permanent resident");
  });

  // Anything truthy-but-not-"1" must read as off. "true" and "0" are both
  // things a .env acquires by hand, and either silently inverting the gate is
  // how a flag stops being a rollback path.
  test("only the exact string \"1\" arms it", () => {
    for (const value of ["0", "true", "yes", ""]) {
      process.env[KEY] = value;
      expect(converseSystem("hello", [])).toContain(VOICE_REGISTER);
    }
  });

  test("flag on → the character replaces the register, and nothing else moves", () => {
    process.env[KEY] = "1";
    const out = converseSystem("what's the weather", []);
    expect(out).toContain("only permanent resident");
    expect(out).not.toContain(VOICE_REGISTER);
    // The two correctness lines are personality-independent and must survive
    // the swap — they are about who died and who is speaking, not about tone.
    expect(out).toContain(GRIEF_LINE);
    expect(out).toContain(SPEAKER_UNKNOWN_LINE);
  });

  // The ordering IS the cache. todayLine() carries a minute-resolution clock;
  // if it ever migrates above the character block the prefix changes every
  // turn and the cache read silently goes to zero.
  test("the volatile clock sits after the stable character block", () => {
    process.env[KEY] = "1";
    const out = converseSystem("hello", []);
    expect(out.indexOf("only permanent resident")).toBeLessThan(out.indexOf("It is "));
  });
});
