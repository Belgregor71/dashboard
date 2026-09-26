import { test, expect } from "@playwright/test";
import {
  easterSunday, seasonOf, seasonRate, planFor, isQuiet, chooseDogs, rollRate,
  createDogSchedule, SEASONS, GENERIC, SEASONAL
} from "../src/v3/core/dog-schedule.js";
import { parseBirthdays } from "../server/routes/dogs.js";
import { OCCASIONS } from "../src/v3/core/dog-occasion.js";

/* ═══════════════════════════════════════════════════════════════════════════
   DOG SCHEDULE — the calendar, the gates and the rates, all pure and all on a
   fixed calendar (no browser, no real clock). The owner's rules, 2026-09-26:

     · seasons: NYE 30 Dec–2 Jan · Australia Day 20–26 Jan · Easter, the week
       to Easter Monday · Halloween all October · Christmas 3–26 Dec
     · a season climbs toward its day, max 5 an hour; generic ~1, max 2
     · birthdays only on the day, and they win the day
     · one dog or both, never the same dog twice
     · only to someone there, not 22:00–07:00, not over a SUBJECT

   The delivered rates are measured by running the real clock loop against a
   seeded random for thousands of present hours — the promise is what the
   wall DOES, not what a constant says.
   ═══════════════════════════════════════════════════════════════════════════ */

const at = (iso) => new Date(iso);
const kind = (iso, b) => { const p = planFor(at(`${iso}T12:00`), b); return `${p.occasion}:${p.rate}`; };

/* mulberry32: a seeded random, so a rate test is the same every run. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* Run the real schedule for `hours` of PRESENT time, calendar held at `iso`. */
function simulate(iso, hours, seed = 1) {
  const plan = planFor(at(iso));
  let t = at("2030-03-04T07:00").getTime();
  const shows = [];
  const s = createDogSchedule({
    show: (occasion, o) => { shows.push({ t, occasion, ...o }); return Promise.resolve({ shown: true }); },
    isPresent: () => true, now: () => new Date(t), random: seeded(seed), planOf: () => plan
  });
  let awake = 0;
  while (awake < hours * 60) {
    if (!isQuiet(new Date(t))) awake += 1;
    s.tick();
    t += 60_000;
  }
  let worst = 0;
  let minGap = Infinity;
  for (let i = 0; i < shows.length; i++) {
    let n = 0;
    for (let j = i; j < shows.length && shows[j].t < shows[i].t + 3_600_000; j++) n++;
    worst = Math.max(worst, n);
    if (i) minGap = Math.min(minGap, shows[i].t - shows[i - 1].t);
  }
  return { perHour: shows.length / hours, worst, minGap, shows, plan };
}

/* ── On the page: the flag, and the live gates' wiring ──────────────────── */

const LOCAL_MIDDAY = new Date("2026-09-11T12:00:00");   // a generic day, awake hours

function withFlag(page, on) {
  return page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: `${await res.text()}\nwindow.CONFIG.features.v3DogSchedule = ${on};\n` });
  });
}

async function boot(page, on) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const birthdayFetches = [];
  page.on("request", (r) => { if (r.url().includes("/api/dogs/birthdays")) birthdayFetches.push(r.url()); });
  await withFlag(page, on);
  await page.clock.setFixedTime(LOCAL_MIDDAY);
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function" && typeof window.dogOccasion?.show === "function");
  return { errors, birthdayFetches };
}

/* One tick with the dice forced to win — stub, tick, restore in one turn. */
const tickWon = (page) => page.evaluate(() => {
  const real = Math.random;
  Math.random = () => 0;
  try { return window.__dogSchedule.tick(); } finally { Math.random = real; }
});

