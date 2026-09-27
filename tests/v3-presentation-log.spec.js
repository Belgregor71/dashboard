import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { cleanRow, prune, RETENTION_MS, MAX_ROWS } from "../server/routes/presentations.js";

/* ═══════════════════════════════════════════════════════════════════════════
   HOUSE-MIND S6a — the wall's log (docs/design/HOUSE-MIND.md §S6).

   What "it worked" means, from the design's own table:
     · a real presentation → EXACTLY ONE row, with the right fields
     · and NO presence, person or home field — which here includes a person
       entity smuggled in through the id or the evidence key (arrival's are
       `arrival:person.x` and `ha:person.x`)
     · a probe (__forceCandidate) is never written (S6-0's lesson)
     · flag off → not one request
     · retention drops the oldest rows
   The server enforces the no-people rule too; its half is asserted against the
   running route, not just the pure function, so a route that skipped
   cleanRow() goes red.
   ═══════════════════════════════════════════════════════════════════════════ */

const ROW_KEYS = ["decision", "end", "evidenceKey", "id", "shown", "source", "start", "surface"];
const MONDAY_MORNING = new Date("2026-07-06T07:30:00");
const HOUR = 60 * 60 * 1000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROWS_FILE = path.join(__dirname, "..", "data", "presentations", "rows.jsonl");

/** Every row the page POSTs, parsed off the wire. */
function captureRows(page) {
  const rows = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && new URL(req.url()).pathname === "/api/presentations") {
      rows.push(JSON.parse(req.postData() ?? "{}").row);
    }
  });
  return rows;
}

async function boot(page, features) {
  await page.clock.setFixedTime(MONDAY_MORNING);
  const rows = captureRows(page);
  const { pageErrors } = await bootV3(page, { "/api/presentations": { ok: true } }, { features });
  await page.evaluate(() => {
    window.__forceCandidate(null);
    window.__v3Presence(false);
  });
  return { rows, pageErrors };
}

/* A real hero, raised the way the house raises one (the S6-0 technique): an
   arrival through V3's own lane. Arrival is an interrupt, so it takes depth 1. */
async function arriveHome(page) {
  await page.evaluate(() => {
    window.__v3Presence(true);
    window.__v3Arrival("person.spec", "home");
    window.__v3Arrival("person.spec", "not_home");
  });
  await page.clock.setFixedTime(new Date(MONDAY_MORNING.getTime() + HOUR));
  await page.evaluate(() => window.__v3Arrival("person.spec", "home"));
}

const settle = (page) => page.evaluate(() => new Promise((r) => setTimeout(r, 50)));

