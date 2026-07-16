import { test, expect } from "@playwright/test";
import {
  phrase,
  shouldSpeak,
  timing,
  celebrate,
  CELEBRATION_SCORE
} from "../src/js/core/personality.js";
import {
  DELIGHT_TRIGGERS,
  pickDelight,
  spendBudget,
  isBudgeted,
  budgetKeyFor,
  DRY_SPELL_DAYS,
  AWAY_DAYS
} from "../src/js/services/delight.js";

// Pure unit tests — personality.js / delight.js carry no DOM and no storage, so
// these run straight in the Playwright node process (routines.spec.js style).
// Phase 10: docs/vision/phase-10-temperament.md.
//
// The phase's whole value is CONSISTENCY (one voice) and RESTRAINT (silence is
// the default; delight can't repeat). So the tests are a golden snapshot of the
// voice across every surfacing kind, the centralised silence thresholds, and —
// the invariant that matters most — that a delight moment cannot fire twice
// within its budget, across a simulated reboot.

// ── The register: restraint, not rewriting ─────────────────────

test.describe("phrase — the voice tidies tone, never facts", () => {
  test("strips a self-narration opener", () => {
    expect(phrase({}, "insight", { text: "I noticed rain is likely in about 15 min." }))
      .toBe("Rain is likely in about 15 min.");
  });

  test("strips an apology opener", () => {
    expect(phrase({}, "insight", { text: "Sorry — the 8:20 bus is running late." }))
      .toBe("The 8:20 bus is running late.");
  });

  test("strips a nagging preamble and tail", () => {
    // "Don't forget …, again." → the fact only.
    expect(phrase({}, "predictive", { text: "Don't forget the bins go out tonight, again." }))
      .toBe("The bins go out tonight");
  });

  test("a plain factual readout is left alone", () => {
    expect(phrase({}, "predictive", { text: "Bins go out tonight." }))
      .toBe("Bins go out tonight.");
  });

  test("collapses whitespace and capitalises", () => {
    expect(phrase({}, "insight", { text: "  rain   is   coming  " }))
      .toBe("Rain is coming");
  });

  test("a rushed room gets the first sentence only", () => {
    expect(phrase({ tempo: "rushed" }, "insight", { text: "Rain soon. Grab the washing. Bins are out." }))
      .toBe("Rain soon.");
  });

  test("a deliberate arrival greeting stays whole even when rushed", () => {
    const text = "Welcome home, Greg! You have dinner at 7.";
    expect(phrase({ tempo: "rushed" }, "arrival", { text })).toBe(text);
  });

  test("never cuts a word in half at the length cap", () => {
    const long = "word ".repeat(40).trim(); // 200 chars, no punctuation
    const out = phrase({}, "celebration", { text: long }); // celebration cap is 90
    expect(out.length).toBeLessThanOrEqual(90);
    expect(out.endsWith("word")).toBe(true); // trimmed at a word boundary
  });

  test("empty in → empty out", () => {
    expect(phrase({}, "insight", { text: "" })).toBe("");
    expect(phrase({}, "insight", {})).toBe("");
  });
});

// ── The consistency snapshot: one voice across every surfacing path ──