test.describe("dog schedule on the page", () => {
  test("flag off: never armed — no clock, no birthdays fetch, no dogs", async ({ page }) => {
    const { errors, birthdayFetches } = await boot(page, false);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => typeof window.__dogSchedule)).toBe("undefined");
    expect(await page.evaluate(() => window.__v3().dogSchedule)).toBeNull();
    // `dogSchedule` is a key the readout HAS, so null above is the flag, not a missing field.
    expect(await page.evaluate(() => "dogSchedule" in window.__v3())).toBe(true);
    expect(birthdayFetches).toEqual([]);
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });

  test("flag on: an empty room gets nothing; someone there gets the dogs; a doorbell holds them off", async ({ page }) => {
    const { errors, birthdayFetches } = await boot(page, true);
    await page.waitForFunction(() => typeof window.__dogSchedule?.tick === "function");
    expect(birthdayFetches.length).toBe(1);
    expect(await page.evaluate(() => window.__v3().dogSchedule.today.kind)).toBe("generic");

    // Nobody in the kitchen: even a winning roll does nothing.
    expect(await tickWon(page)).toMatchObject({ fired: false, reason: "absent" });
    expect(await page.locator(".dogs").count()).toBe(0);

    // Someone walks in (the same entity presence.js listens to).
    await page.evaluate(() => window.__emitHaState({ entity_id: "binary_sensor.kitchen_motion_detected", state: "on", last_changed: new Date().toISOString() }));
    const fired = await tickWon(page);
    expect(fired.reason, "the gate that held").toBeUndefined();
    expect(fired).toMatchObject({ fired: true, occasion: "generic", mode: "peek" });
    // …and they are really on the glass, in a generic look, as the tick said.
    await page.waitForFunction(() => window.dogOccasion.state().dogs.length > 0, null, { timeout: 8_000 });
    const up = await page.evaluate(() => window.dogOccasion.state());
    expect(up.occasion).toBe("generic");
    expect(up.dogs.map((d) => d.id).sort()).toEqual([...fired.dogs].sort());
    await page.evaluate(() => window.dogOccasion.hide());

    // The doorbell rings: the wall goes to SUBJECT and the dogs wait.
    await page.evaluate(() => window.__emitHaState({ entity_id: "binary_sensor.doorbell_ringing", state: "on", last_changed: new Date().toISOString() }));
    await page.waitForFunction(() => window.__depth().depth >= 3, null, { timeout: 5_000 });
    expect(await tickWon(page)).toMatchObject({ fired: false, reason: "busy" });
    expect(await page.locator(".dogs").count()).toBe(0);
    expect(errors).toEqual([]);
  });
});

