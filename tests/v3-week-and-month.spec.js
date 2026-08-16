import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import { dayLabel } from "../src/v3/subjects/forecast.js";
import { eventsAhead, groupAhead } from "../src/v3/subjects/ahead.js";
import { activeMeal, upcomingDishes } from "../src/v3/core/dinner.js";

/* ═══════════════════════════════════════════════════════════════════════════
   THE WEEK, THE MONTH, AND THE DINNER PANEL THE CUTOVER LOST.

   All three arrived as one report: "apart from the new personality it seems
   dumber than the Pi version." None of them was a reasoning failure.

   · /api/weather/forecast had been serving seven days the whole time and
     nothing drew them; houseDigest wrote only TODAY into the model's context,
     so "the next seven days" earned an honest refusal.
   · The calendar had no view past today on either surface that anyone sees.
   · modules/recipePanel.js had exactly one caller — js/core/app.js — so the
     cutover to V3 took the dinner panel off the wall AND stopped anything
     writing data/recipe-cache. One cause, both halves of the complaint.

   The pure halves are tested without a browser; the mounts are tested in one,
   because "it fits" and "it scrolls" and "it tore itself down" are exactly the
   claims that are wrong when reasoned about instead of measured.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ── The week's labels ──────────────────────────────────────────────────── */

test.describe("the week's labels", () => {
  const AUG16 = new Date(2026, 7, 16, 10, 0, 0);   // a Sunday, local

  test("today and tomorrow are named the way people name them", () => {
    expect(dayLabel("2026-08-16", AUG16)).toBe("Today");
    expect(dayLabel("2026-08-17", AUG16)).toBe("Tomorrow");
  });

  test("further out is a weekday", () => {
    expect(dayLabel("2026-08-18", AUG16)).toBe("Tue");
    expect(dayLabel("2026-08-22", AUG16)).toBe("Sat");
  });

  /* ⚠ THE TRAP THIS PINS: `new Date("2026-08-17")` is midnight UTC. In Brisbane
     that is 10am on the 17th and looks correct, which is exactly why it would
     survive a casual read — but the same string parsed anywhere with a negative
     offset lands on the 16th and every label on the strip shifts by one. The
     parts are split and handed to the local three-argument constructor instead,
     which is the same host-local rule localAnswers' forecastDay() follows. */
  test("⚠ a bare date is read LOCAL, not as UTC — late in the day it still says Today", () => {
    expect(dayLabel("2026-08-17", new Date(2026, 7, 17, 23, 30))).toBe("Today");
    expect(dayLabel("2026-08-17", new Date(2026, 7, 17, 0, 5))).toBe("Today");
  });

  test("a malformed date is dropped rather than guessed at", () => {
    expect(dayLabel("", AUG16)).toBeNull();
    expect(dayLabel(undefined, AUG16)).toBeNull();
    expect(dayLabel("not-a-date", AUG16)).toBeNull();
  });
});

/* ── The month's window ─────────────────────────────────────────────────── */

test.describe("the month's window", () => {
  const NOW = new Date(2026, 7, 16, 14, 0, 0);
  const at = (y, m, d, h = 9) => new Date(y, m, d, h).toISOString();

  const feed = [
    { title: "This morning", start: at(2026, 7, 16, 8) },     // today — excluded
    { title: "Tonight", start: at(2026, 7, 16, 19) },         // today — excluded
    { title: "Tomorrow", start: at(2026, 7, 17) },
    { title: "Six days out", start: at(2026, 7, 22) },
    { title: "Ten days out", start: at(2026, 7, 26) },
    { title: "Three weeks out", start: at(2026, 8, 6) },
    { title: "Way out", start: at(2026, 10, 19) },            // past the horizon
    { title: "Rubbish", start: "not-a-date" }
  ];

  /* ⚠ TODAY IS EXCLUDED ON PURPOSE. "What have I got on for the next month"
     asked at 2pm is not a question about this morning, and showDay already owns
     today — two subjects both answering it would let "show me the day" and
     "show me the month" disagree about the same afternoon. */
  test("today is not part of the month ahead, and neither is the far future", () => {
    expect(eventsAhead(feed, NOW).map((e) => e.title))
      .toEqual(["Tomorrow", "Six days out", "Ten days out", "Three weeks out"]);
  });

  test("⚠ a cold calendar is null; an empty one is an empty array", () => {
    expect(eventsAhead(undefined, NOW)).toBeNull();
    expect(eventsAhead(null, NOW)).toBeNull();
    expect(eventsAhead([], NOW)).toEqual([]);
  });

  /* The boundaries are spans from today, not real week starts. A Sunday-anchored
     week would put a Saturday event asked about on Friday into "this week" and
     one two days later into "next week" — true of the calendar, useless to the
     person asking. The groups mean soon / after that / eventually. */
  test("the three groups are spans from today", () => {
    const groups = groupAhead(eventsAhead(feed, NOW), NOW);
    expect(groups.map((g) => g.label)).toEqual(["This week", "Next week", "Later"]);
    expect(groups[0].rows.map((r) => r.title)).toEqual(["Tomorrow", "Six days out"]);
    expect(groups[1].rows.map((r) => r.title)).toEqual(["Ten days out"]);
    expect(groups[2].rows.map((r) => r.title)).toEqual(["Three weeks out"]);
  });

  test("a group with nothing in it is not printed at all", () => {
    const sparse = [{ title: "Way off", start: at(2026, 8, 10) }];
    expect(groupAhead(eventsAhead(sparse, NOW), NOW).map((g) => g.label)).toEqual(["Later"]);
  });
});

