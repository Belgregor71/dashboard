import { test, expect } from "@playwright/test";
import { worstFault } from "../src/v3/core/health.js";

/* Phase 6 — the invisible layer.

   ⚠ THE THING THIS PHASE MOSTLY PROVED IS THAT IT WAS ALREADY DONE. The
   watchdog (server/services/healthService.js) and the self-heal
   (recoveryService.js) are SERVER-side, started from app.listen and driven by
   the Home Assistant manager. They do not know which URL Chromium is showing,
   so they have been running on V3 since the day V3 existed. There is nothing
   to port and no test here asserts otherwise.

   What V3 lacked was any way to tell the ROOM. These are the tests for that:
   which fault gets named, and the readout you can ask for. */

/* ── Which fault gets named ─────────────────────────────────────────────────
   Pure, so it runs without a browser — the same reason the fast lane's tests do.
─────────────────────────────────────────────────────────────────────────── */

const feed = (id, level, detail = null) => ({ id, label: id, level, detail });

test.describe("the fault worth naming", () => {
  test("a healthy house names nothing", () => {
    expect(worstFault({ feeds: [feed("ha", "ok"), feed("wan", "ok")] })).toBeNull();
  });

  test("⚠ a WARN is not worth the wall", () => {
    /* Weather at 46 minutes is late, not broken. A surface that reports
       lateness teaches the room to ignore it by the time something is actually
       wrong, which is the failure mode this whole phase exists to avoid. */
    expect(worstFault({ feeds: [feed("weather", "warn", "no success for 46m")] })).toBeNull();
  });

  test("⚠ ONE CAUSE, NOT THREE SYMPTOMS — the internet outranks what it broke", () => {
    /* healthService's own comment: "when the internet is down, weather + AI +
       news all fail SEPARATELY and the chip reads like three unrelated
       faults." The wall has room for one sentence, so it must be the upstream
       one. This is the assertion that keeps that ordering honest. */
    const fault = worstFault({
      feeds: [
        feed("weather", "error", "no success for 2h"),
        feed("ai", "error", "2 consecutive failures"),
        feed("wan", "error", "internet is down"),
        feed("calendar", "error", "no success for 4h")
      ]
    });
    expect(fault.id).toBe("wan");
    expect(fault.text).toBe("The internet's down.");
  });

  test("a feed this module has never heard of is still named", () => {
    // A feed the server grows later must not become invisible precisely
    // because it is new.
    const fault = worstFault({ feeds: [{ id: "sonarr", label: "Sonarr", level: "error", detail: "down" }] });
    expect(fault.id).toBe("sonarr");
    expect(fault.text).toContain("Sonarr");
  });

  test("⚠ NOT LOADED IS NOT EMPTY — an unreadable health is not a healthy house", () => {
    // The bug class this codebase has produced four times. None of these may
    // be read as "everything is fine".
    expect(worstFault(null)).toBeNull();
    expect(worstFault(undefined)).toBeNull();
    expect(worstFault({})).toBeNull();
    expect(worstFault({ feeds: "not an array" })).toBeNull();
  });
});

/* ── The surface ────────────────────────────────────────────────────────────
   Every /api/** is answered here. A spec about the readout cannot share a
   house with the developer's living room — the trap tests/v3-spread.spec.js
   paid for on its first run.
─────────────────────────────────────────────────────────────────────────── */

const HEALTHY = {
  overall: "ok",
  updatedAt: Date.now(),
  feeds: [feed("ha", "ok"), feed("wan", "ok"), feed("motion", "ok"), feed("weather", "ok")],
  recoveries: []
};

const BROKEN = {
  overall: "error",
  updatedAt: Date.now(),
  feeds: [feed("wan", "error", "internet is down"), feed("weather", "error", "no success for 2h")],
  recoveries: [{ at: Date.now(), kind: "detection-switch", action: "re-armed switch.kitchen_motion_detection", ok: true }]
};

const METRICS = { cpuLoadPercent: 7, cpuCount: 8, uptimeSeconds: 90_000, tempC: 41.2, hostname: "g11" };

async function bootV3(page, { health = HEALTHY, metrics = METRICS } = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const json = (body) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });

    if (url.pathname.startsWith("/api/system/health")) {
      return health === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : json(health);
    }
    if (url.pathname.startsWith("/api/system/metrics")) {
      return metrics === null
        ? route.fulfill({ status: 503, contentType: "application/json", body: "{}" })
        : json(metrics);
    }
    if (/\/(thumb|snapshot|live|image|basemap|overlay)/.test(url.pathname)) {
      return route.fulfill({
        status: 200,
        contentType: "image/gif",
        body: Buffer.from("R0lGODlhAQABAAAAACw=", "base64")
      });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });

  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return { pageErrors };
}

/** Mount the readout and read back what actually landed in the DOM. */
async function showStatus(page) {
  return page.evaluate(async () => {
    const shown = await window.__v3Subject("show.status");
    const mount = document.getElementById("subject-mount");
    return {
      shown: Boolean(shown),
      speech: shown && shown.speech ? shown.speech : null,
      children: mount.childElementCount,
      cell: mount.firstElementChild?.dataset.cell ?? null,
      rows: mount.querySelectorAll(".subject__row").length,
      text: mount.textContent
    };
  });
}

