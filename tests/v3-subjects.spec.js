import { test, expect } from "@playwright/test";
import { eventsForDay, displayTitleOf } from "../src/v3/subjects/calendar.js";
import { yearsAgo, assetDate, captionFor } from "../src/v3/subjects/memories.js";

/* Phase 4 — the six remaining depth-3 subjects.

   Depth 3 is the one genuinely per-event path in V3, and per-event paths are
   where this house has leaked before (709 zombie lottie wrappers, 230k detached
   nodes). So the assertions that matter most here are not about layout: they
   are that nothing mounts empty, that leaving takes everything with it, and
   that every image src is dropped BEFORE its node is detached.

   Every /api/** is answered by this file. A subject that renders whatever
   happens to be playing in the developer's living room is the same trap
   tests/v3-spread.spec.js paid for on its first run — what a subject shows is a
   function of the house's real state, so a spec about subjects cannot share one
   with the house. */

/* Today's date in the BROWSER's local terms, not UTC. `eventsForDay` compares
   `toDateString()` values, so an event stamped from a UTC slice lands on
   yesterday for half of every Brisbane day — a spec that passes before 10am and
   fails after it, which is the worst kind. */
function calToday() {
  const d = new Date();
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return [
    { title: "Dentist", start: `${ymd}T09:30:00` },
    { title: "Meal: Chicken Fajitas", start: `${ymd}T18:30:00` },
    { title: "Soccer", start: `${ymd}T16:00:00` }
  ];
}

/**
 * Every upstream answered, deliberately and identically on every machine.
 * `routes` maps a pathname PREFIX to its JSON body; null means 503.
 */
async function bootV3(page, routes = {}) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const key = Object.keys(routes).find((k) => url.pathname.startsWith(k));
    if (key) {
      const body = routes[key];
      if (body === null) return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(typeof body === "function" ? body(url) : body)
      });
    }
    // Images are answered as images so a subject's <img> resolves rather than
    // hanging: a pending request is not the same as a failed one and the
    // teardown assertions below want a settled DOM.
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

/** Drive one subject the way the voice would, and read back what mounted. */
async function show(page, utterance) {
  return page.evaluate(async (text) => {
    const res = await window.__v3Transcript(text);
    const mount = document.getElementById("subject-mount");
    return {
      lane: res?.lane ?? null,
      handled: res?.handled ?? false,
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      subject: window.__v3().subject,
      html: mount.innerHTML,
      text: mount.textContent,
      cell: mount.firstElementChild?.dataset.cell ?? null,
      children: mount.childElementCount,
      rows: mount.querySelectorAll(".subject__row").length,
      images: mount.querySelectorAll("img").length
    };
  }, utterance);
}

/* ── The pure halves ────────────────────────────────────────────────────────
   Two decisions in Phase 4 are not about the DOM at all, so they are tested
   without one.
─────────────────────────────────────────────────────────────────────────── */

test.describe("the day's window", () => {
  const now = new Date("2026-08-10T12:00:00");
  const on = (day, time) => `2026-08-${day}T${time}:00`;

  test("today's events come back in order, whatever order they arrived in", () => {
    const rows = eventsForDay(
      [
        { title: "Soccer", start: on("10", "16:00") },
        { title: "Dentist", start: on("10", "09:30") },
        { title: "Tomorrow", start: on("11", "09:00") }
      ],
      now
    );
    expect(rows.map((r) => r.title)).toEqual(["Dentist", "Soccer"]);
  });

  test("⚠ NOT LOADED IS NOT EMPTY — a cold cache is null, an empty day is []", () => {
    // The distinction this codebase has now got wrong four separate times. null
    // means "we do not know" and must fall the turn through; [] means "we know,
    // and there is nothing", which is a real answer worth showing.
    expect(eventsForDay(undefined, now)).toBeNull();
    expect(eventsForDay(null, now)).toBeNull();
    expect(eventsForDay([], now)).toEqual([]);
  });

  test("an unparseable start is dropped rather than crashing the list", () => {
    const rows = eventsForDay([{ title: "Junk", start: "not a date" }, { title: "Real", start: on("10", "09:00") }], now);
    expect(rows.map((r) => r.title)).toEqual(["Real"]);
  });
});

