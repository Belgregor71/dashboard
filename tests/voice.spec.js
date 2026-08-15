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
  MAX_TURN_CHARS,
  houseContext,
  MAX_DIGEST_ENTRIES,
  MAX_DIGEST_VALUE_CHARS,
  takeSentences
} from "../server/services/voiceShape.js";
import { houseCharacter } from "../server/services/character.js";
import { houseDigest } from "../src/js/services/voiceSnapshot.js";
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
    // The anti-vagueness rule. Reworded 2026-08-16 from "be specific or be
    // silent", which the model read as licence to invent specifics when it had
    // none — see the invented-reading guard in tests/unresolved.spec.js.
    expect(text).toMatch(/specific about what you have/i);
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

/* ═══════════════════════════════════════════════════════════════════════════
   houseContext — the digest becoming prompt lines.

   The property under test is not "it renders nicely". It is that a house which
   cannot SEE something never sounds like a house reporting that there is
   nothing there. That distinction is carried carefully through every reader in
   voiceSnapshot.js because losing it once already produced "the shopping list
   is empty" on a morning when Home Assistant was simply disconnected.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("houseContext — absent is not empty", () => {
  test("known state is rendered as what the house can see", () => {
    const out = houseContext({ known: { weather: "19°, clear", playing: "nothing playing" }, blind: [] });
    expect(out).toContain("19°, clear");
    expect(out).toContain("nothing playing");
    expect(out).not.toMatch(/CANNOT see/);
  });

  // The load-bearing one.
  test("a blind spot is named, and instructs the house not to fill it in", () => {
    const out = houseContext({ known: {}, blind: ["the shopping list", "the cameras"] });
    expect(out).toContain("the shopping list");
    expect(out).toMatch(/CANNOT see/);
    expect(out).toMatch(/do not guess/i);
  });

  test("empty and blind produce visibly different prompts for the same field", () => {
    const empty = houseContext({ known: { shopping: "the shopping list is empty" }, blind: [] });
    const unseen = houseContext({ known: {}, blind: ["the shopping list"] });
    expect(empty).not.toBe(unseen);
    expect(empty).not.toMatch(/CANNOT see/);
    expect(unseen).toMatch(/CANNOT see/);
  });

  // ⚠ An array reaching a reader keyed by name is what left bomWarning
  // permanently empty. This one arrives over HTTP, so it must degrade rather
  // than throw or silently render garbage.
  test("a malformed digest degrades to nothing instead of throwing", () => {
    for (const bad of [null, undefined, "weather", 42, [], { known: ["19°"] }, { known: null }]) {
      expect(() => houseContext(bad)).not.toThrow();
      expect(houseContext(bad)).toBe("");
    }
  });

  test("non-string values are dropped, not stringified into [object Object]", () => {
    const out = houseContext({ known: { weather: "19°", junk: { a: 1 }, n: 5 }, blind: [] });
    expect(out).toContain("19°");
    expect(out).not.toContain("[object Object]");
    expect(out).not.toContain("5");
  });

  // It rides every conversational turn, so it is bounded on both axes.
  test("bounded — entries and value length are both capped", () => {
    const known = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`k${i}`, "x".repeat(500)])
    );
    const out = houseContext({ known, blind: [] });
    expect(out.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(MAX_DIGEST_ENTRIES);
    for (const line of out.split("\n").filter((l) => l.startsWith("- "))) {
      expect(line.length).toBeLessThanOrEqual(MAX_DIGEST_VALUE_CHARS + 2);
    }
  });

  test("nothing known and nothing blind is the empty string, not a stray header", () => {
    expect(houseContext({ known: {}, blind: [] })).toBe("");
  });
});

test.describe("converseSystem — the house digest is gated and ordered", () => {
  const KEYS = ["HOUSE_CHARACTER_ENABLED", "VOICE_HOUSE_CONTEXT"];
  let saved;
  test.beforeEach(() => { saved = KEYS.map((k) => process.env[k]); });
  test.afterEach(() => {
    KEYS.forEach((k, i) => {
      if (saved[i] === undefined) delete process.env[k];
      else process.env[k] = saved[i];
    });
  });

  const DIGEST = { known: { weather: "19°, clear" }, blind: ["the cameras"] };

  // Sending the family's calendar titles and shopping list upstream is a
  // separate consent from giving the house a character, so it is a separate
  // flag and it defaults off.
  test("off by default — no house state reaches the prompt", () => {
    delete process.env.VOICE_HOUSE_CONTEXT;
    expect(converseSystem("what's it doing out there", [], DIGEST)).not.toContain("19°, clear");
  });

  test("on → the state is in the prompt", () => {
    process.env.VOICE_HOUSE_CONTEXT = "1";
    const out = converseSystem("what's it doing out there", [], DIGEST);
    expect(out).toContain("19°, clear");
    expect(out).toContain("the cameras");
  });

  // The digest changes nearly every turn. Above the breakpoint it would
  // invalidate the cached prefix on every single request.
  test("sits after the stable character block", () => {
    process.env.HOUSE_CHARACTER_ENABLED = "1";
    process.env.VOICE_HOUSE_CONTEXT = "1";
    const out = converseSystem("hello", [], DIGEST);
    expect(out.indexOf("only permanent resident")).toBeLessThan(out.indexOf("19°, clear"));
  });

  test("a missing digest is not an error — the turn is unchanged", () => {
    process.env.VOICE_HOUSE_CONTEXT = "1";
    expect(() => converseSystem("hello", [])).not.toThrow();
    expect(converseSystem("hello", [])).toContain(GRIEF_LINE);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   houseDigest — the same absent/empty discipline, at the source.

   houseContext (above) proves the PROMPT keeps the two apart. These prove the
   DIGEST does, which is where the distinction is actually made or lost: every
   reader in voiceSnapshot.js is careful about it individually, and a digest
   that flattens them undoes all of that work in one function.

   voiceSnapshot.js is browser runtime but imports clean in node — houseDigest
   itself is pure and touches neither the DOM nor the entity cache.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("houseDigest — the shape that crosses the wire", () => {
  // Not an array. Handing an array to a reader keyed by name is exactly what
  // left bomWarning permanently empty and cost the wall its storm warning.
  test("known is a keyed object, blind is an array", () => {
    const d = houseDigest({});
    expect(Array.isArray(d.known)).toBe(false);
    expect(typeof d.known).toBe("object");
    expect(Array.isArray(d.blind)).toBe(true);
  });

  test("never throws, whatever it is handed", () => {
    for (const bad of [null, undefined, {}, "nope", 42, []]) {
      expect(() => houseDigest(bad)).not.toThrow();
    }
  });

  // The regression this whole discipline exists for. With HA disconnected the
  // house once said "the shopping list is empty" with total confidence.
  test("an unreadable shopping list is blind; a genuinely empty one is known", () => {
    const unseen = houseDigest({ todos: { shopping: null, tasks: null } });
    expect(unseen.blind).toContain("the shopping list");
    expect(unseen.known.shopping).toBeUndefined();

    const empty = houseDigest({ todos: { shopping: [], tasks: [] } });
    expect(empty.blind).not.toContain("the shopping list");
    expect(empty.known.shopping).toMatch(/empty/i);
  });

  // null = no media players known at all, i.e. Home Assistant is not talking.
  // [] = the players exist and none of them is playing. Different sentences.
  test("no players known is blind; players known and idle is 'nothing playing'", () => {
    expect(houseDigest({ media: null }).blind).toContain("what's playing");
    expect(houseDigest({ media: [] }).known.playing).toBe("nothing playing");
    expect(houseDigest({ media: [{ title: "Grace", artist: "Jeff Buckley" }] }).known.playing)
      .toBe("Grace by Jeff Buckley");
  });

  // Same rule, and the answerers already enforce it: an undefined calendar
  // must never become "nothing on today" on the day someone relies on it.
  test("an unreadable calendar is blind, never 'nothing on'", () => {
    expect(houseDigest({}).blind).toContain("the calendar");
    expect(houseDigest({}).known.today).toBeUndefined();
    expect(houseDigest({ calendar: [] }).known.today).toMatch(/nothing on the calendar/i);
  });

  test("an empty people roster means HA is quiet, not that the house is empty", () => {
    const d = houseDigest({ people: [] });
    expect(d.blind).toContain("who is home");
    expect(JSON.stringify(d.known)).not.toMatch(/nobody home/i);
  });

  test("known:false cameras are blind; known with no event is a real answer", () => {
    expect(houseDigest({ camera: { known: false, lastEvent: null } }).blind).toContain("the cameras");
    expect(houseDigest({ camera: { known: true, lastEvent: null } }).known.cameras)
      .toMatch(/nothing on the cameras/i);
  });

  test("weather is worded, rounded and en-AU", () => {
    const d = houseDigest({
      weather: { now: { temp_c: 19.4, condition: { label: "Clear" }, uv: 3.2 }, day: { high_c: 24.6, low_c: 12.1 } }
    });
    expect(d.known.weather).toContain("19°");
    expect(d.known.weather).toContain("clear");
    expect(d.known.weather).toContain("12–25°");
    expect(d.known.weather).toContain("UV 3");
  });

  // The nowcast is a ~90 minute radar extrapolation. Its absence means "no
  // rain coming", which is information — not a blind spot to confess to.
  test("no nowcast is silence, not a blind spot", () => {
    const d = houseDigest({ nowcast: null });
    expect(d.known.rainIncoming).toBeUndefined();
    expect(d.blind).not.toContain("rain");
    expect(houseDigest({ nowcast: { startsInMin: 20 } }).known.rainIncoming).toMatch(/20 minutes/);
  });

  // Bins that were never configured are a settled fact about this house, not
  // something it is failing to see.
  test("unconfigured bins earn neither a known line nor a confession", () => {
    const d = houseDigest({ bins: { configured: false } });
    expect(d.known.bins).toBeUndefined();
    expect(d.blind.join(" ")).not.toMatch(/bin/i);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   takeSentences — cutting a stream into things worth synthesising.

   The property that matters is the one that is easy to get wrong and
   embarrassing out loud: a full stop at the END OF THE BUFFER is not a
   sentence boundary. Deltas arrive mid-token, so "19.5 degrees" reaches this
   as "19." and then "5 degrees" — a rule that cut at end-of-buffer would
   speak "nineteen point" and then, separately, "five degrees".
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("takeSentences — sentence chunking for streamed speech", () => {
  test("emits a completed sentence and keeps the remainder", () => {
    const { chunks, rest } = takeSentences("It's nineteen degrees and clear. Tomorrow looks");
    expect(chunks).toEqual(["It's nineteen degrees and clear."]);
    expect(rest.trim()).toBe("Tomorrow looks");
  });

  // ⚠ The one that would be heard on the wall rather than found in a test.
  test("a decimal mid-stream is never mistaken for a sentence end", () => {
    expect(takeSentences("Twelve millimetres and it's 19.").chunks).toEqual([]);
    expect(takeSentences("Twelve millimetres and it's 19.").rest).toContain("19.");
    // ...and once the rest arrives it still is not a boundary.
    expect(takeSentences("Twelve millimetres and it's 19.5 degrees").chunks).toEqual([]);
  });

  test("nothing is emitted until punctuation is followed by whitespace", () => {
    expect(takeSentences("Still writing").chunks).toEqual([]);
    expect(takeSentences("Still writing.").chunks).toEqual([]);   // end of buffer
    expect(takeSentences("Still writing. ").chunks).toEqual(["Still writing."]);
  });

  test("several sentences in one delta all come out, in order", () => {
    const { chunks } = takeSentences("Bins go out tonight. It's the yellow one. Hat on if you're heading out. ");
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toBe("Bins go out tonight.");
    expect(chunks[2]).toBe("Hat on if you're heading out.");
  });

  test("question and exclamation marks are boundaries too", () => {
    expect(takeSentences("Are the bins out tonight? Yellow one, and it's raining. ").chunks)
      .toHaveLength(2);
    expect(takeSentences("Get the hat on! We're not doing sunstroke today. ").chunks)
      .toHaveLength(2);
  });

  // A short sentence AFTER a long one is held back rather than emitted alone,
  // and comes out in the caller's end-of-stream flush. Same MIN_CHUNK_CHARS
  // rule as above, just reached from the other side — worth pinning because
  // the obvious expectation ("two sentences, two chunks") is wrong here.
  test("a short trailing sentence waits in rest for the end-of-stream flush", () => {
    const { chunks, rest } = takeSentences("Are the bins out tonight? Probably. ");
    expect(chunks).toEqual(["Are the bins out tonight?"]);
    expect(rest.trim()).toBe("Probably.");
  });

  // A two-word sentence costs a whole synthesis round trip, which is more than
  // the sentence saves. It accretes onto the next one instead.
  test("a fragment shorter than MIN_CHUNK_CHARS waits for the next sentence", () => {
    const { chunks } = takeSentences("Yes. The bins go out tonight. ");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe("Yes. The bins go out tonight.");
  });

  test("a closing quote or bracket after the stop still closes the sentence", () => {
    expect(takeSentences('She said "the bins are out." Then she left. ').chunks).toHaveLength(2);
  });

  test("never throws, and returns the input as rest when there is no boundary", () => {
    for (const bad of [null, undefined, "", 42]) {
      expect(() => takeSentences(bad)).not.toThrow();
      expect(takeSentences(bad).chunks).toEqual([]);
    }
  });

  // Reassembly must be lossless: the spoken reply and the recorded reply have
  // to be the same words, or the transcript on the glass disagrees with the
  // room and the memory records something nobody said.
  test("chunks plus rest reconstruct the original text", () => {
    const text = "It's nineteen and clear. Rain later, about 4 pm. Hat on. Trailing bit";
    const { chunks, rest } = takeSentences(text);
    expect(`${chunks.join(" ")} ${rest}`.replace(/\s+/g, " ").trim())
      .toBe(text.replace(/\s+/g, " ").trim());
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT THE HOUSE HAS LEARNED — surfaced, hedged, and PULL ONLY.

   routineStore has computed a real 0-1 confidence since Phase 8 and nothing
   ever consumed it. These assert the two properties that let it reach the
   voice at all: it is gated on that existing confidence, and it is worded as
   a tendency rather than a fact about a person.

   ⚠ The third property — that it is never VOLUNTEERED — is asserted in
   tests/unresolved.spec.js against the character prompt, because that is
   where the instruction lives. phase-8-learn.md:81 makes it an absolute rule.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("houseDigest — learned routines, hedged", () => {
  test("a learned time is phrased as usual, never as a fact", () => {
    const d = houseDigest({ learned: { wake: 421, departure: 455, return: 1020 } });
    expect(d.known.usualDay).toMatch(/usually/);
    // 421 minutes = 7:01 am. The clock, not the raw minutes.
    expect(d.known.usualDay).toMatch(/7:01 am/);
    expect(d.known.usualDay).toMatch(/5:00 pm/);
  });

  // learnedTimes() already returns null below CONF_THRESHOLD. The digest must
  // not re-implement that bar, or the house ends up with two different
  // opinions about what it is sure of.
  test("nulls are absent, not rendered", () => {
    const d = houseDigest({ learned: { wake: 421, departure: null, return: null } });
    expect(d.known.usualDay).toMatch(/up around/);
    expect(d.known.usualDay).not.toMatch(/out by/);
  });

  /* ⚠ Not having learned a routine yet is NOT a blind spot. `blind` means "a
     sensor I cannot read", and the house answering "I can't see when you
     usually leave" would claim something is broken when the truth is simply
     that it has not worked it out yet. */
  test("no learned routine adds nothing to known AND nothing to blind", () => {
    const d = houseDigest({ learned: { wake: null, departure: null, return: null } });
    expect(d.known.usualDay).toBeUndefined();
    expect(d.blind.join(" ")).not.toMatch(/usual|routine|leave|wake/i);
  });

  test("a missing learned block is not an error", () => {
    expect(() => houseDigest({})).not.toThrow();
    expect(houseDigest({}).known.usualDay).toBeUndefined();
  });
});
