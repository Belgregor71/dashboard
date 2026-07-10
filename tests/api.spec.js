import { test, expect } from "@playwright/test";

/**
 * API contract tests.
 *
 * These run against a real `node server.js` with whatever .env the machine
 * has, so upstreams (HA, Sonarr, calendars, open-meteo…) may be up or down.
 * The contract is therefore: every route must answer with JSON in one of its
 * KNOWN statuses and its KNOWN shape — never crash, never 404 on a real
 * route, never fall through to an HTML error page. That is exactly the class
 * of regression that would brick the kiosk after a push.
 */

async function expectJson(request, path, { statuses = [200], method = "get", data } = {}) {
  const res = await request[method](path, data ? { data } : undefined);
  expect(statuses, `${method.toUpperCase()} ${path} returned ${res.status()}`).toContain(res.status());
  const contentType = res.headers()["content-type"] || "";
  expect(contentType, `${path} should return JSON`).toContain("application/json");
  return { status: res.status(), body: await res.json() };
}

test.describe("system", () => {
  test("GET /api/config", async ({ request }) => {
    const { body } = await expectJson(request, "/api/config");
    expect(body).toHaveProperty("homeAssistant");
    expect(body).toHaveProperty("calendar");
  });

  test("GET /env.js is JS defining window.__ENV__", async ({ request }) => {
    const res = await request.get("/env.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
    expect(await res.text()).toContain("window.__ENV__");
  });

  test("GET /api/system/health", async ({ request }) => {
    const { body } = await expectJson(request, "/api/system/health");
    expect(["ok", "warn", "error"]).toContain(body.overall);
    expect(Array.isArray(body.feeds)).toBe(true);
    expect(body.feeds.length).toBeGreaterThanOrEqual(7);
    for (const feed of body.feeds) {
      expect(feed).toHaveProperty("id");
      expect(["ok", "warn", "error"]).toContain(feed.level);
    }
    expect(Array.isArray(body.recoveries)).toBe(true);
  });

  test("GET /api/system/metrics", async ({ request }) => {
    const { body } = await expectJson(request, "/api/system/metrics");
    expect(typeof body.cpuLoadPercent).toBe("number");
    expect(body.memory.total).toBeGreaterThan(0);
    expect(typeof body.uptimeSeconds).toBe("number");
  });

  test("GET /api/system/ping", async ({ request }) => {
    const { body } = await expectJson(request, "/api/system/ping", { statuses: [200, 502] });
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.target).toBe("string");
  });
});

test.describe("cameras", () => {
  test("GET /api/cameras", async ({ request }) => {
    const { body } = await expectJson(request, "/api/cameras");
    expect(Array.isArray(body.cameras)).toBe(true);
    for (const camera of body.cameras) {
      expect(typeof camera.id).toBe("string");
      expect(typeof camera.name).toBe("string");
      expect(camera.snapshotUrl).toBe(`/api/camera/${camera.id}/snapshot`);
    }
  });

  test("GET /api/camera/:id/status for a real camera", async ({ request }) => {
    const { body: list } = await expectJson(request, "/api/cameras");
    test.skip(!list.cameras.length, "no cameras configured");
    const { body } = await expectJson(request, `/api/camera/${list.cameras[0].id}/status`);
    expect(body.id).toBe(list.cameras[0].id);
    expect(typeof body.ok).toBe("boolean");
  });

  test("GET /api/camera/:id/status for unknown camera is a JSON 404", async ({ request }) => {
    const { body } = await expectJson(request, "/api/camera/__does_not_exist__/status", { statuses: [404] });
    expect(body).toHaveProperty("error");
  });
});

test.describe("weather", () => {
  test("GET /api/weather/now keeps its shape even when upstream is down", async ({ request }) => {
    const { body } = await expectJson(request, "/api/weather/now", { statuses: [200, 502] });
    expect(body).toHaveProperty("now");
    expect(body.now).toHaveProperty("temp_c");
    expect(typeof body.now.condition.label).toBe("string");
    expect(body).toHaveProperty("day");
  });

  test("GET /api/weather/forecast", async ({ request }) => {
    const { body } = await expectJson(request, "/api/weather/forecast", { statuses: [200, 502] });
    expect(Array.isArray(body.days)).toBe(true);
  });

  test("GET /api/weather/radar/meta", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/weather/radar/meta", { statuses: [200, 502] });
    if (status === 200) {
      expect(typeof body.z).toBe("number");
      expect(body.tiles).toHaveLength(9);
    } else {
      expect(body).toHaveProperty("error");
    }
  });
});