test.describe("how long ago a photograph was", () => {
  const now = new Date("2026-08-10T12:00:00");
  test("reads as a person would say it", () => {
    expect(yearsAgo("2025-08-10T08:00:00Z", now)).toBe("last year");
    expect(yearsAgo("2019-08-10T08:00:00Z", now)).toBe("7 years ago");
    expect(yearsAgo("2026-08-10T08:00:00Z", now)).toBe("this year");
  });
  test("an undated asset says nothing rather than guessing", () => {
    expect(yearsAgo(undefined, now)).toBeNull();
    expect(yearsAgo("", now)).toBeNull();
    expect(yearsAgo("not a date", now)).toBeNull();
    /* ⚠ null specifically, and it is not paranoia — `new Date(null)` is the
       EPOCH, so it sails past an isFinite check and captions an undated photo
       "56 years ago". `new Date(undefined)` is invalid, which is exactly why
       the line above passed while this one was broken. */
    expect(yearsAgo(null, now)).toBeNull();
  });

  test("⚠ the date field is localDateTime — SEEN BLANK ON THE WALL", () => {
    /* Nine photographs went up with not one caption, because this file was
       written against the raw Immich asset's `takenAt` while the route returns
       `slim(a)`, which renames it. Nothing threw; the captions were simply
       absent and the screen looked deliberate. This is the exact payload
       /api/immich/on-this-day really returns. */
    const real = {
      id: "29f27bb6-48c5-4b48-99a4-ccb20f57ede2",
      localDateTime: "2022-08-09T17:57:10.444Z",
      city: "Nudgee", state: "Queensland", country: "Australia"
    };
    expect(assetDate(real)).toBe("2022-08-09T17:57:10.444Z");
    expect(captionFor(real, now)).toBe("4 years ago · Nudgee");
  });

  test("place is optional, and an asset with neither says nothing", () => {
    expect(captionFor({ localDateTime: "2025-08-09T00:00:00Z", city: null }, now)).toBe("last year");
    expect(captionFor({ city: "Nudgee" }, now)).toBe("Nudgee");
    expect(captionFor({}, now)).toBeNull();
  });

  test("the older field names still work, so the fix is additive", () => {
    expect(assetDate({ takenAt: "2020-01-01T00:00:00Z" })).toBe("2020-01-01T00:00:00Z");
    expect(assetDate({ fileCreatedAt: "2020-01-01T00:00:00Z" })).toBe("2020-01-01T00:00:00Z");
  });
});

test.describe("what a calendar row actually says", () => {
  test("⚠ the Meal: routing prefix never reaches the glass — SEEN ON THE WALL", () => {
    /* The wall read "6pm — Meal: Chicken Fajitas". `Meal:` is how tonightsMenu,
       the recipe panel and houseSnapshot FIND dinner; it is not a word anyone
       should read. Every other consumer strips it and this one did not. */
    expect(displayTitleOf({ title: "Meal: Chicken Fajitas" })).toBe("Chicken Fajitas");
    expect(displayTitleOf({ displayTitle: "Meal:   Lasagne" })).toBe("Lasagne");
  });

  test("an ordinary event is untouched, and an empty one still says something", () => {
    expect(displayTitleOf({ title: "Dentist" })).toBe("Dentist");
    // "Meal:" with nothing after it must not render as an empty row.
    expect(displayTitleOf({ title: "Meal:" })).toBe("Meal:");
    expect(displayTitleOf({})).toBe("Something");
  });
});

/* ── The mounted halves ─────────────────────────────────────────────────────
   Everything below needs a real page: what needs a browser is MOUNTING.
─────────────────────────────────────────────────────────────────────────── */

test("the day mounts as rows, at depth 3, with the voice pointing at it", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": calToday() });
  await page.evaluate(() => window.__v3Refresh());

  const got = await show(page, "show me my day");

  expect(got.handled).toBe(true);
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("voice-show.day");
  expect(got.subject).toBe("show.day");
  expect(got.cell).toBe("calendar");
  // Three events today; the "Meal:" one is a real calendar entry and belongs
  // on the day just as much as the dentist does.
  expect(got.rows).toBe(3);
  expect(got.text).toContain("Dentist");
  expect(pageErrors).toEqual([]);
});

