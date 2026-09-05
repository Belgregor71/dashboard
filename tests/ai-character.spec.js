import { test, expect } from "@playwright/test";
import {
  SYSTEM_PROMPTS_TYPES,
  systemPromptFor,
  __CHARACTER_PROMPTS,
  __EXEMPLARS,
} from "../server/routes/ai.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRIEFINGS SPEAK IN THE HOUSE'S CHARACTER (docs/design/CHARACTER.md).

   VOICE.md:12 has said since 2026-08-15 that the page "is deliberately
   describing two voices": /api/voice/converse moved onto CHARACTER.md and
   every other surface stayed on VOICE_REGISTER — on "Kath & Kim energy",
   which CHARACTER.md's opening note calls a costume rather than a character
   because it points at somebody else's person. The briefings are the
   highest-frequency surface that was still wearing it: spoken unprompted,
   twice a day, at a wall nobody has to ask.

   ⚠⚠ WHAT THIS FILE IS ACTUALLY GUARDING, AND WHY IT IS NOT THE REGISTER SWAP.
   Replacing VOICE_REGISTER with houseCharacter() is one line and would have
   been WORSE THAN CHANGING NOTHING on its own. Each prompt also carries two
   WORKED EXAMPLES, and the originals were written in the old voice — "Bins go
   out tonight, gorgeous", "don't make me say it twice", "like the
   sophisticated people you are". A model matches the demonstration over the
   description, so a prompt that describes the resident and then shows it
   performing as somebody else produces the somebody else. The exemplar
   rewrite is the change; the register swap is the trivia. Hence
   `carries no line from the old register` below, which is the test that would
   actually have caught the naive version of this commit.

   ⚠ These read process.env, and node-side module state leaks between specs in
   a worker (reference-boot-module-state-leak). Every test restores it.
   ═══════════════════════════════════════════════════════════════════════════ */

const FLAG = "HOUSE_CHARACTER_BRIEFINGS";

function withFlag(value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, FLAG);
  const prev = process.env[FLAG];
  if (value === undefined) delete process.env[FLAG];
  else process.env[FLAG] = value;
  try {
    return fn();
  } finally {
    if (had) process.env[FLAG] = prev;
    else delete process.env[FLAG];
  }
}

test.describe("HOUSE_CHARACTER_BRIEFINGS — the flag-off build is unchanged", () => {
  /* The house rule: a flag-off build is behaviourally identical to before the
     flag existed. For a prompt that means byte-identical, because the prompt
     IS the behaviour — a changed word is a changed briefing. */
  test("unset serves a prompt with no character block in it", () => {
    withFlag(undefined, () => {
      for (const type of SYSTEM_PROMPTS_TYPES) {
        const text = systemPromptFor(type);
        expect(text).toContain("Kath & Kim energy");
        expect(text).not.toContain("only permanent resident");
      }
    });
  });

  test("any value other than exactly \"1\" is off", () => {
    // Guards the sloppy truthiness bug: "0", "false" and "" are all values a
    // .env can end up holding, and every one of them must read as off.
    for (const value of ["0", "false", "", "true", "yes"]) {
      withFlag(value, () => {
        const text = systemPromptFor("morning");
        const on = value === "1";
        expect(text.includes("only permanent resident")).toBe(on);
      });
    }
  });

  test("off and on actually differ (the flag is wired, not decorative)", () => {
    const off = withFlag(undefined, () => systemPromptFor("morning"));
    const on  = withFlag("1", () => systemPromptFor("morning"));
    expect(on).not.toBe(off);
  });
});

test.describe("HOUSE_CHARACTER_BRIEFINGS=1 — all three lanes move together", () => {
  test("every type the route accepts has a character prompt", () => {
    /* The route validates an incoming `type` against SYSTEM_PROMPTS and then
       resolves the text through systemPromptFor(). A key in one map and not
       the other would 400 on one flag setting and serve on the other, which is
       the kind of split that only shows up on the wall. */
    expect(Object.keys(__CHARACTER_PROMPTS).sort())
      .toEqual([...SYSTEM_PROMPTS_TYPES].sort());
  });

  test("all three carry the character, not just the conversational one", () => {
    withFlag("1", () => {
      for (const type of SYSTEM_PROMPTS_TYPES) {
        const text = systemPromptFor(type);
        expect(text, `${type} lost the character block`)
          .toContain("only permanent resident");
        expect(text, `${type} kept the old register`)
          .not.toContain("Kath & Kim energy");
      }
    });
  });

  test("the time grounding survives the swap", () => {
    /* Added after the model opened a 7:30am briefing with "a quiet start to
       the arvo", and separately guessed northern-hemisphere spring in a
       Brisbane winter. Both defences live in TIME_GROUNDING, and a prompt
       rewrite is exactly how a guard like that gets dropped by accident. */
    withFlag("1", () => {
      for (const type of SYSTEM_PROMPTS_TYPES) {
        expect(systemPromptFor(type), `${type} dropped TIME_GROUNDING`)
          .toMatch(/treat all four as fact/i);
      }
    });
  });

  test("the no-invention rules survive the swap", () => {
    withFlag("1", () => {
      for (const type of ["morning", "evening"]) {
        const text = systemPromptFor(type);
        // A topic with no data line does not exist today.
        expect(text).toMatch(/it does not exist today/i);
        // The chore roster names a real person; swapping it is worse than silence.
        expect(text).toMatch(/say the name as given, never swap it/i);
      }
      // The concierge must not talk about the family at all.
      expect(systemPromptFor("concierge"))
        .toMatch(/Do not mention people, children, school, work, family/i);
    });
  });
});

