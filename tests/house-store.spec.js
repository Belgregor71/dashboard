import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { TEST_ORIGIN } from "../playwright.config.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S2 — the observation store (docs/design/HOUSE-MIND.md §5).

   Three layers, each asserted where its claim lives:
     1. The store itself, against a fixture HTTP server, so "read ONCE however
        many listen", "lazy" and "last good value wins" are counted, not assumed.
     2. The two routes' contracts, against the real test server.
     3. The page, in both flag states, where the claim is about the READING a
        consumer holds — not about the wire. A push that arrives and is never
        applied must fail here, so every assertion reads the consumer's cache.

   The browser specs use two different weather labels on purpose: the store
   says "Fixture Drizzle", the direct route says "Fixture Sun". Whichever a
   consumer holds names which path fed it — so "it came from the store" is a
   text assertion, never a count.
   ═══════════════════════════════════════════════════════════════════════════ */

const KEYS = ["weather", "forecast", "nowcast", "calendar", "commute", "bins", "plex"];

test.describe("the store — read once, lazily, last good value wins", () => {
  test("lazy, one read per source for two subscribers, a failure keeps the last good value", async () => {
    const http = await import("node:http");
    const hits = {};
    const bodies = Object.fromEntries(KEYS.map((k) => [k, { fixture: k, n: 1 }]));
    const failing = new Set();
    const paths = {
      "/api/weather/now": "weather", "/api/weather/forecast": "forecast",
      "/api/weather/nowcast": "nowcast", "/api/calendar/all": "calendar",
      "/api/commute/all": "commute", "/api/bins": "bins", "/api/plex/sessions": "plex"
    };
    const server = http.createServer((req, res) => {
      const key = paths[req.url];
      hits[req.url] = (hits[req.url] ?? 0) + 1;
      if (!key || failing.has(key)) {
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end("{}");
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(bodies[key]));
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const savedPort = process.env.PORT;
    process.env.PORT = String(server.address().port);

    const store = await import("../server/services/houseStore.js");
    const heardA = [];
    const heardB = [];
    try {
      // The fixture serves exactly the store's declared sources, no more.
      expect(store.SOURCES.map((s) => s.key)).toEqual(KEYS);

      // LAZY: imported and waited on, nothing has been read.
      await new Promise((r) => setTimeout(r, 300));
      expect(Object.keys(hits)).toEqual([]);
      expect(store.storeStatus().polling).toBe(false);

      // Two subscribers, one read per source.
      const offA = store.subscribe((key, entry) => heardA.push([key, entry.value]));
      const offB = store.subscribe((key, entry) => heardB.push([key, entry.value]));
      await expect.poll(() => Object.keys(store.snapshot()).sort()).toEqual([...KEYS].sort());
      for (const path of Object.keys(paths)) expect(hits[path], path).toBe(1);
      expect(heardA.map(([k]) => k).sort()).toEqual([...KEYS].sort());
      expect(heardB.map(([k]) => k).sort()).toEqual([...KEYS].sort());
      expect(store.snapshot().weather.value).toEqual({ fixture: "weather", n: 1 });

      // A FAILED read leaves the last good value standing and pushes nothing.
      const weather = store.SOURCES.find((s) => s.key === "weather");
      failing.add("weather");
      const before = heardA.length;
      await store.readSource(weather);
      expect(store.snapshot().weather.value).toEqual({ fixture: "weather", n: 1 });
      expect(heardA.length).toBe(before);
      const st = store.storeStatus().sources.find((s) => s.key === "weather");
      expect(st.failures).toBe(1);
      expect(st.lastError).toContain("500");

      // A good read replaces it and is pushed to both.
      failing.delete("weather");
      bodies.weather = { fixture: "weather", n: 2 };
      await store.readSource(weather);
      expect(store.snapshot().weather.value).toEqual({ fixture: "weather", n: 2 });
      expect(heardA.at(-1)).toEqual(["weather", { fixture: "weather", n: 2 }]);
      expect(heardB.at(-1)).toEqual(["weather", { fixture: "weather", n: 2 }]);

      // The last one out stops the polling; the first one out does not.
      offA();
      expect(store.storeStatus().polling).toBe(true);
      offB();
      expect(store.storeStatus()).toMatchObject({ subscribers: 0, polling: false });

      // A reconnect inside the cadence re-reads nothing: the values are fresh.
      const hitsBefore = { ...hits };
      const offC = store.subscribe(() => {});
      await new Promise((r) => setTimeout(r, 300));
      offC();
      expect(hits).toEqual(hitsBefore);
    } finally {
      if (savedPort === undefined) delete process.env.PORT;
      else process.env.PORT = savedPort;
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

/* The route's close handler, against a PRIVATE app. The suite's test server is
   shared with every V3 page in other specs, so a subscriber count read there
   can never isolate one connection. Here the worker's own store instance has no
   other subscriber, so "back to zero" means THIS socket was released — the leak
   that would otherwise grow by one per kiosk reconnect for weeks. */
test.describe("the route — a closed stream releases its subscriber", () => {
  test("open two, close both: the store is back to no subscribers and no polling", async () => {
    const http = await import("node:http");
    const express = (await import("express")).default;
    const router = (await import("../server/routes/houseStream.js")).default;
    const store = await import("../server/services/houseStore.js");
    const savedPort = process.env.PORT;
    process.env.PORT = "1"; // reads fail fast; this test is about sockets, not data
    const app = express();
    app.use(router);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const open = () => new Promise((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${server.address().port}/api/house/stream`, (res) => {
        res.once("data", () => resolve(req)); // the snapshot frame: subscribed
      });
      req.on("error", (err) => { if (err.code !== "ECONNRESET") reject(err); });
    });
    try {
      expect(store.storeStatus().subscribers).toBe(0);
      const a = await open();
      const b = await open();
      expect(store.storeStatus()).toMatchObject({ subscribers: 2, polling: true });
      a.destroy();
      await expect.poll(() => store.storeStatus().subscribers).toBe(1);
      expect(store.storeStatus().polling).toBe(true);
      b.destroy();
      await expect.poll(() => store.storeStatus()).toMatchObject({ subscribers: 0, polling: false });
    } finally {
      if (savedPort === undefined) delete process.env.PORT;
      else process.env.PORT = savedPort;
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});

test.describe("contract — /api/house/store and /api/house/stream", () => {
  test("store status: the seven sources, no values", async ({ request }) => {
    const res = await request.get("/api/house/store");
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.subscribers).toBe("number");
    expect(typeof body.polling).toBe("boolean");
    expect(body.sources.map((s) => s.key)).toEqual(KEYS);
    for (const s of body.sources) {
      expect(s.path).toMatch(/^\/api\//);
      expect(s.everyMs).toBe(300_000);
      expect(typeof s.reads).toBe("number");
      expect(typeof s.held).toBe("boolean");
      expect(s).not.toHaveProperty("value");
    }
  });

  /* ⚠ THE STORE IS PROCESS-WIDE, and the suite shares one test server. Once any
     v3HouseStore* flag is default-on, V3 pages in other specs subscribe to it,
     so this test can meet a WARM store: `bins` already held and fresh, sent in
     the opening snapshot, with no new read due for five minutes. Measured at the
     v3HouseStoreField flip (2026-09-23): the first version waited for a
     `house_obs` only and timed out holding a snapshot that already had the
     answer. So the relayed value is accepted from WHICHEVER frame carries it,
     and nothing here asserts a global subscriber count — "last one out stops
     polling" is proven against a private fixture server in the store test. */
  test("stream: held snapshot first, and the relayed value equals the route's own answer", async ({ request }) => {
    // Raw node http: an SSE response never ends, so the request fixture would
    // time out awaiting its body. /api/bins answers 200 on any machine
    // (`configured:false` when unset), so it is the relay's positive control.
    const http = await import("node:http");
    let contentType = null;
    const frames = [];
    const binsFrom = (frame) =>
      frame.event === "house_snapshot" ? frame.data?.bins
        : frame.event === "house_obs" && frame.data?.key === "bins" ? { value: frame.data.value, at: frame.data.at }
          : undefined;
    const timedOut = await new Promise((resolve, reject) => {
      let buf = "";
      const req = http.get(`${TEST_ORIGIN}/api/house/stream`, (res) => {
        contentType = res.headers["content-type"];
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          let cut;
          while ((cut = buf.indexOf("\n\n")) !== -1) {
            const block = buf.slice(0, cut);
            buf = buf.slice(cut + 2);
            const event = /^event: (.+)$/m.exec(block)?.[1];
            const data = /^data: (.+)$/m.exec(block)?.[1];
            if (event && data) frames.push({ event, data: JSON.parse(data) });
          }
          if (frames.some(binsFrom)) {
            req.destroy();
            resolve(false);
          }
        });
      });
      req.on("error", (err) => { if (err.code !== "ECONNRESET") reject(err); });
      setTimeout(() => { req.destroy(); resolve(true); }, 20_000);
    });

    expect(contentType).toContain("text/event-stream");
    expect(timedOut, JSON.stringify(frames).slice(0, 400)).toBe(false);
    // The held state comes first, before any delta — warm store or cold.
    expect(frames[0]?.event).toBe("house_snapshot");

    const bins = frames.map(binsFrom).find(Boolean);
    expect(Number.isFinite(bins.at)).toBe(true);
    const direct = await (await request.get("/api/bins")).json();
    expect(bins.value).toEqual(direct);
  });
});

/* ── The page ───────────────────────────────────────────────────────────── */

const SUN = { now: { condition: { label: "Fixture Sun" }, temp_c: 21 } };
const DRIZZLE = { now: { condition: { label: "Fixture Drizzle" }, temp_c: 14 } };

/* Only WEATHER is held by this store, so a consumer must still fetch the keys
   the store did not deliver — the fallback is per key, not per consumer. */
function streamBody() {
  const held = { weather: { value: DRIZZLE, at: Date.now() } };
  return `retry: 600000\n\nevent: house_snapshot\ndata: ${JSON.stringify(held)}\n\n`;
}

const STREAM = { __fulfill: { status: 200, contentType: "text/event-stream", body: streamBody() } };
const ALL_ON = { v3HouseStoreGlance: true, v3HouseStoreVoice: true, v3HouseStoreField: true };
const CAL_OFF = { v3HouseStoreBriefing: false, v3HouseStoreIntent: false, v3HouseStorePersonality: false };
const ALL_OFF = { v3HouseStoreGlance: false, v3HouseStoreVoice: false, v3HouseStoreField: false, ...CAL_OFF };

function countRequests(page) {
  const seen = [];
  page.on("request", (req) => seen.push(new URL(req.url()).pathname));
  return (path) => seen.filter((p) => p === path).length;
}

async function boot(page, features, stream = STREAM) {
  const count = countRequests(page);
  const { pageErrors } = await bootV3(page, {
    "/api/house/stream": stream,
    "/api/weather/now": SUN,
    "/api/fuel": { stations: [] }
  }, { features });
  await page.waitForFunction(() => typeof window.__v3HouseReadings === "function");
  return { pageErrors, count };
}

const readings = (page) => page.evaluate(() => window.__v3HouseReadings());

test.describe("v3HouseStore* — the consumers hold the store's reading", () => {
  test("ON: all three hold the store's reading, and a refresh skips only what it holds", async ({ page }) => {
    const { pageErrors, count } = await boot(page, ALL_ON);

    await expect.poll(() => readings(page), { timeout: 10_000 })
      .toEqual({ glance: "Fixture Drizzle", voice: "Fixture Drizzle", field: "Fixture Drizzle" });
    expect(await page.evaluate(() => window.__v3().houseStream.started)).toBe(true);

    const weatherBefore = count("/api/weather/now");
    const calendarBefore = count("/api/calendar/all");
    const fuelBefore = count("/api/fuel");
    await page.evaluate(() => window.__v3Refresh());

    // The refresh ran (fuel is never in the store) and fetched the key the
    // store did not deliver — but not the one it did.
    expect(count("/api/fuel")).toBeGreaterThan(fuelBefore);
    expect(count("/api/calendar/all")).toBeGreaterThan(calendarBefore);
    expect(count("/api/weather/now")).toBe(weatherBefore);
    // And the fresh store value is still what everyone holds.
    expect(await readings(page)).toEqual({ glance: "Fixture Drizzle", voice: "Fixture Drizzle", field: "Fixture Drizzle" });
    expect(pageErrors).toEqual([]);
  });

  test("OFF: no stream is opened and every consumer fetches — the flags are the rollback", async ({ page }) => {
    const { pageErrors, count } = await boot(page, ALL_OFF);

    await expect.poll(() => readings(page), { timeout: 10_000 })
      .toEqual({ glance: "Fixture Sun", voice: "Fixture Sun", field: "Fixture Sun" });
    await page.waitForTimeout(500);
    expect(count("/api/house/stream")).toBe(0);
    expect(await page.evaluate(() => window.__v3().houseStream.started)).toBe(false);

    const before = count("/api/weather/now");
    await page.evaluate(() => window.__v3Refresh());
    // Two consumers (glance, voice) each fetch their own weather on refresh.
    expect(count("/api/weather/now")).toBe(before + 2);
    expect(pageErrors).toEqual([]);
  });

  test("ON with the stream down: each consumer falls back to its own fetch", async ({ page }) => {
    const { pageErrors, count } = await boot(page, ALL_ON, null);

    await expect.poll(() => readings(page), { timeout: 10_000 })
      .toEqual({ glance: "Fixture Sun", voice: "Fixture Sun", field: "Fixture Sun" });
    expect(count("/api/house/stream")).toBeGreaterThan(0);

    const before = count("/api/weather/now");
    await page.evaluate(() => window.__v3Refresh());
    expect(count("/api/weather/now")).toBe(before + 2);
    expect(pageErrors).toEqual([]);
  });

  /* Each flag is its OWN lever: one on moves exactly one consumer. A shared
     gate (all three reading one flag) would pass the all-on test above and
     fail here. */
  for (const [flagName, moved] of [
    ["v3HouseStoreGlance", "glance"],
    ["v3HouseStoreVoice", "voice"],
    ["v3HouseStoreField", "field"]
  ]) {
    test(`ONLY ${flagName}: the ${moved} holds the store's reading, the others their own`, async ({ page }) => {
      const { pageErrors } = await boot(page, { ...ALL_OFF, [flagName]: true });
      const expected = { glance: "Fixture Sun", voice: "Fixture Sun", field: "Fixture Sun", [moved]: "Fixture Drizzle" };

      await expect.poll(() => readings(page), { timeout: 10_000 }).toEqual(expected);
      // Held, not passed through: still true after the others have settled.
      await page.waitForTimeout(500);
      expect(await readings(page)).toEqual(expected);
      expect(pageErrors).toEqual([]);
    });
  }
});

/* ── The calendar consumers: briefingData, intentEngine, personalityRuntime ──
   Same method as above, on the CALENDAR: the store's today holds "Storey's
   birthday" and two events still to come; the route's holds "Routey's
   birthday" and one. Whichever a consumer made its reading from is named by
   the text (and, for intent, the count) — never by the wire alone.

   The events still to come sit at 23:59 today: always later than now, always
   today, except inside the last minute of the day. */
function calendarFixture(name, upcoming) {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const late = (s) => { const d = new Date(); d.setHours(23, 59, s, 0); return d.toISOString(); };
  return {
    events: [
      { title: `${name}'s birthday`, start: midnight.toISOString() },
      ...Array.from({ length: upcoming }, (_, i) => ({ title: `${name} errand ${i + 1}`, start: late(i * 10) }))
    ]
  };
}

const STORE_CAL = calendarFixture("Storey", 2);
const ROUTE_CAL = calendarFixture("Routey", 1);
const FORECAST = { days: [] };
const BINS = { configured: false };
const NOWCAST = { nowcast: null };

function calStreamBody() {
  const at = Date.now();
  const held = {
    weather: { value: DRIZZLE, at },
    calendar: { value: STORE_CAL, at },
    forecast: { value: FORECAST, at },
    bins: { value: BINS, at },
    nowcast: { value: NOWCAST, at }
  };
  return `retry: 600000\n\nevent: house_snapshot\ndata: ${JSON.stringify(held)}\n\n`;
}

const CAL_STREAM = { __fulfill: { status: 200, contentType: "text/event-stream", body: calStreamBody() } };
const CAL_ON = { v3HouseStoreBriefing: true, v3HouseStoreIntent: true, v3HouseStorePersonality: true };
/* The three that moved first stay OFF here, so each of THESE flags is the only
   reason a calendar read comes off the store. */
const OLD_OFF = { v3HouseStoreGlance: false, v3HouseStoreVoice: false, v3HouseStoreField: false };

const FROM_STORE = {
  briefing: { from: "store", first: "Storey's birthday" },
  intent: { from: "store", events: 2 },
  personality: { from: "store", birthday: "Storey" }
};
const FROM_ROUTE = {
  briefing: { from: "fetch", first: "Routey's birthday" },
  intent: { from: "fetch", events: 1 },
  personality: { from: "fetch", birthday: "Routey" }
};

async function bootCal(page, features, { stream = CAL_STREAM, calendar = ROUTE_CAL } = {}) {
  const count = countRequests(page);
  const { pageErrors } = await bootV3(page, {
    "/api/house/stream": stream,
    "/api/weather/now": SUN,
    "/api/weather/forecast": FORECAST,
    "/api/weather/nowcast": NOWCAST,
    "/api/calendar/all": calendar,
    "/api/bins": BINS,
    "/api/fuel": { stations: [] }
  }, { features: { ...OLD_OFF, ...features } });
  await page.waitForFunction(() => typeof window.__v3HouseCalendar === "function"
    && typeof window.__intent === "function" && typeof window.__personality === "function");
  return { pageErrors, count };
}

/* Drops the briefing's 5-min context cache first (the probe's documented side
   effect), so every read is a fresh gather rather than the last one replayed. */
const calReadings = (page) => page.evaluate(async () => {
  window.__nowcastProbe(null);
  const r = await window.__v3HouseCalendar();
  return {
    briefing: { from: r.briefing.from, first: r.briefing.today[0] ?? null },
    intent: { from: r.intent.from, events: r.intent.events },
    personality: { from: r.personality.from, birthday: r.personality.birthday }
  };
});

test.describe("v3HouseStore{Briefing,Intent,Personality} — the calendar consumers hold the store's reading", () => {
  test("ON: all three hold the store's calendar, and a fresh gather fetches none of the store's keys", async ({ page }) => {
    const { pageErrors, count } = await bootCal(page, CAL_ON);

    await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(FROM_STORE);
    expect(await page.evaluate(() => window.__v3().houseStream.started)).toBe(true);

    const before = Object.fromEntries(
      ["/api/calendar/all", "/api/weather/forecast", "/api/bins", "/api/weather/nowcast", "/api/fuel"].map((p) => [p, count(p)])
    );
    expect(await calReadings(page)).toEqual(FROM_STORE);

    // The gather ran (fuel is never in the store) and fetched nothing the store holds.
    expect(count("/api/fuel")).toBeGreaterThan(before["/api/fuel"]);
    expect(count("/api/calendar/all")).toBe(before["/api/calendar/all"]);
    expect(count("/api/weather/forecast")).toBe(before["/api/weather/forecast"]);
    expect(count("/api/bins")).toBe(before["/api/bins"]);
    expect(count("/api/weather/nowcast")).toBe(before["/api/weather/nowcast"]);

    /* The intent (5-min) and personality (6-h) refreshes skip while the store
       is fresh. Their BOOT reads always precede the stream, so only a refresh
       can show the skip — a boot-only assertion is green with it deleted. */
    const calBefore = count("/api/calendar/all");
    await page.evaluate(() => Promise.all([window.__intentRefreshCalendar(), window.__personalityRefreshCalendar()]));
    expect(count("/api/calendar/all")).toBe(calBefore);
    expect(await calReadings(page)).toEqual(FROM_STORE);
    expect(pageErrors).toEqual([]);
  });

  /* OFF counterpart of the skip above: the same refreshes DO fetch, or the
     count assertion there could be passing because the hooks do nothing. */
  test("OFF: the intent and personality refreshes fetch for themselves", async ({ page }) => {
    const { pageErrors, count } = await bootCal(page, CAL_OFF);
    await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(FROM_ROUTE);

    const calBefore = count("/api/calendar/all");
    await page.evaluate(() => Promise.all([window.__intentRefreshCalendar(), window.__personalityRefreshCalendar()]));
    expect(count("/api/calendar/all")).toBe(calBefore + 2);
    expect(pageErrors).toEqual([]);
  });

  /* The briefing is PULLED, so its drop-late case is a gather already in
     flight when the store's first push lands: the stream is held back 2.5 s,
     the calendar route 4.5 s, and a gather started at once must still come back
     holding the store's calendar, not the route's late answer. */
  test("ON: a briefing gather in flight when the store delivers returns the store's reading", async ({ page }) => {
    const { pageErrors } = await bootCal(page, CAL_ON, {
      stream: { ...CAL_STREAM, __delayMs: 2_500 },
      calendar: { __delayMs: 4_500, __body: ROUTE_CAL }
    });

    const first = await page.evaluate(async () => {
      window.__nowcastProbe(null);
      const fresh = window.__v3().houseStream.keys.calendar == null;
      const r = await window.__v3HouseCalendar();
      return { fresh, first: r.briefing.today[0] ?? null };
    });
    // Precondition: the gather really started before the store had delivered.
    expect(first.fresh).toBe(true);
    expect(first.first).toBe("Storey's birthday");
    expect(pageErrors).toEqual([]);
  });

  test("OFF: no stream, and every calendar consumer holds its own fetch — the flags are the rollback", async ({ page }) => {
    const { pageErrors, count } = await bootCal(page, CAL_OFF);

    await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(FROM_ROUTE);
    await page.waitForTimeout(500);
    expect(count("/api/house/stream")).toBe(0);
    expect(await page.evaluate(() => window.__v3().houseStream.started)).toBe(false);

    const before = count("/api/calendar/all");
    expect(await calReadings(page)).toEqual(FROM_ROUTE);
    expect(count("/api/calendar/all")).toBe(before + 1);
    expect(pageErrors).toEqual([]);
  });

  test("ON with the stream down: each falls back to its own fetch", async ({ page }) => {
    const { pageErrors, count } = await bootCal(page, CAL_ON, { stream: null });

    await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(FROM_ROUTE);
    expect(count("/api/house/stream")).toBeGreaterThan(0);
    expect(pageErrors).toEqual([]);
  });

  /* The boot reads of intent and personality run BEFORE V3 opens the stream,
     so with a slow calendar route they resolve AFTER the store has delivered.
     That late answer must be dropped, not written over the store's reading. */
  test("ON: a fetch that resolves after the store delivered is dropped", async ({ page }) => {
    const { pageErrors, count } = await bootCal(page, CAL_ON, {
      calendar: { __delayMs: 2_500, __body: ROUTE_CAL }
    });

    await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(FROM_STORE);
    // The slow boot fetches were made, and have now all come back.
    expect(count("/api/calendar/all")).toBeGreaterThan(0);
    await page.waitForTimeout(3_000);
    expect(await calReadings(page)).toEqual(FROM_STORE);
    expect(pageErrors).toEqual([]);
  });

  /* Each flag is its OWN lever: one on moves exactly one consumer. */
  for (const [flagName, moved] of [
    ["v3HouseStoreBriefing", "briefing"],
    ["v3HouseStoreIntent", "intent"],
    ["v3HouseStorePersonality", "personality"]
  ]) {
    test(`ONLY ${flagName}: the ${moved} holds the store's calendar, the others their own`, async ({ page }) => {
      const { pageErrors } = await bootCal(page, { ...CAL_OFF, [flagName]: true });
      const expected = { ...FROM_ROUTE, [moved]: FROM_STORE[moved] };

      await expect.poll(() => calReadings(page), { timeout: 10_000 }).toEqual(expected);
      await page.waitForTimeout(500);
      expect(await calReadings(page)).toEqual(expected);
      expect(pageErrors).toEqual([]);
    });
  }
});