/* ── The dinner window ──────────────────────────────────────────────────── */

test.describe("the dinner window", () => {
  const at = (y, m, d, h, min = 0) => new Date(y, m, d, h, min).toISOString();
  const dinner = { title: "Meal: Cottage Pie", start: at(2026, 7, 16, 18) };

  test("opens an hour before and closes twenty minutes after", () => {
    expect(activeMeal([dinner], new Date(2026, 7, 16, 16, 59))).toBeNull();
    expect(activeMeal([dinner], new Date(2026, 7, 16, 17, 1))?.dish).toBe("Cottage Pie");
    expect(activeMeal([dinner], new Date(2026, 7, 16, 18, 19))?.dish).toBe("Cottage Pie");
    expect(activeMeal([dinner], new Date(2026, 7, 16, 18, 21))).toBeNull();
  });

  /* ⚠ A LITTLE OVER HALF THIS HOUSEHOLD'S MEAL EVENTS ARE ALL-DAY, and an
     all-day event's start is midnight. Treated as a dinner time it would put the
     recipe on the wall at 11pm the night before. The panel wants the timed ones;
     the WARM still wants both, which the last test in this block pins. */
  test("⚠ an all-day meal never opens the panel", () => {
    const allDay = { title: "Meal: Cottage Pie", start: at(2026, 7, 16, 0), allDay: true };
    expect(activeMeal([allDay], new Date(2026, 7, 16, 17, 30))).toBeNull();
  });

  test("the Meal: prefix is stripped, and a bare prefix is not a dish", () => {
    const t = new Date(2026, 7, 16, 17, 30);
    expect(activeMeal([dinner], t)?.dish).toBe("Cottage Pie");
    expect(activeMeal([{ title: "Meal:   ", start: at(2026, 7, 16, 18) }], t)).toBeNull();
    expect(activeMeal([{ title: "Dentist", start: at(2026, 7, 16, 18) }], t)).toBeNull();
  });

  test("⚠ a cold calendar is not a night with no dinner", () => {
    expect(activeMeal(undefined, new Date())).toBeNull();
    expect(activeMeal([], new Date())).toBeNull();
  });

  test("the earliest open window wins when two overlap", () => {
    const two = [
      { title: "Meal: Late", start: at(2026, 7, 16, 19) },
      { title: "Meal: Early", start: at(2026, 7, 16, 18) }
    ];
    expect(activeMeal(two, new Date(2026, 7, 16, 18, 10))?.dish).toBe("Early");
  });

  /* The warm is what refills the recipe book — it is not a side errand. It takes
     ALL-DAY events too: a dish worth having on disk is worth having on disk
     whether or not its event carries a time. */
  test("the warm looks at later days, all-day events included, nearest first", () => {
    const now = new Date(2026, 7, 16, 12);
    const feed = [
      { title: "Meal: Today's", start: at(2026, 7, 16, 18) },
      { title: "Meal: Katsu Curry", start: at(2026, 7, 18, 0), allDay: true },
      { title: "Meal: Souvlaki", start: at(2026, 7, 17, 18) },
      { title: "Dentist", start: at(2026, 7, 17, 9) }
    ];
    expect(upcomingDishes(feed, now).map((d) => d.dish)).toEqual(["Souvlaki", "Katsu Curry"]);
  });

  test("the warm never looks backwards", () => {
    const now = new Date(2026, 7, 16, 12);
    expect(upcomingDishes([{ title: "Meal: Last week's", start: at(2026, 7, 9, 18) }], now)).toEqual([]);
  });
});

/* ── On the glass ───────────────────────────────────────────────────────── */

