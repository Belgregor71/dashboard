import { test, expect } from "./fixtures/coverage.js";
import { dayBeats, MAX_BEATS, WINDOW_MS } from "../server/services/dayBeats.js";
import { lapseShare, lapseStart, spotFor } from "../src/v3/subjects/day-lapse.js";
import { matchIntent } from "../src/js/services/localIntents.js";

/* The day in 20 seconds (features.v3DayLapse). The real plan is gitignored, so the
   page gets a fixture plate. Time on the page is fixed; the run itself is Web
   Animations, so the spec jumps the run rather than waiting 20 s for it. */

const MIDDAY = new Date("2026-06-15T12:00:00+10:00").getTime();
const at = (hhmm) => new Date(`2026-06-15T${hhmm}:00+10:00`).getTime();
const SPAN = { from: at("00:00"), to: MIDDAY };

const trigger = (time, camera = "driveway") => ({
  surface: "spread", id: `camera-trigger:${time}`, source: "cameraTrigger",
  evidenceKey: `ha:binary_sensor.${camera}_motion_detected`, shown: true, start: time + 9000, end: time + 20_000
});

test.describe("what may be played", () => {
  test("a trigger plays when the motion was, not when it reached the glass, and once per id", () => {
    const row = trigger(at("08:10"));
    const beats = dayBeats([row, { ...row, surface: "glance", start: row.start + 60_000 }], [], SPAN);
    expect(beats).toEqual([{ at: at("08:10"), kind: "camera", camera: "driveway", n: 1 }]);
  });

  test("⛔ nothing about a person can ride through, whatever the row carries", () => {
    const beats = dayBeats([
      { surface: "glance", id: "arrival", source: "arrival", evidenceKey: "ha:person", shown: true, start: at("08:00"), end: at("08:01") },
      { surface: "glance", id: null, source: "arrival", evidenceKey: null, shown: true, start: at("08:00"), end: at("08:01") },
      { ...trigger(at("09:00")), person: "person.brett", home: true }
    ], [{ at: at("09:30"), kind: "condition", from: "Clear", to: "Rain", person: "person.brett" }], SPAN);
    expect(beats.map((beat) => beat.kind)).toEqual(["camera", "sky"]);
    expect(JSON.stringify(beats)).not.toMatch(/person|home|arrival/);
  });

  test("a busy camera is one pulse per window and carries the count; cameras stay apart", () => {
    const beats = dayBeats([
      trigger(at("09:00")), trigger(at("09:05")), trigger(at("09:14")),
      trigger(at("09:00") + WINDOW_MS),
      trigger(at("09:06"), "patio")
    ], [], SPAN);
    expect(beats.map(({ camera, n }) => [camera, n])).toEqual([["driveway", 3], ["patio", 1], ["driveway", 1]]);
  });

  test("the door's paired rows are one beat; a night's bin reminders are one fact", () => {
    const door = { surface: "stage", source: "doorbell", evidenceKey: null, shown: true, start: at("13:14"), end: at("13:15") };
    const bin = { surface: "spread", source: "predictive", evidenceKey: null, shown: true, end: at("20:00") };
    const beats = dayBeats([
      { ...door, id: null }, { ...door, id: "show.camera" },
      { ...bin, id: "bin-night:2026-6-15", start: at("10:00") },
      { ...bin, id: "bin-night:2026-6-15", start: at("10:30") },
      { ...bin, id: "bin-last-chance:2026-6-15", start: at("11:30") }
    ], [], SPAN);
    expect(beats.map(({ kind, at: time }) => [kind, time])).toEqual([["bins", at("10:00")], ["door", at("13:14")]].filter(([, t]) => t <= MIDDAY));
    expect(dayBeats([{ ...door, start: at("11:00"), id: null }, { ...door, start: at("11:00"), id: "show.camera" }], [], SPAN))
      .toEqual([{ at: at("11:00"), kind: "door", n: 2 }]);
  });

  test("not shown, outside the day, and a row the log can't place are all left out", () => {
    expect(dayBeats([
      { ...trigger(at("08:00")), shown: false },
      trigger(SPAN.from - 1),
      trigger(MIDDAY + 60_000),
      { ...trigger(at("08:00")), evidenceKey: "ha:person" },
      { ...trigger(at("08:00")), evidenceKey: null },
      null
    ], null, SPAN)).toEqual([]);
  });

  test("the sky is the rain arriving, not every change of cloud", () => {
    const beats = dayBeats([], [
      { at: at("07:00"), kind: "condition", from: "Clear", to: "Partly cloudy" },
      { at: at("08:00"), kind: "condition", from: "Partly cloudy", to: "Light rain" },
      { at: at("08:30"), kind: "condition", from: "Light rain", to: "Heavy rain" },
      { at: at("09:00"), kind: "rain-chance", direction: "up", pct: 80 },
      { at: at("10:00"), kind: "condition", from: "Heavy rain", to: "Thunderstorm" }
    ], SPAN);
    expect(beats).toEqual([{ at: at("08:00"), kind: "sky", to: "Light rain" }]);
  });

  test("the cap drops the quietest cameras, never the door or the rain", () => {
    const rows = [];
    for (let i = 0; i < MAX_BEATS + 10; i += 1) rows.push(trigger(SPAN.from + i * WINDOW_MS));
    // One busy window, late enough to be past the quiet ones.
    const busy = SPAN.from + (MAX_BEATS - 1) * WINDOW_MS;
    rows.push(trigger(busy + 1000), trigger(busy + 2000));
    rows.push({ surface: "stage", id: null, source: "doorbell", shown: true, start: SPAN.from + 3600_000, end: MIDDAY });
    const beats = dayBeats(rows, [{ at: SPAN.from + 7200_000, kind: "condition", from: "Clear", to: "Rain" }], SPAN);
    expect(beats).toHaveLength(MAX_BEATS);
    expect(beats.filter((beat) => beat.kind !== "camera").map((beat) => beat.kind).sort()).toEqual(["door", "sky"]);
    expect(beats.some((beat) => beat.n === 3)).toBe(true);
    expect(beats.map((beat) => beat.at)).toEqual(beats.map((beat) => beat.at).sort((a, b) => a - b));
  });
});

