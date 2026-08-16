import { test, expect } from "@playwright/test";
import { createHash } from "crypto";
import { mkdir, rm, stat, utimes, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { pickSensorPath } from "../server/routes/system.js";
import { isScreenshot } from "../server/services/immichClient.js";

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/* ⚠⚠ NEVER LEAVE A REQUEST IN FLIGHT WHEN A TEST IS ABOUT TO END.
   Blocked a push 2026-08-16: "Target page, context or browser has been closed".

   The SSE tests below fire a POST on a timer to provoke the frame they are
   waiting for, then resolve the instant that frame arrives — which is caused
   BY that POST, so the POST is by definition still in flight. Playwright then
   tears the request context down underneath it, and the rejection surfaces
   with no owning test, intermittently, in whichever run happens to be fast
   enough. It passed three full suites before it failed one.

   The fix is ownership: capture the promise the timer creates and settle it
   before the test returns. `.catch()` because a POST cut short by a stream
   that already closed is an expected outcome here, not a failure — the frame
   arriving is the assertion. */
async function settle(promise) {
  if (promise) await Promise.resolve(promise).catch(() => {});
}

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
    // tempC was entirely unasserted, so the System-view tile could go blank
    // forever and no test would notice — which is exactly what a host migration
    // does to a hardcoded sensor path. null is legitimate (this dev box has no
    // readable CPU sensor), so pin the shape and the plausible range, not a value.
    expect(body.tempC === null || typeof body.tempC === "number").toBe(true);
    if (typeof body.tempC === "number") {
      expect(body.tempC).toBeGreaterThan(20);
      expect(body.tempC).toBeLessThan(120);
    }
  });

  test("GET /api/system/ping", async ({ request }) => {
    const { body } = await expectJson(request, "/api/system/ping", { statuses: [200, 502] });
    expect(typeof body.ok).toBe("boolean");
    expect(typeof body.target).toBe("string");
  });
});

/**
 * pickSensorPath — CPU temperature sensor selection.
 *
 * The Pi reads /sys/class/thermal/thermal_zone0/temp; x86 exposes the CPU die
 * under /sys/class/hwmon instead, where thermal_zone0 may be absent or a
 * different sensor. The ordering is the part worth pinning, because getting it
 * wrong means latching a board or fan sensor and rendering a confident wrong
 * number instead of an honest blank. Tested without a filesystem, same as
 * isWithinOffWindow.
 */