test.describe("the rewritten exemplars are in the house's voice", () => {
  /* ⚠ THE TEST THIS FILE EXISTS FOR. Everything above passes on a commit that
     swapped the register and left the old examples underneath it — which is
     the version of this change that a review would most plausibly wave
     through, and which would have produced briefings still performing the
     costume while claiming the character. */
  test("carries no line from the old register", () => {
    withFlag("1", () => {
      const ghosts = [
        "gorgeous",                          // performed intimacy: banned outright
        "don't make me say it twice",        // nagging: banned outright
        "sophisticated people",              // the old camp beat
        "get your skates on",
        "an absolute cracker",
        "thank goodness",
        "bold move, weather",
        "properly smug",
      ];
      for (const type of SYSTEM_PROMPTS_TYPES) {
        const text = systemPromptFor(type).toLowerCase();
        for (const ghost of ghosts) {
          expect(text, `${type} still demonstrates "${ghost}"`).not.toContain(ghost);
        }
      }
    });
  });

  test("names no external property", () => {
    // Same guard as tests/voice.spec.js applies to the converse lane. The show
    // name reaching a prompt is the regression that says the pointer came back.
    withFlag("1", () => {
      for (const type of SYSTEM_PROMPTS_TYPES) {
        const text = systemPromptFor(type).toLowerCase();
        for (const ghost of ["kath", "kim", "sharon"]) {
          expect(text, `${type} referenced ${ghost}`).not.toContain(ghost);
        }
      }
    });
  });

  test("the examples still declare themselves as style-only", () => {
    /* Without this clause the model lifts the exemplar's CONTENT. The old
       prompts had it and a rewrite is where it gets lost — the examples name
       bins, UV, wind and a temperature, every one of which would read as a
       real reading if it leaked. */
    withFlag("1", () => {
      for (const type of ["morning", "evening"]) {
        expect(systemPromptFor(type), `${type} lost the style-only clause`)
          .toMatch(/style references ONLY/);
      }
    });
  });

  test("the exemplars lead with a fact, per CHARACTER.md's first rule", () => {
    /* "The fact comes first, always... A joke that arrives before the number
       is a regression, every time." The examples are the demonstration of
       that rule, so each opens on a countable thing rather than a mood. */
    withFlag("1", () => {
      const morning = systemPromptFor("morning");
      expect(morning).toMatch(/Nothing on the calendar/);
      expect(morning).toMatch(/Three things before lunch/);
      const evening = systemPromptFor("evening");
      expect(evening).toMatch(/Nothing left on the books tonight/);
      expect(evening).toMatch(/One thing left/);
    });
  });

  test("the counting habit is present as an observation, never a scoreboard", () => {
    /* CHARACTER.md: the count is "offered as an observation, never as a
       scoreboard and never as a correction". The bin time to the minute is
       the page's own worked example of the habit, so it belongs in the
       exemplars; anything that reads as a reprimand does not. */
    withFlag("1", () => {
      expect(systemPromptFor("morning")).toMatch(/the latest all month/i);
      expect(systemPromptFor("evening")).toMatch(/four clear days running/i);
    });
  });

  test("no exemplar describes a photograph, or any other particular", () => {
    /* CHARACTER.md, 2026-08-16: asked its favourite photograph with none in
       the prompt, the house invented one in full — a named family member, a
       year, a backyard, the light, the overexposure at the edges. No briefing
       prompt ever carries a photograph, so an exemplar that narrates one is a
       standing invitation to repeat exactly that.

       ⚠ Asserted on EXEMPLARS, not on the assembled prompt. The character
       block discusses photographs in KINDS — which is sanctioned and wanted —
       so a whole-prompt scan for the word would fail on correct copy. The
       first version of this test tried to scrape the quoted spans back out of
       the prompt and could not: the block is prose full of apostrophes, so
       quote-pairing matched from "family's" to the next stray apostrophe and
       returned most of the character. Addressable copy is the fix. */
    for (const [name, line] of Object.entries(__EXEMPLARS)) {
      expect(line, `${name} describes a photo`)
        .not.toMatch(/photo|photograph|picture|album/i);
      // Nor a person: the exemplars are seen by a model that has no roster.
      expect(line, `${name} names a person`)
        .not.toMatch(/\b(mum|dad|nan|pop|grandma|grandad)\b/i);
    }
  });

  test("every exemplar is actually reachable from a prompt", () => {
    /* An exemplar nobody interpolates is copy that reads as reviewed and is
       not in the build — the same class of dead lever as a flag that no code
       tests. Each one must appear in the prompt it belongs to. */
    withFlag("1", () => {
      const home = {
        morningQuiet: "morning", morningBusy: "morning",
        eveningClear: "evening", eveningBusy: "evening",
        conciergeWarm: "concierge", conciergeWinter: "concierge",
      };
      for (const [name, line] of Object.entries(__EXEMPLARS)) {
        expect(home[name], `${name} has no declared home prompt`).toBeTruthy();
        expect(systemPromptFor(home[name]), `${name} is not in ${home[name]}`)
          .toContain(line);
      }
      // And the map is exhaustive — a new exemplar must be added here too.
      expect(Object.keys(__EXEMPLARS).sort()).toEqual(Object.keys(home).sort());
    });
  });
});