test.describe("the status readout", () => {
  test("a healthy house reads as healthy, and says so in one sentence", async ({ page }) => {
    const { pageErrors } = await bootV3(page);
    const got = await showStatus(page);

    expect(got.shown).toBe(true);
    expect(got.cell).toBe("status");
    // Four feeds plus the box line.
    expect(got.rows).toBe(5);
    expect(got.text).toContain("g11");
    expect(got.text).toContain("41°C");
    expect(got.speech).toBe("Everything's healthy.");
    expect(pageErrors).toEqual([]);
  });

  test("a broken house names the upstream cause, and shows the repair", async ({ page }) => {
    await bootV3(page, { health: BROKEN });
    const got = await showStatus(page);

    expect(got.speech).toBe("The internet's down.");
    // The server's own detail strings are reused rather than re-worded.
    expect(got.text).toContain("internet is down");
    // A self-heal that keeps firing is a fault that keeps happening, and it is
    // invisible in the feed levels precisely because the repair worked.
    expect(got.text).toContain("re-armed switch.kitchen_motion_detection");
  });

  test("⚠ an unreadable health mounts NOTHING rather than an empty confident panel", async ({ page }) => {
    await bootV3(page, { health: null });
    const got = await showStatus(page);
    expect(got.shown).toBe(false);
    expect(got.children).toBe(0);
  });

  test("⚠ a 200 with NO feeds is silence, not a clean bill of health", async ({ page }) => {
    /* The nastier half of not-loaded-is-not-empty, and the one a null check
       does not catch: a watchdog that has started but evaluated nothing answers
       200 with an empty array. Without the length clause this mounts a titled
       panel with no rows and says "Everything's healthy" — a confident empty
       panel, which is worse than no panel at all. */
    await bootV3(page, { health: { overall: "ok", updatedAt: Date.now(), feeds: [], recoveries: [] } });
    const got = await showStatus(page);
    expect(got.shown).toBe(false);
    expect(got.children).toBe(0);
  });

  test("the box's own line is optional — a missing sensor is not a missing readout", async ({ page }) => {
    /* The G11 has no vcgencmd and no /sys/class/thermal. A subject that refused
       to render because it could not read a CPU temperature would be answering
       a question about health by being unhealthy. */
    await bootV3(page, { metrics: null });
    const got = await showStatus(page);
    expect(got.shown).toBe(true);
    expect(got.rows).toBe(4);
  });

  test("leaving takes the whole readout with it", async ({ page }) => {
    // Depth 3 is the one genuinely per-event path in V3, and per-event paths
    // are where this house has leaked before.
    await bootV3(page);
    const after = await page.evaluate(async () => {
      const mount = document.getElementById("subject-mount");
      // Ten mount/remount cycles: showSubject() clears whatever is there first,
      // so a teardown that leaked would show as a rising child count.
      for (let i = 0; i < 10; i += 1) await window.__v3Subject("show.status");
      const whileMounted = mount.childElementCount;

      // And leaving depth 3 must empty it entirely — that is the path the wall
      // actually takes when a subject's hold expires.
      window.__setDepth(3, "spec");
      await window.__v3Subject("show.status");
      window.__setDepth(1, "spec");
      return { whileMounted, afterLeaving: mount.childElementCount };
    });
    expect(after.whileMounted).toBe(1);
    expect(after.afterLeaving).toBe(0);
  });
});

test.describe("the one-line notice", () => {
  test("a broken feed reaches the attention queue without touching the screen", async ({ page }) => {
    await bootV3(page, { health: BROKEN });

    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return {
        health: window.__v3().health,
        announced: window.__v3().announced
      };
    });

    expect(got.health.fault).toBe("wan");
    const entry = got.announced.find((c) => c.source === "health");
    expect(entry, "the fault never reached the queue").toBeTruthy();
    /* ⚠ High band, NOT the interrupt band. 72 earns depth 1 when someone is in
       the room and never when nobody is: a house alone at 3am does not need to
       be told about itself. */
    expect(entry.score).toBe(72);
    expect(entry.expiresAt).toBeGreaterThan(Date.now());
  });

  test("a healthy house announces nothing at all", async ({ page }) => {
    await bootV3(page);
    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return window.__v3().announced.filter((c) => c.source === "health");
    });
    expect(got).toEqual([]);
  });

  test("⚠ an unreachable server does not INVENT a fault", async ({ page }) => {
    /* This page is served BY the server it is polling, so a failed poll means a
       restart in progress or a page that is about to stop working anyway.
       Announcing from a reading we could not take would be making one up. */
    await bootV3(page, { health: null });
    const got = await page.evaluate(async () => {
      await window.__v3Health();
      return {
        announced: window.__v3().announced.filter((c) => c.source === "health"),
        health: window.__v3().health
      };
    });
    expect(got.announced).toEqual([]);
  });
});