test.describe("pickSensorPath — portable CPU sensor selection", () => {
  const entry = (name) => ({ name, path: `/sys/class/hwmon/${name}/temp1_input` });

  test("prefers the AMD CPU sensor over a board sensor", () => {
    // The G11's real shape: acpitz enumerates first but k10temp is the CPU die.
    expect(pickSensorPath([entry("acpitz"), entry("k10temp")]))
      .toBe("/sys/class/hwmon/k10temp/temp1_input");
  });

  test("prefers Intel coretemp over a board sensor", () => {
    expect(pickSensorPath([entry("acpitz"), entry("coretemp")]))
      .toBe("/sys/class/hwmon/coretemp/temp1_input");
  });

  test("resolves the Pi's own hwmon name, so rollback keeps reporting", () => {
    expect(pickSensorPath([entry("cpu_thermal")]))
      .toBe("/sys/class/hwmon/cpu_thermal/temp1_input");
  });

  test("falls back to acpitz when nothing better is present", () => {
    expect(pickSensorPath([entry("acpitz")]))
      .toBe("/sys/class/hwmon/acpitz/temp1_input");
  });

  test("returns null on no match, so the caller can try thermal_zone0", () => {
    expect(pickSensorPath([entry("nvme"), entry("iwlwifi_1")])).toBeNull();
    expect(pickSensorPath([])).toBeNull();
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

  // H4. CORS blocks the cross-origin READ; these cover the WRITE, which a
  // `mode: 'no-cors'` fetch from a malicious LAN page lands regardless. Each of
  // these would actuate real state if it got through.
  const CROSS_ORIGIN_WRITES = [
    ["post", "/api/ha/services/light/turn_on", {}],
    ["post", "/api/ha/shopping_list", { name: "csrf" }],
    ["put", "/api/routines", { routines: {} }],
    ["put", "/api/delight", { budgets: {} }],
    ["post", "/api/memories", { title: "csrf" }],
    ["delete", "/api/memories/anything", undefined],
    ["post", "/api/recipe", { title: "csrf" }],
    ["delete", "/api/recipe/anything", undefined]
  ];

  for (const [method, path, data] of CROSS_ORIGIN_WRITES) {
    test(`${method.toUpperCase()} ${path} rejects a foreign origin`, async ({ request }) => {
      const res = await request[method](path, {
        headers: { Origin: "http://evil.example" },
        ...(data ? { data } : {})
      });
      expect(res.status(), `${path} let a cross-origin write through`).toBe(403);
      expect((await res.json()).error).toContain("Cross-origin");
    });
  }

  test("a browser that sends only Sec-Fetch-Site is still judged on it", async ({ request }) => {
    const blocked = await request.put("/api/routines", {
      headers: { "sec-fetch-site": "cross-site" },
      data: { routines: {} }
    });
    expect(blocked.status()).toBe(403);

    const allowed = await request.put("/api/routines", {
      headers: { "sec-fetch-site": "same-origin" },
      data: { routines: {} }
    });
    expect(allowed.status()).toBe(200);
  });

  // The guard must not cost the kiosk anything. Two shapes have to keep working:
  // the page's own write (Origin === the host it was served from) and the
  // header-less write every node-side caller makes — the pregenerate script, the
  // mic bridge, and every other mutating test in this file.
  test("the kiosk's own same-origin write is untouched", async ({ request, baseURL }) => {
    const res = await request.put("/api/routines", {
      headers: { Origin: new URL(baseURL).origin },
      data: { routines: {} }
    });
    expect(res.status()).toBe(200);
  });

  // ORDER, which security.js:158 calls load-bearing and nothing above checks:
  // applySecurity (server.js:90) must stay ABOVE express.json (server.js:91), so
  // a rejected write is never parsed. Reversing those two lines changes no
  // status code on any test in this file — every body above is small and legal —
  // so the invariant would go quietly.
  //
  // A body over the 256kb json limit is the discriminator, because the two
  // orders disagree on it and on nothing else:
  //   guard first  -> 403, the body is never read
  //   parser first -> 413, the server buffered a quarter-megabyte for a request
  //                   it was always going to refuse
  // Which matters beyond one wasted read: it is the shape that lets an attacker
  // page make this box do work before it says no.
  test("a cross-origin write is refused BEFORE its body is parsed", async ({ request }) => {
    const oversized = { routines: { junk: "x".repeat(300 * 1024) } };
    const res = await request.put("/api/routines", {
      headers: { Origin: "http://evil.example" },
      data: oversized
    });

    expect(
      res.status(),
      "413 means express.json() parsed the body first — applySecurity must stay above it in server.js"
    ).toBe(403);
    expect((await res.json()).error).toContain("Cross-origin");
  });
});

// S5. The HA proxy mounts forward to HA with the bearer token attached, and
// Express strips the mount prefix before http-proxy-middleware sees the path —
// so before the pathFilter, everything below returned 200 with real HA data to
// any LAN caller. The contract is the BLOCK, which is deterministic whether or
// not this machine has HA configured: 404 when the proxy is mounted and the
// filter declines (falls through to Express), 503 when HA_HOST is unset.
test.describe("home assistant proxy path filter", () => {
  const ESCAPES = [
    "/api/image_proxy/api/",
    "/api/image_proxy/api/states",
    "/api/image_proxy/api/config",
    "/api/image_proxy/api/services/light/turn_on",
    "/api/camera_proxy/api/states",
    "/api/camera_proxy/api/config",
    // Traversal back out of an allowed prefix, percent-encoded so no client
    // normalises it away before the wire — HPM's own string filters are a bare
    // indexOf on an unnormalised path, which this would have satisfied.
    "/api/image_proxy/api/media_player_proxy/%2e%2e/%2e%2e/states"
  ];

  // "Did the filter decline?" is the real question, and status alone cannot
  // answer it — HA answers 404 itself for a path it does not serve, so 404 is
  // ambiguous. Express's fall-through 404 is an HTML error page; anything the
  // proxy forwarded carries HA's own (here bodiless) response. Discriminate on
  // that, not on the number.
  const EXPRESS_FALLTHROUGH = "<!DOCTYPE html>";

  for (const path of ESCAPES) {
    test(`GET ${path} never reaches Home Assistant`, async ({ request }) => {
      const res = await request.get(path);
      expect([404, 503], `${path} escaped the proxy filter`).toContain(res.status());
      const body = await res.text();
      // A 200 here would be HA's own JSON/config. Prove it is not.
      expect(body).not.toContain("entity_id");
      if (res.status() === 404) {
        expect(body, `${path} was forwarded rather than declined`).toContain(EXPRESS_FALLTHROUGH);
      }
    });
  }

  // Writes must not reach the proxy at all: express.json() has already drained
  // the body, so a forwarded POST left HA waiting on a body forever and the
  // socket hung open — a free way for a LAN client to pile up sockets.
  test("POST to an otherwise-allowed proxy path is refused, not hung", async ({ request }) => {
    const res = await request.post("/api/image_proxy/api/media_player_proxy/media_player.x", {
      data: {},
      timeout: 5000
    });
    expect([404, 503]).toContain(res.status());
  });

  // The one shape the dashboard genuinely needs (modules/mediaPanels.js prefixes
  // this mount onto a media_player's entity_picture) must still be routed.
  //
  // Routing is the assertion, never the upstream's answer. An earlier version of
  // this test asserted `status !== 404` and passed for the wrong reason: HA
  // replies 404 to a bogus signed token, so the test tracked whatever
  // media_player.piano_room happened to be doing that hour — a live-data
  // dependency of exactly the kind the file header forbids. It duly broke the
  // moment the entity stopped playing.
  test("a real media_player entity_picture path still proxies", async ({ request }) => {
    const res = await request.get(
      "/api/image_proxy/api/media_player_proxy/media_player.piano_room?token=probe",
      { timeout: 10_000 }
    );
    // 503 = HA unconfigured on this machine, which is the mount answering, not
    // Express. Otherwise: whatever HA said, as long as Express did not say it.
    if (res.status() !== 503) {
      expect(
        await res.text(),
        "the live media-art path was declined by the filter"
      ).not.toContain(EXPRESS_FALLTHROUGH);
    }
  });

  // ⚠ Regression guard for a request nobody ever answered. server.js supplies
  // its own `error` handler to the HA proxy, and doing so REPLACES
  // http-proxy-middleware's default responder — the thing that would otherwise
  // reply. It used to log and return, so an unreachable HA left the socket open
  // until the client gave up. A kiosk never gives up.
  //
  // The reason this is worth a test rather than a shrug: the browser allows six
  // connections per host, so hung requests accumulate against that pool and
  // starve unrelated fetches on the same origin. That is not theoretical — it
  // is exactly how the ambient-archive motion specs failed on 2026-08-05, where
  // two long-lived SSE streams stopped a <video> range request from ever being
  // served. HA lives on the NAS, and a sleeping NAS is a recurring condition.
  //
  // HA_HOST is pinned to a dead port in playwright.config.js, so this request is
  // guaranteed to reach the error handler rather than the house.
  test("an unreachable Home Assistant is ANSWERED, never left hanging", async ({ request }) => {
    const started = Date.now();
    const res = await request.get(
      "/api/image_proxy/api/media_player_proxy/media_player.piano_room?token=probe",
      { timeout: 5_000 }
    );
    expect([502, 503]).toContain(res.status());
    expect(
      Date.now() - started,
      "the proxy answered, but only after a delay that suggests it is waiting rather than refusing"
    ).toBeLessThan(5_000);
  });
});

test.describe("document root", () => {
  // Phase 5 removed the legacy static/index.html fallback — `/` must serve the
  // Vite-built document unconditionally. Guards against a broken build or a
  // regression that 404s the kiosk's entry point.
  //
  // Surface-agnostic on purpose: WHICH built document `/` serves is the V3
  // cutover flag's business (tests/root-surface.spec.js), and this test must
  // stay green in both states. Hence the case-insensitive doctype — Vite emits
  // `<!DOCTYPE html>` for the incumbent entry and `<!doctype html>` for V3's,
  // and a case-sensitive assertion here would have gone red on the flip for a
  // reason that has nothing to do with what it is guarding.
  test("GET / returns 200 and the built HTML document", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"] || "").toContain("text/html");
    const html = await res.text();
    expect(html).toMatch(/<!doctype html>/i);
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

    // Substrate causes: wind_bearing and cloud_pct must be PRESENT on every
    // path (Open-Meteo, the BOM fallback, and the 502 shape) because the schema
    // requires them and `additionalProperties: false` makes a mismatch a hard
    // validation failure rather than a missing field. Values may be null — the
    // V3 substrate reads null as "unknown" and disables drift rather than
    // inventing a direction.
    expect(body.now).toHaveProperty("wind_bearing");
    expect(body.now).toHaveProperty("cloud_pct");
    expect(["number", "object"]).toContain(typeof body.now.wind_bearing);
    expect(["number", "object"]).toContain(typeof body.now.cloud_pct);
    if (typeof body.now.wind_bearing === "number") {
      expect(body.now.wind_bearing).toBeGreaterThanOrEqual(0);
      expect(body.now.wind_bearing).toBeLessThanOrEqual(360);
    }
    if (typeof body.now.cloud_pct === "number") {
      expect(body.now.cloud_pct).toBeGreaterThanOrEqual(0);
      expect(body.now.cloud_pct).toBeLessThanOrEqual(100);
    }
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
    if (!body.configured) return;

    expect(typeof body.due).toBe("boolean");
    // HA is stubbed to a dead port under test, so this also proves the route
    // DEGRADES to the date-math rather than 500ing when the calendar is gone.
    expect(["calendar", "fallback"]).toContain(body.source);

    if (!body.due) return;
    expect(Array.isArray(body.bins)).toBe(true);
    expect(Array.isArray(body.words)).toBe(true);
    expect(body.bins.length).toBe(body.words.length);
    expect(typeof body.label).toBe("string");
    // The two windows are mutually exclusive by construction — a reminder is
    // either "the day before" or "last chance", never both.
    expect(body.eve && body.lastChance).toBe(false);
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
    const { status, body } = await expectJson(request, "/api/plex/sessions", { statuses: [200, 500, 502] });
    /* Contract, not live data — Plex may be off on any machine, and on this one
       it usually is. What must hold is that every session names WHERE it is
       playing (or honestly says null), because the wall now renders that as the
       eyebrow over the title. `player` missing entirely is the shape that put
       "Colin from Accounts" on the glass with no room attached. */
    if (status === 200 && Array.isArray(body.sessions)) {
      for (const s of body.sessions) {
        expect(s, "a session must carry a player field, even as null").toHaveProperty("player");
      }
    }
  });
});

/* ── The Plex session parser ────────────────────────────────────────────────
   Pure, and unreachable through the route on a box with no Plex — which is
   every box the suite runs on. The payload below is the real shape: `<Player>`
   is a CHILD of `<Video>`, which is exactly why the opening-tag scan this
   replaced could never see it.
─────────────────────────────────────────────────────────────────────────── */
test.describe("parsePlexSessions", () => {
  const XML = `<MediaContainer size="2">
    <Video ratingKey="1" title="2022-01-27" grandparentTitle="Colin from Accounts" type="episode" thumb="/library/metadata/1/thumb">
      <Media id="1" />
      <User id="1" title="greg" />
      <Player address="192.168.0.50" device="SHIELD" product="Plex for Android (TV)" title="Lounge Room TV" state="playing" />
    </Video>
    <Video ratingKey="2" title="Arrival" type="movie" thumb="/library/metadata/2/thumb">
      <Player address="192.168.0.51" device="iPhone" product="Plex for iOS" title="Brett's iPhone" state="playing" />
    </Video>
  </MediaContainer>`;

  test("each session gets the player NESTED INSIDE IT, never the next one's", async () => {
    const { parsePlexSessions } = await import("../server/routes/plex.js");
    const sessions = parsePlexSessions(XML);

    expect(sessions).toHaveLength(2);
    expect(sessions[0].grandparentTitle).toBe("Colin from Accounts");
    expect(sessions[0].player).toBe("Lounge Room TV");
    /* The attribution guard. A document-wide `<Player>` search would give both
       sessions the first player, and the wall would confidently name the wrong
       room — worse than naming none. */
    expect(sessions[1].player).toBe("Brett's iPhone");
  });

  test("XML entities are decoded — the wall showed `X-Men &#39;97`", async () => {
    /* ⚠ SEEN ON THE GLASS, 2026-08-13, in the ambient band. These are attribute
       values: the entities are XML encoding, not content. Every consumer renders
       with textContent — correctly, this is data — so an undecoded `&#39;` goes
       to the wall verbatim. */
    const { parsePlexSessions } = await import("../server/routes/plex.js");
    const [s] = parsePlexSessions(
      `<Video title="X-Men &#39;97" grandparentTitle="Law &amp; Order" thumb="/p?w=1&amp;h=2">
         <Player title="Brett&apos;s iPhone" />
       </Video>`
    );

    expect(s.title).toBe("X-Men '97");
    expect(s.grandparentTitle).toBe("Law & Order");
    expect(s.player).toBe("Brett's iPhone");
    // The thumb is a URL, and `&amp;` is how XML spells the separator. Left
    // encoded it would be requested as a literal "&amp;" and 404.
    expect(s.thumb).toBe("/p?w=1&h=2");
  });

  test("a double-escaped entity decodes once, not twice", async () => {
    // `&amp;lt;` is a literal "&lt;". Decoding the ampersand before the angle
    // brackets would invent a "<" that was never in the title.
    const { parsePlexSessions } = await import("../server/routes/plex.js");
    const [s] = parsePlexSessions(`<Video title="a &amp;lt; b" thumb="/t" />`);
    expect(s.title).toBe("a &lt; b");
  });

  test("a client with no friendly name falls back, and no player is null", async () => {
    const { parsePlexSessions } = await import("../server/routes/plex.js");

    const [noTitle] = parsePlexSessions(
      `<Video title="X" thumb="/t"><Player device="SHIELD" product="Plex for Android" /></Video>`
    );
    expect(noTitle.player).toBe("SHIELD");

    const [none] = parsePlexSessions(`<Video title="X" thumb="/t"><Media id="1" /></Video>`);
    expect(none.player).toBeNull();
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

// House knowledge base (docs/design/VAULT.md). Read-only: the vault's write path
// is Obsidian, so there is nothing to round-trip here. VAULT_ENABLED=1 is set by
// playwright.config.js; data/vault/ does not exist on a test machine, so this
// covers the COLD START — the same state the Pi is in before the vault is
// cloned, and the one that must degrade to empty rather than crash.
test.describe("vault (house knowledge base)", () => {
  test("GET /api/vault/status reports counts, never content", async ({ request }) => {
    const { body } = await expectJson(request, "/api/vault/status");
    expect(typeof body.notes).toBe("number");
    expect(body.notes).toBeGreaterThanOrEqual(0);
    // null before the first index pass, an ISO string after it — never absent.
    expect(body.indexedAt === null || typeof body.indexedAt === "string").toBe(true);
    // The status route is LAN-safe precisely because it leaks nothing.
    expect(body).not.toHaveProperty("body");
    expect(body).not.toHaveProperty("notesList");
  });

  test("GET /api/vault/search returns { query, notes: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/vault/search?q=tasmania");
    expect(body.query).toBe("tasmania");
    expect(Array.isArray(body.notes)).toBe(true);
    for (const n of body.notes) {
      expect(typeof n.id).toBe("string");
      expect(typeof n.title).toBe("string");
      expect(Array.isArray(n.tags)).toBe(true);
    }
  });

  // A 400 rather than a 403 is the assertion that matters: it proves the request
  // got PAST loopbackOnly and into the handler. The test client is itself
  // loopback, so the 403-from-LAN leg is proved live on the Pi, exactly as the
  // cost routes were (see the security middleware block above).
  test("GET /api/vault/search with no q is a JSON 400, not a 403", async ({ request }) => {
    const { body } = await expectJson(request, "/api/vault/search", { statuses: [400] });
    expect(body).toHaveProperty("error");
  });

  test("a query matching nothing is an empty list, not an error", async ({ request }) => {
    const { body } = await expectJson(request, "/api/vault/search?q=zzzznotathing");
    expect(body.notes).toEqual([]);
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

  // Live Photo motion parts (features.ambientArchiveMotion). The clip is
  // transcoded overnight to local disk; this route only ever serves a finished
  // file.
  test("GET /api/immich/asset/:id/clip rejects a non-UUID id with a JSON 400", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/asset/not-a-uuid/clip", { statuses: [400] });
    expect(body).toHaveProperty("error");
  });

  // ⚠ Note what is NOT in this status set: 502. /thumb above allows one because
  // it may fetch from Immich on a miss. /clip never reaches Immich at all — a
  // lazy fetch here would wake a sleeping Synology mid-rotation to serve a 3s
  // clip. That difference is the "never fetch on the render path" decision,
  // encoded as a contract rather than left as a comment.
  test("GET /api/immich/asset/:id/clip is video or 404 — never HTML, never 502", async ({ request }) => {
    const res = await request.get("/api/immich/asset/b55feb89-5cbd-4e94-a9eb-613fc351634b/clip");
    expect([200, 404]).toContain(res.status());
    const ct = res.headers()["content-type"] || "";
    expect(ct.startsWith("video/") || ct.includes("application/json")).toBe(true);
  });

  test("GET /api/immich/asset/:id/clip honours a Range request", async ({ request }) => {
    const res = await request.get("/api/immich/asset/b55feb89-5cbd-4e94-a9eb-613fc351634b/clip", {
      headers: { Range: "bytes=0-99" }
    });
    expect([206, 404, 416]).toContain(res.status());
    if (res.status() === 206) expect(res.headers()["content-range"]).toBeTruthy();
  });

  // Daily Memories — the frozen per-day set. With no Immich configured it degrades
  // to { date, photos: [] } (the client then falls back to the random blend).
  test("GET /api/immich/daily-set returns { date, photos: array }", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/daily-set");
    expect(typeof body.date).toBe("string");
    expect(Array.isArray(body.photos)).toBe(true);
  });

  // The internal/public split. `motionId` is what the overnight transcoder reads
  // off the frozen set on disk; the browser gets `motion`, a boolean that means
  // "a playable clip is on local disk right now" — a stat(), not a claim Immich
  // made. Every failure (NAS asleep, HEVC source, no ffmpeg, encode failed,
  // clip pruned) collapses into false, so the client cannot request a 404.
  test("GET /api/immich/daily-set never leaks the internal motion id", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/daily-set");
    for (const p of body.photos) {
      expect(p).not.toHaveProperty("motionId");
      if ("motion" in p) expect(typeof p.motion).toBe("boolean");
    }
  });

  // The other half of that boolean. `motion: false` alone cannot tell the client
  // whether a clip is coming or was never going to exist — and the one response
  // that seeds the client's day-stable pool is the response that BUILDS the day's
  // set, which is guaranteed to precede its own transcode. `motionPending` is
  // what makes asking again worthwhile, so the two must never both be true:
  // a clip that is on disk is not pending.
  test("GET /api/immich/daily-set marks an unfinished clip pending, never a finished one", async ({ request }) => {
    const { body } = await expectJson(request, "/api/immich/daily-set");
    for (const p of body.photos) {
      expect(typeof p.motionPending).toBe("boolean");
      if (p.motion === true) expect(p.motionPending).toBe(false);
    }
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

  // M2 converted the cache read from existsSync + readFileSync to a single
  // async readFile. This pins the behaviour that conversion had to preserve:
  // a hit is served verbatim, from disk, with no upstream involved (KOKORO_URL
  // is stubbed unreachable, so a miss here could not return audio at all).
  test("POST /api/tts/speak serves a cache hit from disk", async ({ request }) => {
    const text = `cache hit contract probe ${Date.now()}`;
    const speed = 1.25;
    const key = createHash("sha256").update(`${text}::${speed}`).digest("hex");
    const cacheDir = path.join(REPO_ROOT, "server", "tts-cache");
    const cachePath = path.join(cacheDir, `${key}.wav`);
    // Not real audio — the route is a byte pipe and never parses the WAV.
    const payload = Buffer.from("RIFF....WAVEfmt cache-hit-probe");

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, payload);
    try {
      const res = await request.post("/api/tts/speak", { data: { text, rate: speed } });
      expect(res.status()).toBe(200);
      expect(res.headers()["content-type"]).toContain("audio/wav");
      expect(Buffer.from(await res.body()).equals(payload)).toBe(true);
    } finally {
      await rm(cachePath, { force: true });
    }
  });

  test("a cache hit refreshes the entry's mtime, so eviction is least-recently-USED", async ({ request }) => {
    // The prune evicts on age, and mtime only moves on WRITE. Without a touch
    // on read, the doorbell lines — pre-warmed once at boot and thereafter only
    // ever read — were deleted on day 15 no matter how often they rang, and a
    // kiosk up longer than a fortnight then waited ~10-17s on live synthesis
    // at the front door. This asserts the touch actually happens.
    const text = `mtime refresh probe ${Date.now()}`;
    const speed = 1.25;
    const key = createHash("sha256").update(`${text}::${speed}`).digest("hex");
    const cacheDir = path.join(REPO_ROOT, "server", "tts-cache");
    const cachePath = path.join(cacheDir, `${key}.wav`);
    const payload = Buffer.from("RIFF....WAVEfmt mtime-probe");

    await mkdir(cacheDir, { recursive: true });
    await writeFile(cachePath, payload);

    // Age the entry to 20 days — comfortably past the 14-day ceiling.
    const stale = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
    await utimes(cachePath, stale, stale);
    const before = (await stat(cachePath)).mtimeMs;

    try {
      const res = await request.post("/api/tts/speak", { data: { text, rate: speed } });
      expect(res.status()).toBe(200);

      // The touch is fire-and-forget so the reply never waits on it.
      await expect
        .poll(async () => (await stat(cachePath)).mtimeMs, { timeout: 5000 })
        .toBeGreaterThan(before);

      const after = (await stat(cachePath)).mtimeMs;
      expect(Date.now() - after, "entry is still older than the 14-day ceiling").toBeLessThan(60_000);
    } finally {
      await rm(cachePath, { force: true });
    }
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

  // Also the flag-off contract for the tool lane (VOICE_TOOLS_ENABLED unset here):
  // no `tools` key is sent and the shape is unchanged. The loop itself cannot be
  // covered from this suite — ANTHROPIC_API_KEY is stubbed to "" in
  // playwright.config.js, so the Claude leg never runs. What decides whether a
  // tool call is ALLOWED is pure and covered in tests/voice-tools.spec.js instead.
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

  // Microphone LEVEL, not audio — the guardrail is unchanged: no audio ever
  // reaches this server. The level feeds the listening light so the rim
  // responds to the real room rather than to a timer.
  test("POST /api/voice/level accepts an rms frame and answers 204 with no body", async ({ request }) => {
    const res = await request.post("/api/voice/level", { data: { rms: 1840 } });
    // 204 deliberately: this is a ~12.5Hz hot path, so it returns no body at all.
    expect(res.status()).toBe(204);
    expect((await res.body()).length).toBe(0);
  });

  test("POST /api/voice/level rejects a missing or nonsense rms", async ({ request }) => {
    for (const data of [{}, { rms: "loud" }, { rms: -1 }, { rms: null }]) {
      const res = await request.post("/api/voice/level", { data });
      expect(res.status(), `accepted junk: ${JSON.stringify(data)}`).toBe(400);
      expect(await res.json()).toHaveProperty("error");
    }
  });

  test("a level frame reaches /api/voice/stream as a voice_level event", async ({ request }) => {
    // Prove the fan-out END TO END. A client listening for an event nothing
    // emits is precisely the silent no-op this route exists to fix, and only a
    // real subscriber can show the frame actually arrives.
    //
    // Raw node http rather than the request fixture: an SSE response never
    // ends, so awaiting its body simply times out.
    const http = await import("node:http");
    let posted;
    const received = await new Promise((resolve, reject) => {
      const req = http.get("http://127.0.0.1:3210/api/voice/stream", (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.includes("event: voice_level")) {
            req.destroy();
            resolve(buf);
          }
        });
      });
      req.on("error", (err) => { if (err.code !== "ECONNRESET") reject(err); });
      setTimeout(() => { req.destroy(); resolve(buf_fallback()); }, 6000);
      function buf_fallback() { return "TIMEOUT"; }
      // Post once the subscriber is definitely attached.
      setTimeout(() => { posted = request.post("/api/voice/level", { data: { rms: 2222 } }); }, 500);
    });

    await settle(posted);

    expect(received, "no voice_level frame reached the SSE subscriber").not.toBe("TIMEOUT");
    expect(received).toContain("event: voice_level");
    expect(received).toContain('"rms":2222');
  });

  /* ── Half duplex ─────────────────────────────────────────────────────────
     The kiosk's mic hears its own speakers. On 2026-08-08 the wake agent
     transcribed the dashboard's replies back into this very pipeline and the
     house answered itself. Two facts have to cross the wire for that to stop:
     the page saying "I am talking", and the agent saying "stop talking".     */

  test("POST /api/voice/speaking rejects anything that is not a boolean", async ({ request }) => {
    // Truthiness would be a disaster here: "false" and 0 are both things a
    // caller sends by accident, and either one silently inverts the gate —
    // muting the microphone for good, or never gating it at all.
    for (const data of [{}, { speaking: "true" }, { speaking: 1 }, { speaking: null }]) {
      const res = await request.post("/api/voice/speaking", { data });
      expect(res.status(), `${JSON.stringify(data)} was accepted`).toBe(400);
      expect((await res.json()).error).toBeTruthy();
    }
  });

  test("POST /api/voice/speaking accepts a boolean and answers 204 with no body", async ({ request }) => {
    for (const speaking of [true, false]) {
      const res = await request.post("/api/voice/speaking", { data: { speaking } });
      expect(res.status()).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  test("POST /api/voice/barge-in is accepted from loopback", async ({ request }) => {
    const { status, body } = await expectJson(request, "/api/voice/barge-in", { method: "post", data: {} });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  test("the agent stream states the CURRENT speaking state on connect", async ({ request }) => {
    // The agent reconnects after every deploy. A subscriber that learns
    // nothing until the next CHANGE sits on a stale default through whatever
    // is already playing as it connects — which is the exact window the fix
    // exists to cover.
    await request.post("/api/voice/speaking", { data: { speaking: true } });
    const http = await import("node:http");
    const received = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:3210/api/voice/stream?agent=1", (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.includes("event: voice_speaking")) { req.destroy(); resolve(buf); }
        });
      });
      req.on("error", () => resolve("TIMEOUT"));
      setTimeout(() => { req.destroy(); resolve("TIMEOUT"); }, 6000);
    });
    await request.post("/api/voice/speaking", { data: { speaking: false } }); // leave it clear

    expect(received, "the agent stream said nothing on connect").not.toBe("TIMEOUT");
    expect(received).toContain("event: voice_speaking");
    expect(received).toContain('"speaking":true');
  });

  test("the agent stream carries speaking and NOT the level firehose", async ({ request }) => {
    // ~12.5 level frames a second, pushed at the process that generated them.
    // Harmless-looking, and the reason this route takes a flavour at all.
    const http = await import("node:http");
    let posted;
    const received = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:3210/api/voice/stream?agent=1", (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.includes('"speaking":true')) { req.destroy(); resolve(buf); }
        });
      });
      req.on("error", () => resolve("TIMEOUT"));
      setTimeout(() => { req.destroy(); resolve("TIMEOUT"); }, 6000);
      setTimeout(() => {
        posted = (async () => {
          await request.post("/api/voice/level", { data: { rms: 3333 } });
          await request.post("/api/voice/transcript", { data: { text: "agent stream isolation" } });
          await request.post("/api/voice/speaking", { data: { speaking: true } });
        })();
      }, 500);
    });
    await settle(posted);
    await request.post("/api/voice/speaking", { data: { speaking: false } });

    expect(received, "the agent never saw the speaking change").not.toBe("TIMEOUT");
    expect(received).toContain('"speaking":true');
    expect(received, "the level firehose leaked onto the agent stream").not.toContain("voice_level");
    expect(received, "transcripts leaked onto the agent stream").not.toContain("voice_transcript");
  });

  test("a barge-in reaches the KIOSK stream, which is what silences the page", async ({ request }) => {
    const http = await import("node:http");
    let posted;
    const received = await new Promise((resolve) => {
      const req = http.get("http://127.0.0.1:3210/api/voice/stream", (res) => {
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          if (buf.includes("event: voice_barge_in")) { req.destroy(); resolve(buf); }
        });
      });
      req.on("error", () => resolve("TIMEOUT"));
      setTimeout(() => { req.destroy(); resolve("TIMEOUT"); }, 6000);
      setTimeout(() => { posted = request.post("/api/voice/barge-in", { data: {} }); }, 500);
    });
    await settle(posted);

    expect(received, "no voice_barge_in frame reached the kiosk").not.toBe("TIMEOUT");
    expect(received).toContain("event: voice_barge_in");
  });
});


