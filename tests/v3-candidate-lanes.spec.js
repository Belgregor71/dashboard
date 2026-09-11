import { test, expect } from "@playwright/test";
import {
  houseSnapshot,
  refreshHouseCache,
  __resetHouseCache
} from "../src/js/services/houseSnapshot.js";
import { collectSources } from "../src/js/services/candidateSources.js";
import { rankQueue } from "../src/js/services/attentionRank.js";
import { laneState } from "../src/v3/core/attention.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE INCUMBENT'S FOUR CANDIDATE LANES ARE A LEVER ON V3 — audit F1(b).

   `commute`, `mediaCandidate`, `foldHomeTiles` and `cameraCandidate` each gate
   a lane on the incumbent (focusHero.js:120-123 hands the lane's inputs to
   collectSources as null). Until 2026-09-11 V3 read none of them: houseSnapshot
   fed all four lanes on every tick, so "turn it off" was not a rollback on the
   wall (docs/audit/F1-FLAG-CENSUS-2026-09-11.md). v3/core/attention.js now masks
   each lane's inputs on the copy handed to collectSources.

   What is asserted, and why each one:
     · the fixture lights every lane         → a gate over a dark lane passes
                                                 vacuously
     · each flag drops ITS lane and no other → a union gate (any flag off kills
                                                 all four) would pass a test
                                                 that only ever turns one off
     · all on = byte-identical to ungated    → the change ships with every flag
                                                 true; it must not move the wall
     · the flag is read off window.CONFIG    → a predicate-only test never
                                                 touches the production reader
     · the lane dies AFTER the ranker too    → an adapter's output is not the
                                                 wall (the cameraTrigger lane was
                                                 produced and then dropped for
                                                 V3's whole life)
     · the snapshot itself is untouched      → the now-playing band, the media
                                                 subject and the dinner panel
                                                 read it too
     · the real tick honours a live flip     → nothing above proves tickAttention
                                                 calls laneState at all
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date("2026-08-08T18:30:00+10:00");

/* Which sources each flag owns. `mediaCandidate` owns two, as on the incumbent. */
const LANES = {
  commute: ["commute"],
  mediaCandidate: ["nowPlaying", "plex"],
  foldHomeTiles: ["tonightsMenu"],
  cameraCandidate: ["cameraTrigger"]
};
const FLAGS = Object.keys(LANES);

function stubFetch(routes) {
  globalThis.fetch = async (url) => {
    const hit = Object.keys(routes).find((k) => String(url).includes(k));
    if (!hit) return { ok: false, status: 404, json: async () => null };
    return { ok: true, status: 200, json: async () => routes[hit] };
  };
}

const sensor = (entity_id, state, agoMin) => ({
  entity_id,
  state,
  last_changed: new Date(NOW.getTime() - agoMin * 60000).toISOString(),
  attributes: {}
});

/* The same restore-never-delete-and-hope as house-snapshot.spec.js: workers are
   reused across spec files, and a stray `window` follows this one onward. */
const withWindow = (features, fn) => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "window");
  const prev = globalThis.window;
  globalThis.window = { CONFIG: { features } };
  try {
    return fn();
  } finally {
    if (had) globalThis.window = prev;
    else delete globalThis.window;
  }
};

const realFetch = globalThis.fetch;

/** A house with every lane lit, built by houseSnapshot itself — the TYPES the
 *  production tick supplies (an ISO-string cameraTriggerAt, not a number). */
async function litHouse() {
  stubFetch({
    "/api/commute/all": { legs: [{ id: "greg", label: "Greg", seconds: 1380, trafficDelaySeconds: 0 }] },
    "/api/plex/sessions": { sessions: [{ title: "Arrival", thumb: "/t" }] },
    "/api/calendar/all": [{ title: "Meal: Butter chicken", start: NOW.toISOString() }]
  });
  await refreshHouseCache();
  return houseSnapshot({ now: NOW, entities: [sensor("binary_sensor.driveway_motion_detected", "off", 4)] });
}

const on = () => true;
const allBut = (name) => (flag) => flag !== name;
const sourcesOf = (state) => collectSources({ ...state, now: NOW }).map((c) => c.source);

