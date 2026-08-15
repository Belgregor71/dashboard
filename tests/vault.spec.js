import { test, expect } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";
import {
  parseNote,
  scoreNote,
  stemVariants,
  retrieve,
  buildContext,
  buildIndex,
  searchVault,
  tokenize,
  parseRelationships,
  buildRelationshipMap,
  isoDay,
  spanOf,
  spansFor,
  coveringSpan,
  getLabelledSpans,
  SCORE_FLOOR,
  MAX_CONTEXT_CHARS
} from "../server/services/vaultIndex.js";
import { buildConverseSystem, NO_KNOWLEDGE_LINE } from "../server/services/voiceShape.js";

const FIXTURE_VAULT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures",
  "vault"
);

// Pure unit tests for the house knowledge base (docs/design/VAULT.md).
// Everything above buildIndex() has no I/O, so these run straight in the
// Playwright node process — the voice.spec.js / insights.spec.js precedent.

test.describe("parseNote — the restricted frontmatter subset", () => {
  test("inline scalars, arrays and booleans", () => {
    const note = parseNote(
      ["---", "title: Tasmania 2019", "tags: [trip, family]", "kind: place", "private: false", "---", "We drove the Great Eastern Drive."].join("\n"),
      "places/tassie.md"
    );
    expect(note).toEqual({
      id: "places/tassie",
      title: "Tasmania 2019",
      tags: ["trip", "family"],
      kind: "place",
      private: false,
      date: null,
      until: null,
      label: null,
      body: "We drove the Great Eastern Drive."
    });
  });

  test("block-list tags — what Obsidian's property editor actually writes", () => {
    const note = parseNote(
      ["---", "title: Pantry", "tags:", "  - shopping", "  - kitchen", "---", "Flour is in the top tub."].join("\n"),
      "pantry.md"
    );
    expect(note.tags).toEqual(["shopping", "kitchen"]);
    expect(note.body).toBe("Flour is in the top tub.");
  });

  test("a note with no frontmatter is still indexable", () => {
    const note = parseNote("Just some prose about the hot water system.", "notes/hot-water.md");
    expect(note.title).toBe("hot-water"); // falls back to the filename
    expect(note.tags).toEqual([]);
    expect(note.kind).toBeNull();
    expect(note.private).toBe(false);
    expect(note.body).toBe("Just some prose about the hot water system.");
  });

  test("malformed frontmatter costs the property, never the note", () => {
    const note = parseNote(
      ["---", "title: Bins", "this line has no colon", "tags: [rubbish]", "---", "Yellow lid goes out Tuesday."].join("\n"),
      "bins.md"
    );
    expect(note.title).toBe("Bins");
    expect(note.tags).toEqual(["rubbish"]);
    expect(note.body).toBe("Yellow lid goes out Tuesday.");
  });

  test("an unterminated frontmatter block leaves the note whole rather than eating it", () => {
    const note = parseNote(["---", "title: Broken", "no closing delimiter here"].join("\n"), "broken.md");
    expect(note.title).toBe("broken"); // no valid block → filename fallback
    expect(note.body).toContain("no closing delimiter here");
  });

  test("a closing --- at EOF with no trailing newline still splits", () => {
    const note = parseNote("---\ntitle: Terse\n---", "terse.md");
    expect(note.title).toBe("Terse");
    expect(note.body).toBe("");
  });

  test("a '----' rule in the body does not truncate the note", () => {
    const note = parseNote(
      ["---", "title: Rules", "---", "Intro paragraph.", "----", "Outro paragraph."].join("\n"),
      "rules.md"
    );
    expect(note.title).toBe("Rules");
    expect(note.body).toContain("Outro paragraph.");
  });

  test("private: true is flagged so buildIndex can drop it before it is ever held", () => {
    const note = parseNote(["---", "title: Passwords", "private: true", "---", "hunter2"].join("\n"), "secret.md");
    expect(note.private).toBe(true);
  });

  test("private is only true for the literal boolean, not the string", () => {
    for (const raw of ["private: false", 'private: "true"', "private: yes", ""]) {
      const note = parseNote(["---", "title: T", raw, "---", "body"].join("\n"), "t.md");
      expect(note.private, `"${raw}" should not read as private`).toBe(false);
    }
  });

  // Regression: PowerShell 5.1's `Set-Content -Encoding utf8` always writes a
  // BOM and Node's readFile does not strip it, so the BOM sat in front of the
  // opening "---" and the frontmatter was silently ignored — filename as title,
  // no tags. Obsidian doesn't emit one, but Windows tooling does.
  test("a UTF-8 BOM does not hide the frontmatter", () => {
    const note = parseNote("﻿---\r\ntitle: Bommed\r\ntags: [house]\r\n---\r\nBody.", "b.md");
    expect(note.title).toBe("Bommed");
    expect(note.tags).toEqual(["house"]);
    expect(note.body).toBe("Body.");
  });

  test("CRLF notes parse the same as LF", () => {
    const note = parseNote("---\r\ntitle: Windows\r\ntags: [crlf]\r\n---\r\nBody text.", "win.md");
    expect(note.title).toBe("Windows");
    expect(note.tags).toEqual(["crlf"]);
    expect(note.body).toBe("Body text.");
  });

  test("tags are normalised — '#' stripped, cased down, deduped", () => {
    const note = parseNote(["---", "tags: [#Trip, trip, FAMILY]", "---", "x"].join("\n"), "t.md");
    expect(note.tags).toEqual(["trip", "family"]);
  });

  test("quoted values keep their spaces and lose their quotes", () => {
    const note = parseNote(['---', 'title: "The Beach House"', '---', 'x'].join("\n"), "b.md");
    expect(note.title).toBe("The Beach House");
  });

  test("id is vault-relative, slash-normalised and extension-free", () => {
    expect(parseNote("x", "places\\qld\\noosa.md").id).toBe("places/qld/noosa");
  });

  test("the date grain is read off the frontmatter", () => {
    const note = parseNote(
      ["---", "title: Mexico", "date: 2017-08-12", "until: 2017-08-21", "label: Mexico", "---", "Playa."].join("\n"),
      "trips/mexico-2017.md"
    );
    expect(note).toMatchObject({ date: "2017-08-12", until: "2017-08-21", label: "Mexico" });
  });

  /* An unparseable property costs that property, never the note — the same rule
     the rest of the frontmatter follows. A typo'd date must not make a trip note
     disappear from the concierge's index. */
  test("a malformed date costs the date, not the note", () => {
    const note = parseNote(
      ["---", "title: Mexico", "date: August 2017", "until: 2017-02-31", "---", "Playa."].join("\n"),
      "trips/mexico-2017.md"
    );
    expect(note).toMatchObject({ title: "Mexico", date: null, until: null, body: "Playa." });
  });

  test("non-string input never throws", () => {
    for (const raw of [null, undefined, 42, {}]) {
      expect(() => parseNote(raw, "x.md")).not.toThrow();
    }
  });
});

