import { test, expect } from "@playwright/test";
import { dayPart, buildBriefPayload } from "../src/js/modules/aiBriefing.js";

// The same bug as season.spec.js, one axis over. The prompt gave the model a
// bare clock ("7:30 am") and left it to infer the daypart, while the voice
// register named "arvo" as a house word — so the primed token occasionally
// landed on the clause describing NOW: a 7:30am briefing opened with "a quiet
// start to the arvo" and then correctly discussed the cold morning in the very
// next sentence. Naming the part of the day outright is the fix; these lock the
// boundaries, and that the word actually reaches the payload.

test.describe("dayPart — the part of the day named to the model", () => {
  const at = (hour) => new Date(2026, 7, 4, hour, 30);

  test("morning is 5am–noon (the reported bug was 7:30am)", () => {
    expect(dayPart(at(5))).toBe("morning");
    expect(dayPart(at(7))).toBe("morning"); // ← the reported bug
    expect(dayPart(at(11))).toBe("morning");
  });

  test("afternoon, evening and night take the rest of the clock", () => {
    expect(dayPart(at(12))).toBe("afternoon");
    expect(dayPart(at(16))).toBe("afternoon");
    expect(dayPart(at(17))).toBe("evening");
    expect(dayPart(at(20))).toBe("evening");
    expect(dayPart(at(21))).toBe("night");
    expect(dayPart(at(2))).toBe("night");
  });

  // These are briefingView.js's greeting boundaries. If one moves and the other
  // doesn't, the headline says "Good morning" over a narrative calling it the
  // afternoon — the exact contradiction this whole change exists to prevent.
  test("the boundaries agree with the view's greeting", () => {
    expect(dayPart(at(4))).toBe("night");     // greeting: overnight rundown
    expect(dayPart(at(5))).toBe("morning");   // greeting: Good morning
    expect(dayPart(at(12))).toBe("afternoon"); // greeting: Good afternoon
    expect(dayPart(at(17))).toBe("evening");  // greeting: Good evening
  });
});

test.describe("the Time line carries the daypart to the prompt", () => {
  const ctxAt = (hour) => ({
    type: "morning",
    generatedAt: new Date(2026, 7, 4, hour, 30),
    weather: null,
    tomorrowWeather: null,
    calendar: { today: [], tomorrow: [] },
    bins: null, commute: null, fuel: null, news: [], people: [],
  });

  test("a 7:30am payload names the morning, the clock and the season", () => {
    const { time } = buildBriefPayload(ctxAt(7));
    expect(time).toContain("morning");
    expect(time).toContain("7:30");
    expect(time).toContain("winter");   // August in Brisbane
    expect(time).not.toContain("afternoon");
  });

  test("an afternoon payload names the afternoon, not the morning", () => {
    const { time } = buildBriefPayload(ctxAt(15));
    expect(time).toContain("afternoon");
    expect(time).not.toContain("morning");
  });
});
