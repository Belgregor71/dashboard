import { test, expect } from "@playwright/test";
import { join } from "node:path";
import { SRC, rel, codeOf, rawOf, moduleEntry, importClosure } from "./fixtures/source-scan.js";
import { bootV3 } from "./fixtures/v3boot.js";
import {
  EVIDENCE_KEYS,
  evidenceOf,
  evidenceVerdict,
  gateByEvidence,
  isEvidenceKey
} from "../src/js/services/evidence.js";
import { houseSnapshot, refreshHouseCache, __resetHouseCache } from "../src/js/services/houseSnapshot.js";
import { collectSources } from "../src/js/services/candidateSources.js";
import { evaluateInsights } from "../src/js/services/insightRules.js";
import { evaluatePredictive } from "../src/js/services/predictiveRules.js";
import { toSurface } from "../src/js/services/memoryEngine.js";
import { celebrate } from "../src/js/core/personality.js";
import { DELIGHT_TRIGGERS } from "../src/js/services/delight.js";

/* ═══════════════════════════════════════════════════════════════════════════
   EVERY CANDIDATE NAMES WHAT IT STANDS ON — HOUSE-MIND S5a, 2026-09-25.

   A candidate is `evidence: {key, at}` or it is a line with nothing under it
   (the "8:41", the forecast invented 24/24). src/js/services/evidence.js is
   the vocabulary and the gate; features.v3EvidenceGate arms the gate on V3.

   The inventory is DERIVED, the way event-registry.spec.js derives the bus:
   every object literal in V3's import closure with a `score:` key is either a
   candidate — and must carry `evidence` — or is on EXEMPT with a reason. Red on:

     1. the scan sees what it claims to see  → a blind scan passes everything
     2. a scored literal with no evidence    → an undeclared candidate
        and no exemption
     3. the per-file count moved             → a new producer, or a removed
                                               one, that nobody declared
     4. an exemption that matches nothing    → an excuse that outlived its cause

   Then the literals are checked at RUNTIME, because a literal that says
   `evidence: laneEvidence(evidence, "wether")` passes a text scan and ships
   null: the real lanes are run through houseSnapshot and the rules, and every
   candidate they produce must get an "ok" verdict.
   ═══════════════════════════════════════════════════════════════════════════ */

/* Scored literals that are NOT candidates. Matched on the literal's text. */
const EXEMPT = [
  {
    file: "src/js/services/candidateSources.js",
    re: /^\{\s*score:\s*\d+,\s*interrupt:\s*(true|false)\s*\}$/,
    count: 4,
    why: "the BOM severity ladder (WARNING_DEFAULT + three tiers): rows a candidate reads its score from"
  },
  {
    file: "src/v3/core/attention.js",
    re: /score:\s*(hero|c)\.score/,
    count: 4,
    why: "diagnostic projections for __v3() (hero, stack, queue, announcements) — copies of candidates, not candidates"
  }
];

/* How many candidate literals each producer file holds. A new one is red here
   until it is declared — with its evidence — and counted. */
const PRODUCERS = {
  "src/js/services/candidateSources.js": 11,
  "src/js/services/insightRules.js": 4,
  "src/js/services/predictiveRules.js": 4,
  "src/js/services/memoryEngine.js": 1,
  "src/js/core/personality.js": 1,
  "src/v3/core/arrival.js": 1,
  "src/v3/core/resolutions.js": 1
};

/* Skip a template literal starting at the backtick at `i`; returns the index of
   its closing backtick. Its TEXT is skipped whole — `rain's` in copy is not a
   string opener, and treating it as one lost one literal per file on the first
   run — while each `${…}` is walked by brace count. */
function skipTemplate(code, i) {
  for (i++; i < code.length; i++) {
    const c = code[i];
    if (c === "\\") { i++; continue; }
    if (c === "`") return i;
    if (c === "$" && code[i + 1] === "{") {
      let depth = 0;
      for (i++; i < code.length; i++) {
        if (code[i] === "`") i = skipTemplate(code, i);
        else if (code[i] === "{") depth++;
        else if (code[i] === "}" && --depth === 0) break;
      }
    }
  }
  return i;
}

/* The innermost object literal enclosing `pos`. Strings and templates are
   skipped so a brace or a quote in copy cannot unbalance the walk. */
