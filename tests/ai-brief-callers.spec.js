import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { timeLine } from "../src/js/modules/aiBriefing.js";
import { SYSTEM_PROMPTS_TYPES } from "../server/routes/ai.js";

/* The wall showed this, twice over, with nobody having asked for anything:
   "I need the actual time, day of the week, and season to give you a proper
   briefing."

   attentionEngine POSTed { type: "insight" } to /api/ai/brief. `insight` was
   never one of that route's SYSTEM_PROMPTS, so the route's
   `SYSTEM_PROMPTS[body.type] ? body.type : "morning"` fallback quietly served
   the full MORNING BRIEFING prompt — a system prompt swearing the Time line is
   fact on four axes — while buildPrompt ignored the `text` field the caller had
   actually sent and emitted its own fallback, `Time: unknown`. The model was
   handed a promise of four facts, none of the facts, and an order to brief.

   Two guards, because the defect had two halves that failed independently:
   the caller sent a type the server did not have, and a sibling caller sent
   fewer axes than the prompt swore were there. */

test.describe("every /api/ai/brief caller sends a type the server has", () => {
  const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

  function jsFiles(dir) {
    return readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return jsFiles(full);
      return name.endsWith(".js") ? [full] : [];
    });
  }

  // Comments must go first: the tombstone left where aiPhrase() used to live
  // quotes `type: "insight"` verbatim to explain the defect. A guard that reads
  // prose as code convicts the very comment warning about it.
  const stripComments = (src) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\n]*?\/\/[^\n]*$/gm, "");

  test("no caller can fall through to the morning briefing prompt", () => {
    const offenders = [];

    for (const file of jsFiles(SRC)) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (!code.includes("/api/ai/brief")) continue;

      for (const [, type] of code.matchAll(/type:\s*"([a-z]+)"/g)) {
        if (!SYSTEM_PROMPTS_TYPES.includes(type)) {
          offenders.push(`${file.split(/[\\/]/).pop()} sends type "${type}"`);
        }
      }
    }

    // Was: ['focusHero.js…'] clean, but attentionEngine.js sends type "insight".
    expect(offenders).toEqual([]);
  });

  test("the server still only knows the three real types", () => {
    // If a fourth is added deliberately, this is the line that says so out loud
    // rather than letting the silent "morning" fallback absorb it.
    expect([...SYSTEM_PROMPTS_TYPES].sort()).toEqual(["concierge", "evening", "morning"]);
  });
});

test.describe("the shared Time line carries all four grounded axes", () => {
  // A Thursday in Brisbane's winter, mid-afternoon. Every axis is distinct, so
  // a missing one cannot be masked by another's text.
  const when = new Date(2026, 6, 16, 16, 26); // 2026-07-16, 4:26 pm, July = winter

  test("weekday, daypart, clock and season are all present", () => {
    const line = timeLine(when);

    expect(line).toContain("Thursday");   // weekday
    expect(line).toContain("afternoon");  // daypart — absent before this fix
    expect(line).toContain("4:26");       // clock
    expect(line).toContain("winter");     // season  — absent before this fix
  });

  test("the season is southern — July is not summer here", () => {
    expect(timeLine(new Date(2026, 6, 16, 9, 0))).toContain("winter");
    expect(timeLine(new Date(2026, 0, 16, 9, 0))).toContain("summer");
  });

  // One function, two callers — the briefing payload and the concierge. That
  // is the whole fix: both grounding commits (61aeaf8, b02def1) updated the
  // briefing and missed the concierge, which is only possible with two copies.
  test("it states the same four axes the briefing payload does", () => {
    expect(timeLine(when)).toBe("Thursday afternoon, 4:26 pm, winter in Brisbane");
  });
});
