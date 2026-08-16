import { test, expect } from "@playwright/test";
import { rmSync } from "fs";
import os from "os";
import path from "path";
import {
  observe, noteCoverage, openItems, resolvedItems, resolve, forget, __reset,
  MAX_OPEN, MAX_PROMPTED, RESOLVED_TTL_MS
} from "../server/services/unresolved.js";
import { unresolvedContext } from "../server/services/voiceShape.js";
import { houseCharacter } from "../server/services/character.js";

/* ═══════════════════════════════════════════════════════════════════════════
   UNRESOLVED OBSERVATIONS — the house holding a claim it might be wrong about.

   The lifecycle is the feature. A store that only records is a log; what makes
   this a memory is that an open thing can CLOSE, with a reason the house can
   repeat later. Most of these tests are about closing.

   ⚠ The store is pointed at a per-worker temp file, NOT data/unresolved.json.
   Two reasons, both real: specs run in parallel workers and would collide on
   one shared file, and load() is lazy — a stale real file left behind by a
   test would be read at the next boot and the house would open believing a
   camera is down.
   ═══════════════════════════════════════════════════════════════════════════ */
const STORE = path.join(os.tmpdir(), `unresolved-test-${process.pid}.json`);

test.beforeEach(() => { __reset({ file: STORE }); rmSync(STORE, { force: true }); });
test.afterAll(() => rmSync(STORE, { force: true }));

const T0 = Date.parse("2026-08-16T02:00:00Z");
const cam = (id, what, evidence) => ({ key: `test:${id}`, what, evidence });

test.describe("observe — the open/resolve lifecycle", () => {
  test("a new divergence opens; seeing it again does not duplicate it", () => {
    const first = observe([cam("a", "the kitchen camera has been silent for 2h")], T0);
    expect(first.opened).toHaveLength(1);
    expect(openItems()).toHaveLength(1);

    const again = observe([cam("a", "the kitchen camera has been silent for 3h")], T0 + 3600_000);
    expect(again.opened).toHaveLength(0);
    expect(openItems()).toHaveLength(1);
    expect(openItems()[0].what).toContain("3h");     // refreshed
  });

  // How long this has been going on is the most interesting thing about it.
  test("firstSeen survives a refresh — re-stamping it would erase the story", () => {
    observe([cam("a", "silent 2h")], T0);
    observe([cam("a", "silent 6h")], T0 + 4 * 3600_000);
    const item = openItems()[0];
    expect(item.firstSeen).toBe(T0);
    expect(item.lastSeen).toBe(T0 + 4 * 3600_000);
  });

  /* THE ONE THE FEATURE EXISTS FOR. motionCoverage today re-evaluates a fault
     to "ok" on the next event and it is silently gone — the house never knew
     it happened and could never say it had cleared. */
  test("a divergence that stops is RESOLVED, not deleted", () => {
    observe([cam("a", "silent 2h")], T0);
    const out = observe([], T0 + 7200_000);

    expect(out.resolved).toEqual(["test:a"]);
    expect(openItems()).toHaveLength(0);
    expect(resolvedItems()).toHaveLength(1);
    expect(resolvedItems()[0].resolution).toMatch(/on its own/);
  });

  test("reconciliation is per-key — one clearing does not close the others", () => {
    observe([cam("a", "a silent"), cam("b", "b silent")], T0);
    observe([cam("b", "b silent")], T0 + 1000);
    expect(openItems().map((i) => i.key)).toEqual(["test:b"]);
    expect(resolvedItems().map((i) => i.key)).toEqual(["test:a"]);
  });

  test("a resolved item never silently reappears as open", () => {
    observe([cam("a", "silent")], T0);
    observe([], T0 + 1000);
    expect(openItems()).toHaveLength(0);
    // It comes back as a genuinely new occurrence, which it is.
    const back = observe([cam("a", "silent again")], T0 + 2000);
    expect(back.opened).toEqual(["test:a"]);
    expect(openItems()[0].firstSeen).toBe(T0 + 2000);
  });

  test("being told the answer resolves it with that reason", () => {
    observe([cam("a", "silent")], T0);
    expect(resolve("test:a", "the camera was unplugged", T0 + 500)).toBe(true);
    expect(resolvedItems()[0].resolution).toBe("the camera was unplugged");
    // Resolving something already closed is not an error, it is a no-op.
    expect(resolve("test:a", "again")).toBe(false);
  });

  test("forget removes outright — different from resolving", () => {
    observe([cam("a", "silent")], T0);
    expect(forget("test:a")).toBe(true);
    expect(openItems()).toHaveLength(0);
    expect(resolvedItems()).toHaveLength(0);   // no story kept, unlike resolve
    expect(forget("test:nope")).toBe(false);
  });
});