function enclosingLiteral(code, pos) {
  let depth = 0;
  let start = -1;
  for (let i = pos; i >= 0; i--) {
    const c = code[i];
    if (c === "}") depth++;
    else if (c === "{") {
      if (depth === 0) { start = i; break; }
      depth--;
    }
  }
  if (start < 0) return null;
  depth = 0;
  for (let i = start; i < code.length; i++) {
    const c = code[i];
    if (c === "`") { i = skipTemplate(code, i); continue; }
    if (c === '"' || c === "'") {
      const q = c;
      for (i++; i < code.length && code[i] !== q; i++) if (code[i] === "\\") i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}

function scoredLiterals() {
  const files = [...importClosure(moduleEntry("v3/index.html"), codeOf)];
  const out = [];
  for (const f of files) {
    const code = codeOf(f);
    const re = /(?:^|[{,\s])score\s*:/g;
    let m;
    while ((m = re.exec(code))) {
      const literal = enclosingLiteral(code, m.index + m[0].indexOf("score"));
      if (literal) out.push({ file: rel(f), literal });
    }
  }
  return { files, literals: out };
}

const hasEvidence = (literal) => /(^|[{,\s])evidence\s*[:,}]/.test(literal);
const exemptionFor = (lit) => EXEMPT.find((e) => e.file === lit.file && e.re.test(lit.literal.replace(/\s+/g, " ")));

test.describe("S5a inventory — every scored literal is a candidate with evidence, or exempt", () => {
  const { files, literals } = scoredLiterals();

  test("1. the scan sees what it claims to see", () => {
    // The closure is real (not an empty walk) and reaches every producer.
    expect(files.length).toBeGreaterThan(50);
    const seen = new Set(literals.map((l) => l.file));
    for (const f of Object.keys(PRODUCERS)) expect(seen, `scan never reached ${f}`).toContain(f);
    // Named candidates the scan must have captured WHOLE (id through score).
    const whole = (file, needle) => literals.some((l) => l.file === file && l.literal.includes(needle) && l.literal.includes("score"));
    expect(whole("src/v3/core/arrival.js", "arrival:")).toBe(true);
    expect(whole("src/js/services/candidateSources.js", "bom:")).toBe(true);
    expect(whole("src/js/services/predictiveRules.js", "rain-incoming:")).toBe(true);
    // And the evidence detector can fail: it must say no to a literal without it.
    expect(hasEvidence('{ id: "x", score: 1, text: "evidenced" }')).toBe(false);
    expect(hasEvidence('{ id: "x", evidence: null, score: 1 }')).toBe(true);
  });

  test("2. no scored literal lacks evidence unless it is exempt", () => {
    const bad = literals
      .filter((l) => !hasEvidence(l.literal) && !exemptionFor(l))
      .map((l) => `${l.file}: ${l.literal.replace(/\s+/g, " ").slice(0, 120)}`);
    expect(bad, "a candidate with no `evidence` — add it (services/evidence.js), or exempt a non-candidate with a reason").toEqual([]);
  });

  test("3. each producer holds exactly its declared number of candidates", () => {
    const counts = {};
    for (const l of literals) {
      if (exemptionFor(l)) continue;
      counts[l.file] = (counts[l.file] ?? 0) + 1;
    }
    expect(counts).toEqual(PRODUCERS);
  });

  test("4. every exemption still matches exactly what it names", () => {
    for (const e of EXEMPT) {
      const n = literals.filter((l) => exemptionFor(l) === e).length;
      expect(n, `${e.file}: ${e.why}`).toBe(e.count);
    }
  });

  test("every delight trigger says what it stands on", () => {
    // DELIGHT_EVIDENCE is module-private in personalityRuntime (it imports the
    // DOM-side runtime), so it is read from source — keys only.
    const src = rawOf(join(SRC, "js", "core", "personalityRuntime.js"));
    const block = src.match(/const DELIGHT_EVIDENCE = \{([\s\S]*?)\};/);
    expect(block, "DELIGHT_EVIDENCE map not found").not.toBeNull();
    const mapped = Object.fromEntries([...block[1].matchAll(/"([\w-]+)":\s*"([\w:.-]+)"/g)].map((m) => [m[1], m[2]]));
    const ids = DELIGHT_TRIGGERS.map((t) => t.id);
    expect(ids.length).toBeGreaterThan(3);
    expect(Object.keys(mapped).sort()).toEqual([...ids].sort());
    for (const key of Object.values(mapped)) expect(isEvidenceKey(key), key).toBe(true);
  });
});

/* ── The verdicts ──────────────────────────────────────────────────────── */

const T = Date.parse("2026-09-25T12:00:00+10:00");
const MIN = 60_000;

test.describe("S5a verdicts — services/evidence.js", () => {
  test("a current reading, an HA entity and a dated event are ok", () => {
    expect(evidenceVerdict({ evidence: { key: "weather", at: T - 5 * MIN } }, T)).toBe("ok");
    expect(evidenceVerdict({ evidence: { key: "ha:sensor.bom_warnings", at: T - 600 * MIN } }, T)).toBe("ok");
    expect(evidenceVerdict({ evidence: { key: "calendar", at: T - 600 * MIN, event: true }, expiresAt: T + MIN }, T)).toBe("ok");
    expect(evidenceVerdict({ evidence: { key: "clock", at: T - 600 * MIN } }, T)).toBe("ok");
  });

  test("each way of standing on nothing has its own reason", () => {
    expect(evidenceVerdict({}, T)).toBe("missing");
    expect(evidenceVerdict({ evidence: null }, T)).toBe("missing");
    expect(evidenceVerdict({ evidence: { key: "vibes", at: T } }, T)).toBe("unknown");
    expect(evidenceVerdict({ evidence: { key: "ha:Not An Entity", at: T } }, T)).toBe("unknown");
    expect(evidenceVerdict({ evidence: { key: "weather" } }, T)).toBe("undated");
    expect(evidenceVerdict({ evidence: { key: "weather", at: 0 } }, T)).toBe("undated");
    expect(evidenceVerdict({ evidence: { key: "weather", at: T - 21 * MIN } }, T)).toBe("stale");
    expect(evidenceVerdict({ evidence: { key: "arrival", at: T, event: true } }, T)).toBe("unknown");
    expect(evidenceVerdict({ evidence: { key: "presence", at: T, event: true } }, T)).toBe("endless");
  });

  test("the stale line sits at 20 minutes for every polled key, and nowhere for the rest", () => {
    for (const [key, max] of Object.entries(EVIDENCE_KEYS)) {
      if (max == null) {
        expect(evidenceVerdict({ evidence: { key, at: T - 10_000 * MIN } }, T), key).toBe("ok");
      } else {
        expect(max, key).toBe(20 * MIN);
        expect(evidenceVerdict({ evidence: { key, at: T - 20 * MIN } }, T), key).toBe("ok");
        expect(evidenceVerdict({ evidence: { key, at: T - 20 * MIN - 1 } }, T), key).toBe("stale");
      }
    }
  });

  test("evidenceOf refuses an undated or unknown reading rather than inventing one", () => {
    expect(evidenceOf("weather", 0)).toBeNull();
    expect(evidenceOf("weather", null)).toBeNull();
    expect(evidenceOf("weather", "not a date")).toBeNull();
    expect(evidenceOf("rumour", T)).toBeNull();
    expect(evidenceOf("weather", new Date(T))).toEqual({ key: "weather", at: T });
    expect(evidenceOf("presence", T, { event: true })).toEqual({ key: "presence", at: T, event: true });
  });

  test("the gate keeps order and says what it dropped and why", () => {
    const list = [
      { id: "a", source: "s", evidence: { key: "weather", at: T } },
      { id: "b", source: "s" },
      { id: "c", source: "s", evidence: { key: "commute", at: T - 60 * MIN } },
      { id: "d", source: "s", evidence: { key: "ha:person.x", at: T - 60 * MIN } }
    ];
    const { kept, dropped } = gateByEvidence(list, T);
    expect(kept.map((c) => c.id)).toEqual(["a", "d"]);
    expect(dropped).toEqual([
      { id: "b", source: "s", why: "missing" },
      { id: "c", source: "s", why: "stale" }
    ]);
  });
});

/* ── The real lanes ─────────────────────────────────────────────────────── */

const NOW = new Date("2026-08-08T18:30:00+10:00");
const realFetch = globalThis.fetch;

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => routes[hit] };
  };
}