const WEEK = {
  days: [
    { date: "2026-08-16", high_c: 21.1, low_c: 12.1, condition: { code: 1, label: "Mostly clear" }, rain_chance_pct: 18 },
    { date: "2026-08-17", high_c: 20.4, low_c: 12.6, condition: { code: 51, label: "Light drizzle" }, rain_chance_pct: 45 },
    { date: "2026-08-18", high_c: 20.9, low_c: 12.2, condition: { code: 53, label: "Drizzle" }, rain_chance_pct: 71 },
    { date: "2026-08-19", high_c: 18.9, low_c: 12.4, condition: { code: 55, label: "Heavy drizzle" }, rain_chance_pct: 63 },
    { date: "2026-08-20", high_c: 20.6, low_c: 10.8, condition: { code: 51, label: "Light drizzle" }, rain_chance_pct: 47 },
    { date: "2026-08-21", high_c: 21.9, low_c: 10.8, condition: { code: 3, label: "Cloudy" }, rain_chance_pct: 12 },
    { date: "2026-08-22", high_c: 21.1, low_c: 11.7, condition: { code: 3, label: "Cloudy" }, rain_chance_pct: 33 }
  ]
};

test("the week mounts a cell per day, each with a name, an icon and two temperatures", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/weather/forecast": WEEK });

  const got = await page.evaluate(async () => {
    await window.__v3Subject("show.forecast");
    const mount = document.getElementById("subject-mount");
    return {
      cell: mount.firstElementChild?.dataset.cell ?? null,
      days: mount.querySelectorAll(".subject__day").length,
      icons: mount.querySelectorAll(".subject__dayicon").length,
      names: [...mount.querySelectorAll(".subject__dayname")].map((n) => n.textContent),
      highs: [...mount.querySelectorAll(".subject__high")].map((n) => n.textContent),
      lows: [...mount.querySelectorAll(".subject__low")].map((n) => n.textContent),
      rains: [...mount.querySelectorAll(".subject__dayrain")].map((n) => n.textContent)
    };
  });

  expect(got.days).toBe(7);
  expect(got.icons).toBe(7);
  expect(got.highs).toEqual(["21°", "20°", "21°", "19°", "21°", "22°", "21°"]);
  expect(got.lows).toEqual(["12°", "13°", "12°", "12°", "11°", "11°", "12°"]);
  // The deixis address is the weather cell, so "the week" lights the same
  // rectangle "what's it like outside" does.
  expect(got.cell).toBe("weather");
  /* ⚠ A DRY DAY CARRIES AN EMPTY RAIN LINE, NOT A MISSING ONE. An element that
     exists only sometimes makes the seven cells different heights and the strip
     stops reading as a row — the icons no longer land on one line across. */
  expect(got.rains.length).toBe(7);
  expect(got.rains).toContain("");           // the 12% day is below the floor
  expect(got.rains).toContain("71%");
  expect(pageErrors).toEqual([]);
});

/* ⚠⚠ SEVEN IS NOT A PROMISE — the same warning localAnswers carries. The
   Open-Meteo path and the BOM-via-HA fallback build the array differently, and
   weatherFallbackForecast() returns `{ days: [] }` with no coordinates at all.
   Anything that indexes days[1] as "tomorrow" or pads to seven is wrong on the
   fallback, which is the path this house uses when the upstream is down. */
test("⚠ a short forecast renders short rather than padded", async ({ page }) => {
  const { pageErrors } = await bootV3(page, {
    "/api/weather/forecast": { days: WEEK.days.slice(0, 3) }
  });
  const days = await page.evaluate(async () => {
    await window.__v3Subject("show.forecast");
    return document.querySelectorAll(".subject__day").length;
  });
  expect(days).toBe(3);
  expect(pageErrors).toEqual([]);
});

test("⚠ a cold forecast mounts NOTHING; a loaded-but-empty one says so", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/weather/forecast": null });

  const cold = await page.evaluate(async () => {
    const res = await window.__v3Subject("show.forecast");
    return { res, children: document.getElementById("subject-mount").childElementCount };
  });
  expect(cold.res).toBe(false);
  expect(cold.children).toBe(0);

  /* ⚠ Registered AFTER the catch-all in bootV3, and page.route matches
     LAST-registered first — so this one wins. Getting that backwards is a
     documented trap in this repo. */
  await page.route("**/api/weather/forecast", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ days: [] }) }));

  const empty = await page.evaluate(async () => {
    await window.__v3Subject("show.forecast");
    const mount = document.getElementById("subject-mount");
    return { children: mount.childElementCount, text: mount.textContent };
  });
  expect(empty.children).toBe(1);
  expect(empty.text).toContain("can't see the forecast");
  expect(pageErrors).toEqual([]);
});

