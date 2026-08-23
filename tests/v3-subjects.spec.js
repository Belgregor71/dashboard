import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
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

/* bootV3 moved to fixtures/v3boot.js on 2026-08-16 — a second spec file (the
   week and the month) needed the same stubbed house, and two copies of "every
   upstream answered" would drift the moment one of them learned a new route. */

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
    return { vw, vh, heard: box("#heard"), subject: box(".subject--calendar"), title: box(".subject__title") };
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

  /* ⚠ And it does not land on the subject's own title. Parking the transcript
     top-left to fix the clipping put it exactly on top of "8 AUGUST", and the
     wall rendered the two strings overprinted into mush. Two absolutely
     positioned things in one corner is a collision nobody sees until they look
     at the glass, so it is asserted rather than remembered. */
  const overlaps =
    got.heard.left < got.title.right && got.heard.right > got.title.left &&
    got.heard.top < got.title.bottom && got.heard.bottom > got.title.top;
  expect(overlaps, "the transcript is printed over the subject's title").toBe(false);
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
  /* The same teardown proof Phase 1 used for the camera subject, widened to the
     Phase 4 six. A single cycle proves nothing about a wall that runs for weeks.

     ⚠ MOUNTED DIRECTLY RATHER THAN SPOKEN — measured 2026-08-15, this test was
     a coin flip on every run: thirty voice turns took **30.5 s** against the
     config's 30 s default, so it passed or failed on how busy the machine was.
     That is a real candidate for the "different single failure each run" flakes
     this suite has been carrying since 2026-08-08, and it is the same defect
     the F2 churn test below shipped with and had to fix.

     The subject here is TEARDOWN. The voice turn is proven by the tests above,
     and `__v3Subject` mounts without a TTS round trip — the browser's speech
     fallback is a serialised resource, which is what made the cost superlinear
     under load. Same fifteen cycles, ~1 s. */
  const { pageErrors } = await bootV3(page, {
    "/api/immich/on-this-day": { assets: [{ id: "aaa", takenAt: "2019-08-10T08:00:00Z" }] },
    "/api/calendar/all": []
  });
  await page.evaluate(() => window.__v3Refresh?.());

  const got = await page.evaluate(async () => {
    const count = () => document.querySelectorAll("*").length;
    // An unknown id is the documented way to clear, and __setDepth(0) is NOT:
    // __v3Subject does not touch depth, so there is no transition to fire the
    // handler that tears a subject down on the way out of SUBJECT.
    await window.__v3Subject("__spec.none__");
    const settle = count();
    for (let i = 0; i < 15; i++) {
      await window.__v3Subject("show.year");
      await window.__v3Subject("show.day");
    }
    await window.__v3Subject("__spec.none__");
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

/* ⚠⚠ THE BRIEFING WAS CLIPPING A THIRD OF ITSELF OFF THE WALL and every spec
   above passed throughout, because they all read `textContent` — which returns
   the whole string whether or not the screen ever showed it.

   `.subject__prose-stack` carried `max-width: 26ch`, and `ch` resolves against
   the element's OWN font-size — the 32px body floor, not the 96px Fraunces of
   the prose inside it. The "measured column" computed to 416px and then had
   96px text poured into it: eleven ragged lines about five characters wide,
   needing 1663px of an 800px stack, with `overflow: hidden` eating the rest.
   Found 2026-08-10 while measuring this surface for something else entirely.

   🔑 `ch` on a parent is not the child's measure — the unit is a typographic
   measure only when it is read in the type it is measuring.

   So this asserts the LAYOUT, not the text: a stack that overflows itself has
   lost content no textContent assertion can miss. Two independent numbers,
   because they fail differently — scrollHeight catches the block overflowing
   the stack, and the last line box's bottom catches the subtler one underneath
   it (`.said`'s 1.06 display leading could not contain its own ink at 96px, so
   the final line's descenders were clipped by 7.3px even once the width was
   right). */
test("the briefing fits the stack it is given — no line is clipped away", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    "/api/ai/brief": {
      summary:
        "A cool start, clearing by lunch and warm by the middle of the afternoon. " +
        "Nothing on the calendar until four. The bins go out tonight, and the green one is due."
    }
  });

  const got = await page.evaluate(async () => {
    await window.__v3Briefing({ force: true });
    const stack = document.querySelector(".subject__prose-stack");
    const prose = document.querySelector(".subject--briefing .subject__prose");
    const sr = stack.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(stack.lastElementChild);
    const rects = [...range.getClientRects()];
    const lastLine = rects[rects.length - 1];
    return {
      overflow: stack.scrollHeight - stack.clientHeight,
      overhang: lastLine.bottom - sr.bottom,
      // The measure must be taken in the prose's own type, so the column has to
      // be far wider than the 416px the stack's 32px `ch` produced.
      proseWidth: prose.getBoundingClientRect().width,
      proseFont: parseFloat(getComputedStyle(prose).fontSize)
    };
  });

  expect(got.proseFont).toBe(96);
  // 26ch of 96px Fraunces is ~1480px. Anything near 416 means the measure has
  // been read in the wrong font again.
  expect(got.proseWidth).toBeGreaterThan(1000);
  // 1px of sub-pixel rounding is not a clip; a line is ~115px.
  expect(got.overflow).toBeLessThanOrEqual(1);
  expect(got.overhang).toBeLessThan(2);
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

/* ═══════════════════════════════════════════════════════════════════════════
   F2 — THE THREE DISPATCH ENTRIES THAT HAD NEVER FIRED.

   `show.sky`, `show.tonight` and `show.media` have been in the registry since
   Phase 4 and not one of them had ever been driven from an utterance. That is
   not a theoretical gap in THIS table: Phase 6 shipped `show.status` shadowed by
   voiceCommands' NAV_KEYWORD_MAP and nobody noticed, because nothing exercised
   the row. The sweep of 2026-08-15 then found `show.media` declining on the
   wall with 0% coverage behind it.

   So each of the three is driven the whole way here — transcript, matcher,
   registry, mount — and the two defects that were sitting under them are
   pinned:

     · a subject that DECLINES threw away the fast lane's spoken answer and sent
       the turn to Assist (voice.js)
     · `__emitHaState` announced an entity without ever writing it to the cache,
       so no reader could see it and the media subject was undrivable (main.js)
   ═══════════════════════════════════════════════════════════════════════════ */

/** A radar meta payload in the server's real shape (routes/radar.js). */
const RADAR_META = {
  z: 7,
  frameTime: 1755000000,
  tiles: [
    { x: 117, y: 71 }, { x: 118, y: 71 }, { x: 119, y: 71 },
    { x: 117, y: 72 }, { x: 118, y: 72 }, { x: 119, y: 72 },
    { x: 117, y: 73 }, { x: 118, y: 73 }, { x: 119, y: 73 }
  ]
};

/** A configured player (core/config.js names both of these "Lounge Room"),
 *  mid-track, with artwork on the HA-relative path the resolver has to fix. */
const PLAYING = {
  entity_id: "media_player.living_room",
  state: "playing",
  attributes: {
    media_title: "Wichita Lineman",
    media_artist: "Glen Campbell",
    entity_picture: "/api/media_player_proxy/media_player.living_room",
    source: "Spotify Connect"
  }
};

test("the sky mounts the real radar mosaic, from a spoken 'show me the radar'", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/weather/radar/meta": RADAR_META });

  const got = await show(page, "show me the radar");

  expect(got.handled).toBe(true);
  expect(got.lane).toBe("local");
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("voice-show.sky");
  expect(got.subject).toBe("show.sky");
  expect(got.cell).toBe("sky");
  // Nine tiles, each a basemap with the rain layered over it.
  expect(got.images).toBe(18);
  expect(pageErrors).toEqual([]);
});