test.describe("tokenize + scoreNote — retrieval weighting", () => {
  const note = {
    id: "places/tassie",
    title: "Tasmania 2019",
    tags: ["trip", "family"],
    body: "We drove the Great Eastern Drive and stayed in Bicheno.",
    kind: "place"
  };

  test("stopwords and single characters are dropped", () => {
    expect(tokenize("what is the a of to")).toEqual([]);
    expect(tokenize("when did we go to Tasmania")).toEqual(["go", "tasmania"]);
  });

  test("a title hit outweighs a tag hit, which outweighs a body hit", () => {
    expect(scoreNote(note, "tasmania")).toBe(5);
    expect(scoreNote(note, "family")).toBe(3);
    expect(scoreNote(note, "bicheno")).toBe(2);
  });

  test("each query term counts once — a long note cannot win on repetition", () => {
    const repetitive = { ...note, title: "x", tags: [], body: "bicheno ".repeat(200) };
    expect(scoreNote(repetitive, "bicheno")).toBe(2);
  });

  // Both of these are live regressions: "how old are the dogs" skipped a note
  // tagged `dog`, and "when is Teddys birthday" missed a note titled `Teddy`.
  test("a plural question finds a singular note", () => {
    const dog = { title: "Benji", tags: ["dog"], body: "Border Collie." };
    expect(scoreNote(dog, "how old are the dogs")).toBeGreaterThanOrEqual(SCORE_FLOOR);
  });

  test("a possessive without an apostrophe still finds the name", () => {
    const teddy = { title: "Teddy (Theodore)", tags: [], body: "Born 20 May 2022." };
    expect(scoreNote(teddy, "when is Teddys birthday")).toBeGreaterThanOrEqual(SCORE_FLOOR);
  });

  test("an apostrophe possessive needs no stemming — tokenize already splits it", () => {
    expect(tokenize("what is Teddy's microchip")).toEqual(["teddy", "microchip"]);
  });

  test("stemming never double-counts a term that matches both ways", () => {
    // "dogs" hits the title as-is AND as "dog"; it must still score one title hit.
    expect(scoreNote({ title: "The dogs", tags: [], body: "" }, "dogs")).toBe(5);
  });

  test("short words are left alone, so 'gas' cannot match 'garage' via 'ga'", () => {
    expect(stemVariants("gas")).toEqual(["gas"]);
    expect(stemVariants("dogs")).toEqual(["dogs", "dog"]);
    expect(stemVariants("teddys")).toEqual(["teddys", "teddy"]);
    expect(stemVariants("rice")).toEqual(["rice"]); // no trailing s, untouched
    expect(scoreNote({ title: "Garage", tags: [], body: "" }, "gas")).toBe(0);
  });

  test("an empty or stopword-only query scores nothing", () => {
    expect(scoreNote(note, "")).toBe(0);
    expect(scoreNote(note, "what is the")).toBe(0);
    expect(scoreNote(null, "tasmania")).toBe(0);
  });
});

