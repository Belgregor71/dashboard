import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HA'S COMMAND CHANNEL, ON V3.

   `src/v3/core/commands.js` is the subscriber the cutover never gave this
   surface. The server half was intact throughout — HA fires the event, haWs
   subscribes, haRoutes relays it over SSE, client.js emits it on the bus — so
   the defect was one missing `on()`, and every assertion in this file fails
   without it.

   ⚠ THE POINT OF MOST OF THESE IS THE REFUSAL, not the mount. Twenty-four of
   the twenty-six commands HA can send address surfaces V3 does not have, and
   the failure this module was written against is a remote control whose buttons
   do nothing QUIETLY. So "cameras is declined" is not a gap in coverage being
   papered over — it is the behaviour, and it is asserted as such.

   Every /api/** is answered here. Same rule as the subjects spec: what a
   subject shows is a function of the house's real state, so a spec about
   subjects cannot share one with the house.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Today in the BROWSER's local terms — `eventsForDay` compares `toDateString()`
   values, so an event stamped off a UTC slice lands on yesterday for half of
   every Brisbane day. */
function calToday() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [{ title: "Dentist", start: `${ymd}T09:30:00` }];
}

/* ⚠ `feeds: []` WOULD NOT MOUNT, and the refusal is correct: status.js reads a
   zero-length feed list as "the watchdog has evaluated nothing", not as "the
   house is fine". An empty array here would have made every status assertion
   below fail for a reason that has nothing to do with this module. */
const HEALTH = {
  overall: "ok",
  feeds: [
    { id: "ha", label: "Home Assistant", level: "ok", detail: "connected" },
    { id: "weather", label: "Weather", level: "ok", detail: "fresh" }
  ]
};
const METRICS = { tempC: 51.2, cpuLoadPercent: 6, uptimeSeconds: 90_000 };
const FORECAST = {
  days: [
    { date: "2026-08-18", high_c: 24, low_c: 11, condition: { code: 0 }, rain_chance_pct: 5 },
    { date: "2026-08-19", high_c: 25, low_c: 12, condition: { code: 1 }, rain_chance_pct: 10 }
  ]
};

/** The stubbed house every test here boots against. */
const HOUSE = {
  "/api/calendar/all": calToday(),
  "/api/system/health": HEALTH,
  "/api/system/metrics": METRICS,
  "/api/weather/forecast": FORECAST,
  "/api/ai/brief": { summary: "A cool start, clearing by lunch. Nothing on until four." }
};

/**
 * Send one command the way Home Assistant does — onto the bus, through the real
 * subscription — and read back what the wall did about it.
 */
async function send(page, payload) {
  return page.evaluate(async (data) => {
    await window.__v3Command(data);
    const mount = document.getElementById("subject-mount");
    return {
      result: window.__v3Commands(),
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      subject: window.__v3().subject,
      children: mount.childElementCount,
      text: mount.textContent
    };
  }, payload);
}

/* ── The channel is connected at all ────────────────────────────────────────
   This is the whole defect, in one assertion. Before the fix `__v3Command` does
   not exist and the page throws; with the subscription neutered it resolves and
   nothing happens.
─────────────────────────────────────────────────────────────────────────── */

test("switch_view reaches the wall — the subscription the cutover left out", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE);

  const got = await send(page, { command: "switch_view", view: "status" });

  expect(got.subject).toBe("show.status");
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("command-show.status");
  expect(got.result.event).toBe("command:executed");
  expect(got.result.ok).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("system_status and its two synonyms all reach the status subject", async ({ page }) => {
  // The incumbent treats these three as one command (events.js:60) and HA has a
  // script on the wire for the first. Asserting one of three would read as
  // coverage while leaving two untested — the mistake mediaSource.js paid for.
  const { pageErrors } = await bootV3(page, HOUSE);

  for (const command of ["system_status", "status", "system_status_view"]) {
    const got = await send(page, { command });
    expect(got.subject, command).toBe("show.status");
    expect(got.depth, command).toBe(3);
    expect(got.result.ok, command).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});

test("the briefing and the day each have a view id that opens them", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE);
  await page.evaluate(() => window.__v3Refresh());

  const briefing = await send(page, { command: "switch_view", view: "briefing" });
  expect(briefing.subject).toBe("show.briefing");
  expect(briefing.depth).toBe(3);

  const day = await send(page, { command: "switch_view", view: "timeline" });
  expect(day.subject).toBe("show.day");
  expect(day.text).toContain("Dentist");
  expect(pageErrors).toEqual([]);
});