test.describe("bounds — this runs for weeks and feeds a prompt", () => {
  test("open items are capped, newest kept", () => {
    const many = Array.from({ length: MAX_OPEN + 6 }, (_, i) => cam(`k${i}`, `thing ${i}`));
    observe(many, T0);
    expect(openItems().length).toBeLessThanOrEqual(MAX_OPEN);
  });

  test("resolved items expire", () => {
    observe([cam("a", "silent")], T0);
    observe([], T0 + 1000);
    expect(resolvedItems()).toHaveLength(1);
    // A later reconciliation past the TTL prunes it.
    observe([], T0 + RESOLVED_TTL_MS + 10_000);
    expect(resolvedItems()).toHaveLength(0);
  });

  test("malformed input never throws and records nothing", () => {
    for (const bad of [null, undefined, "nope", 42, [null], [{}], [{ key: "x" }], [{ what: "y" }]]) {
      expect(() => observe(bad, T0)).not.toThrow();
    }
    expect(openItems()).toHaveLength(0);
  });
});

test.describe("noteCoverage — motionCoverage's table becoming observations", () => {
  const table = (level) => [
    { id: "kitchen", label: "Kitchen", silentMs: 2 * 3600_000, elsewhere: 19, skipped: false, level }
  ];

  test("only warn and error open anything", () => {
    noteCoverage(table("ok"), T0);
    expect(openItems()).toHaveLength(0);
    noteCoverage(table("warn"), T0);
    expect(openItems()).toHaveLength(1);
  });

  // The occupancy gate already sets level "ok" for a skipped camera — an empty
  // house explains a quiet kitchen, and that must not become a mystery.
  test("an occupancy-skipped camera never opens one", () => {
    noteCoverage([{ id: "kitchen", label: "Kitchen", silentMs: 9e6, elsewhere: 99, skipped: true, level: "ok" }], T0);
    expect(openItems()).toHaveLength(0);
  });

  test("the wording is plain, and carries why the silence is strange", () => {
    noteCoverage(table("warn"), T0);
    const item = openItems()[0];
    expect(item.what).toBe("the kitchen camera has been silent for 2h 0m");
    expect(item.evidence).toContain("19 motion events");
  });

  test("the camera coming back resolves it", () => {
    noteCoverage(table("warn"), T0);
    noteCoverage(table("ok"), T0 + 1000);
    expect(openItems()).toHaveLength(0);
    expect(resolvedItems()).toHaveLength(1);
  });

  test("never throws on a malformed table", () => {
    for (const bad of [null, undefined, "x", [null], [{}]]) {
      expect(() => noteCoverage(bad, T0)).not.toThrow();
    }
  });
});