test("⚠ a cold calendar shows NOTHING rather than a confident empty day", async ({ page }) => {
  // The failure this guards is not a crash. It is the wall calmly stating that
  // the day is clear on the one morning someone was relying on it.
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": null });

  const got = await show(page, "show me my day");

  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("a loaded-but-empty day is a real answer and does earn the screen", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": [] });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await show(page, "show me my day");

  expect(got.subject).toBe("show.day");
  expect(got.depth).toBe(3);
  expect(got.text).toContain("Nothing on today");
  expect(pageErrors).toEqual([]);
});

test("the year mounts the photographs and captions how long ago they were", async ({ page }) => {
  // The payload shape is the REAL one — localDateTime + city — because writing
  // this against the upstream API's field names is what shipped nine blank
  // captions to the wall.
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": {
      assets: [
        { id: "aaa", localDateTime: "2019-08-10T08:00:00Z", city: "Nudgee" },
        { id: "bbb", localDateTime: "2025-08-10T08:00:00Z", city: null }
      ]
    }
  });

  const got = await show(page, "show me the year");

  expect(got.subject).toBe("show.year");
  expect(got.depth).toBe(3);
  expect(got.images).toBe(2);

  const caps = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".subject__caption-sm")).map((n) => n.textContent)
  );
  // The one thing the subject is ABOUT. Blank captions are the failure that
  // looked deliberate on the glass.
  expect(caps).toEqual(["7 years ago · Nudgee", "last year"]);
  expect(pageErrors).toEqual([]);
});

test("⚠ a text subject carries the solved scrim across the WHOLE frame", async ({ page }) => {
  /* --scrim is a gradient `to top` that is transparent by 88%, which is right
     for depths 0-1 (an hour and one line, both at the floor) and wrong for a
     subject that writes across the top half. Seen on the wall: a title over
     bright sky at the edge of legible. The veil uses the SOLVED opacity, so no
     number is invented — it just applies it at full coverage. */
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": calToday() });
  await page.evaluate(() => window.__v3Refresh());
  await show(page, "show me my day");

  const got = await page.evaluate(() => {
    const el = document.querySelector(".subject--calendar");
    const solved = getComputedStyle(document.documentElement).getPropertyValue("--scrim-opacity").trim();
    const bg = getComputedStyle(el).backgroundColor;
    const alpha = Number((bg.match(/[\d.]+\)$/) ?? ["1)"])[0].replace(")", ""));
    return { solved: Number(solved), bg, alpha, opaque: bg !== "rgba(0, 0, 0, 0)" };
  });

  expect(got.opaque, `the subject painted no veil at all: ${got.bg}`).toBe(true);
  // The veil tracks the sampler's answer rather than a hand-picked constant.
  expect(got.alpha).toBeGreaterThan(0);
  expect(Math.abs(got.alpha - got.solved)).toBeLessThan(0.06);
  expect(pageErrors).toEqual([]);
});

test("⚠ nothing on the surface renders outside the panel", async ({ page }) => {
  /* The bug this exists for was invisible to every previous verification: the
     heard transcript had NO positioning and flowed at the top-left of an
     unpadded fixed stage, so it rendered half off the top edge of the wall.
     Reading textContent over CDP — which is how V3 has been checked since Phase
     1 — cannot see that. A geometry assertion can.

     Also asserts depth 3 is genuinely full bleed: it is "one thing, full bleed"
     in the plan, and it was rendering as a rectangle inset by the safe area. */
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": calToday() });
  await page.evaluate(() => window.__v3Refresh());
  await show(page, "show me my day");

  const got = await page.evaluate(() => {
    const vw = window.innerWidth, vh = window.innerHeight;
    const box = (sel) => {
      const el = document.querySelector(sel);
      if (!el || el.hidden) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, left: r.left, right: r.right, bottom: r.bottom, w: r.width };
    };
    return { vw, vh, heard: box("#heard"), subject: box(".subject--calendar") };
  });

  // The transcript is on screen, in full, inside the panel.
  expect(got.heard, "the transcript did not render at all").not.toBeNull();
  expect(got.heard.top, "the transcript is clipped off the top of the wall").toBeGreaterThanOrEqual(0);
  expect(got.heard.left).toBeGreaterThanOrEqual(0);
  expect(got.heard.right).toBeLessThanOrEqual(got.vw);

  // The subject IS the screen at depth 3, not a card floating on it.
  expect(got.subject.left).toBe(0);
  expect(got.subject.top).toBe(0);
  expect(got.subject.right).toBe(got.vw);
  expect(got.subject.bottom).toBe(got.vh);
  expect(pageErrors).toEqual([]);
});

