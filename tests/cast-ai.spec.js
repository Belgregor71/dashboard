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

  test("a number spelled out is checked the same as one in digits", () => {
    expect(claimFault("It's twenty-seven degrees.", SOURCE)).toBe("number 27");
    expect(claimFault("It got to forty today.", SOURCE)).toBe("number 40");
    expect(claimFault("It hasn't rung in five days.", SOURCE)).toBe("number 5");
    expect(claimFault("It's thirty-one out, Kim.", SOURCE)).toBeNull();
    expect(claimFault("The dentist is at three.", SOURCE)).toBeNull();
  });

  test("a spoken figure may stand for part of a written one", () => {
    const fuel = "Fuel: unleaded is 1.79. Time: 7:30 am.";
    expect(claimFault("Unleaded's one seventy-nine.", fuel)).toBeNull();
    expect(claimFault("It's only half seven.", fuel)).toBeNull();
  });

  test("ordinary speech is not mistaken for a figure", () => {
    expect(claimFault("I've got one word to say to you.", SOURCE)).toBeNull();
    expect(claimFault("You two are a disgrace.", SOURCE)).toBeNull();
    expect(claimFault("Someone's got no sense.", SOURCE)).toBeNull();
  });

  test("a past or a habit nobody recorded is refused", () => {
    expect(claimFault("He'll leave the cords out like last time.", SOURCE)).toBe("invents a past");
    expect(claimFault("It was hot yesterday.", SOURCE)).toBe("invents a past");
    expect(claimFault("Neither of them, Greg or Brett, ever does the dishes.", SOURCE)).toBe("invents a habit");
    expect(claimFault("Greg never does the vacuuming.", SOURCE)).toBe("invents a habit");
    expect(claimFault("It's Greg's turn to vacuum.", SOURCE)).toBeNull();
  });

  test("a sentence the token limit cut off is not offered", () => {
    expect(keepClaims("Bins go out. Oh, and the Broncos signed a", SOURCE)).toBe("Bins go out.");
  });

  test("a list is flattened into speech", () => {
    expect(keepClaims("Say this:\n- Be kind.\n- Be there.", SOURCE)).toBe("Say this: Be kind. Be there.");
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

  test("the room hears four lines, and the wall keeps them all", () => {
    const script = ["Kath: One.", "Kim: Two.", "Kath: Three.", "Kim: Four.", "Kath: Five."].join("\n");
    const { text, lines } = readCastScript(script);
    expect(lines.map((line) => line.text)).toEqual(["One.", "Two.", "Three.", "Four."]);
    expect(text).toBe("One. Two. Three. Four. Five.");
  });

  test("an ordinary briefing passes through untouched", () => {
    const plain = "A quiet one. Nothing on: it's yours.";
    expect(readCastScript(plain)).toEqual({ text: plain, lines: [] });
  });

  test("nothing stays nothing", () => {
    expect(readCastScript("")).toEqual({ text: "", lines: [] });
  });
});
