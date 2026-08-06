import { test, expect } from "@playwright/test";

import { stateFeedLevel } from "../server/services/healthService.js";

// The WAN feed exists to name ONE cause when several feeds fail at once: with the
// internet down, weather + AI + news all break separately and the health chip
// reads like three unrelated faults.

test.describe("stateFeedLevel — the router's own verdict, read across", () => {
  test("on → ok", () => {
    expect(stateFeedLevel({ state: "on" })).toEqual({ level: "ok", detail: null });
  });

  test("off → error, and says why", () => {
    expect(stateFeedLevel({ state: "off" })).toEqual({ level: "error", detail: "internet is down" });
  });

  test("unknown/unavailable is a WARN, not an outage claim", () => {
    // The distinction is real: `off` is the router reporting the WAN down;
    // unavailable means the router integration itself is unreachable — which is
    // the more likely state when HA is the thing having a bad day. Reporting
    // that as "internet is down" would be a claim we cannot support.
    expect(stateFeedLevel({ state: "unavailable" }).level).toBe("warn");
    expect(stateFeedLevel({ state: "unknown" }).level).toBe("warn");
    expect(stateFeedLevel({ state: "unavailable" }).detail).not.toContain("internet is down");
  });

  test("a missing entity warns and names what it looked for", () => {
    const result = stateFeedLevel(null, "binary_sensor.archer_ax11000_wan_status");
    expect(result.level).toBe("warn");
    expect(result.detail).toContain("binary_sensor.archer_ax11000_wan_status");
  });
});

test.describe("health contract", () => {
  test("GET /api/system/health carries the wan feed", async ({ request }) => {
    const res = await request.get("/api/system/health");
    expect(res.ok()).toBe(true);
    const body = await res.json();

    const wan = body.feeds.find((f) => f.id === "wan");
    expect(wan).toBeTruthy();
    expect(wan.label).toBe("Internet");
    expect(["ok", "warn", "error"]).toContain(wan.level);
  });
});