test("⚠ an Immich with nothing for today never reaches depth 3", async ({ page }) => {
  // { assets: [] } is what an unconfigured Immich returns AND what a date
  // nobody photographed returns. Neither is a screen, and mounting an empty
  // grid at depth 3 is the black-screen bug the composer caught in review.
  const { pageErrors } = await bootV3(page, { "/api/immich/on-this-day": { assets: [] } });

  const got = await show(page, "show me the year");

  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("assets with no id are skipped, and an all-junk answer mounts nothing", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": { assets: [{ takenAt: "2019-08-10T08:00:00Z" }, {}] }
  });

  const got = await show(page, "show me the year");

  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("the recipe lays out ingredients beside method", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    "/api/calendar/all": calToday(),
    "/api/recipe": {
      title: "Chicken Fajitas",
      servings: "serves 4",
      ingredients: ["2 chicken breasts", "1 red capsicum", "tortillas"],
      steps: ["Slice the chicken.", "Fry it hot.", "Warm the tortillas."]
    }
  });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await show(page, "show me the recipe");

  expect(got.subject).toBe("show.recipe");
  expect(got.depth).toBe(3);
  expect(got.cell).toBe("menu");
  expect(got.text).toContain("Chicken Fajitas");
  expect(got.text).toContain("red capsicum");
  expect(got.text).toContain("Warm the tortillas");
  expect(pageErrors).toEqual([]);
});

test("a dish with no saved method still shows the dish", async ({ page }) => {
  // The dish IS the answer to "what's for dinner". Falling through because the
  // method is missing would throw away the half we have.
  const { pageErrors } = await bootV3(page, {
    "/api/calendar/all": calToday(),
    "/api/recipe": null
  });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await show(page, "show me the recipe");

  expect(got.subject).toBe("show.recipe");
  expect(got.text).toContain("Chicken Fajitas");
  expect(got.text).toContain("No method saved");
  expect(pageErrors).toEqual([]);
});

test("the list is a screen job — all five on the wall, three in the sentence", async ({ page }) => {
  /* The plan's rule, made good on: never speak a list of more than three. The
     fast lane has said the first three and counted the rest since it shipped,
     and until now it was pointing at nothing. The snapshot is INJECTED rather
     than driven through the todo entities, because which entity ids this house
     has discovered is not what this test is about. */
  const { pageErrors } = await bootV3(page);

  const got = await page.evaluate(async () => {
    const snap = { todos: { shopping: ["milk", "bread", "coffee", "eggs", "butter"], tasks: null } };
    const res = await window.__v3Subject("show.list", { list: "shopping" }, snap);
    const mount = document.getElementById("subject-mount");
    return {
      mounted: Boolean(res),
      subject: window.__v3().subject,
      cell: mount.firstElementChild?.dataset.cell ?? null,
      rows: mount.querySelectorAll(".subject__row").length,
      text: mount.textContent
    };
  });

  expect(got.mounted).toBe(true);
  expect(got.subject).toBe("show.list");
  expect(got.cell).toBe("shopping");
  expect(got.rows).toBe(5);
  expect(got.text).toContain("butter");     // the screen carries the fourth and fifth
  expect(pageErrors).toEqual([]);
});