test.describe("the page's half", () => {
  test("a real presentation is ONE row, closed when it leaves the glass, with no people on it", async ({ page }) => {
    const { rows, pageErrors } = await boot(page, { v3PresentationLog: true });

    await arriveHome(page);
    // Not vacuous: the arrival really is on the glass at depth 1.
    const at = await page.evaluate(() => ({ depth: window.__v3().depth?.depth, hero: window.__v3().attention.hero?.id }));
    expect(at).toEqual({ depth: 1, hero: "arrival:person.spec" });

    // Still up across three ticks: open, and not posted yet (nor twice).
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.__v3Tick());
    await settle(page);
    expect(rows.filter((r) => r.surface === "glance")).toEqual([]);
    expect(await page.evaluate(() => window.__v3().presentations.open.map((r) => r.surface))).toContain("glance");

    // Five minutes later the room empties: depth 0, and the row closes.
    await page.clock.setFixedTime(new Date(MONDAY_MORNING.getTime() + HOUR + 5 * 60 * 1000));
    await page.evaluate(() => window.__v3Presence(false));
    await expect.poll(() => rows.filter((r) => r.surface === "glance").length).toBe(1);

    // More ticks and depth churn cannot add a second row for the same showing.
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.__v3Tick());
    await settle(page);
    const glance = rows.filter((r) => r.surface === "glance");
    expect(glance).toHaveLength(1);

    const row = glance[0];
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(row).toMatchObject({
      surface: "glance",
      id: "arrival",            // `arrival:person.spec`, scrubbed to its source
      source: "arrival",
      evidenceKey: "ha:person", // `ha:person.spec`, scrubbed
      decision: null,
      shown: true
    });
    expect(row.end - row.start).toBe(5 * 60 * 1000);
    /* The arrival also SPOKE (author "arrival"), which the arbiter took: a voice
       row, closed when the air came free. Its TTS 503s here, so the line ends on
       the browser fallback; the row closes either way. */
    await expect.poll(() => rows.filter((r) => r.surface === "voice").length).toBe(1);
    expect(rows.find((r) => r.surface === "voice")).toMatchObject({
      id: null, source: "arrival", decision: { action: "took", over: null }, shown: true
    });

    // No row, on any surface, carries a person entity anywhere.
    expect(JSON.stringify(rows)).not.toMatch(/person\./i);
    expect(pageErrors).toEqual([]);
  });

  test("a subject on the stage is one row, with the arbiter's call on it", async ({ page }) => {
    const rows = captureRows(page);
    const d = new Date();
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    await bootV3(page, {
      "/api/presentations": { ok: true },
      "/api/calendar/all": [{ title: "Dentist", start: `${ymd}T09:30:00` }]
    }, { features: { v3PresentationLog: true } });
    await page.evaluate(() => window.__v3Refresh());

    const got = await page.evaluate(async () => {
      await window.__v3Transcript("show me my day");
      return { depth: window.__depth().depth, subject: window.__v3().subject };
    });
    // Not vacuous: the subject really mounted at depth 3.
    expect(got).toEqual({ depth: 3, subject: "show.day" });
    expect(rows.filter((r) => r.surface === "stage")).toEqual([]);   // still up

    await page.evaluate(() => window.__setDepth(0, "spec"));
    await expect.poll(() => rows.filter((r) => r.surface === "stage").length).toBe(1);
    expect(rows.find((r) => r.surface === "stage")).toMatchObject({
      id: "show.day", source: "voice", decision: { action: "took" }, shown: true
    });
  });

  test("a __forceCandidate probe on the glass is never written", async ({ page }) => {
    const { rows } = await boot(page, { v3PresentationLog: true });

    await page.evaluate(() => {
      window.__v3Presence(true);
      window.__forceCandidate({ id: "spec:probe", source: "spec", text: "the back gate is open", score: 95, interrupt: true, cooldownMs: 0 });
      window.__v3Tick();
    });
    // Not vacuous: the probe really reached the glass.
    expect(await page.evaluate(() => ({ depth: window.__v3().depth?.depth, acted: window.__v3().attention.acted })))
      .toEqual({ depth: 1, acted: "spec:probe" });

    // Cleared while its line is still up, then the room empties.
    await page.evaluate(() => { window.__forceCandidate(null); window.__v3Tick(); });
    await page.evaluate(() => window.__v3Presence(false));
    await settle(page);

    expect(rows.filter((r) => r.source === "spec" || r.id === "spec:probe")).toEqual([]);
  });

  test("flag off: the same showing makes no request at all", async ({ page }) => {
    const { rows, pageErrors } = await boot(page, { v3PresentationLog: false });

    await arriveHome(page);
    expect(await page.evaluate(() => window.__v3().depth?.depth)).toBe(1);
    await page.evaluate(() => window.__v3Presence(false));
    await settle(page);

    expect(rows).toEqual([]);
    expect(await page.evaluate(() => window.__v3().presentations.armed)).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});