/* ⚠ THE LEAK SHAPE THIS SUBJECT IS MOST EXPOSED TO. Seven lottie players on the
   one genuinely per-event path in V3 is precisely the code that produced 709
   zombie wrappers and 230k detached nodes. frame()'s teardown clears image srcs
   and knows nothing about lottie, so forecast.js keeps its own list and destroys
   every instance — and this counts nodes rather than trusting that it does. */
test("⚠ fifteen week/leave cycles leave the DOM exactly where they found it", async ({ page }) => {
  const { pageErrors } = await bootV3(page, { "/api/weather/forecast": WEEK });

  const got = await page.evaluate(async () => {
    const count = () => document.querySelectorAll("*").length;
    await window.__v3Subject("show.forecast");
    await window.__v3Subject("__spec.none__");
    await new Promise((r) => setTimeout(r, 300));
    const settle = count();

    for (let i = 0; i < 15; i++) {
      await window.__v3Subject("show.forecast");
      await window.__v3Subject("__spec.none__");
    }
    await new Promise((r) => setTimeout(r, 500));
    const mount = document.getElementById("subject-mount");
    return {
      settle,
      after: count(),
      children: mount.childElementCount,
      // A player left alive keeps a rAF and a decoded SVG on a detached node.
      strays: document.querySelectorAll("#subject-mount .subject__dayicon svg").length
    };
  });

  expect(got.children).toBe(0);
  expect(got.strays).toBe(0);
  expect(got.after).toBe(got.settle);
  expect(pageErrors).toEqual([]);
});

/* The flag gate lives in matchIntent, not in the subject registry — see the
   header comment there. This is the spoken path proving it, which is the half a
   direct __v3Subject call cannot reach. */
test("the spoken week reaches depth 3 and points at the weather", async ({ page }) => {
  const { pageErrors } = await bootV3(page,
    { "/api/weather/forecast": WEEK },
    { features: { v3ForecastWeek: true } });

  const got = await page.evaluate(async () => {
    await window.__v3Transcript("show me the weather for the next 7 days");
    return {
      subject: window.__v3().subject,
      depth: window.__depth().depth,
      reason: window.__depth().reason,
      days: document.querySelectorAll(".subject__day").length
    };
  });

  expect(got.subject).toBe("show.forecast");
  expect(got.depth).toBe(3);
  expect(got.reason).toBe("voice-show.forecast");
  expect(got.days).toBe(7);
  expect(pageErrors).toEqual([]);
});

test("the month groups what is coming and names each span", async ({ page }) => {
  const { pageErrors } = await bootV3(page);

  const got = await page.evaluate(async () => {
    const iso = (offsetDays, h = 9) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      d.setHours(h, 0, 0, 0);
      return d.toISOString();
    };
    const snap = {
      calendar: [
        { title: "Today's thing", start: iso(0) },
        { title: "Meal: Sausage, Mash & Onion Gravy", start: iso(1, 18) },
        { title: "Dentist", start: iso(5, 14) },
        { title: "Vic & Kyle over", start: iso(10), allDay: true },
        { title: "Three weeks out", start: iso(21) }
      ]
    };
    await window.__v3Subject("show.ahead", {}, snap);
    const mount = document.getElementById("subject-mount");
    return {
      cell: mount.firstElementChild?.dataset.cell ?? null,
      groups: [...mount.querySelectorAll(".subject__aheadgroup > .subject__title")].map((n) => n.textContent),
      text: mount.textContent,
      rows: mount.querySelectorAll(".subject__row").length
    };
  });

  expect(got.cell).toBe("calendar");
  expect(got.groups).toEqual(["This week", "Next week", "Later"]);
  expect(got.rows).toBe(4);                     // today's thing is excluded
  expect(got.text).not.toContain("Today's thing");
  /* ⚠ SEEN ON THE WALL 2026-08-08: the day read "6pm — Meal: Chicken Fajitas".
     `Meal:` is a routing convention, not something anybody should read on the
     glass — and this subject is the most exposed to it, because a third of this
     feed's events are meal events. */
  expect(got.text).toContain("Sausage, Mash & Onion Gravy");
  expect(got.text).not.toContain("Meal:");
  expect(pageErrors).toEqual([]);
});

test("⚠ a cold calendar mounts NOTHING; an empty month is a real answer", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  const got = await page.evaluate(async () => {
    const cold = await window.__v3Subject("show.ahead", {}, { calendar: null });
    const coldChildren = document.getElementById("subject-mount").childElementCount;
    await window.__v3Subject("show.ahead", {}, { calendar: [] });
    const mount = document.getElementById("subject-mount");
    return { cold, coldChildren, text: mount.textContent, children: mount.childElementCount };
  });
  expect(got.cold).toBe(false);
  expect(got.coldChildren).toBe(0);
  expect(got.children).toBe(1);
  expect(got.text).toContain("Nothing on for the next month");
  expect(pageErrors).toEqual([]);
});