const entity = (entity_id, state, agoMin, attributes = {}) => ({
  entity_id,
  state,
  last_changed: new Date(NOW.getTime() - agoMin * MIN).toISOString(),
  last_updated: new Date(NOW.getTime() - agoMin * MIN).toISOString(),
  attributes
});

test.describe("S5a — every candidate the real lanes produce is evidenced", () => {
  test.beforeEach(() => __resetHouseCache());
  test.afterEach(() => {
    globalThis.fetch = realFetch;
    __resetHouseCache();
    delete globalThis.window;
  });

  test("houseSnapshot → collectSources: every lane's candidate names its reading", async () => {
    globalThis.window = { CONFIG: { features: { robotCandidate: true } } };
    stubFetch({
      "/api/weather/now": { now: { condition: { label: "Thunderstorm" }, temp_c: 24 } },
      "/api/commute/all": { legs: [{ id: "greg", label: "Greg", seconds: 1380, trafficDelaySeconds: 0 }] },
      "/api/plex/sessions": { sessions: [{ title: "Arrival", thumb: "/t" }] },
      "/api/calendar/all": [
        { title: "Meal: Butter chicken", start: NOW.toISOString() },
        { title: "Dentist", start: new Date(NOW.getTime() + 10 * MIN).toISOString() }
      ]
    });
    await refreshHouseCache();
    const snap = houseSnapshot({
      now: NOW,
      entities: [
        entity("binary_sensor.driveway_motion_detected", "off", 4),
        entity("sensor.nudgee_warnings", "Severe Thunderstorm Warning for Brisbane", 90), // CONFIG.weather.bom.warningsEntityId
        entity("vacuum.roborock_s8", "docked", 30),
        entity("binary_sensor.roborock_s8_water_shortage", "on", 30, { device_class: "problem" })
      ]
    });
    const cands = collectSources({ ...snap, now: NOW });
    const sources = cands.map((c) => c.source).sort();
    // Not vacuous: the fixture must light these lanes, or "all ok" means nothing.
    for (const s of ["bom", "weather", "nextEvent", "commute", "plex", "tonightsMenu", "cameraTrigger", "robot"]) {
      expect(sources, `the fixture did not light ${s}`).toContain(s);
    }
    const verdicts = cands.map((c) => `${c.source}:${evidenceVerdict(c, NOW.getTime())}`);
    expect(verdicts.filter((v) => !v.endsWith(":ok"))).toEqual([]);
    const keyOf = (s) => cands.find((c) => c.source === s).evidence.key;
    expect(keyOf("weather")).toBe("weather");
    expect(keyOf("nextEvent")).toBe("calendar");
    expect(keyOf("bom")).toBe("ha:sensor.nudgee_warnings");
    expect(keyOf("robot")).toBe("ha:vacuum.roborock_s8");
    expect(keyOf("cameraTrigger")).toBe("ha:binary_sensor.driveway_motion_detected");
  });

  test("a failed re-read does not freshen the evidence of the value it kept", async () => {
    stubFetch({ "/api/weather/now": { now: { condition: { label: "Thunderstorm" }, temp_c: 24 } } });
    await refreshHouseCache();
    const first = houseSnapshot({ now: NOW }).evidence.weather.at;
    await new Promise((r) => setTimeout(r, 5));
    stubFetch({}); // every read fails from here
    await refreshHouseCache();
    const snap = houseSnapshot({ now: NOW });
    expect(snap.weatherCondition).toBe("Thunderstorm"); // the last good value stands...
    expect(snap.evidence.weather.at).toBe(first); // ...and still says when it was read
  });

  test("a cold cache has no polled evidence at all", () => {
    const ev = houseSnapshot({ now: NOW }).evidence;
    for (const k of ["weather", "calendar", "commute", "plex"]) expect(ev[k], k).toBeNull();
  });

  test("the rules, the memory and the delight all carry evidence the gate accepts", () => {
    const now = new Date("2026-08-08T19:30:00+10:00");
    const ctx = {
      nextEventDrive: { title: "Footy", start: new Date(now.getTime() + 60 * MIN), minutes: 20, delayMin: 0, leaveBy: new Date(now.getTime() + 20 * MIN), leaveByStr: "7:50" },
      bins: { eve: true, colours: ["red"] },
      weather: { rainChancePct: 70 },
      tomorrowWeather: { rainChancePct: 80 },
      calendar: { tomorrow: [{ title: "Swim", time: "7am", start: new Date("2026-08-09T07:00:00+10:00"), allDay: false }] },
      nowcast: { startsInMin: 12, probabilityPct: 80 },
      anniversaries: [{ title: "Wedding anniversary" }]
    };
    const insights = evaluateInsights(ctx, now);
    const predictive = evaluatePredictive(ctx, now);
    expect(insights.map((c) => c.id.split(":")[0]).sort()).toEqual(["bin-weather", "leave-by", "tomorrow-rain"]);
    expect(predictive.map((c) => c.id.split(":")[0]).sort()).toEqual(["on-this-day", "rain-incoming"]);
    const memory = toSurface({ id: "m1", title: "First day", kind: "memory" }, now);
    const delight = celebrate({ id: "christmas", title: "Christmas", expiresAt: now.getTime() + 60 * MIN, evidence: { key: "clock", at: now.getTime(), event: true } });
    for (const c of [...insights, ...predictive, memory, delight]) {
      expect(evidenceVerdict(c, now.getTime()), c.id).toBe("ok");
    }
    // A delight with nothing mapped is dropped, not waved through.
    expect(evidenceVerdict(celebrate({ id: "x", expiresAt: now.getTime() + MIN }), now.getTime())).toBe("missing");
  });
});

