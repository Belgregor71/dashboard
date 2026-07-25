import { test, expect } from "@playwright/test";
import { southernSeason } from "../src/js/modules/aiBriefing.js";

// The AI prompt is given a weekday + clock but no month, so without a grounded
// season it invented a northern one ("a proper spring Saturday" in the middle of
// a Brisbane winter). southernSeason maps the month to the correct Brisbane
// season; this locks the boundaries so a reorder can't quietly regress it.

test.describe("southernSeason — Brisbane (southern hemisphere)", () => {
  const at = (monthIndex) => new Date(2026, monthIndex, 15);

  test("winter is Jun–Aug (the bug month, July, is winter)", () => {
    expect(southernSeason(at(5))).toBe("winter"); // June
    expect(southernSeason(at(6))).toBe("winter"); // July  ← the reported bug
    expect(southernSeason(at(7))).toBe("winter"); // August
  });

  test("the other three seasons map correctly", () => {
    expect(southernSeason(at(11))).toBe("summer"); // December
    expect(southernSeason(at(0))).toBe("summer");  // January
    expect(southernSeason(at(3))).toBe("autumn");  // April
    expect(southernSeason(at(9))).toBe("spring");  // October
  });
});
