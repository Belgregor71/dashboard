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

// Audit 2026-07-26 S1/S2/S3. The billable routes are additionally gated to
// loopback (server/middleware/security.js) — not asserted here because the test
// client IS loopback; what these cover is that the gate did not break the
// kiosk's own access, and that the headers/limiter are actually mounted.
test.describe("security middleware", () => {
  test("helmet headers are set on every response", async ({ request }) => {
    const res = await request.get("/api/config");
    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBeTruthy();
    expect(headers["referrer-policy"]).toBeTruthy();
  });

  test("CSP ships report-only and never upgrades to https on a LAN", async ({ request }) => {
    const res = await request.get("/api/config");
    const headers = res.headers();
    // CSP_ENFORCE=1 flips this to the enforcing header; until a live Pi pass
    // confirms zero violations, an enforcing CSP here is the regression.
    const csp = headers["content-security-policy-report-only"];
    expect(csp, "CSP should be report-only until verified on the Pi").toBeTruthy();
    expect(headers["content-security-policy"]).toBeFalsy();
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("https://fonts.gstatic.com");
    expect(csp).toContain("https://api.open-meteo.com");
    // Plain HTTP on the LAN — this directive would break every asset.
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  // The limiter is LAN-only. This asserts the exemption, not the ceiling: a
  // 2000/min global ceiling was measured throttling the suite's own loopback
  // traffic (~2,700 req/min peak), which on the Pi means a silent 429 to the
  // kiosk. A burst well past any sane per-minute ceiling must still all pass.
  test("loopback is never rate-limited", async ({ request }) => {
    const statuses = await Promise.all(
      Array.from({ length: 60 }, () => request.get("/api/config").then((r) => r.status()))
    );
    expect(statuses.every((s) => s === 200)).toBe(true);
    expect(statuses).not.toContain(429);
  });

  test("a foreign origin gets no CORS grant", async ({ request }) => {
    const res = await request.get("/api/config", { headers: { Origin: "http://evil.example" } });
    expect(res.status()).toBe(200); // the response is made; the browser blocks the read
    expect(res.headers()["access-control-allow-origin"]).toBeFalsy();

    const preflight = await request.fetch("/api/config", {
      method: "OPTIONS",
      headers: { Origin: "http://evil.example", "Access-Control-Request-Method": "POST" }
    });
    expect(preflight.status()).toBe(403);
  });
});

test.describe("document root", () => {
  // Phase 5 removed the legacy static/index.html fallback — `/` must serve the
  // Vite-built document unconditionally. Guards against a broken build or a
  // regression that 404s the kiosk's entry point.
  test("GET / returns 200 and the built HTML document", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] || "").toContain("text/html");
    const html = await res.text();
    expect(html).toContain("<!DOCTYPE html>");
    // The built app links the split-tree bundle, never the retired legacy CSS.
    expect(html).toContain("/assets/");
    expect(html).not.toContain("/css/styles.css");
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
    // Living-window fields: intensity is a tier or null, thunder is always a boolean —
    // including on the 502 fallback shape.
    expect([null, "light", "moderate", "heavy"]).toContain(body.now.condition.intensity);
    expect(typeof body.now.condition.thunder).toBe("boolean");
    expect(body).toHaveProperty("day");
  });

  test("GET /api/weather/forecast", async ({ request }) => {
    const { body } = await expectJson(request, "/api/weather/forecast", { statuses: [200, 502] });
    expect(Array.isArray(body.days)).toBe(true);
  });

  test("GET /api/weather/nowcast keeps its shape and degrades to null when upstream is down", async ({ request }) => {
    const { body } = await expectJson(request, "/api/weather/nowcast", { statuses: [200, 502] });
    expect(body).toHaveProperty("nowcast");
    if (body.nowcast !== null) {
      expect(typeof body.nowcast.startsInMin).toBe("number");
      expect(body.nowcast.startsInMin).toBeGreaterThan(0);
      expect(typeof body.nowcast.mm).toBe("number");
      // probabilityPct is a number or null (Open-Meteo may omit it)
      expect(["number", "object"]).toContain(typeof body.nowcast.probabilityPct);
    }
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

test.describe("recipe", () => {
  // Web-search-backed recipe lookup, cached to data/recipe-cache. The test
  // server has no ANTHROPIC_API_KEY, so a cache miss degrades to 502 with the
  // same {title, ingredients, steps} shape — no API spend, no network.
  test("GET /api/recipe keeps its shape and degrades when upstream is down", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/recipe?dish=test-dish", { statuses: [200, 502] });
    expect(body.title === null || typeof body.title === "string").toBe(true);
    expect(Array.isArray(body.ingredients)).toBe(true);
    expect(Array.isArray(body.steps)).toBe(true);
    if (status === 200) {
      expect(body.ingredients.length).toBeGreaterThan(0);
      expect(body.steps.length).toBeGreaterThan(0);
    }
  });

  test("GET /api/recipe rejects a missing dish", async ({ request }) => {
    await expectJson(request, "/api/recipe", { statuses: [400] });
  });

  // The Recipe Book portal (static/recipes/) writes hand-added recipes into the
  // same cache, so a saved dish is found for free when its Meal: event fires.
  test("GET /api/recipes lists cached recipes in a stable shape", async ({ request }) => {
    const { body } = await expectJson(request, "/api/recipes");
    expect(Array.isArray(body.recipes)).toBe(true);
    for (const r of body.recipes) {
      expect(typeof r.slug).toBe("string");
      expect(typeof r.title).toBe("string");
      expect(Array.isArray(r.ingredients)).toBe(true);
      expect(Array.isArray(r.steps)).toBe(true);
      expect(typeof r.authored).toBe("boolean");
    }
  });

  test("POST /api/recipe saves, appears in the list, then DELETE removes it", async ({ request }) => {
    const dish = { title: "Test Portal Dish", servings: "4", ingredients: ["400g pasta"], steps: ["Boil it."] };
    const { body: saved } = await expectJson(request, "/api/recipe", { method: "post", data: dish, statuses: [200] });
    expect(saved.ok).toBe(true);
    expect(saved.slug).toBe("test-portal-dish");
    expect(saved.recipe.authored).toBe(true);

    const { body: list } = await expectJson(request, "/api/recipes");
    expect(list.recipes.some((r) => r.slug === "test-portal-dish" && r.authored)).toBe(true);

    // It must also resolve through the panel's read path.
    const { body: fetched } = await expectJson(request, "/api/recipe?dish=Test%20Portal%20Dish", { statuses: [200] });
    expect(fetched.title).toBe("Test Portal Dish");

    await expectJson(request, "/api/recipe/test-portal-dish", { method: "delete", statuses: [200] });
    await expectJson(request, "/api/recipe/test-portal-dish", { method: "delete", statuses: [404] });
  });

  test("POST /api/recipe rejects an empty or shapeless recipe", async ({ request }) => {
    await expectJson(request, "/api/recipe", { method: "post", data: {}, statuses: [400] });
    await expectJson(request, "/api/recipe", { method: "post", data: { title: "No Steps", ingredients: ["x"], steps: [] }, statuses: [400] });
  });

  test("DELETE /api/recipe rejects a path-traversal slug", async ({ request }) => {
    await expectJson(request, "/api/recipe/..%2F..%2Fsecret", { method: "delete", statuses: [400, 404] });
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

test.describe("routines (Phase 8 behavioural learning)", () => {
  // On-device aggregate store. Cold start degrades to an object, never an error;
  // a PUT round-trips; a bad body is a JSON 400 (never an HTML error page).
  test("GET /api/routines returns { routines: object }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/routines");
    expect(typeof body.routines).toBe("object");
    expect(Array.isArray(body.routines)).toBe(false);
  });

  test("PUT then GET round-trips the aggregate blob", async ({ request }) => {
    const marker = { wake: { weekday: { n: 6, mean: 421, variance: 9 } } };
    await expectJson(request, "/api/routines", { method: "put", data: { routines: marker } });
    const { body } = await expectJson(request, "/api/routines");
    expect(body.routines.wake.weekday.mean).toBe(421);
  });

  test("PUT with a non-object body is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/routines", {
      method: "put",
      data: { routines: [1, 2, 3] },
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });
});

test.describe("delight budgets (Phase 10 personality)", () => {
  // On-device budget store. Cold start degrades to an object, never an error; a
  // PUT round-trips; a bad body is a JSON 400 (never an HTML error page).
  test("GET /api/delight returns { budgets: object }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/delight");
    expect(typeof body.budgets).toBe("object");
    expect(Array.isArray(body.budgets)).toBe(false);
  });

  test("PUT then GET round-trips the budgets blob", async ({ request }) => {
    const marker = { "christmas-eve": "xmas:2026" };
    await expectJson(request, "/api/delight", { method: "put", data: { budgets: marker } });
    const { body } = await expectJson(request, "/api/delight");
    expect(body.budgets["christmas-eve"]).toBe("xmas:2026");
  });

  test("PUT with a non-object body is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/delight", {
      method: "put",
      data: { budgets: [1, 2, 3] },
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });
});

test.describe("memories (Phase 9 memory engine)", () => {
  // Authored-memory loader — read-only, on-device. Cold start (no directory, or
  // no files) degrades to an empty list, never an error or an HTML page.
  test("GET /api/memories returns { memories: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/memories");
    expect(Array.isArray(body.memories)).toBe(true);
    for (const m of body.memories) {
      expect(typeof m.id).toBe("string"); // every returned entry is identified
    }
  });

  // Portal write path (Memory Studio). Writes are confined to authored.json; the
  // round-trip cleans up its own entry so a repo/CI run leaves no residue.
  test("POST rejects an entry with no photo (JSON 400)", async ({ request }) => {
    const { body } = await expectJson(request, "/api/memories", {
      method: "post",
      data: { title: "no photo here" },
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });

  test("POST → GET → DELETE round-trips one authored memory", async ({ request }) => {
    const id = `test-studio-${Date.now()}`;
    const { body: saved } = await expectJson(request, "/api/memories", {
      method: "post",
      data: {
        id,
        title: "a test memory",
        photos: [{ immich: "b55feb89-5cbd-4e94-a9eb-613fc351634b" }],
        date: "2016-07-14",
        tags: ["winter", "grey"],
        sensitivity: "normal"
      }
    });
    expect(saved.ok).toBe(true);
    expect(saved.entry.id).toBe(id);

    const { body: after } = await expectJson(request, "/api/memories");
    expect(after.memories.some((m) => m.id === id)).toBe(true);

    const { body: del } = await expectJson(request, `/api/memories/${id}`, { method: "delete" });
    expect(del.ok).toBe(true);

    const { body: gone } = await expectJson(request, "/api/memories");
    expect(gone.memories.some((m) => m.id === id)).toBe(false);
  });

  test("POST without an id derives one from the title (never the string 'undefined')", async ({ request }) => {
    const { body } = await expectJson(request, "/api/memories", {
      method: "post",
      data: {
        title: "a slugged title here",
        photos: [{ immich: "b55feb89-5cbd-4e94-a9eb-613fc351634b" }]
      }
    });
    expect(body.entry.id).not.toBe("undefined");
    expect(body.entry.id).toMatch(/^a-slugged-title-here-/); // title slug + unique suffix
    await request.delete(`/api/memories/${body.entry.id}`); // clean up
  });

  test("DELETE of an unknown id is a JSON 404", async ({ request }) => {
    const { body } = await expectJson(request, "/api/memories/no-such-entry-xyz", {
      method: "delete",
      statuses: [404]
    });
    expect(body).toHaveProperty("error");
  });
});

test.describe("immich photo source (Phase 9.5)", () => {
  // Read-only proxy. With no IMMICH_URL/KEY (the test machine) every endpoint
  // degrades to empty/404 — never a 500-to-HTML page, never a crash.
  test("GET /api/immich/on-this-day returns { assets: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/on-this-day");
    expect(Array.isArray(body.assets)).toBe(true);
  });

  test("GET /api/immich/random returns { assets: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/random?count=5");
    expect(Array.isArray(body.assets)).toBe(true);
  });

  test("GET /api/immich/browse without after/before is a JSON 400", async ({ request }) => {
    // Params are validated before the config check, so the contract holds even
    // on a machine with no Immich configured.
    const { body } = await expectJson(request, "/api/immich/browse", { statuses: [400] });
    expect(body).toHaveProperty("error");
  });

  test("GET /api/immich/browse with a valid window returns { assets: array }", async ({ request }) => {
    const { body } = await expectJson(
      request,
      "/api/immich/browse?after=2016-07-01T00:00:00.000Z&before=2016-08-01T00:00:00.000Z"
    );
    expect(Array.isArray(body.assets)).toBe(true);
  });

  test("GET /api/immich/asset/:id/thumb rejects a non-UUID id with a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/asset/not-a-uuid/thumb", { statuses: [400] });
    expect(body).toHaveProperty("error");
  });

  test("GET /api/immich/asset/:id/thumb for a well-formed id is image, 404, or 502 — never HTML", async ({ request }) => {
    const res = await request.get("/api/immich/asset/b55feb89-5cbd-4e94-a9eb-613fc351634b/thumb");
    expect([200, 404, 502]).toContain(res.status());
    const ct = res.headers()["content-type"] || "";
    expect(ct.startsWith("image/") || ct.includes("application/json")).toBe(true);
  });

  // Daily Memories — the frozen per-day set. With no Immich configured it degrades
  // to { date, photos: [] } (the client then falls back to the random blend).
  test("GET /api/immich/daily-set returns { date, photos: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/daily-set");
    expect(typeof body.date).toBe("string");
    expect(Array.isArray(body.photos)).toBe(true);
  });

  test("GET /api/immich/map without lat/lng is a JSON 400", async ({ request }) => {
    // Coordinates are validated before the key check, so the contract holds on any
    // machine (with or without MAP_API_KEY).
    const { body } = await expectJson(request, "/api/immich/map", { statuses: [400] });
    expect(body).toHaveProperty("error");
  });

  test("GET /api/immich/map with valid coords is image, 404 (no key), or 502 — never HTML", async ({ request }) => {
    const res = await request.get("/api/immich/map?lat=35.0116&lng=135.7681");
    expect([200, 404, 502]).toContain(res.status());
    const ct = res.headers()["content-type"] || "";
    expect(ct.startsWith("image/") || ct.includes("application/json")).toBe(true);
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

  // S1: unbounded text is unbounded synthesis cost and SD-card writes. Every
  // real line (alert, briefing, concierge reply) is well under 400 chars.
  test("POST /api/tts/speak rejects text over the length cap", async ({ request }) => {
    const { body } = await expectJson(request, "/api/tts/speak", {
      method: "post",
      data: { text: "a".repeat(401) },
      statuses: [400]
    });
    expect(body.error).toContain("400 characters");
  });

  test("POST /api/ai/brief answers with a summary key (AI stubbed off)", async ({ request }) => {
    const { body } = await expectJson(request, "/api/ai/brief", {
      method: "post",
      data: { type: "concierge", time: "6pm" },
      statuses: [200, 502]
    });
    expect(body).toHaveProperty("summary");
  });

  // Phase 4 voice lanes (docs/vision/phase-4-voice.md). Assist proxies text to
  // HA's conversation API (502 when HA is down/misconfigured); converse is the
  // Claude house-voice (502 with reply:null when both AI upstreams are out,
  // which is the stubbed test environment). Text-only — no audio endpoints.
  test("POST /api/voice/assist without text is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/voice/assist", {
      method: "post",
      data: {},
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });

  test("POST /api/voice/assist answers the lane contract", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/voice/assist", {
      method: "post",
      data: { text: "hello" },
      statuses: [200, 502]
    });
    expect(typeof body.handled).toBe("boolean");
    expect(body).toHaveProperty("speech");
    if (status === 502) expect(body.handled).toBe(false);
  });

  test("POST /api/voice/converse without text is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/voice/converse", {
      method: "post",
      data: {},
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });

  test("POST /api/voice/converse answers with a reply key (AI stubbed off)", async ({ request }) => {
    const { body } = await expectJson(request, "/api/voice/converse", {
      method: "post",
      data: { text: "hello there", history: [] },
      statuses: [200, 502]
    });
    expect(body).toHaveProperty("reply");
  });

  // Mic-bridge transcript injection (project-voice-mic-bridge): the on-device
  // wake/STT agent POSTs the finished transcript here (loopback only); the
  // server fans it out over /api/voice/stream to the kiosk. Audio never reaches
  // the server — text only. Tests run from loopback so they clear the guard.
  test("POST /api/voice/transcript without text is a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/voice/transcript", {
      method: "post",
      data: {},
      statuses: [400]
    });
    expect(body).toHaveProperty("error");
  });

  test("POST /api/voice/transcript accepts a transcript from loopback", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/voice/transcript", {
      method: "post",
      data: { text: "what time is it" },
      statuses: [200]
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty("ok", true);
  });
});