test.describe("the run", () => {
  test("it starts at the first beat's hour and the day maps onto it", () => {
    expect(lapseStart([{ at: at("08:10") }], MIDDAY)).toBe(at("08:00"));
    expect(lapseShare(at("10:00"), at("08:00"), MIDDAY)).toBe(0.5);
    expect(lapseShare(MIDDAY, at("08:00"), MIDDAY)).toBe(1);
    expect(lapseShare(at("08:00"), at("08:00"), at("08:00"))).toBe(0);
  });

  test("each kind of beat finds its place, and a camera off the plan has none", () => {
    const plan = {
      width: 1500, height: 1000,
      cameras: { driveway: { fov: [[0.1, 0.5], [0.3, 0.7]] }, doorbell: { fov: [[0.5, 0.5], [0.7, 0.7]] } },
      diorama: { bins: [{ x: 150, y: 500 }] }
    };
    expect(spotFor({ kind: "camera", camera: "driveway" }, plan)).toEqual([0.2, 0.6]);
    expect(spotFor({ kind: "door" }, plan)).toEqual([0.6, 0.6]);
    expect(spotFor({ kind: "bins" }, plan)).toEqual([0.1, 0.5]);
    expect(spotFor({ kind: "camera", camera: "kitchen" }, plan)).toBeNull();
    expect(spotFor({ kind: "bins" }, { ...plan, diorama: undefined })).toBeNull();
  });
});