test.describe("retrieve — the score floor is what keeps prompts clean", () => {
  const notes = [
    { id: "a", title: "Tasmania 2019", tags: ["trip"], body: "Bicheno and Freycinet." },
    { id: "b", title: "Pantry", tags: ["kitchen"], body: "Flour, sugar, and the good salt." },
    { id: "c", title: "Bins", tags: ["chores"], body: "Yellow lid Tuesday." }
  ];

  test("returns the on-topic note and nothing else", () => {
    const hits = retrieve(notes, "when were we in Tasmania");
    expect(hits.map((n) => n.id)).toEqual(["a"]);
  });

  // Regression: a live probe asked "who is the plumber" against a note whose
  // BODY named the plumber, and a stricter floor returned nothing — the house
  // answering "I don't know" to a question it had written down. Recall on a
  // body-only hit is the property this lane lives or dies on.
  test("a body-only hit on one meaningful term still retrieves", () => {
    const house = [{ id: "hw", title: "Hot water system", tags: ["house"], body: "Plumber is Dave at Southside." }];
    expect(scoreNote(house[0], "who is the plumber")).toBeGreaterThanOrEqual(SCORE_FLOOR);
    expect(retrieve(house, "who is the plumber").map((n) => n.id)).toEqual(["hw"]);
  });

  test("an unrelated question retrieves nothing at all", () => {
    expect(retrieve(notes, "what is the airspeed of a swallow")).toEqual([]);
  });

  test("results are capped and ordered by score", () => {
    const hits = retrieve(notes, "Tasmania pantry bins", { max: 2 });
    expect(hits.length).toBe(2);
    expect(scoreNote(hits[0], "Tasmania pantry bins")).toBeGreaterThanOrEqual(
      scoreNote(hits[1], "Tasmania pantry bins")
    );
  });

  test("ties break deterministically, so the same question gives the same prompt", () => {
    const first = retrieve(notes, "Tasmania Pantry Bins", { max: 3 }).map((n) => n.id);
    const again = retrieve(notes, "Tasmania Pantry Bins", { max: 3 }).map((n) => n.id);
    expect(again).toEqual(first);
  });

  test("an empty vault is a valid state, not an error", () => {
    expect(retrieve([], "anything")).toEqual([]);
    expect(retrieve(null, "anything")).toEqual([]);
  });
});

/* The date grain (docs/design/VAULT.md "The date grain"). Until this existed
   every date in the vault was prose — "29 March to 12 April 2026" — and nothing
   could read it, so a photograph from inside a fifteen-day trip was captioned
   with the same bare year as a Tuesday at home. Pure, so all of it runs here. */