test("viewManager's aliases still normalise — an HA payload that worked before still works", async ({ page }) => {
  /* The alias map is DUPLICATED into commands.js rather than imported, because
     importing core/viewManager.js would pull the incumbent's DOM view router
     into V3's closure. Duplication drifts; this is what stops it silently. */
  const { pageErrors } = await bootV3(page, HOUSE);
  await page.evaluate(() => window.__v3Refresh());

  for (const [view, subject] of [
    ["agenda", "show.day"],
    ["calendar", "show.day"],
    ["status-view", "show.status"],
    ["briefing-view", "show.briefing"],
    ["STATUS", "show.status"],      // trimmed and lowercased, as viewManager does
    ["  status  ", "show.status"]
  ]) {
    const got = await send(page, { command: "switch_view", view });
    expect(got.subject, view).toBe(subject);
  }
  expect(pageErrors).toEqual([]);
});

/* ── home is a release, not a subject ───────────────────────────────────────
   And it has to be `setDepth`, not `deepen` — deepen() falls through to
   sustain() for a shallower target, so a `home` sent to a wall already at depth
   3 would RE-ARM the hold on whatever was up instead of letting it go. That is
   the Phase 1 trap, and this is the assertion that would catch it: the test
   only means anything because it drives the surface deep FIRST.
─────────────────────────────────────────────────────────────────────────── */

test("home releases the wall from depth 3 rather than re-arming the hold", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE);

  const deep = await send(page, { command: "switch_view", view: "status" });
  expect(deep.depth).toBe(3);

  const home = await send(page, { command: "switch_view", view: "home" });

  expect(home.depth).toBe(0);
  expect(home.reason).toBe("command-home");
  expect(home.subject).toBeNull();
  expect(home.children).toBe(0);
  expect(home.result.ok).toBe(true);
  expect(pageErrors).toEqual([]);
});

/* ── The refusals ───────────────────────────────────────────────────────────
   Four ways to be told no, all of them out loud.
─────────────────────────────────────────────────────────────────────────── */

test("⚠ a view V3 has no surface for is REFUSED, not swallowed", async ({ page }) => {
  // `cameras` is the honest case: V3 has no cameras grid, `show.camera` needs a
  // camera named, and `switch_view` never names one. Picking one would be the
  // house inventing which camera you meant.
  const { pageErrors } = await bootV3(page, HOUSE);

  const got = await send(page, { command: "switch_view", view: "cameras" });

  expect(got.result.event).toBe("command:unknown");
  expect(got.result.ok).toBe(false);
  expect(got.result.message).toContain("cameras");
  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("⚠ a command with no V3 surface is refused by name", async ({ page }) => {
  // These are twenty-four of the twenty-six HA can send, and not one of them has
  // ever fired. `agenda_tomorrow` stands for the family.
  const { pageErrors } = await bootV3(page, HOUSE);

  for (const command of ["agenda_tomorrow", "camera_pin", "next_month", "doorbell_overlay"]) {
    const got = await send(page, { command });
    expect(got.result.event, command).toBe("command:unknown");
    expect(got.result.message, command).toContain(command);
    expect(got.depth, command).not.toBe(3);
  }
  expect(pageErrors).toEqual([]);
});

test("an event carrying no command at all is refused rather than ignored", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE);

  for (const payload of [{}, { view: "status" }, null, { command: "" }]) {
    const got = await send(page, payload);
    expect(got.result.event).toBe("command:unknown");
    expect(got.result.command).toBe("");
  }
  expect(pageErrors).toEqual([]);
});