test("⚠ a disconnected Home Assistant does not get to say the list is empty", async ({ page }) => {
  /* The exact failure this repo shipped once: openTodoSummaries() returns []
     for an ABSENT entity, indistinguishable from a list that is genuinely
     empty, and the house said "the shopping list is empty" with total
     confidence on the one morning someone was relying on it. */
  const { pageErrors } = await bootV3(page);

  const got = await page.evaluate(async () => {
    const cold = await window.__v3Subject("show.list", { list: "shopping" }, { todos: { shopping: null } });
    const coldChildren = document.getElementById("subject-mount").childElementCount;
    const empty = await window.__v3Subject("show.list", { list: "shopping" }, { todos: { shopping: [] } });
    return {
      cold: Boolean(cold),
      coldChildren,
      empty: Boolean(empty),
      emptyText: document.getElementById("subject-mount").textContent
    };
  });

  expect(got.cold).toBe(false);             // not loaded — show nothing at all
  expect(got.coldChildren).toBe(0);
  expect(got.empty).toBe(true);             // loaded and empty — a real answer
  expect(got.emptyText).toContain("empty");
  expect(pageErrors).toEqual([]);
});

test("a long list is capped on the screen too, and says how many it left out", async ({ page }) => {
  const { pageErrors } = await bootV3(page);

  const got = await page.evaluate(async () => {
    const items = Array.from({ length: 20 }, (_, i) => `item ${i + 1}`);
    await window.__v3Subject("show.list", { list: "todo" }, { todos: { tasks: items } });
    const mount = document.getElementById("subject-mount");
    return { rows: mount.querySelectorAll(".subject__row").length, text: mount.textContent };
  });

  // Twelve items plus the "and 8 more" line. The fix for a thirteenth is never
  // a smaller row — nothing below the 32px floor is received at 3m.
  expect(got.rows).toBe(13);
  expect(got.text).toContain("and 8 more");
  expect(pageErrors).toEqual([]);
});

test("⚠ leaving depth 3 drops every image src BEFORE detaching the node", async ({ page }) => {
  /* The leak this whole file is shaped around. An <img> whose src is still set
     keeps its connection and its decoded bitmap alive on a detached node — on a
     surface that runs for weeks that is not a leak, it is a fire. The nine
     plates of "the year" are the worst case in Phase 4. */
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": {
      assets: Array.from({ length: 9 }, (_, i) => ({ id: `a${i}`, takenAt: "2019-08-10T08:00:00Z" }))
    }
  });

  const got = await page.evaluate(async () => {
    await window.__v3Transcript("show me the year");
    const mount = document.getElementById("subject-mount");
    const imgs = Array.from(mount.querySelectorAll("img"));
    const before = imgs.length;

    // Recede the way the hold would, without waiting out the timer.
    window.__setDepth(0, "spec");

    return {
      before,
      // Read the DETACHED nodes we captured a reference to. Asking the mount
      // would prove only that they are gone, which is the easy half.
      srcsAfter: imgs.map((i) => i.getAttribute("src")),
      mountChildren: mount.childElementCount,
      subject: window.__v3().subject
    };
  });

  expect(got.before).toBe(9);
  expect(got.mountChildren).toBe(0);
  expect(got.subject).toBeNull();
  expect(got.srcsAfter.every((s) => s === "" || s === null), `srcs left set: ${got.srcsAfter}`).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("⚠ one subject replaces another rather than layering over it", async ({ page }) => {
  /* Phase 3's silent failure in a new shape: a doorbell announced over a
     picture of the side gate looked exactly like a broken doorbell camera.
     Whatever was mounted must be gone, and its images must be released, before
     the next subject arrives. */
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": { assets: [{ id: "aaa", takenAt: "2019-08-10T08:00:00Z" }] },
    "/api/calendar/all": []
  });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await page.evaluate(async () => {
    await window.__v3Transcript("show me the year");
    const first = Array.from(document.querySelectorAll("#subject-mount img"));
    await window.__v3Transcript("show me my day");
    const mount = document.getElementById("subject-mount");
    return {
      subject: window.__v3().subject,
      children: mount.childElementCount,
      plates: mount.querySelectorAll(".subject__plate").length,
      firstSrcs: first.map((i) => i.getAttribute("src"))
    };
  });

  expect(got.subject).toBe("show.day");
  expect(got.children).toBe(1);            // exactly one subject, never two
  expect(got.plates).toBe(0);              // the year is gone, not underneath
  expect(got.firstSrcs.every((s) => s === "" || s === null)).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("⚠ fifteen show/leave cycles leave the DOM exactly where they found it", async ({ page }) => {
  // The same teardown proof Phase 1 used for the camera subject, widened to the
  // Phase 4 six. A single cycle proves nothing about a wall that runs for weeks.
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": { assets: [{ id: "aaa", takenAt: "2019-08-10T08:00:00Z" }] },
    "/api/calendar/all": []
  });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await page.evaluate(async () => {
    const count = () => document.querySelectorAll("*").length;
    const settle = count();
    for (let i = 0; i < 15; i++) {
      await window.__v3Transcript("show me the year");
      window.__setDepth(0, "spec");
      await window.__v3Transcript("show me my day");
      window.__setDepth(0, "spec");
    }
    return { settle, after: count(), mount: document.getElementById("subject-mount").childElementCount };
  });

  expect(got.mount).toBe(0);
  expect(got.after, `DOM grew ${got.after - got.settle} nodes over 15 cycles`).toBe(got.settle);
  expect(pageErrors).toEqual([]);
});