test.describe("isoDay — strict about the shape, not lenient about the value", () => {
  test("a plain calendar day passes through", () => {
    expect(isoDay("2017-08-12")).toBe("2017-08-12");
  });

  test("a full ISO timestamp is trimmed to its day", () => {
    expect(isoDay("2017-08-12T19:13:52.378Z")).toBe("2017-08-12");
  });

  /* ⚠ THE ONE THAT NEEDS BOTH CHECKS. new Date("2026-13-01") is Invalid and the
     parse catches it — but new Date("2026-02-31") is 3 March, so it parses
     perfectly and means something other than what the author wrote. Only the
     round-trip catches that, which is why the regex alone was not enough. */
  test("a date that rolls over is rejected, not silently moved", () => {
    expect(isoDay("2026-02-31")).toBeNull();
    expect(isoDay("2026-13-01")).toBeNull();
    expect(isoDay("2026-00-10")).toBeNull();
  });

  test("anything that is not a calendar day is null rather than a throw", () => {
    for (const raw of [null, undefined, 20170812, "", "  ", "12/08/2017", "August 2017", {}, []]) {
      expect(isoDay(raw)).toBeNull();
    }
  });
});

test.describe("spanOf / spansFor — a note's dates", () => {
  const note = (extra) => ({ id: "trips/x", title: "X", ...extra });

  test("a note with no date has no span — which is almost every note", () => {
    expect(spanOf(note({}))).toBeNull();
    expect(spanOf(note({ until: "2019-10-14", label: "Tasmania" }))).toBeNull();
    expect(spanOf(null)).toBeNull();
  });

  test("date without until spans exactly that day — a birthday, a wedding", () => {
    expect(spanOf(note({ date: "2017-08-12" }))).toMatchObject({ from: "2017-08-12", to: "2017-08-12" });
  });

  /* "29 March to 12 April" means the 12th is a day of the trip. Off-by-one here
     would silently drop the last day of every trip in the vault. */
  test("until is INCLUSIVE", () => {
    const span = spanOf(note({ date: "2017-08-12", until: "2017-08-21", label: "Mexico" }));
    expect(span).toMatchObject({ from: "2017-08-12", to: "2017-08-21", label: "Mexico" });
  });

  test("an until before the date collapses to one day rather than matching nothing", () => {
    expect(spanOf(note({ date: "2017-08-21", until: "2017-08-12" }))).toMatchObject({
      from: "2017-08-21",
      to: "2017-08-21"
    });
  });

  test("a dated note with no label still has a span — it just has nothing to say", () => {
    expect(spanOf(note({ date: "2017-08-12" })).label).toBeNull();
  });

  test("spansFor drops the undated and orders the rest, earliest first", () => {
    const spans = spansFor([
      { id: "b", date: "2023-05-21", until: "2023-06-01", label: "Singapore" },
      { id: "a", title: "no dates here" },
      { id: "c", date: "2017-03-07", until: "2017-03-26", label: "Europe" }
    ]);
    expect(spans.map((s) => s.id)).toEqual(["c", "b"]);
  });
});

test.describe("coveringSpan — which note owns a day", () => {
  const THAILAND = { id: "trips/thailand-2026", label: "Thailand", from: "2026-03-29", to: "2026-04-12" };
  const CHIANG_MAI = { id: "trips/thailand-2026-chiang-mai", label: "Chiang Mai", from: "2026-04-05", to: "2026-04-08" };
  const MEXICO = { id: "trips/mexico-2017", label: "Mexico", from: "2017-08-12", to: "2017-08-21" };

  test("a day inside the span is covered, at both edges", () => {
    expect(coveringSpan([MEXICO], "2017-08-12").label).toBe("Mexico");
    expect(coveringSpan([MEXICO], "2017-08-15").label).toBe("Mexico");
    expect(coveringSpan([MEXICO], "2017-08-21").label).toBe("Mexico");
  });

  test("a day outside it is not", () => {
    expect(coveringSpan([MEXICO], "2017-08-11")).toBeNull();
    expect(coveringSpan([MEXICO], "2017-08-22")).toBeNull();
    expect(coveringSpan([MEXICO], "2018-08-15")).toBeNull();
  });

  /* THE DESIGN DECISION. The Thailand note contains the Chiang Mai note, so a
     photo from the 6th is covered twice. The more specific note is the one
     saying something the photograph does not already say. */
  test("the SHORTEST span wins where two overlap", () => {
    expect(coveringSpan([THAILAND, CHIANG_MAI], "2026-04-06").label).toBe("Chiang Mai");
    expect(coveringSpan([CHIANG_MAI, THAILAND], "2026-04-06").label).toBe("Chiang Mai");
    // outside the inner span, the outer one still answers
    expect(coveringSpan([THAILAND, CHIANG_MAI], "2026-04-02").label).toBe("Thailand");
  });

  /* A caption that changed every ten minutes — each reindex — would read as a
     fault rather than a feature. Equal-length overlaps must not coin-flip. */
  test("equal-length overlaps break on id, so a reindex cannot change the caption", () => {
    const a = { id: "trips/aaa", label: "A", from: "2020-01-01", to: "2020-01-05" };
    const b = { id: "trips/bbb", label: "B", from: "2020-01-01", to: "2020-01-05" };
    expect(coveringSpan([a, b], "2020-01-03").label).toBe("A");
    expect(coveringSpan([b, a], "2020-01-03").label).toBe("A");
  });

  test("a malformed or absent day is not covered by anything", () => {
    for (const day of [null, undefined, "", "not-a-date", "2026-02-31"]) {
      expect(coveringSpan([MEXICO, THAILAND], day)).toBeNull();
    }
    expect(coveringSpan(null, "2017-08-15")).toBeNull();
  });
});