test.describe("V3 candidate lanes — node", () => {
  test.beforeEach(() => {
    __resetHouseCache();
    globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => null });
  });
  test.afterEach(() => {
    globalThis.fetch = realFetch;
    __resetHouseCache();
  });

  test("the fixture lights every lane these flags own that it can", async () => {
    const snap = await litHouse();
    const seen = sourcesOf(laneState(snap, on));
    /* nowPlaying needs a configured media_player and is covered by the mask
       assertion below; every other lane must be lit or the rest is vacuous. */
    for (const src of ["commute", "plex", "tonightsMenu", "cameraTrigger"]) {
      expect(seen, `the fixture did not light ${src}`).toContain(src);
    }
  });

  test("every flag on is byte-identical to no gate at all", async () => {
    const snap = await litHouse();
    expect(laneState(snap, on)).toBe(snap); // not even a copy
    expect(collectSources({ ...laneState(snap, on), now: NOW })).toEqual(collectSources({ ...snap, now: NOW }));
  });

  for (const flag of FLAGS) {
    test(`${flag} off drops its own lane and no other`, async () => {
      const snap = await litHouse();
      const before = sourcesOf(snap);
      const after = sourcesOf(laneState(snap, allBut(flag)));

      for (const src of LANES[flag]) expect(after, `${flag} off left ${src} in`).not.toContain(src);
      const others = before.filter((s) => !LANES[flag].includes(s));
      expect(after, `${flag} off took another lane with it`).toEqual(others);
      expect(others.length, "no other lane lit — isolation proves nothing").toBeGreaterThan(1);
    });
  }

  test("the flags are read off window.CONFIG, the production reader", async () => {
    const snap = await litHouse();
    const features = { commute: true, mediaCandidate: false, foldHomeTiles: true, cameraCandidate: false };
    const seen = withWindow(features, () => sourcesOf(laneState(snap)));

    expect(seen).toContain("commute");
    expect(seen).toContain("tonightsMenu");
    expect(seen).not.toContain("plex");
    expect(seen).not.toContain("cameraTrigger");
  });

  test("an unreadable config reads every lane as off", async () => {
    // V3's rule for every flag: no CONFIG means off, never on by accident.
    const snap = await litHouse();
    const seen = withWindow(undefined, () => sourcesOf(laneState(snap)));
    for (const flag of FLAGS) for (const src of LANES[flag]) expect(seen).not.toContain(src);
  });

  test("a lane that is off is off AFTER the ranker, and one that is on survives it", async () => {
    const snap = await litHouse();
    const ranked = (state) => rankQueue(collectSources({ ...state, now: NOW }), NOW).map((c) => c.source);

    expect(ranked(laneState(snap, on))).toContain("cameraTrigger");
    expect(ranked(laneState(snap, allBut("cameraCandidate")))).not.toContain("cameraTrigger");
    expect(ranked(laneState(snap, on))).toContain("tonightsMenu");
    expect(ranked(laneState(snap, allBut("foldHomeTiles")))).not.toContain("tonightsMenu");
  });

  test("masking never touches the snapshot the other V3 readers use", async () => {
    const snap = await litHouse();
    const copy = structuredClone(snap);
    const off = laneState(snap, () => false);

    expect(snap, "laneState mutated its input").toEqual(copy);
    expect(off.nowPlayingActive).toBe(false);
    expect(off.plexActive).toBe(false);
    // What the band, the media subject and the rooms read — never masked.
    expect(off.plexSub).toEqual(snap.plexSub);
    expect(off.plexImage).toEqual(snap.plexImage);
    expect(off.mediaRooms).toEqual(snap.mediaRooms);
    expect(off.nextEventText).toEqual(snap.nextEventText);
  });
});

/* ── The real tick ─────────────────────────────────────────────────────────── */

test.describe("V3 candidate lanes — the tick", () => {
  test("the live tick honours a flip of foldHomeTiles, both ways, without a reload", async ({ page }) => {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));

    /* Pinned to local midday so the menu is "tonight" and no window or daypart
       rule decides the result — the clock goes in through __v3Tick(now). */
    const noon = new Date();
    noon.setHours(12, 0, 0, 0);
    const dinner = new Date(noon);
    dinner.setHours(18, 30, 0, 0);

    // Registered FIRST: Playwright matches the last-registered route first.
    await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await page.route("**/api/calendar/all", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([{ title: "Meal: Butter chicken", start: dinner.toISOString() }])
      })
    );
    await page.goto("/v3/");
    await page.waitForFunction(() => typeof window.__v3Tick === "function");

    const menuIds = (flag) =>
      page.evaluate(
        ({ flag, at }) => {
          window.CONFIG.features.foldHomeTiles = flag;
          return window.__v3Tick(at).queue.filter((c) => c.source === "tonightsMenu").map((c) => c.id);
        },
        { flag, at: noon.getTime() }
      );

    // On — and the house cache has to have landed first, so poll the positive.
    await expect.poll(() => menuIds(true), { timeout: 8000 }).toEqual(["tonights-menu:Butter chicken"]);
    // Off: the flip is the rollback.
    expect(await menuIds(false)).toEqual([]);
    // And back: the rollback of the rollback.
    expect(await menuIds(true)).toEqual(["tonights-menu:Butter chicken"]);

    expect(pageErrors).toEqual([]);
  });
});