test.describe("consistency snapshot — one recognisable voice", () => {
  // A golden of the voiced tone across the kinds the attention / memory / arrival
  // paths speak in. A later change that re-introduces a second voice fails here.
  test("golden tone across attention, memory, celebration, arrival", () => {
    const samples = [
      { kind: "insight",     text: "I noticed rain is likely in about 15 min." },
      { kind: "predictive",  text: "Bins go out tonight." },
      { kind: "memory",      text: "On this day — Tasmania." },
      { kind: "celebration", text: "First rain in a while — the garden's grateful." },
      { kind: "arrival",     text: "Welcome home, Greg!" }
    ];
    const voiced = samples.map((s) => phrase({}, s.kind, { text: s.text }));
    expect(voiced).toEqual([
      "Rain is likely in about 15 min.",
      "Bins go out tonight.",
      "On this day — Tasmania.",
      "First rain in a while — the garden's grateful.",
      "Welcome home, Greg!"
    ]);
  });

  test("golden motion tokens — one set of manners for every transition", () => {
    expect(timing("atmosphere")).toEqual({ settleMs: 60000, easing: "ease" });
    expect(timing("hero")).toEqual({ settleMs: 700, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    expect(timing("arrival")).toEqual({ settleMs: 550, easing: "cubic-bezier(0.22, 1, 0.36, 1)" });
    expect(timing("anything-else")).toEqual({ settleMs: 600, easing: "ease" }); // default
  });
});

// ── Silence: the default setting ───────────────────────────────

test.describe("shouldSpeak — centralised silence thresholds", () => {
  const insight = { interrupt: false, score: 60 };
  const alert = { interrupt: true, score: 90 };

  test("a normal room takes an ordinary line", () => {
    expect(shouldSpeak(insight, { tempo: "neutral" })).toBe(true);
  });

  test("a rushed room is left alone — non-interrupt lines stay silent", () => {
    expect(shouldSpeak(insight, { tempo: "rushed" })).toBe(false);
  });

  test("an interrupt (a safety line) always speaks, even in a rushed room", () => {
    expect(shouldSpeak(alert, { tempo: "rushed" })).toBe(true);
  });

  test("a winding-down room only takes a line that clears the quiet floor", () => {
    expect(shouldSpeak({ interrupt: false, score: 30 }, { activity: "winding-down" })).toBe(false);
    expect(shouldSpeak({ interrupt: false, score: 60 }, { activity: "winding-down" })).toBe(true);
  });

  test("no candidate → silence", () => {
    expect(shouldSpeak(null, {})).toBe(false);
  });
});

// ── Celebration: a warmth, never confetti ──────────────────────

test.describe("celebrate — a gentle, non-interrupt surface", () => {
  test("builds a Low-Mid band candidate that never interrupts", () => {
    const c = celebrate({ id: "birthday-morning", icon: "🎂", title: "Greg's birthday", line: "Happy birthday, Greg." });
    expect(c.id).toBe("delight:birthday-morning");
    expect(c.source).toBe("delight");
    expect(c.interrupt).toBe(false);
    expect(c.score).toBe(CELEBRATION_SCORE);
    expect(c.text).toBe("Happy birthday, Greg."); // spoken in the voice
  });
});

// ── Delight: rare by design, and it cannot fire twice ──────────

test.describe("delight registry — detection + hard budgets", () => {
  const MORNING = new Date("2026-07-12T09:00:00");
  const EVENING = new Date("2026-07-12T20:00:00");

  test("christmas-eve fires only on Dec 24, and never twice that year", () => {
    const xeve = new Date("2026-12-24T09:00:00");
    const fired = pickDelight({}, {}, xeve);
    expect(fired.id).toBe("christmas-eve");
    expect(fired.budgetKey).toBe("xmas:2026");

    const spent = spendBudget({}, fired);
    expect(pickDelight({}, spent, xeve)).toBeNull(); // budget blocks the second fire

    // A different day is not Christmas Eve at all.
    expect(pickDelight({}, {}, MORNING)).toBeNull();
  });

  test("power-restored takes priority, and its own budget blocks a re-fire", () => {
    const both = { outageRecovered: true, bootKey: "b1", birthdayName: "Greg" };
    const fired = pickDelight(both, {}, MORNING);
    expect(fired.id).toBe("power-restored"); // beats the birthday
    expect(fired.budgetKey).toBe("boot:b1");
    // With the outage budget spent, the boot moment is done for this boot…
    const spent = spendBudget({}, fired);
    expect(pickDelight({ outageRecovered: true, bootKey: "b1" }, spent, MORNING)).toBeNull();
    // …but a distinct, still-valid moment (the birthday) is free to surface next.
    expect(pickDelight(both, spent, MORNING).id).toBe("birthday-morning");
  });

  test("home-after-away needs a genuine absence", () => {
    const back = { awayDays: 3, awayReturnKey: "2026-7-12", awayName: "Greg" };
    expect(pickDelight(back, {}, MORNING).id).toBe("home-after-away");
    // A short pop-out is not an absence.
    expect(pickDelight({ awayDays: 1, awayReturnKey: "2026-7-12" }, {}, MORNING)).toBeNull();
    expect(AWAY_DAYS).toBe(2);
  });

  test("birthday-morning greets in the morning window only", () => {
    const ctx = { birthdayName: "Greg" };
    const fired = pickDelight(ctx, {}, MORNING);
    expect(fired.id).toBe("birthday-morning");
    expect(fired.occasion.title).toBe("Greg's birthday");
    expect(pickDelight(ctx, {}, EVENING)).toBeNull(); // not a morning
  });

  test("a calendar occasion fires once per occasion per year (retires occasionPopup)", () => {
    const xmas = new Date("2026-12-25T09:00:00");
    const ctx = { occasion: { id: "christmas", icon: "🎄", title: "Christmas", line: "Merry Christmas." } };
    const fired = pickDelight(ctx, {}, xmas);
    expect(fired.id).toBe("calendar-occasion");
    expect(fired.budgetKey).toBe("occ:2026:christmas");
    expect(fired.occasion.title).toBe("Christmas");

    // Budget blocks a second fire for the same occasion this year.
    const spent = spendBudget({}, fired);
    expect(pickDelight(ctx, spent, xmas)).toBeNull();
    // No occasion today → nothing.
    expect(pickDelight({}, {}, xmas)).toBeNull();
  });

  test("a birthday still beats a same-day calendar occasion", () => {
    // A person-named moment outranks the generic calendar line.
    const ctx = { occasion: { id: "christmas", title: "Christmas", line: "Merry Christmas." }, birthdayName: "Greg" };
    expect(pickDelight(ctx, {}, MORNING).id).toBe("birthday-morning");
  });

  test("first-rain-after-dry needs both rain and a long dry spell", () => {
    const wet = { rainNow: true, dryStreakDays: DRY_SPELL_DAYS + 2, dryBreakKey: "2026-7-12" };
    expect(pickDelight(wet, {}, MORNING).id).toBe("first-rain-after-dry");
    // Rain after only a couple of dry days is just rain.
    expect(pickDelight({ rainNow: true, dryStreakDays: 3, dryBreakKey: "2026-7-12" }, {}, MORNING)).toBeNull();
  });

  test("an ordinary morning fires nothing", () => {
    expect(pickDelight({}, {}, MORNING)).toBeNull();
  });

  test("a spent budget survives a reboot (JSON round-trip still blocks)", () => {
    const xeve = new Date("2026-12-24T09:00:00");
    const fired = pickDelight({}, {}, xeve);
    const spent = spendBudget({}, fired);
    const rebooted = JSON.parse(JSON.stringify(spent)); // persisted to disk, then reloaded
    expect(isBudgeted(rebooted, "christmas-eve", "xmas:2026")).toBe(true);
    expect(pickDelight({}, rebooted, xeve)).toBeNull();
  });

  test("budgetKeyFor matches what a fire would spend (the force-hook contract)", () => {
    const xeve = new Date("2026-12-24T09:00:00");
    const fired = pickDelight({}, {}, xeve);
    expect(budgetKeyFor("christmas-eve", {}, xeve)).toBe(fired.budgetKey);
    expect(budgetKeyFor("no-such-trigger", {}, xeve)).toBeNull();
  });

  test("every trigger is uniquely identified", () => {
    const ids = DELIGHT_TRIGGERS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