test.describe("the sentence", () => {
  const withFlag = (on, fn) => {
    const before = globalThis.window;
    globalThis.window = { CONFIG: { features: { v3DayLapse: on } } };
    try { return fn(); } finally { globalThis.window = before; }
  };

  for (const said of ["how was today", "How was the day?", "how's today been", "how is the day been", "replay the day", "the day in twenty seconds"]) {
    test(`"${said}" asks for it`, () => {
      expect(withFlag(true, () => matchIntent(said))?.id).toBe("show.lapse");
    });
  }

  for (const [said, other] of [["how's today looking", undefined], ["what's on today", "cal.today"], ["how was i sleeping", undefined], ["show me my day", "show.day"]]) {
    test(`"${said}" is not asking for it`, () => {
      const got = withFlag(true, () => matchIntent(said));
      expect(got?.id).not.toBe("show.lapse");
      if (other) expect(got?.id).toBe(other);
    });
  }

  test("flag off, the sentence is not claimed at all", () => {
    expect(withFlag(false, () => matchIntent("how was today"))).toBeNull();
    expect(withFlag(true, () => matchIntent("how was today"))).not.toBeNull();
  });
});

// 3x2 solid PNG.
const PLATE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAEElEQVR4nGNkYGD4DwYMAA0YAgEQ3YTtAAAAAElFTkSuQmCC",
  "base64"
);
const META = {
  width: 1500,
  height: 1000,
  upBearing: 22.5,
  cameras: {
    driveway: { fov: [[0.1, 0.5], [0, 0.4], [0.05, 0.9]] },
    doorbell: { fov: [[0.2, 0.5], [0, 0.3], [0, 0.6]] }
  },
  diorama: { bins: [{ x: 66, y: 874 }], cars: {} }
};
const BEATS = [
  { at: at("08:10"), kind: "camera", camera: "driveway", n: 3 },
  { at: at("09:00"), kind: "door", n: 1 },
  { at: at("09:30"), kind: "camera", camera: "kitchen", n: 1 },
  { at: at("10:00"), kind: "bins", n: 1 },
  { at: at("11:00"), kind: "sky", to: "Heavy rain" }
];

async function bootV3(page, { on = true, plan = true, beats = BEATS } = {}) {
  const pageErrors = [];
  const layers = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.clock.setFixedTime(new Date(MIDDAY));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (plan && url.pathname === "/api/house-plan") return route.fulfill({ json: META });
    if (url.pathname === "/api/house/day") return route.fulfill({ json: { ...SPAN, beats } });
    if (plan && url.pathname.startsWith("/api/house-plan/layer/")) {
      layers.push(url.pathname.split("/").pop());
      return route.fulfill({ status: 200, contentType: "image/png", body: PLATE });
    }
    return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
  });
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch({ maxRetries: 3 });
    await route.fulfill({
      response: res,
      body: `${await res.text()}\nwindow.CONFIG.features.v3DayLapse = ${on};\nwindow.CONFIG.features.v3CameraPlan = false;\nwindow.CONFIG.features.v3Diorama = false;\n`
    });
  });
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3 === "function");
  return { pageErrors, layers };
}

// The real voice lane: __v3Subject leaves the depth alone, so its subject sits hidden.
const ask = (page, sentence) => page.evaluate((text) => {
  window.__v3Transcript(text);
}, sentence);

// Read once, never `toHaveCount(0)`: that retries past a node that removes itself.
const lapseNow = (page) => page.locator(".lapse").count();

const jumpToEnd = (page) => page.locator(".lapse").evaluate((wrap) => {
  for (const animation of wrap.getAnimations({ subtree: true })) animation.currentTime = 21_000;
});