test.describe("dog schedule", () => {
  test("Easter Sunday, against published dates", () => {
    const known = { 2024: [3, 31], 2025: [4, 20], 2026: [4, 5], 2027: [3, 28], 2028: [4, 16], 2029: [4, 1], 2030: [4, 21], 2038: [4, 25], 2285: [3, 22] };
    for (const [y, [month, day]] of Object.entries(known)) {
      expect(easterSunday(Number(y)), y).toEqual({ month, day });
    }
  });

  test("every season's first day, THE day and last day — and the day either side is generic", () => {
    // [day before, first, the day, last, day after] → expected occasion:rate
    const cases = [
      ["christmas", ["2026-12-02", "2026-12-03", "2026-12-25", "2026-12-26", "2026-12-27"], [1, 5, 3]],
      ["newYear", ["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-02", "2027-01-03"], [1, 5, 1]],
      ["australiaDay", ["2027-01-19", "2027-01-20", "2027-01-26", "2027-01-26", "2027-01-27"], [1, 5, 5]],
      // Easter 2027 is 28 March: Monday of Holy Week 22nd, Easter Monday 29th.
      ["easter", ["2027-03-21", "2027-03-22", "2027-03-28", "2027-03-29", "2027-03-30"], [1, 5, 3]],
      ["halloween", ["2026-09-30", "2026-10-01", "2026-10-31", "2026-10-31", "2026-11-01"], [1, 5, 5]]
    ];
    for (const [id, [before, first, day, last, after], [r0, rDay, rLast]] of cases) {
      expect(kind(before), `${id} day before`).toBe("generic:1");
      expect(kind(first), `${id} first`).toBe(`${id}:${r0}`);
      expect(kind(day), `${id} the day`).toBe(`${id}:${rDay}`);
      expect(kind(last), `${id} last`).toBe(`${id}:${rLast}`);
      expect(kind(after), `${id} day after`).toBe("generic:1");
    }
    // New Year straddles the year line: 1 Jan is LAST year's season, tapering.
    expect(kind("2027-01-01")).toBe("newYear:3");
    // Easter moves: 2026's is 5 April — and 22 March 2026 is an ordinary day.
    expect(kind("2026-04-05")).toBe("easter:5");
    expect(kind("2026-04-06")).toBe("easter:3");
    expect(kind("2026-03-22")).toBe("generic:1");
  });

  test("a season only climbs toward its day, peaks at 5, and eases after", () => {
    for (const y of [2026, 2027, 2028]) {
      for (const [id, window] of Object.entries(SEASONS)) {
        const [start, peak, end] = window(y);
        let prev = 0;
        for (let d = start; d <= peak; d++) {
          const r = seasonRate(d, window(y));
          expect(r, `${id} ${y} day ${d - start}`).toBeGreaterThanOrEqual(prev);
          expect(r).toBeGreaterThanOrEqual(SEASONAL.floor);
          prev = r;
        }
        expect(seasonRate(peak, window(y)), `${id} peak`).toBe(SEASONAL.peak);
        for (let d = peak + 1; d <= end; d++) {
          expect(seasonRate(d, window(y)), `${id} after`).toBeLessThan(SEASONAL.peak);
        }
      }
    }
    // The cap climbs with it: a season's first day is capped like a generic day.
    expect(planFor(at("2026-12-03T12:00")).cap).toBe(GENERIC.cap);
    expect(planFor(at("2026-12-25T12:00")).cap).toBe(SEASONAL.cap);
    // Every season the calendar names is an occasion the dogs can wear.
    for (const id of Object.keys(SEASONS)) expect(OCCASIONS[id]?.peek, id).toBeTruthy();
    expect(OCCASIONS.generic?.peek).toBeTruthy();
    expect(OCCASIONS.birthday?.peek).toBeTruthy();
  });

  test("birthdays: only on the day, they win the day, and a dog's own day is his", () => {
    const days = parseBirthdays("Benji 20/5, Teddy 20/5, Greg 2/12, Brett 16/5, Teddy 9/10, Pat 9/10").days;
    // Both dogs share 20 May: that day is both of theirs.
    expect(planFor(at("2027-05-20T12:00"), days)).toMatchObject({ kind: "birthday", occasion: "birthday", rate: 5, dogs: ["benji", "teddy"] });
    // A family birthday: either dog, or both.
    expect(planFor(at("2027-05-16T12:00"), days)).toMatchObject({ kind: "birthday", dogs: ["benji", "teddy"] });
    // Only on the day.
    expect(planFor(at("2027-05-17T12:00"), days).kind).toBe("generic");
    expect(planFor(at("2027-12-01T12:00"), days).kind).toBe("generic");
    // 2 Dec is the day before Christmas opens — a birthday, then Christmas.
    expect(planFor(at("2026-12-02T12:00"), days).kind).toBe("birthday");
    expect(planFor(at("2026-12-03T12:00"), days).occasion).toBe("christmas");
    // Inside a season the birthday wins that day, and the season resumes.
    const lone = [{ month: 10, day: 15, dogs: ["teddy"], family: false }];
    expect(planFor(at("2026-10-15T12:00"), lone)).toMatchObject({ occasion: "birthday", dogs: ["teddy"], runShare: 0 });
    expect(planFor(at("2026-10-16T12:00"), lone).occasion).toBe("halloween");
    // A dog's day shared with a person is everyone's.
    expect(planFor(at("2026-10-09T12:00"), days).dogs).toEqual(["benji", "teddy"]);
  });

  test("parseBirthdays: dates and dog ids out, names never; bad entries counted, not guessed", () => {
    const { days, bad } = parseBirthdays("Benji 20/5; Teddy 20/5, Greg 2/12 ,brett 16/5, nobody, Zed 31/2, Ann 29/2");
    expect(days).toEqual([
      { month: 2, day: 29, dogs: [], family: true },
      { month: 5, day: 16, dogs: [], family: true },
      { month: 5, day: 20, dogs: ["benji", "teddy"], family: false },
      { month: 12, day: 2, dogs: [], family: true }
    ]);
    expect(bad).toBe(2);   // "nobody" (no date) and 31 February
    expect(JSON.stringify(days)).not.toMatch(/greg|brett|ann/i);
    expect(parseBirthdays(undefined)).toEqual({ days: [], bad: 0 });
  });

  test("gates: quiet hours, an empty room, a SUBJECT on the glass", () => {
    const calls = [];
    const make = (iso, { present = true, busy = false } = {}) => createDogSchedule({
      show: (...a) => { calls.push(a); return Promise.resolve({ shown: true }); },
      isPresent: () => present, isBusy: () => busy, now: () => at(iso), random: () => 0
    });
    expect(make("2026-09-26T22:00").tick()).toMatchObject({ fired: false, reason: "quiet" });
    expect(make("2026-09-26T06:59").tick()).toMatchObject({ fired: false, reason: "quiet" });
    expect(make("2026-09-26T12:00", { present: false }).tick()).toMatchObject({ fired: false, reason: "absent" });
    expect(make("2026-09-26T12:00", { busy: true }).tick()).toMatchObject({ fired: false, reason: "busy" });
    expect(calls).toEqual([]);
    // Positive control, same conditions otherwise: 07:00 and 21:59 fire.
    expect(make("2026-09-26T07:00").tick()).toMatchObject({ fired: true, occasion: "generic" });
    expect(make("2026-09-26T21:59").tick()).toMatchObject({ fired: true, occasion: "generic" });
    expect(calls).toHaveLength(2);
  });

  test("the cap and the gap hold; a popup that never reached the glass gives its slot back", async () => {
    let t = at("2026-12-25T09:00").getTime();
    const answer = { shown: true };
    const s = createDogSchedule({
      show: () => Promise.resolve(answer), isPresent: () => true, now: () => new Date(t), random: () => 0
    });
    const fire = () => s.tick();
    // random 0 always wins the dice: only the gap and the cap stop it.
    expect(fire().fired).toBe(true);
    t += 5 * 60_000;
    expect(fire()).toMatchObject({ fired: false, reason: "gap" });
    for (let i = 0; i < 4; i++) { t += 6 * 60_000; expect(fire().fired, `popup ${i + 2}`).toBe(true); }
    t += 6 * 60_000;
    expect(fire()).toMatchObject({ fired: false, reason: "cap" });   // 5 inside 60 minutes
    t = at("2026-12-25T10:00").getTime() + 1;
    expect(fire().fired, "the first has left the hour").toBe(true);
    t += 6 * 60_000;
    expect(fire()).toMatchObject({ fired: false, reason: "cap" });   // 9:11–9:29 + 10:00 still count
    expect(answer).toEqual({ shown: true });

    // A show answered { shown: false } — busy, an asset failed — is handed
    // back: seven in 42 minutes that never reached the glass spend nothing.
    let u = at("2026-12-25T12:00").getTime();
    const failing = createDogSchedule({
      show: () => Promise.resolve({ shown: false, reason: "asset" }),
      isPresent: () => true, now: () => new Date(u), random: () => 0
    });
    for (let i = 0; i < 7; i++) {
      expect(failing.tick().fired, `attempt ${i + 1}`).toBe(true);
      await new Promise((r) => setTimeout(r, 0));
      expect(failing.state().lastHour).toBe(0);
      u += 6 * 60_000;
    }
  });

  test("dogs: one or both, never the same dog twice; the run is Christmas's, and always the pair", () => {
    const r = seeded(7);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const d = chooseDogs(["benji", "teddy"], r);
      expect(new Set(d).size, "no dog twice").toBe(d.length);
      seen.add(d.join("+"));
    }
    expect([...seen].sort()).toEqual(["benji", "benji+teddy", "teddy"]);
    expect(chooseDogs(["teddy"], r)).toEqual(["teddy"]);

    const xmas = simulate("2026-12-25T12:00", 600, 3).shows;
    const runs = xmas.filter((s) => s.mode === "run");
    expect(runs.length / xmas.length).toBeGreaterThan(0.12);
    expect(runs.length / xmas.length).toBeLessThan(0.28);
    expect(runs.every((s) => s.dogs.join("+") === "benji+teddy")).toBe(true);
    for (const iso of ["2026-10-31T12:00", "2026-09-26T12:00", "2027-03-28T12:00"]) {
      expect(simulate(iso, 200, 5).shows.every((s) => s.mode === "peek"), iso).toBe(true);
    }
  });

  test("delivered rates, per present hour, on the real loop", () => {
    // The dice compensates for the gap's dead time (rollRate), or a peak of 5
    // would deliver ~3.3.
    expect(rollRate({ rate: 5, minGapMs: 6 * 60_000 })).toBeCloseTo(10, 6);
    const generic = simulate("2026-09-26T12:00", 3000, 11);
    expect(generic.perHour).toBeGreaterThan(0.8);
    expect(generic.perHour).toBeLessThanOrEqual(1.05);
    expect(generic.worst, "never more than twice an hour").toBe(2);
    expect(generic.minGap).toBeGreaterThanOrEqual(GENERIC.minGapMin * 60_000);

    const first = simulate("2026-12-03T12:00", 3000, 12);
    expect(first.worst, "a season's first day is capped like a generic one").toBe(2);

    const mid = simulate("2026-12-14T12:00", 3000, 13);
    expect(mid.perHour).toBeGreaterThan(first.perHour + 1);

    const day = simulate("2026-12-25T12:00", 3000, 14);
    expect(day.perHour).toBeGreaterThan(mid.perHour);
    expect(day.perHour).toBeGreaterThan(4);
    expect(day.worst, "never more than 5 an hour").toBe(5);
    expect(day.minGap).toBeGreaterThanOrEqual(SEASONAL.minGapMin * 60_000);
  });
});