test.describe("unresolvedContext — what reaches the model", () => {
  const open = [
    { key: "a", what: "the kitchen camera has been silent for 3h", evidence: "22 events elsewhere" },
    { key: "b", what: "the side gate camera has been silent for 5h", evidence: null }
  ];

  test("renders open items with their evidence", () => {
    const out = unresolvedContext(open, []);
    expect(out).toContain("kitchen camera has been silent for 3h");
    expect(out).toContain("22 events elsewhere");
  });

  /* ⚠⚠ THE INSTRUCTION THAT KEEPS THIS PLEASANT TO LIVE WITH. A model handed a
     list of unexplained events volunteers them at the first opportunity, and
     "the kitchen camera has gone quiet", unprompted at 11pm, is a horror film
     rather than a dashboard. */
  test("instructs answer-only, and pins the tone away from ominous", () => {
    const out = unresolvedContext(open, []);
    expect(out).toMatch(/only if asked/i);
    expect(out).toMatch(/do not volunteer/i);
    expect(out).toMatch(/not alarming|not intruders/i);
  });

  test("recently resolved carries its reason — the 'that cleared up' half", () => {
    const out = unresolvedContext([], [{ key: "c", what: "the doorbell went quiet", resolution: "it came back" }]);
    expect(out).toContain("the doorbell went quiet");
    expect(out).toContain("it came back");
  });

  test("bounded — a busy house does not bury the prompt", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ key: `k${i}`, what: `thing ${i}` }));
    const lines = unresolvedContext(many, []).split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(MAX_PROMPTED);
  });

  test("nothing open and nothing resolved is the empty string", () => {
    expect(unresolvedContext([], [])).toBe("");
    expect(unresolvedContext(null, null)).toBe("");
  });

  test("never throws on rubbish", () => {
    for (const bad of [null, undefined, "x", 42, [null], [{}]]) {
      expect(() => unresolvedContext(bad, bad)).not.toThrow();
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ⚠⚠ THE PHASE-8 GUARD.

   `docs/vision/phase-8-learn.md:81` makes it an ABSOLUTE RULE of this house
   that learning is never announced — "a half-learned routine that announces
   itself would be worse than silence" — and personality.js:39-48 enforces it
   by stripping "I noticed…" from every candidate's text.

   Surfacing learned routines to the voice (houseDigest.usualDay) walks right
   up to that line. It stays on the correct side only because it is PULL-ONLY:
   answered when asked, never volunteered. That property lives in prose today.
   This makes it live in a test.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("the house never announces what it has worked out", () => {
  test("the character prompt forbids volunteering a learned pattern", () => {
    const text = houseCharacter();
    expect(text).toMatch(/never announce a pattern/i);
    expect(text).toMatch(/never volunteer/i);
    // And it must say what to do instead, or the model just goes quiet.
    expect(text).toMatch(/answer it if you are asked/i);
  });

  test("a learned time is phrased as usual, never as certain", () => {
    // The register the digest is required to produce. "You leave at 7:20" is a
    // fact claim about a person from four observations; "usually" is what the
    // distribution actually supports.
    expect(houseCharacter()).toMatch(/usually out by twenty past/i);
    expect(houseCharacter()).toMatch(/never as certain/i);
  });

  test("unresolved items are curious, never ominous", () => {
    const text = houseCharacter();
    expect(text).toMatch(/never ominous/i);
    expect(text).toMatch(/flat battery/i);   // the deflating, correct prior
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   ⚠⚠ THE INVENTED-READING GUARD.

   Found on the live wall 2026-08-16, minutes after the character was first
   armed. Asked "what's it like out there" with NO weather in its prompt, the
   house answered "mid-twenties, mostly clear, light northeasterly" — and then,
   seconds later, "flat grey, thirty degrees". Two confident inventions that
   contradicted each other and the real 21°. The OLD register never did this,
   because it never asked for numbers; the character does, and that is exactly
   what made the guess tempting.

   Root cause was placement, not wording: the specificity demand lived in
   REGISTER and the honesty rule three paragraphs away in FALLIBILITY, so the
   model weighed two instructions and picked the louder one. The fix welds the
   exception to the rule. These assert that the weld holds.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("the house never invents a reading it was not given", () => {
  test("the ban sits INSIDE the specificity sentence, not in a later paragraph", () => {
    const text = houseCharacter();
    const specificity = text.indexOf("Be specific about what you have");
    const ban = text.indexOf("NEVER MANUFACTURE A PARTICULAR");
    expect(specificity).toBeGreaterThan(-1);
    expect(ban).toBeGreaterThan(-1);
    // Same sentence-run: the exception must not drift back out into its own
    // paragraph, which is the arrangement that produced the invented weather.
    expect(ban - specificity).toBeLessThan(400);
  });

  /* ⚠⚠ THE SECOND FAILURE, AND WHY THE RULE IS ABOUT PARTICULARS NOT NUMBERS.
     The first fix banned inventing "a temperature, a time or a measurement".
     An hour later, asked its favourite photograph with no photograph in the
     prompt, the house described one in full — a named family member, a year, a
     backyard, the light, the overexposure at the edges. None of it existed. It
     walked straight through a ban written about numbers, because a photograph
     is not a number. */
  test("the ban covers every kind of particular, not just readings", () => {
    const text = houseCharacter();
    for (const kind of ["temperature", "time", "photograph", "event"]) {
      expect(text, `"${kind}" is not named in the no-invention rule`).toContain(kind);
    }
    expect(text).toMatch(/not a thing somebody did/i);
  });

  // The trait that caused it. Taste is worth keeping; taste in a specific
  // image it was never shown puts a real person in a scene that never happened.
  test("photo taste is expressed in KINDS, never in a particular it cannot see", () => {
    const text = houseCharacter();
    expect(text).toMatch(/not looking at the library right now/i);
    expect(text).toMatch(/never name or describe a particular photograph/i);
    // The concrete example that taught the model to invent one is gone.
    expect(text).not.toMatch(/mexico/i);
  });

  test("it may still say what KIND of thing it likes — the trait survives", () => {
    expect(houseCharacter()).toMatch(/what KIND of thing you like/i);
    expect(houseCharacter()).toMatch(/nobody is posing/i);
  });

  test("it says where its senses end, so an absent number reads as absent", () => {
    const text = houseCharacter();
    expect(text).toMatch(/everything you know is in this prompt/i);
    expect(text).toMatch(/cannot look out of a window/i);
    expect(text).toMatch(/not a gap to fill/i);
  });

  test("the temptation is named, because the weather interest is what causes it", () => {
    expect(houseCharacter()).toMatch(/being interested in these things is exactly what makes it tempting/i);
  });
});
