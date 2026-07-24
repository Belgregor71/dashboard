import { test, expect } from "@playwright/test";
import { detectOccasion } from "../src/js/services/occasions.js";

// Pure unit tests — occasions.js carries no DOM and no storage, so these run
// straight in the Playwright node process. This module replaces the retired
// occasionPopup's full-screen scene with a once-a-year delight occasion; the date
// math (fixed + Easter + Nth-weekday) is what these lock down. Dates are AU 2026.

test.describe("detectOccasion — fixed and moveable calendar days", () => {
  const local = (iso) => new Date(`${iso}T09:00:00`);

  test("fixed dates map to their occasion", () => {
    expect(detectOccasion(local("2026-01-01")).id).toBe("newyear");
    expect(detectOccasion(local("2026-02-14")).id).toBe("valentine");
    expect(detectOccasion(local("2026-04-25")).id).toBe("anzac");
    expect(detectOccasion(local("2026-10-31")).id).toBe("halloween");
    expect(detectOccasion(local("2026-12-31")).id).toBe("newyeareve");
    expect(detectOccasion(local("2026-12-25")).id).toBe("christmas");
  });

  test("Easter weekend 2026 (Sun 5 Apr) resolves Good Friday and Sunday", () => {
    expect(detectOccasion(local("2026-04-03")).id).toBe("goodfriday");
    expect(detectOccasion(local("2026-04-05")).id).toBe("easter");
    expect(detectOccasion(local("2026-04-04"))).toBeNull(); // Easter Saturday not observed here
  });

  test("carries an icon, a title caption, and a warm line", () => {
    const xmas = detectOccasion(local("2026-12-25"));
    expect(xmas.icon).toBe("🎄");
    expect(xmas.title).toBe("Christmas");
    // The line rotates by day across a pool, so assert the stable greeting it
    // always opens with rather than one exact phrasing.
    expect(xmas.line).toContain("Merry Christmas");
  });

  test("Christmas Eve is NOT here — it keeps its own christmas-eve delight trigger", () => {
    expect(detectOccasion(local("2026-12-24"))).toBeNull();
  });

  test("an ordinary day is null", () => {
    expect(detectOccasion(local("2026-07-16"))).toBeNull();
  });
});
