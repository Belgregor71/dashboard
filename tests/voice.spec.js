import { test, expect } from "@playwright/test";
import {
  shapeAssistResponse,
  buildConverseMessages,
  MAX_TURNS,
  MAX_TURN_CHARS
} from "../server/services/voiceShape.js";

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
