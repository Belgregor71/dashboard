import { test, expect } from "@playwright/test";
import {
  parseLog,
  renderNote,
  renderTranscript,
  houseDay,
  memoryEnabled,
  MAX_ENTRY_CHARS,
  MAX_ENTRIES_PER_DAY,
  RAW_RETENTION_DAYS
} from "../server/services/conversationLog.js";

/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATION MEMORY — the pure half.

   Everything asserted here runs without touching the disk or the API. The
   parts that do (consolidateOnce, the sweep, the review routes) are proved
   live, because a fixture that cannot produce the defect cannot catch it.

   The properties that matter are all about NOT keeping things: the retention
   promise, the frontmatter that must not exist, and the flag defaulting off.
   ═══════════════════════════════════════════════════════════════════════════ */

test.describe("memoryEnabled — off unless asked, exactly", () => {
  const KEY = "VOICE_MEMORY_ENABLED";
  let saved;
  test.beforeEach(() => { saved = process.env[KEY]; });
  test.afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  test("unset is off", () => {
    delete process.env[KEY];
    expect(memoryEnabled()).toBe(false);
  });

  // A microphone that writes things down does not get to be switched on by a
  // typo. "true" and "0" are both things a hand-edited .env acquires.
  test("only the exact string \"1\" arms it", () => {
    for (const value of ["0", "true", "yes", "", "on"]) {
      process.env[KEY] = value;
      expect(memoryEnabled()).toBe(false);
    }
    process.env[KEY] = "1";
    expect(memoryEnabled()).toBe(true);
  });
});

test.describe("houseDay — Brisbane, not the server's idea of a day", () => {
  test("sorts lexically, which the 'is this today's file' check relies on", () => {
    expect(houseDay(new Date("2026-08-15T02:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(houseDay(new Date("2026-08-14T00:00:00Z")) < houseDay(new Date("2026-08-15T00:00:00Z"))).toBe(true);
  });

  // 15:00Z is already 01:00 the next day here. A UTC day boundary would file
  // the evening's conversation under the wrong date and — worse — consolidate
  // it as "finished" while it was still being had.
  test("a UTC evening is already tomorrow in Brisbane", () => {
    expect(houseDay(new Date("2026-08-14T15:00:00Z"))).toBe("2026-08-15");
    expect(houseDay(new Date("2026-08-14T13:59:00Z"))).toBe("2026-08-14");
  });
});

test.describe("parseLog — a corrupt line costs that line, never the day", () => {
  test("reads well-formed entries", () => {
    const raw = [
      JSON.stringify({ at: "2026-08-15T01:00:00Z", said: "when's the rubbish", replied: "Tonight." }),
      JSON.stringify({ at: "2026-08-15T01:01:00Z", said: "thanks", replied: "" })
    ].join("\n");
    expect(parseLog(raw)).toHaveLength(2);
    expect(parseLog(raw)[0].said).toBe("when's the rubbish");
  });

  // A hard kill mid-append leaves half a line. Losing the whole day's memory
  // to it would be a poor trade.
  test("a half-written trailing line is skipped, the rest survives", () => {
    const raw = `${JSON.stringify({ said: "good one" })}\n{"said":"trunca`;
    expect(parseLog(raw)).toHaveLength(1);
  });

  test("entries with no utterance are dropped", () => {
    const raw = [
      JSON.stringify({ said: "   ", replied: "hello" }),
      JSON.stringify({ replied: "orphan" }),
      JSON.stringify({ said: "real" })
    ].join("\n");
    expect(parseLog(raw)).toHaveLength(1);
  });

  test("never throws on rubbish", () => {
    for (const bad of [null, undefined, "", "not json", 42, "{}\n[]\n"]) {
      expect(() => parseLog(bad)).not.toThrow();
    }
  });
});

test.describe("renderNote — a memory that must not caption a photograph", () => {
  const note = { title: "Melbourne trip in October", tags: ["travel", "#Melbourne"], body: "Greg and Brett are going to Melbourne in October." };

  /* ⚠⚠ THE ONE THAT WOULD BE FOUND ON THE WALL RATHER THAN IN A TEST.
     `date`, `until` and `label` are not metadata in this vault — they open a
     photo-caption span (docs/design/VAULT.md, "The date grain"). A memory note
     dated today with a label would start captioning today's photographs with
     whatever the kitchen happened to be talking about. */
  test("carries no date, until or label — those caption photographs", () => {
    const md = renderNote(note, "2026-08-15");
    const frontmatter = md.split("---")[1];
    expect(frontmatter).not.toMatch(/^\s*date:/m);
    expect(frontmatter).not.toMatch(/^\s*until:/m);
    expect(frontmatter).not.toMatch(/^\s*label:/m);
  });

  test("the day is recorded as prose in the body, where it is inert", () => {
    expect(renderNote(note, "2026-08-15")).toContain("2026-08-15");
    expect(renderNote(note, "2026-08-15")).toMatch(/Remembered by the house/);
  });

  // Provenance: a person reading their own vault has to be able to tell what
  // they wrote from what the house wrote about them.
  test("is marked as machine-written and tagged for retrieval", () => {
    const md = renderNote(note, "2026-08-15");
    expect(md).toContain("kind: memory");
    expect(md).toMatch(/tags: \[memory, /);
  });

  test("tags are normalised the way the vault parser expects", () => {
    // Obsidian writes inline tags as "#travel"; the index strips the hash and
    // lowercases, so a note written with one would never match the spoken word.
    expect(renderNote(note, "2026-08-15")).toContain("melbourne");
    expect(renderNote(note, "2026-08-15")).not.toContain("#Melbourne");
  });

  test("indexable — private is false, or the note is invisible to retrieval", () => {
    expect(renderNote(note, "2026-08-15")).toContain("private: false");
  });

  test("a title with a newline cannot break the frontmatter block", () => {
    const md = renderNote({ ...note, title: "line one\nline two" }, "2026-08-15");
    expect(md.split("\n")[1]).toBe("title: line one line two");
    expect(md.split("---").length).toBeGreaterThanOrEqual(3);
  });

  test("tags are bounded", () => {
    const md = renderNote({ ...note, tags: Array.from({ length: 30 }, (_, i) => `t${i}`) }, "2026-08-15");
    expect(md.match(/tags: \[(.+)\]/)[1].split(", ")).toHaveLength(7); // "memory" + 6
  });
});

test.describe("renderTranscript — what the distiller is shown", () => {
  test("attributes both sides, so the house's own guesses are identifiable", () => {
    const out = renderTranscript([{ said: "is it going to rain", replied: "Not today." }]);
    expect(out).toContain("Person: is it going to rain");
    expect(out).toContain("House: Not today.");
  });

  // The house's replies can be wrong. The prompt tells the model not to treat
  // them as fact, which is only possible if they are labelled as its own.
  test("a turn the house did not answer is still shown", () => {
    expect(renderTranscript([{ said: "hmm", replied: "" }])).toBe("Person: hmm");
  });
});

test.describe("the retention promise", () => {
  // Not arbitrary numbers — each one is a ceiling on how much of a kitchen
  // ends up on an SD card in a public-repo checkout.
  test("raw text is bounded on every axis: length, count and age", () => {
    expect(MAX_ENTRY_CHARS).toBeLessThanOrEqual(2000);
    expect(MAX_ENTRIES_PER_DAY).toBeLessThanOrEqual(1000);
    expect(RAW_RETENTION_DAYS).toBeLessThanOrEqual(7);
    expect(RAW_RETENTION_DAYS).toBeGreaterThan(0);
  });
});