test.describe("on the wall", () => {
  test("asked, the day plays on the empty plan and leaves its marks", async ({ page }) => {
    const { pageErrors, layers } = await bootV3(page);
    await ask(page, "how was today");

    const lapse = page.locator(".lapse");
    await expect(lapse).toBeVisible();
    await expect(page.locator(".lapse__clock")).toHaveText(/^8:00\sam$/);
    // The render fell back to a browser serif once; no test saw it.
    for (const part of [".lapse__clock", ".lapse__note"]) {
      expect(await page.locator(part).evaluate((node) => getComputedStyle(node).fontFamily)).not.toMatch(/^("?Times|serif)/);
    }
    // The kitchen has no place on the plan, so it is not a pulse at the corner.
    await expect(page.locator(".lapse__pulse")).toHaveCount(3);
    await expect(page.locator(".lapse__pulse--door")).toHaveCount(1);
    await expect(page.locator(".lapse__pulse--bins")).toHaveCount(1);
    await expect(page.locator(".lapse__sky")).toHaveCount(1);
    // A parked car would be a claim about who was home.
    expect(layers).toEqual(["plan-empty"]);

    // 10 of the 240 minutes the run covers, after the lead.
    const delay = await page.locator(".lapse__pulse").first().evaluate((node) => node.getAnimations()[0].effect.getTiming().delay);
    expect(delay).toBeCloseTo(1000 + (10 / 240) * 20_000, 0);

    const spot = await page.locator(".lapse__pulse--door").evaluate((node) => [node.style.left, node.style.top]);
    expect(parseFloat(spot[0])).toBeCloseTo((0.2 / 3) * 100, 1);
    expect(parseFloat(spot[1])).toBeCloseTo((1.4 / 3) * 100, 1);

    await jumpToEnd(page);
    await expect(page.locator(".lapse__clock")).toHaveText(/^12:00\spm$/);
    // Every note reached, the last one standing.
    await expect(page.locator(".lapse__note")).toHaveText("Heavy rain");
    const left = await page.locator(".lapse__pulse").first().evaluate((node) => Number(getComputedStyle(node).opacity));
    expect(left).toBeCloseTo(0.3, 1);
    await expect(lapse).toBeVisible();
    expect(pageErrors).toEqual([]);
  });

  test("the note is the door when the door comes up", async ({ page }) => {
    const { pageErrors } = await bootV3(page, { beats: [BEATS[1]] });
    await ask(page, "how was today");
    await expect(page.locator(".lapse")).toBeVisible();
    await jumpToEnd(page);
    await expect(page.locator(".lapse__note")).toHaveText("The door");
    expect(pageErrors).toEqual([]);
  });

  test("flag off: the sentence draws nothing and fetches nothing", async ({ page }) => {
    const { pageErrors, layers } = await bootV3(page, { on: false });
    await ask(page, "how was today");
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(await lapseNow(page)).toBe(0);
    expect(layers).toEqual([]);
    expect(pageErrors).toEqual([]);
  });

  for (const [name, options] of [
    ["nothing logged yet", { beats: [] }],
    ["only a camera off the plan", { beats: [BEATS[2]] }],
    ["no plan on the box", { plan: false }]
  ]) {
    test(`${name}: it declines rather than playing an empty house`, async ({ page }) => {
      const { pageErrors } = await bootV3(page, options);
      await ask(page, "how was today");
      await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
      expect(await lapseNow(page)).toBe(0);
      expect(await page.evaluate(() => window.__v3().subject?.id ?? null)).not.toBe("show.lapse");
      expect(pageErrors).toEqual([]);
    });
  }

  test("the door takes the wall mid-run, and the run goes with it", async ({ page }) => {
    const { pageErrors } = await bootV3(page);
    await ask(page, "how was today");
    await expect(page.locator(".lapse")).toBeVisible();
    const image = await page.locator(".lapse .plan__image").elementHandle();
    const clock = await page.locator(".lapse__clock").elementHandle();
    await page.evaluate(() => { window.__v3Alert(); });

    await expect(page.locator(".subject--camera")).toBeVisible();
    expect(await lapseNow(page)).toBe(0);
    expect(await image.evaluate((node) => node.getAttribute("src"))).toBe("");
    // The interval is gone too: one still ticking would write over this. Comparing
    // two reads can't tell, because a cancelled run reads as the first frame.
    await clock.evaluate((node) => { node.textContent = "stopped"; });
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
    expect(await clock.evaluate((node) => node.textContent)).toBe("stopped");
    expect(pageErrors).toEqual([]);
  });
});
