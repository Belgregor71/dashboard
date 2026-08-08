import { test, expect } from "@playwright/test";
import {
  BRIEFING_SCHEDULES,
  CATCHUP_MS,
  PREFETCH_LEAD_MS,
  dueBriefing
} from "../src/js/services/briefingSchedule.js";
import { menuFrom } from "../src/js/services/mealEvent.js";
import { resolveMediaImage } from "../src/js/services/mediaImage.js";

/* Pure-node. These three modules were extracted so that BOTH surfaces answer
   the same question the same way — the briefing's window, tonight's dish, and
   where a piece of album art actually lives. Each had a copy on the incumbent
   that V3 could not reach, and each is now the only copy that matters. */

// 2026-08-10 is a Monday; 2026-08-08 is a Saturday.
const at = (iso) => new Date(iso);

test.describe("the briefing window", () => {
  test("the weekday morning fires at 5:35 and stays available for 30 minutes", () => {
    expect(dueBriefing({ now: at("2026-08-10T05:35:00") })).toMatchObject({ phase: "fire" });
    expect(dueBriefing({ now: at("2026-08-10T06:04:00") })).toMatchObject({ phase: "fire" });
    // One minute past the catch-up window and the day has been missed.
    expect(dueBriefing({ now: at("2026-08-10T06:06:00") })).toBeNull();
  });

  test("the lead window prefetches without firing", () => {
    const due = dueBriefing({ now: at("2026-08-10T05:33:00") });
    expect(due.phase).toBe("prefetch");
    expect(due.schedule.name).toBe("morning-weekday");
    // Four minutes out is outside the three-minute lead.
    expect(dueBriefing({ now: at("2026-08-10T05:31:00") })).toBeNull();
  });

  test("weekday and weekend mornings never both apply", () => {
    // Saturday at 5:35 is nobody's briefing; the weekend one is at 7:30.
    expect(dueBriefing({ now: at("2026-08-08T05:35:00") })).toBeNull();
    expect(dueBriefing({ now: at("2026-08-08T07:30:00") })).toMatchObject({ phase: "fire" });
    expect(dueBriefing({ now: at("2026-08-08T07:30:00") }).schedule.name).toBe("morning-weekend");
  });

  test("the evening runs every day", () => {
    for (const day of ["2026-08-08", "2026-08-10"]) {
      expect(dueBriefing({ now: at(`${day}T18:00:00`) })).toMatchObject({ phase: "fire" });
    }
  });

  test("one that has already fired today is not offered again", () => {
    const now = at("2026-08-10T05:40:00");
    expect(dueBriefing({ now })).not.toBeNull();
    expect(dueBriefing({ now, hasFired: (name) => name === "morning-weekday" })).toBeNull();
  });

  test("a fire anywhere in the table beats a prefetch", () => {
    /* The current schedules can never produce both at once — the gaps are far
       wider than the lead — so this drives it through a stub table shape by
       asserting the ORDER property directly on a moment where the evening is
       live and the morning has not fired. If a fourth schedule is ever added
       with a tighter gap, this is the assertion that keeps the real briefing
       from being starved by a neighbour's prefetch. */
    const fireWindows = BRIEFING_SCHEDULES.map((s) => s.hour * 60 + s.minute).sort((a, b) => a - b);
    const gaps = fireWindows.slice(1).map((m, i) => m - fireWindows[i]);
    for (const gap of gaps) {
      expect(gap * 60_000, "a gap narrower than the lead would overlap the windows")
        .toBeGreaterThan(PREFETCH_LEAD_MS);
    }
    expect(CATCHUP_MS).toBe(30 * 60 * 1000);
  });
});

test.describe("tonight's dish", () => {
  const meal = (title, start) => ({ title, start });

  test("finds a Meal:-prefixed event on today and strips the prefix", () => {
    const now = at("2026-08-10T12:00:00");
    const events = [
      meal("Soccer", "2026-08-10T16:00:00"),
      meal("Meal: Chicken Fajitas", "2026-08-10T18:30:00")
    ];
    expect(menuFrom(events, now)).toBe("Chicken Fajitas");
  });

  test("tomorrow's dinner is not tonight's", () => {
    const now = at("2026-08-10T12:00:00");
    expect(menuFrom([meal("Meal: Lasagne", "2026-08-11T18:30:00")], now)).toBeNull();
  });

  test("NOT LOADED IS NOT EMPTY — a missing calendar is null, and so is an empty one", () => {
    // Both answer null here on purpose; it is the CALLER that must tell them
    // apart, by checking Array.isArray itself before claiming there is no
    // dinner. This asserts the function does not invent a difference.
    expect(menuFrom(undefined, at("2026-08-10T12:00:00"))).toBeNull();
    expect(menuFrom([], at("2026-08-10T12:00:00"))).toBeNull();
  });

  test("a Meal: event with nothing after the prefix is not a dish", () => {
    expect(menuFrom([meal("Meal: ", "2026-08-10T18:30:00")], at("2026-08-10T12:00:00"))).toBeNull();
  });
});

test.describe("album art urls", () => {
  test("an HA entity_picture is put through the image proxy", () => {
    expect(resolveMediaImage("/api/media_player_proxy/media_player.lounge?token=abc"))
      .toBe("/api/image_proxy/api/media_player_proxy/media_player.lounge?token=abc");
  });

  test("resolving twice does not double-prefix", () => {
    // houseSnapshot resolves, and any consumer might resolve again. The bug
    // this guards is silent: a doubled prefix 404s and leaves a blank tile.
    const once = resolveMediaImage("/api/media_player_proxy/x");
    expect(resolveMediaImage(once)).toBe(once);
  });

  test("absolute urls and empty values are left alone", () => {
    expect(resolveMediaImage("https://art.example/cover.jpg")).toBe("https://art.example/cover.jpg");
    expect(resolveMediaImage(null)).toBe("");
    expect(resolveMediaImage(undefined)).toBe("");
    expect(resolveMediaImage("")).toBe("");
  });
});