/* ── The briefing window (step 3.4) ─────────────────────────────────────────
   Deferred out of Phase 3 and landed here. The assertion that matters is not
   that it opens — it is that a CLOCK ALONE never opens it.
─────────────────────────────────────────────────────────────────────────── */

test("⚠ A CLOCK IS NOT A CAUSE — an empty room gets no briefing", async ({ page }) => {
  /* §5.1: time passing is not a cause. A wall that lights itself at 5:35am in
     an empty kitchen and reads the news to nobody is the screen talking to
     itself, which is the behaviour V3 exists to not have. The window is a
     PERMISSION; the person is the cause. */
  const { pageErrors } = await bootV3(page, {
    "/api/ai/brief": { summary: "A cool start, clearing by lunch. Nothing on until four." }
  });

  const got = await page.evaluate(async () => {
    window.__v3Presence(false);
    // Drive the SCHEDULE rather than the forced path, at a moment inside a real
    // fire window, with nobody there. `force` would skip the very gate this
    // test exists to prove.
    const monday0540 = new Date();
    monday0540.setDate(monday0540.getDate() - ((monday0540.getDay() + 6) % 7)); // this week's Monday
    monday0540.setHours(5, 40, 0, 0);
    const result = await window.__v3Briefing({ now: monday0540 });
    return {
      result,
      depth: window.__depth().depth,
      subject: window.__v3().subject,
      children: document.getElementById("subject-mount").childElementCount
    };
  });

  expect(got.result).toBeNull();
  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("the briefing opens forced, holds longer than a subject, and speaks only its opening", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    "/api/ai/brief": {
      summary: "A cool start, clearing by lunch. Nothing on until four. The bins go out tonight."
    }
  });

  const got = await page.evaluate(async () => {
    await window.__v3Briefing({ force: true });
    const mount = document.getElementById("subject-mount");
    return {
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      subject: window.__v3().subject,
      last: window.__v3().briefing,
      text: mount.textContent,
      paras: mount.querySelectorAll(".subject__prose").length
    };
  });

  expect(got.depth).toBe(3);
  // FORCED, not deepened — the reason carries the provenance that the mounted
  // subject cannot: "brief me" and the window mount the same thing.
  expect(got.reason).toBe("briefing:window");
  expect(got.subject).toBe("show.briefing");
  expect(got.last.shown).toBe(true);
  // The screen carries the whole thing, including the sentence the two-sentence
  // cap keeps out of the spoken half.
  expect(got.text).toContain("bins go out tonight");
  expect(got.paras).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});

test("⚠ a model that answers nothing never touches the depth", async ({ page }) => {
  // Nothing may flip the depth into a layer with nothing in it. The briefing is
  // the only Phase 4 subject whose content is generated, so it is the only one
  // that can be asked for and still legitimately have no text.
  const { pageErrors } = await bootV3(page, { "/api/ai/brief": null });

  const got = await page.evaluate(async () => {
    const last = await window.__v3Briefing({ force: true });
    return {
      last,
      depth: window.__depth().depth,
      subject: window.__v3().subject,
      children: document.getElementById("subject-mount").childElementCount
    };
  });

  expect(got.last.shown).toBe(false);
  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});