test.describe("the server's half", () => {
  const tag = () => `spec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  test("a row is stored and read back with exactly the whitelisted fields", async ({ request }) => {
    const source = tag();
    const now = Date.now();
    const res = await request.post("/api/presentations", {
      data: { row: { surface: "spread", id: `x:${source}`, source, evidenceKey: "weather", decision: null, shown: true, start: now - 1000, end: now } }
    });
    expect(res.status()).toBe(201);

    const got = await (await request.get(`/api/presentations?since=${now - 5000}&limit=5000`)).json();
    expect(got.retentionDays).toBe(90);
    const mine = got.rows.filter((r) => r.source === source);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(ROW_KEYS);
    expect(mine[0]).toMatchObject({ surface: "spread", id: `x:${source}`, evidenceKey: "weather", start: now - 1000, end: now });
  });

  test("people fields the page sends are never written, and a person id is scrubbed", async ({ request }) => {
    const source = tag();
    const now = Date.now();
    const res = await request.post("/api/presentations", {
      data: {
        row: {
          surface: "glance", id: "arrival:person.greg", source, evidenceKey: "ha:person.greg",
          start: now - 1000, end: now,
          present: true, person: "person.greg", home: ["person.greg"], dwelling: true
        }
      }
    });
    expect(res.status()).toBe(201);

    const got = await (await request.get(`/api/presentations?since=${now - 5000}&limit=5000`)).json();
    const mine = got.rows.filter((r) => r.source === source);
    expect(mine).toHaveLength(1);
    expect(Object.keys(mine[0]).sort()).toEqual(ROW_KEYS);
    expect(mine[0].id).toBe(source);
    expect(mine[0].evidenceKey).toBe("ha:person");
    expect(JSON.stringify(mine[0])).not.toMatch(/person\.|greg/i);
  });

  test("a row with no end, a bad surface or a future end is refused", async ({ request }) => {
    const now = Date.now();
    const base = { surface: "glance", id: "x", source: tag(), start: now - 1000, end: now };
    const cases = [
      [{ ...base, end: undefined }, "missing end"],
      [{ ...base, surface: "billboard" }, "bad surface"],
      [{ ...base, end: now + 10 * 60 * 1000 }, "end in the future"],
      [{ ...base, end: base.start - 1 }, "end before start"]
    ];
    for (const [row, why] of cases) {
      const res = await request.post("/api/presentations", { data: { row } });
      expect(res.status(), why).toBe(400);
      expect((await res.json()).error).toBe(why);
    }
  });

  test("retention drops rows older than 90 days, on disk as well as in the answer", async ({ request }) => {
    const oldSource = tag();
    const newSource = tag();
    const now = Date.now();
    const old = now - RETENTION_MS - 60 * 60 * 1000;
    for (const [source, end] of [[oldSource, old], [newSource, now]]) {
      const res = await request.post("/api/presentations", {
        data: { row: { surface: "glance", id: "x", source, start: end - 1000, end } }
      });
      expect(res.status()).toBe(201);
    }

    const got = await (await request.get("/api/presentations?limit=5000")).json();
    expect(got.rows.some((r) => r.source === newSource)).toBe(true);
    expect(got.rows.some((r) => r.source === oldSource)).toBe(false);

    // The read pruned the FILE, not just the reply.
    expect(existsSync(ROWS_FILE)).toBe(true);
    const disk = readFileSync(ROWS_FILE, "utf8");
    expect(disk).toContain(newSource);
    expect(disk).not.toContain(oldSource);
  });
});

test.describe("the pure halves", () => {
  test("cleanRow rebuilds from the whitelist and scrubs a person", () => {
    const now = 1_800_000_000_000;
    const row = cleanRow({ surface: "voice", id: null, source: "arrival", start: now - 5, end: now, person: "x", present: true }, now);
    expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    expect(cleanRow({ surface: "glance", id: "arrival:person.a", source: "arrival", start: 1, end: 2 }, now).id).toBe("arrival");
    expect(cleanRow({ surface: "glance", id: "a", source: "s", start: 1 }, now)).toBe("missing end");
    expect(cleanRow({ surface: "glance", id: "a", source: "s", start: 1, end: 2, decision: { action: "vetoed" } }, now)).toBe("bad decision");
  });

  test("prune keeps the window and caps the count at the NEWEST rows", () => {
    const now = 1_800_000_000_000;
    const rows = [
      { id: "old", end: now - RETENTION_MS - 1 },
      { id: "edge", end: now - RETENTION_MS },
      { id: "new", end: now }
    ];
    expect(prune(rows, now).map((r) => r.id)).toEqual(["edge", "new"]);

    const many = Array.from({ length: MAX_ROWS + 3 }, (_, i) => ({ id: i, end: now - 1000 + (i % 1000) }));
    const kept = prune(many, now);
    expect(kept).toHaveLength(MAX_ROWS);
    expect(kept[0].id).toBe(3);                  // the three oldest went
    expect(kept[kept.length - 1].id).toBe(MAX_ROWS + 2);
  });
});
