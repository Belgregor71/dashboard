import { test, expect } from "@playwright/test";
import { claimFault, keepClaims, keepReply, splitLines, stripTags } from "../server/services/castLines.js";
import { readCastScript } from "../src/v3/core/cast.js";
import { takeSentences } from "../server/services/voiceShape.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE CAST'S AI LINES. Invented lines only: the persona is private.

   A persona told to be uninformed is being told to invent, so what matters here
   is what stops a made-up fact reaching the room, and that one speaker's words
   never come out in the other's voice.
   ═══════════════════════════════════════════════════════════════════════════ */

const SOURCE = "Time: Sunday, 2:30 pm. Weather: 31 degrees, UV 8. Bins: Red. Calendar: Dentist at 3.";

test.describe("speaker tags", () => {
  test("each speaker keeps their own words", () => {
    expect(splitLines("Kath: It's hot.\nKim: Nobody asked.")).toEqual([
      { speaker: "kath", text: "It's hot." },
      { speaker: "kim", text: "Nobody asked." }
    ]);
  });

  test("a tag in the middle of a chunk does not bleed", () => {
    expect(splitLines("Kath: Yes. Kim: No.")).toEqual([
      { speaker: "kath", text: "Yes." },
      { speaker: "kim", text: "No." }
    ]);
  });

  test("short sentences merged by the chunker still split by speaker", () => {
    const { chunks } = takeSentences("Kath: Yes. Kim: No. Kath: That is quite enough of that from you. ");
    const lines = chunks.flatMap((chunk) => splitLines(chunk));
    expect(lines.map((line) => line.speaker)).toEqual(["kath", "kim", "kath"]);
  });

  test("a chunk that continues a line stays in the same voice", () => {
    expect(splitLines("And another thing.", "kim")).toEqual([{ speaker: "kim", text: "And another thing." }]);
  });

  test("a colon that is not a tag is left alone", () => {
    expect(splitLines("Kath: Remember this: nothing.")).toEqual([{ speaker: "kath", text: "Remember this: nothing." }]);
    expect(splitLines("Akim: hello", "kath")[0].text).toContain("Akim");
  });

  test("tags never reach the wall, history or memory", () => {
    expect(stripTags("Kath: One.\nKim: Two.")).toBe("One. Two.");
  });
});

test.describe("the fact check", () => {
  test("a number the model was given passes", () => {
    expect(claimFault("It's 31 degrees and UV 8, Kim.", SOURCE)).toBeNull();
    expect(claimFault("Dentist at 3.", SOURCE)).toBeNull();
    expect(claimFault("It's 2:30.", SOURCE)).toBeNull();
  });

  test("an invented number or clock time is refused", () => {
    expect(claimFault("It's 35 degrees.", SOURCE)).toBe("number 35");
    expect(claimFault("The bins went out at 8:41.", SOURCE)).toBe("number 8:41");
  });

  test("a number is matched whole, not as part of a bigger one", () => {
    expect(claimFault("It's 1 degree.", SOURCE)).toBe("number 1");
    expect(claimFault("It's 3 degrees.", "Weather: 31 degrees.")).toBe("number 3");
  });

  test("a day it was not told about is refused, and one it was passes", () => {
    expect(claimFault("It's on Tuesday.", SOURCE)).toBe("day Tuesday");
    expect(claimFault("Happy sunday, Kim.", SOURCE)).toBeNull();
  });

  test("claiming to have done something is refused unless a tool ran", () => {
    expect(claimFault("I've turned the lights off.", SOURCE)).toBe("claims an action");
    expect(claimFault("We just locked the door.", SOURCE)).toBe("claims an action");
    expect(claimFault("I've turned the lights off.", SOURCE, { toolRan: true })).toBeNull();
  });

  test("an opinion with no facts in it passes", () => {
    expect(claimFault("Look at you, you're a sight.", SOURCE)).toBeNull();
  });

  test("a line loses only its bad sentence", () => {
    expect(keepClaims("It's 31 degrees. It was 40 yesterday. Put a hat on.", SOURCE)).toBe("It's 31 degrees. Put a hat on.");
  });

  test("a reply loses a line left empty, and keeps its tags", () => {
    expect(keepReply("Kath: It was 40 yesterday.\nKim: It's 31.", SOURCE)).toBe("Kim: It's 31.");
    expect(keepReply("Kath: It was 40 yesterday.", SOURCE)).toBeNull();
  });
});

test.describe("reading a written briefing", () => {
  test("a tagged script gives lines to speak and clean words for the wall", () => {
    expect(readCastScript("Kath: Hot today.\nKim: Noted.")).toEqual({
      text: "Hot today. Noted.",
      lines: [{ voice: "kath", text: "Hot today." }, { voice: "kim", text: "Noted." }]
    });
  });

  test("an ordinary briefing passes through untouched", () => {
    const plain = "A quiet one. Nothing on: it's yours.";
    expect(readCastScript(plain)).toEqual({ text: plain, lines: [] });
  });

  test("nothing stays nothing", () => {
    expect(readCastScript("")).toEqual({ text: "", lines: [] });
  });
});