test("⚠ every radar tile is SQUARE — a 256px tile in a 16:9 cell loses 44% of the map", async ({ page }) => {
  /* Found by LOOKING, on the wall, the first time this subject was ever shown.
     The mosaic was `inset: 0` across the whole panel, so each of the nine cells
     was 640×360 and `object-fit: cover` cropped 140px off the top and bottom of
     every 256×256 tile — nine crops butted together and passed off as a
     continuous map of the coast. Nothing threw, nothing failed to load, and the
     result was plausible enough to survive unlooked-at since Phase 4.

     A geometry assertion is the only kind that can catch this: the tiles all
     loaded, the grid had nine children, and every textContent read was empty
     because a map has no text. */
  const { pageErrors } = await bootV3(page, { "/api/weather/radar/meta": RADAR_META });
  await show(page, "show me the radar");

  const got = await page.evaluate(() => {
    const cells = [...document.querySelectorAll(".subject__tile")].map((t) => {
      const r = t.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
    const imgs = [...document.querySelectorAll(".subject--sky img")];
    return {
      cells,
      // A tile that is square in CSS and square in pixels cannot be cropped by
      // `cover`, whatever `cover` is doing.
      natural: [...new Set(imgs.map((i) => `${i.naturalWidth}x${i.naturalHeight}`))]
    };
  });

  expect(got.cells).toHaveLength(9);
  for (const { w, h } of got.cells) {
    expect(Math.abs(w - h), `a ${w}×${h} cell crops a square tile`).toBeLessThanOrEqual(1);
  }
  expect(pageErrors).toEqual([]);
});

test("⚠ no radar meta is a decline, not a blank mosaic", async ({ page }) => {
  // The upstream is RainViewer via our own cache, and it 502s. An empty grid of
  // nine broken tiles at 1920px is worse than not answering.
  const { pageErrors } = await bootV3(page, { "/api/weather/radar/meta": null });

  const got = await show(page, "show me the radar");

  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("'what about tonight' opens the day, the same one 'show me my day' opens", async ({ page }) => {
  /* Both ids resolve to showDay on purpose — the evening's shape is a question
     about the calendar, not about the recipe. What had never been checked is
     that the utterance reaches the row at all. */
  const { pageErrors } = await bootV3(page, { "/api/calendar/all": calToday() });
  await page.evaluate(() => window.__v3Refresh());

  const got = await show(page, "what about tonight");

  expect(got.handled).toBe(true);
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("voice-show.tonight");
  expect(got.subject).toBe("show.tonight");
  expect(got.cell).toBe("calendar");
  expect(got.rows).toBe(3);
  expect(got.text).toContain("Dentist");
  expect(pageErrors).toEqual([]);
});

test("⚠ an entity a probe pushes actually ARRIVES in the house", async ({ page }) => {
  /* The guard on __emitHaState, and the reason media.js sat at 0% coverage.
     The hook emitted the bus event without writing the cache, so every listener
     saw the change and every READER — houseSnapshot, voiceSnapshot, the
     attention queue — still described the house as it was before it. Nothing
     threw. entityFeed.js's header calls that ordering load-bearing; this is the
     assertion that the debug seam obeys it too. */
  const { pageErrors } = await bootV3(page);

  const got = await page.evaluate((entity) => {
    const before = window.__v3().ha.entities;
    window.__emitHaState(entity);
    return { before, after: window.__v3().ha.entities };
  }, PLAYING);

  expect(got.before).toBe(0);
  expect(got.after).toBe(1);
  expect(pageErrors).toEqual([]);
});

test("what's playing mounts the artwork at editorial scale, named by room", async ({ page }) => {
  /* ⚠ PINNED ON, not left to the default — and the reversibility check is what
     insisted. The eyebrow's ORDER is flag-dependent: the rooms surface reads
     "Lounge Room · Glen Campbell" and the band it replaced read "Glen Campbell
     · Lounge Room". Asserting either one while riding the default means the
     spec passes today and fails the moment the flag is flipped back — which is
     the rollback path, so a spec that only holds in one state quietly makes
     the rollback unavailable. Pinned, this asserts the surface it names
     regardless of what the default happens to be. */
  const { pageErrors } = await bootV3(page, {}, { features: { v3MediaRooms: true } });
  await page.evaluate((entity) => window.__emitHaState(entity), PLAYING);

  const got = await show(page, "show me what's playing");

  expect(got.handled).toBe(true);
  expect(got.lane).toBe("local");
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("voice-show.media");
  expect(got.subject).toBe("show.media");
  expect(got.cell).toBe("nowPlaying");
  expect(got.text).toContain("Wichita Lineman");
  /* The ROOM AND the artist, room first — and the order changed deliberately
     when v3MediaRooms flipped on 2026-08-23. It used to read "Glen Campbell ·
     Lounge Room", because houseSnapshot joined them artist-first for a surface
     whose subject was the track.

     The subject of this wall is now the ROOM: depth 0 draws one row per room
     with the room as its eyebrow, and a depth-3 caption that put the artist
     first would be the only place in the system reading the other way round.
     The room is also the half that survives truncation, which is the practical
     argument for it leading. */
  expect(got.text).toContain("Lounge Room · Glen Campbell");
  expect(got.images).toBe(1);
  expect(got.html).toContain("/api/image_proxy/api/media_player_proxy/");
  expect(pageErrors).toEqual([]);
});

test("⚠ the subject and the ambient band cannot name a Plex stream differently", async ({ page }) => {
  /* subjects/media.js carried its own copy of the precedence, and the copy
     never learned what the band learned on 2026-08-13: a Plex session names the
     ROOM it is playing in. The band said "Lounge Room TV" over the title and
     the depth-3 subject said "Playing" over the same title — two readers of one
     snapshot disagreeing about it, which is the bug houseSnapshot exists to
     make impossible. The precedence is now imported, not repeated. */
  const { pageErrors } = await bootV3(page, {
    "/api/plex/sessions": {
      sessions: [{
        title: "2022-01-27",
        grandparentTitle: "Colin from Accounts",
        player: "Lounge Room TV",
        thumb: "/library/metadata/1/thumb"
      }]
    }
  });
  await page.evaluate(() => window.__v3Refresh());

  const got = await show(page, "show me what we're watching");

  expect(got.subject).toBe("show.media");
  expect(got.cell).toBe("plex");
  // The SHOW, never the episode — "2022-01-27" is what the wall said once.
  expect(got.text).toContain("Colin from Accounts");
  expect(got.text).not.toContain("2022-01-27");
  expect(got.text).toContain("Lounge Room TV");
  expect(got.text).not.toContain("Playing");
  expect(pageErrors).toEqual([]);
});

test("⚠ nothing playing: the fast lane ANSWERS instead of falling to Assist", async ({ page }) => {
  /* Measured on the wall at 06:44 on 2026-08-15 — show.media declined because
     nothing was playing, which is correct — and then the turn fell all the way
     through to HA Assist, discarding a sentence the local lane already held.
     A 2-4 s round trip to an agent that does not own the question, in place of
     0.015 ms. Nothing to SHOW is not nothing to SAY.

     ⚠ The player is injected PAUSED on purpose: `voiceSnapshot.media` is null
     when the house knows of no players at all, and null must still fall
     through. It is the difference between "nothing's playing" and "I can't see
     the players", and only the first earns a sentence. */
  const { pageErrors } = await bootV3(page);
  await page.evaluate((entity) => window.__emitHaState({ ...entity, state: "paused" }), PLAYING);

  const got = await page.evaluate(async () => {
    const res = await window.__v3Transcript("show me what's playing");
    return {
      lane: res?.lane ?? null,
      handled: res?.handled ?? false,
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      subject: window.__v3().subject,
      children: document.getElementById("subject-mount").childElementCount,
      said: document.getElementById("glance-said")?.textContent ?? ""
    };
  });

  expect(got.handled).toBe(true);
  expect(got.lane).toBe("local");             // never "assist", never unhandled
  expect(got.said).toContain("Nothing's playing");
  // The screen stays where it was: there is nothing to show, so nothing mounts.
  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).toBe(1);                  // a spoken answer earns a glance
  expect(got.reason).toBe("voice-show.media");
  expect(pageErrors).toEqual([]);
});

test("⚠ TV audio is not what's playing — on the screen OR out loud", async ({ page }) => {
  /* SEEN AND HEARD ON THE WALL, 2026-08-15, driving show.media for the first
     time. `media_player.living_room` was `playing` with `source: "TV"`. The
     screen was right — houseSnapshot applies `isTvAudio`, so the subject
     declined — and then the fast lane, which never had the rule, answered
     "TV." The two readers of one house disagreed out loud, which is the entire
     thing services/mediaSource.js was extracted to prevent.

     ⚠ The player carries `media_title: "TV"` here because that is what the live
     entity carries NOW — mediaSource's header measured no title at all on
     2026-08-09. The source test is the whole test; a title check would pass
     this fixture and fail the house. */
  const { pageErrors } = await bootV3(page);
  await page.evaluate(() => window.__emitHaState({
    entity_id: "media_player.living_room",
    state: "playing",
    attributes: { source: "TV", media_title: "TV" }
  }));

  const got = await page.evaluate(async () => {
    const res = await window.__v3Transcript("show me what's playing");
    return {
      handled: res?.handled ?? false,
      subject: window.__v3().subject,
      said: document.getElementById("glance-said")?.textContent ?? ""
    };
  });

  expect(got.subject).toBeNull();               // the screen was always right
  expect(got.said).not.toContain("TV");         // and now the voice is too
  expect(got.said).toContain("Nothing's playing");
  expect(got.handled).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("⚠ a declined subject never leaves the surface HELD at depth 3 with nothing in it", async ({ page }) => {
  /* SEEN ON THE WALL, 2026-08-15, and it is the worst of the three because the
     room can see it: the radar was up, "show me what's playing" declined, and
     the surface sat at `{depth: 3, held: true, subject: null, mount: 0}` — a
     blank stage holding the whole screen for thirty seconds, re-armed by every
     repeat of the phrase.

     Two causes meeting. `showSubject()` tears the old subject down before it
     looks the new id up, so a decline empties the stage; and `deepen()` falls
     through to `sustain()` for a shallower target, so every lane below re-armed
     SUBJECT rather than stepping out of it. Phase 1 recorded that fall-through
     as a trap and this is the second thing it has cost.

     ⚠ Both halves are asserted — the depth AND the empty mount. A test that
     checked only the mount passes on the exact state that was on the wall. */
  const { pageErrors } = await bootV3(page, { "/api/weather/radar/meta": RADAR_META });

  const got = await page.evaluate(async () => {
    await window.__v3Transcript("show me the radar");
    const atSubject = { depth: window.__depth().depth, subject: window.__v3().subject };

    // Nothing is playing and no player is even known, so this declines AND has
    // no sentence — the case that falls all the way through every lane.
    await window.__v3Transcript("show me what's playing");
    const after = window.__depth();
    return {
      atSubject,
      depth: after.depth,
      held: after.held,
      subject: window.__v3().subject,
      mount: document.getElementById("subject-mount").childElementCount
    };
  });

  expect(got.atSubject).toEqual({ depth: 3, subject: "show.sky" });   // it really was deep
  expect(got.subject).toBeNull();
  expect(got.mount).toBe(0);
  expect(got.depth, "depth 3 with an empty mount is a blank wall").toBeLessThanOrEqual(1);
  expect(pageErrors).toEqual([]);
});

test("⚠ a house that cannot see its players still says nothing at all", async ({ page }) => {
  // The other half of the line above, and the one that must NOT speak. With no
  // media_player entities known, `voiceSnapshot.media` is null — the answerer
  // returns null and the turn falls through, exactly as it did before.
  const { pageErrors } = await bootV3(page);

  const got = await show(page, "show me what's playing");

  expect(got.handled).toBe(false);
  expect(got.subject).toBeNull();
  expect(got.children).toBe(0);
  expect(got.depth).not.toBe(3);
  expect(pageErrors).toEqual([]);
});

test("⚠ the three leave nothing behind either — ten cycles, same DOM", async ({ page }) => {
  /* The teardown proof, widened to the rows it had never covered. The radar is
     the worst case in the whole registry: eighteen <img> elements, every one of
     them a live connection to our own tile cache.

     ⚠ MOUNTED DIRECTLY, NOT SPOKEN, and that is the fix for a flake I wrote
     myself. The first draft drove all thirty cycles through __v3Transcript: it
     landed at ~29 s against the config's 30 s default, passed on the machine it
     was written on, and failed the pre-push gate the moment anything else
     shared the CPU. Raising the budget did not hold either — three copies in
     parallel blew 90 s, because ten of those turns SPEAK and the TTS fallback
     is a serialised browser resource.

     The subject of this test is TEARDOWN. The voice turn is proven by the six
     tests above it, and __v3Subject exists precisely to mount a subject without
     saying anything out loud — it is what kiosk-drive.cjs uses to cycle the
     wall. So the churn keeps all ten cycles (a per-event leak is exactly what
     only shows on the tenth pass) and drops the speech that was never the
     point. Fewer cycles would have fit the budget and proved less. */
  const { pageErrors } = await bootV3(page, {
    "/api/weather/radar/meta": RADAR_META,
    "/api/calendar/all": calToday()
  });
  await page.evaluate(() => window.__v3Refresh());
  await page.evaluate((entity) => window.__emitHaState(entity), PLAYING);

  const got = await page.evaluate(async () => {
    const count = () => document.querySelectorAll("*").length;
    /* ⚠ `__setDepth(0)` DOES NOT CLEAR A SUBJECT MOUNTED THIS WAY, which is the
       second thing this test taught me about itself. __v3Subject deliberately
       does not touch depth, so with nothing to leave, no depth transition
       fires, and the handler that tears a subject down on the way out of
       SUBJECT never runs — the last mount was still on the surface and
       `children` read 1. An unknown id is the documented way to clear: it tears
       the previous subject down before it looks the new one up. Same bracket
       kiosk-drive.cjs puts around the wall's own cycle. */
    await window.__v3Subject("__spec.none__");
    const settle = count();
    const seen = new Set();
    for (let i = 0; i < 10; i++) {
      for (const id of ["show.sky", "show.tonight", "show.media"]) {
        await window.__v3Subject(id);
        seen.add(window.__v3().subject);
      }
    }
    await window.__v3Subject("__spec.none__");
    const mount = document.getElementById("subject-mount");
    return {
      settle,
      after: count(),
      seen: [...seen],
      children: mount.childElementCount,
      // Any <img> still holding a tile or an artwork after the last teardown.
      liveSrcs: [...document.querySelectorAll("#subject-mount img")].map((i) => i.getAttribute("src"))
    };
  });

  expect(got.seen.sort()).toEqual(["show.media", "show.sky", "show.tonight"]);
  expect(got.children).toBe(0);
  expect(got.liveSrcs).toEqual([]);
  expect(got.after).toBe(got.settle);
  expect(pageErrors).toEqual([]);
});