/* ── On the page: the gate, both directions ─────────────────────────────── */

const MIDDAY = new Date("2026-07-06T12:00:00");
const STORM = { now: { condition: { label: "Thunderstorm" }, temp_c: 24 } };

async function boot(page, gate) {
  await page.clock.install({ time: MIDDAY });
  const { pageErrors } = await bootV3(page, { "/api/weather/now": STORM }, { features: { v3EvidenceGate: gate } });
  // The weather read has landed and the lane is in the queue.
  await page.waitForFunction(() => {
    window.__v3Tick();
    return (window.__v3().attention?.queue ?? []).some((c) => c.source === "weather");
  });
  return pageErrors;
}

/** Tick at `+min` minutes with no re-read in between (the page clock is paused). */
const tickAt = (page, min) =>
  page.evaluate((t) => {
    const a = window.__v3Tick(t);
    return { queue: a.queue.map((c) => c.source), dropped: a.dropped };
  }, MIDDAY.getTime() + min * MIN);

test.describe("v3EvidenceGate — a reading the page stopped refreshing stops holding the room", () => {
  test("ON: fresh weather ranks; 25 minutes without a read, it is dropped as stale", async ({ page }) => {
    const pageErrors = await boot(page, true);
    const fresh = await tickAt(page, 1);
    expect(fresh.queue).toContain("weather");
    expect(fresh.dropped).toEqual([]);

    const stale = await tickAt(page, 25);
    expect(stale.queue).not.toContain("weather");
    expect(stale.dropped).toContainEqual({ id: "weather:Thunderstorm", source: "weather", why: "stale" });
    expect(pageErrors).toEqual([]);
  });

  test("OFF: the same stale weather still ranks — the flag is the rollback", async ({ page }) => {
    const pageErrors = await boot(page, false);
    const stale = await tickAt(page, 25);
    expect(stale.queue).toContain("weather");
    expect(stale.dropped).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  test("ON: an arrival (an event) ranks, and __forceCandidate is never gated", async ({ page }) => {
    await boot(page, true);
    // Home, out, and back an hour later: past the too-brief guard, as in
    // v3-house-mind-s0.spec.js.
    await page.evaluate(() => {
      window.__v3Arrival("person.spec", "home");
      window.__v3Arrival("person.spec", "not_home");
    });
    await page.clock.setSystemTime(MIDDAY.getTime() + 60 * MIN);
    const got = await page.evaluate(() => {
      window.__v3Arrival("person.spec", "home");
      window.__forceCandidate({ id: "spec:forced", source: "spec", text: "Forced by the spec", score: 60, cooldownMs: 0 });
      const a = window.__v3Tick();
      return { queue: a.queue.map((c) => c.id), dropped: a.dropped };
    });
    expect(got.queue).toContain("arrival:person.spec");
    expect(got.queue).toContain("spec:forced");
    /* The hour the arrival needed also aged the boot's weather read past 20
       minutes — so the gate IS live in this very tick, and it took the stale
       reading and nothing else. */
    expect(got.dropped).toEqual([{ id: "weather:Thunderstorm", source: "weather", why: "stale" }]);
  });
});