test("`intent` and `action` are read as the command, the way the incumbent reads them", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE);

  for (const payload of [
    { intent: "switch_view", view: "status" },
    { action: "system_status" }
  ]) {
    const got = await send(page, payload);
    expect(got.subject).toBe("show.status");
    expect(got.result.ok).toBe(true);
  }
  expect(pageErrors).toEqual([]);
});

/* ── The flag gate ──────────────────────────────────────────────────────────
   The subject registry is deliberately left ungated so `__v3Subject` can drive
   an unflipped subject for verification before the flip. Which means any OTHER
   door into it has to re-apply the gate itself, or flipping the flag off stops
   being a rollback.
─────────────────────────────────────────────────────────────────────────── */

test("⚠ a flag-gated view refuses while its flag is off — the rollback stays a rollback", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE, { features: { v3ForecastWeek: false } });

  const got = await send(page, { command: "switch_view", view: "weather" });

  expect(got.result.event).toBe("command:unknown");
  expect(got.result.message).toContain("flag");
  expect(got.subject).toBeNull();
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("and opens the forecast once the flag is on", async ({ page }) => {
  const { pageErrors } = await bootV3(page, HOUSE, { features: { v3ForecastWeek: true } });

  const got = await send(page, { command: "switch_view", view: "weather" });

  expect(got.subject).toBe("show.forecast");
  expect(got.depth).toBe(3);
  expect(pageErrors).toEqual([]);
});

/* ── The decline path ───────────────────────────────────────────────────────
   ⚠⚠ SEEN ON THE WALL 2026-08-15 through the voice lane: depth 3, HELD, with
   nothing in it. `showSubject()` tears the previous subject down BEFORE it looks
   the new one up, and `deepen()` falls through to `sustain()` for a shallower
   target — so a decline from depth 3 leaves an empty stage owning the whole
   screen, re-armed by every repeat. This lane reaches the same function and
   would reach the same state.
─────────────────────────────────────────────────────────────────────────── */

test("⚠⚠ a subject that declines does not leave depth 3 held with nothing in it", async ({ page }) => {
  // A cold calendar: `/api/calendar/all` never resolves to a list, so `showDay`
  // correctly refuses rather than claiming the day is clear.
  const { pageErrors } = await bootV3(page, { ...HOUSE, "/api/calendar/all": null });

  const deep = await send(page, { command: "switch_view", view: "status" });
  expect(deep.depth).toBe(3);

  const declined = await send(page, { command: "switch_view", view: "timeline" });

  expect(declined.subject).toBeNull();
  expect(declined.children).toBe(0);
  expect(declined.depth).toBeLessThanOrEqual(1);
  // Declined is not unknown: the command was understood, the subject had
  // nothing. `ok:false` on an `executed` is exactly what that field is for.
  expect(declined.result.event).toBe("command:executed");
  expect(declined.result.ok).toBe(false);
  expect(pageErrors).toEqual([]);
});

test("a decline from the resting wall does not drag the surface anywhere", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { ...HOUSE, "/api/calendar/all": null });

  const got = await send(page, { command: "switch_view", view: "timeline" });

  /* ⚠ THE RESULT ASSERTION IS LOAD-BEARING, not decoration. Depth 0 with an
     empty mount is also what a wall with NO SUBSCRIBER looks like — this test
     was the one of thirteen that stayed green when the `on()` was neutered,
     i.e. it was passing for the wrong reason. The recorded outcome is the only
     thing here that separates "declined politely" from "never heard". */
  expect(got.result.event).toBe("command:executed");
  expect(got.result.ok).toBe(false);
  expect(got.depth).toBe(0);
  expect(got.children).toBe(0);
  expect(pageErrors).toEqual([]);
});