test.describe("calendar", () => {
  test("GET /api/calendar/all", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/calendar/all", { statuses: [200, 500] });
    if (status === 200) {
      expect(Array.isArray(body)).toBe(true);
    } else {
      expect(body).toHaveProperty("error");
    }
  });

  test("GET /api/calendar/holidays returns an array", async ({ request }) => {
    const { body } = await expectJson(request, "/api/calendar/holidays");
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /api/calendar/holidays rejects a bad year", async ({ request }) => {
    await expectJson(request, "/api/calendar/holidays?year=1800", { statuses: [400] });
  });
});

test.describe("feeds", () => {
  test("GET /api/news", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/news", { statuses: [200, 500, 502] });
    if (status === 200) expect(Array.isArray(body.headlines)).toBe(true);
  });

  test("GET /api/bins", async ({ request }) => {
    const { body } = await expectJson(request, "/api/bins");
    expect(typeof body.configured).toBe("boolean");
    if (body.configured) expect(typeof body.due).toBe("boolean");
  });

  test("GET /api/nrl/broncos", async ({ request }) => {
    const { body } = await expectJson(request, "/api/nrl/broncos", { statuses: [200, 500, 502] });
    expect(typeof body).toBe("object");
  });

  test("GET /api/fuel", async ({ request }) => {
    await expectJson(request, "/api/fuel", { statuses: [200, 500, 502] });
  });

  test("GET /api/photos returns an array", async ({ request }) => {
    const { body } = await expectJson(request, "/api/photos");
    expect(Array.isArray(body)).toBe(true);
  });

  test("GET /api/arr/summary", async ({ request }) => {
    // Unconfigured services must answer 200-empty, not 500 (the kiosk re-hits
    // this every 10s); a configured-but-down upstream may still 500/502.
    const { status, body } = await expectJson(request, "/api/arr/summary", { statuses: [200, 500, 502] });
    if (status === 200) {
      expect(typeof body.active).toBe("boolean");
      for (const svc of ["sonarr", "radarr", "lidarr"]) {
        expect(Array.isArray(body[svc])).toBe(true);
      }
    }
  });

  test("GET /api/plex/sessions", async ({ request }) => {
    await expectJson(request, "/api/plex/sessions", { statuses: [200, 500, 502] });
  });
});

test.describe("home assistant", () => {
  test("GET /api/ha/health", async ({ request }) => {
    const { body } = await expectJson(request, "/api/ha/health");
    expect(body.ok).toBe(true);
    expect(typeof body.enabled).toBe("boolean");
    expect(typeof body.connected).toBe("boolean");
  });

  test("GET /api/ha/snapshot", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/ha/snapshot", { statuses: [200, 502] });
    if (status === 502) expect(body.error.code).toBe("HA_UNAVAILABLE");
  });
});

test.describe("ai + tts", () => {
  test("POST /api/tts/speak without text is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/tts/speak", {
      method: "post",
      data: {},
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });

  test("POST /api/ai/brief answers with a summary key (AI stubbed off)", async ({ request }) => {
    const { body } = await expectJson(request, "/api/ai/brief", {
      method: "post",
      data: { type: "concierge", time: "6pm" },
      statuses: [200, 502]
    });
    expect(body).toHaveProperty("summary");
  });

  // The frontend calls /api/ai/route from events.js (voice command routing)
  // and systemStatus.js (explain status), but the server never defined it —
  // both callers silently degrade on the 404 today. Un-fixme this test when
  // the endpoint is implemented.
  test.fixme("POST /api/ai/route exists", async ({ request }) => {
    await expectJson(request, "/api/ai/route", {
      method: "post",
      data: { text: "show cameras" },
      statuses: [200]
    });
  });
});