test("a crowded month is capped, and whatever it cut is counted and said", async ({ page }) => {
  const { pageErrors } = await bootV3(page);
  const got = await page.evaluate(async () => {
    const calendar = [];
    for (let i = 1; i <= 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      d.setHours(9, 0, 0, 0);
      calendar.push({ title: `Thing ${i}`, start: d.toISOString() });
    }
    await window.__v3Subject("show.ahead", {}, { calendar });
    const mount = document.getElementById("subject-mount");
    return { rows: mount.querySelectorAll(".subject__row").length, text: mount.textContent };
  });
  expect(got.text).toMatch(/and \d+ more/);
  expect(got.rows).toBeLessThanOrEqual(17);     // 16 budgeted rows + the "and N more" line
  expect(pageErrors).toEqual([]);
});

/* ── The recipe's whole method ──────────────────────────────────────────── */

/* ⚠⚠ THE DEFECT THIS PINS. The subject capped the method at six steps. That cap
   was written for a FIXED panel and its premise was false — the incumbent's
   dinner panel had solved this in July by scrolling the column. Half this
   household's recipes are longer than six steps, so the wall was truncating the
   END of the cooking, which is the half you need when your hands are busy. */
test("⚠ every step reaches the glass — a ten-step method is not cut to six", async ({ page }) => {
  const steps = Array.from({ length: 10 }, (_, i) => `Step number ${i + 1}, do the thing.`);
  const { pageErrors } = await bootV3(page, {
    "/api/recipe": {
      title: "Spanish Chicken & Chorizo Traybake",
      servings: "4",
      ingredients: ["640g chicken breast", "200g chorizo"],
      steps
    }
  });

  const got = await page.evaluate(async () => {
    await window.__v3Subject("show.recipe", {}, { calendar: [], menu: "Spanish Chicken & Chorizo Traybake" });
    const mount = document.getElementById("subject-mount");
    const scroller = mount.querySelector(".subject__scroll--method");
    return {
      steps: scroller ? scroller.querySelectorAll(".subject__row").length : 0,
      text: mount.textContent,
      overflowY: scroller ? getComputedStyle(scroller).overflowY : null
    };
  });

  expect(got.steps).toBe(10);
  expect(got.text).toContain("Step number 10");
  /* "Every step is in the DOM" is not the claim — the claim is that every step
     can REACH the wall. A clipped column would satisfy the count above and fail
     the family, which is exactly how the six-step cap came to look reasonable. */
  expect(got.overflowY).toBe("auto");
  expect(pageErrors).toEqual([]);
});

/* ⚠ The scroll loop is a rAF, and frame()'s teardown knows nothing about it. A
   loop left running holds a detached element for the life of the page — on a
   wall that runs for weeks that is the leak, not a tidiness point. */
test("⚠ leaving the recipe stops its scroll loop", async ({ page }) => {
  const steps = Array.from({ length: 24 }, (_, i) =>
    `Step ${i + 1}, with quite a lot of words in it so the column genuinely overflows.`);
  const { pageErrors } = await bootV3(page, {
    "/api/recipe": { title: "Long One", ingredients: ["Thing"], steps }
  });

  const got = await page.evaluate(async () => {
    /* Count rAF scheduling rather than inspecting the module: a stopped loop
       stops asking for frames, and that is observable from outside. */
    let scheduled = 0;
    const realRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (fn) => { scheduled += 1; return realRaf(fn); };

    await window.__v3Subject("show.recipe", {}, { calendar: [], menu: "Long One" });
    await new Promise((r) => setTimeout(r, 400));      // let the loop get going
    const whileUp = scheduled;
    await new Promise((r) => setTimeout(r, 300));
    const running = scheduled > whileUp;               // it really was looping

    await window.__v3Subject("__spec.none__");
    await new Promise((r) => setTimeout(r, 200));
    const a = scheduled;
    await new Promise((r) => setTimeout(r, 400));
    const b = scheduled;

    window.requestAnimationFrame = realRaf;
    return {
      running,
      drift: b - a,
      children: document.getElementById("subject-mount").childElementCount
    };
  });

  expect(got.running).toBe(true);       // the test can actually fail
  expect(got.children).toBe(0);
  expect(got.drift).toBe(0);
  expect(pageErrors).toEqual([]);
});