test.describe("buildContext — the prompt budget", () => {
  test("no notes → empty string, which is what keeps the no-hit path byte-identical", () => {
    expect(buildContext([])).toBe("");
    expect(buildContext(null)).toBe("");
  });

  test("notes are wrapped with their titles", () => {
    const out = buildContext([{ id: "a", title: "Pantry", body: "Flour is in the top tub." }]);
    expect(out).toContain('<note title="Pantry">');
    expect(out).toContain("Flour is in the top tub.");
  });

  test("the assembled block never exceeds the budget", () => {
    const fat = Array.from({ length: 3 }, (_, i) => ({
      id: `n${i}`,
      title: `Note ${i}`,
      body: "x".repeat(MAX_CONTEXT_CHARS * 2)
    }));
    expect(buildContext(fat).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
  });

  test("one long note cannot crowd the others out", () => {
    const out = buildContext([
      { id: "a", title: "Long", body: "x".repeat(MAX_CONTEXT_CHARS * 2) },
      { id: "b", title: "Short", body: "the good salt lives above the stove" }
    ]);
    expect(out).toContain('<note title="Short">');
  });
});

// The only I/O in the service, against a committed vault under tests/fixtures/.
// buildIndex() sets the module-level index that searchVault() reads, so these
// run serially (fullyParallel is already false).
test.describe("buildIndex — walking a real vault", () => {
  test.beforeAll(async () => {
    await buildIndex(FIXTURE_VAULT);
  });

  test("indexes markdown recursively, id'd by vault-relative path", async () => {
    const ids = searchVault("tasmania hot water plumber").map((n) => n.id).sort();
    expect(ids).toContain("trips/tasmania-2019");
    expect(ids).toContain("house/hot-water");
  });

  // The privacy guardrail, and the reason it is a REGRESSION test rather than a
  // unit test: a private note must be excluded by the thing that reads the disk,
  // not merely by a caller that remembers to filter. Nothing retrieved may ever
  // carry it, because retrieved text goes upstream to Anthropic.
  test("private: true notes never enter the index at all", async () => {
    for (const q of ["wifi", "wifi password", "guest network", "hunter2", "network"]) {
      const hits = searchVault(q);
      expect(hits.map((n) => n.id), `"${q}" surfaced a private note`).not.toContain("house/wifi");
      expect(JSON.stringify(hits)).not.toContain("hunter2");
    }
  });

  test(".obsidian/ is skipped wholesale", async () => {
    const hits = searchVault("workspace indexed obsidian");
    expect(hits.map((n) => n.id).join(",")).not.toContain(".obsidian");
  });

  test("getLabelledSpans reads the dated notes off the live index", async () => {
    await buildIndex(FIXTURE_VAULT);
    const spans = getLabelledSpans();
    expect(spans).toContainEqual({
      id: "trips/tasmania-2019",
      label: "Tasmania",
      from: "2019-10-04",
      to: "2019-10-14"
    });
    // Every other fixture note is undated (Queenstown is the second dated one),
    // and an undated note must never claim a photograph — a span with no dates
    // would cover every day there is.
    expect(spans.map((s) => s.id)).toEqual(["trips/tasmania-2019", "trips/queenstown-2019"]);
  });

  test("an absent vault directory is a cold start, not a throw", async () => {
    const index = await buildIndex(path.join(FIXTURE_VAULT, "does-not-exist"));
    expect(index.notes).toEqual([]);
    expect(typeof index.indexedAt).toBe("string");
    expect(getLabelledSpans()).toEqual([]);
  });
});

test.describe("buildConverseSystem — the vault must be inert when off", () => {
  const BASE = ["Line one.", "Line two.", "Line three."];

  // The whole rollback story: unset VAULT_ENABLED and the concierge prompt is
  // the pre-vault prompt, character for character. Asserted against a literal
  // rather than a re-derivation so a change to either side fails loudly.
  test("no context → byte-identical to the pre-vault prompt", () => {
    const expected = `Line one. Line two. Line three. ${NO_KNOWLEDGE_LINE}`;
    expect(buildConverseSystem(BASE, "")).toBe(expected);
    expect(buildConverseSystem(BASE, null)).toBe(expected);
    expect(buildConverseSystem(BASE, undefined)).toBe(expected);
  });

  test("with context → the notes are quoted and the honesty line survives", () => {
    const out = buildConverseSystem(BASE, '<note title="Bins">Yellow lid Tuesday.</note>');
    expect(out).toContain("Yellow lid Tuesday.");
    expect(out).toContain("Here is what the household has written down");
    // Retrieval must not license guessing about what the notes don't cover.
    expect(out).toContain(NO_KNOWLEDGE_LINE);
  });
});

// The name → relationship list the Daily Memories caption reads, so a photo can
// say "our niece Melanie" instead of "Melanie". It lives in a note's BODY rather
// than its frontmatter: forty entries as an Obsidian property would be miserable
// to edit, and in the body the same list reads as prose to the concierge.
test.describe("parseRelationships — the who-is-who list", () => {
  test("reads 'Name: label' bullets, keyed case-insensitively", () => {
    const map = parseRelationships([
      "## Greg's side",
      "- Paddy Dee: Greg's brother",
      "- Melanie Webber: our niece",
      "* Sooty Dee-Lewis: our dog"
    ].join("\n"));

    expect(map.get("paddy dee")).toBe("Greg's brother");
    expect(map.get("melanie webber")).toBe("our niece");
    expect(map.get("sooty dee-lewis")).toBe("our dog");
  });

  test("names keep their hyphens and apostrophes — the separator is the COLON", () => {
    // A hyphen separator would have split Perry-McHugh and Dee-Lewis in half.
    const map = parseRelationships("- Joe Perry-McHugh: a friend\n- Lucas O'Brian: a friend");
    expect(map.get("joe perry-mchugh")).toBe("a friend");
    expect(map.get("lucas o'brian")).toBe("a friend");
  });

  test("prose, headings and colon-less bullets are ignored", () => {
    const map = parseRelationships([
      "One line per person, in the form Name: what they are.",
      "## Dogs",
      "- just a bullet with no colon",
      "- `Akex Harmey` looks like a misspelling: fix it in Immich",
      "- Real Person: our nephew"
    ].join("\n"));

    expect(map.size).toBe(1);
    expect(map.get("real person")).toBe("our nephew");
  });

  test("the first mention wins, so a later aside cannot overwrite a roster line", () => {
    const map = parseRelationships("- Rose: our niece\n- Rose: someone else");
    expect(map.get("rose")).toBe("our niece");
  });

  test("empty / malformed input → empty map, never a throw", () => {
    expect(parseRelationships("").size).toBe(0);
    expect(parseRelationships(null).size).toBe(0);
    expect(parseRelationships("- : no name").size).toBe(0);
  });
});

test.describe("buildRelationshipMap — only notes that opt in", () => {
  const notes = [
    { id: "family/who-is-who", kind: "relationships", body: "- Paddy Dee: Greg's brother" },
    { id: "house/bins", kind: "routine", body: "- Tuesday: yellow lid" },
    { id: "house/teddy", kind: "pet", body: "- Teddy: a Border Collie" }
  ];

  test("reads only `kind: relationships` notes", () => {
    const map = buildRelationshipMap(notes);
    expect(map.get("paddy dee")).toBe("Greg's brother");
    // A bins note listing "Tuesday: yellow lid" must not become a person.
    expect(map.has("tuesday")).toBe(false);
    expect(map.has("teddy")).toBe(false);
  });

  test("no such note (or no vault at all) → empty map, captions unchanged", () => {
    expect(buildRelationshipMap(notes.slice(1)).size).toBe(0);
    expect(buildRelationshipMap([]).size).toBe(0);
    expect(buildRelationshipMap(null).size).toBe(0);
  });
});