/**
 * isScreenshot — keeping screenshots off the ambient substrate.
 *
 * A screenshot is not a photograph, and on the living window it wrecks the
 * premise: the live rotation served a car-configurator web page, browser chrome
 * and cursor included, as Mode-0 wallpaper.
 *
 * The cases below are real assets from the household library, and the
 * false-positive ones matter far more than the true positives. An earlier rule
 * ("PNG with no camera EXIF make") looked exact on a 621-image random sample —
 * 9/9 true screenshots — and was still wrong: over a fixed date window it
 * dropped a 360-degree panorama of a park and a photo of the dog on the grass.
 * Both are PNGs with no EXIF at all, so no camera-detail field can rescue them.
 * Hence the pixel-exact device-panel rule, and hence these tests.
 */
test.describe("isScreenshot — ambient pool curation", () => {
  const png = (w, h, make) => ({
    originalMimeType: "image/png",
    exifInfo: { exifImageWidth: w, exifImageHeight: h, ...(make ? { make } : {}) }
  });

  test("drops pixel-exact device screenshots", () => {
    expect(isScreenshot(png(1170, 2532))).toBe(true); // iPhone 12/13, x17 in the library
    expect(isScreenshot(png(1024, 768))).toBe(true);  // iPad, x24
    expect(isScreenshot(png(1668, 2388))).toBe(true); // iPad Pro 11
    expect(isScreenshot(png(2048, 1536))).toBe(true); // iPad retina, landscape
  });

  test("matches either orientation", () => {
    expect(isScreenshot(png(2532, 1170))).toBe(true);
    expect(isScreenshot(png(768, 1024))).toBe(true);
  });

  /**
   * The regressions that made this rule what it is. Both were dropped by the
   * previous "PNG + no make" rule and are genuine memories.
   */
  test("KEEPS the 360 panorama and the dog — the two real false positives", () => {
    expect(isScreenshot(png(4096, 2048))).toBe(false); // equirectangular park panorama
    expect(isScreenshot(png(540, 540))).toBe(false);   // border collie on the grass
  });

  test("keeps EXIF-stripped photographs at non-panel sizes", () => {
    // 58 of these in the sample: forwarded and resized family pictures.
    expect(isScreenshot(png(3024, 4032))).toBe(false);
    expect(isScreenshot(png(619, 907))).toBe(false);
    expect(isScreenshot(png(2645, 1617))).toBe(false);
  });

  test("keeps a PNG that carries camera EXIF even at a panel size", () => {
    expect(isScreenshot(png(1170, 2532, "Apple"))).toBe(false);
  });

  test("keeps non-PNG assets regardless of size", () => {
    expect(isScreenshot({ originalMimeType: "image/jpeg", exifInfo: { exifImageWidth: 1024, exifImageHeight: 768 } })).toBe(false);
    expect(isScreenshot({ originalMimeType: "image/heic", exifInfo: { exifImageWidth: 1170, exifImageHeight: 2532 } })).toBe(false);
  });

  test("never drops on missing information", () => {
    // No dimensions (searchRandom omits withExif) → inert, never a guess.
    expect(isScreenshot({ originalMimeType: "image/png", exifInfo: {} })).toBe(false);
    expect(isScreenshot({ originalMimeType: "image/png" })).toBe(false);
    expect(isScreenshot({})).toBe(false);
    expect(isScreenshot(null)).toBe(false);
    expect(isScreenshot(undefined)).toBe(false);
  });
});
