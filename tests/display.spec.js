import { test, expect } from "@playwright/test";
import { isWithinOffWindow } from "../server/routes/display.js";

/**
 * /api/display/wake — audit M11.
 *
 * The Pi's crontab already powers the panel down 21:00→05:00; what was missing
 * was any way to interrupt it, so a 3am ring spoke its TTS to a dark screen.
 * This route is that interrupt.
 *
 * The window logic is unit-tested directly (it wraps midnight, which is the
 * only genuinely subtle part). The route itself is contract-tested for shape
 * and for the no-op case — the test runner is not the Pi, so `xset` is absent
 * and the wake path cannot be driven end-to-end here. That leg is proven live.
 */

test.describe("isWithinOffWindow — wraps midnight", () => {
  const at = (h, m = 0) => new Date(2026, 6, 30, h, m, 0);

  test("the real 21:00→05:00 window covers the night, not the day", () => {
    // Inside
    expect(isWithinOffWindow(at(21, 0), "21:00", "05:00")).toBe(true);
    expect(isWithinOffWindow(at(23, 59), "21:00", "05:00")).toBe(true);
    expect(isWithinOffWindow(at(0, 0), "21:00", "05:00")).toBe(true);
    expect(isWithinOffWindow(at(4, 59), "21:00", "05:00")).toBe(true);
    // Outside — note 05:00 itself is OUT (the crontab turns the panel on then)
    expect(isWithinOffWindow(at(5, 0), "21:00", "05:00")).toBe(false);
    expect(isWithinOffWindow(at(12, 0), "21:00", "05:00")).toBe(false);
    expect(isWithinOffWindow(at(20, 59), "21:00", "05:00")).toBe(false);
  });

  test("a same-day window still behaves", () => {
    expect(isWithinOffWindow(at(2, 0), "01:00", "03:00")).toBe(true);
    expect(isWithinOffWindow(at(4, 0), "01:00", "03:00")).toBe(false);
    expect(isWithinOffWindow(at(22, 0), "01:00", "03:00")).toBe(false);
  });

  test("malformed or degenerate settings never claim the panel is off", () => {
    // Fail safe: an unparseable window must not let the route power the panel
    // down at an arbitrary hour.
    expect(isWithinOffWindow(at(3, 0), "", "05:00")).toBe(false);
    expect(isWithinOffWindow(at(3, 0), "9pm", "5am")).toBe(false);
    expect(isWithinOffWindow(at(3, 0), "25:00", "05:00")).toBe(false);
    expect(isWithinOffWindow(at(3, 0), "21:60", "05:00")).toBe(false);
    expect(isWithinOffWindow(at(3, 0), "21:00", "21:00")).toBe(false);
  });
});

test.describe("route contract", () => {
  test("GET /api/display/state reports the window and never 500s", async ({ request }) => {
    const res = await request.get("/api/display/state");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("window.start");
    expect(body).toHaveProperty("window.end");
    expect(typeof body.withinOffWindow).toBe("boolean");
    expect(typeof body.holdMs).toBe("number");
    // xset is absent off-Pi, so these are null here rather than throwing —
    // that graceful degrade is the contract, not an accident.
    expect([true, false, null]).toContain(body.dpmsEnabled);
  });

  test("POST /api/display/wake is a clean no-op outside the off window", async ({ request }) => {
    const state = await (await request.get("/api/display/state")).json();
    const res = await request.post("/api/display/wake");

    // Never an HTML error page, whatever the hour the suite runs at.
    expect(res.headers()["content-type"]).toContain("application/json");
    const body = await res.json();

    if (!state.withinOffWindow) {
      expect(res.status()).toBe(200);
      expect(body).toMatchObject({ woken: false, reason: "outside-off-window" });
    } else {
      // Inside the window and off-Pi: xset is missing, so the honest answer is
      // a 503, not a lie that the panel was lit.
      expect([200, 503]).toContain(res.status());
      if (res.status() === 503) expect(body.woken).toBe(false);
    }
  });
});
