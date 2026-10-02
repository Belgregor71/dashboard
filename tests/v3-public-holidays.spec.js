import { test, expect } from "./fixtures/coverage.js";
import { bootV3 } from "./fixtures/v3boot.js";
import {
  normalizeHoliday,
  refreshHolidays,
  withHolidays,
  holidayToday,
  resetHolidays
} from "../src/js/services/publicHolidays.js";

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLIC HOLIDAYS — features.v3PublicHolidays (L3 of the incumbent retirement).

   The incumbent put QLD public holidays on its month and a warm edge on the
   wall on the day. V3 never read /api/calendar/holidays, so retiring the
   incumbent would have taken holidays out of the house entirely. Each test
   below names the wrong answer it exists to catch.
   ═══════════════════════════════════════════════════════════════════════════ */

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const HOLIDAY = "Ekka Show Day";

function setFlag(on) {
  globalThis.window = { CONFIG: { features: { v3PublicHolidays: on } } };
}

function fakeFetch(rows, calls = []) {
  return async (url) => {
    calls.push(url);
    return { ok: true, json: async () => rows };
  };
}

test.describe("the merge (node)", () => {
  test.afterEach(() => {
    resetHolidays();
    delete globalThis.window;
  });

  test("a holiday row is an all-day event at LOCAL midnight, the ICS shape", () => {
    const h = normalizeHoliday({ start: "2026-10-05", title: "Labour Day" });
    expect(h).not.toBeNull();
    expect(h.title).toBe("Labour Day");
    expect(h.allDay).toBe(true);
    expect(new Date(h.start).getHours()).toBe(0);
    expect(new Date(h.start).toDateString()).toBe(new Date(2026, 9, 5).toDateString());
    expect(normalizeHoliday({ start: "2026-10-05" })).toBeNull();
  });

  test("flag on: the calendar gains the holiday, sorted into place", async () => {
    setFlag(true);
    const now = new Date(2026, 9, 3, 9, 0);
    await refreshHolidays(now, fakeFetch([{ start: "2026-10-05", title: "Labour Day" }]));
    const cal = [{ title: "Dentist", start: new Date(2026, 9, 4, 9).toISOString() },
      { title: "Soccer", start: new Date(2026, 9, 6, 16).toISOString() }];
    const merged = withHolidays(cal);
    expect(merged.map((e) => e.title)).toEqual(["Dentist", "Labour Day", "Soccer"]);
  });

  test("⚠ flag OFF: no fetch, and the calendar is passed through by reference", async () => {
    setFlag(false);
    const calls = [];
    await refreshHolidays(new Date(2026, 9, 3), fakeFetch([{ start: "2026-10-03", title: HOLIDAY }], calls));
    expect(calls).toEqual([]);
    const cal = [{ title: "Dentist", start: new Date(2026, 9, 3, 9).toISOString() }];
    expect(withHolidays(cal)).toBe(cal);
    expect(holidayToday(new Date(2026, 9, 3, 12))).toBeNull();
  });

  /* ⚠ Found by injecting the defect: the test above never reaches withHolidays'
     own guard, because refreshHolidays bails first and there is nothing held to
     merge. Holidays held from an ON period must still be withheld once off. */
  test("⚠ holidays already held are withheld the moment the flag is off", async () => {
    setFlag(true);
    await refreshHolidays(new Date(2026, 9, 3), fakeFetch([{ start: "2026-10-03", title: HOLIDAY }]));
    const cal = [{ title: "Dentist", start: new Date(2026, 9, 3, 9).toISOString() }];
    expect(withHolidays(cal)).toHaveLength(2);           // positive control: it IS held
    setFlag(false);
    expect(withHolidays(cal)).toBe(cal);
    expect(holidayToday(new Date(2026, 9, 3, 12))).toBeNull();
  });

  test("⚠ a cold calendar stays cold — holidays never invent one", async () => {
    setFlag(true);
    await refreshHolidays(new Date(2026, 9, 3), fakeFetch([{ start: "2026-10-05", title: "Labour Day" }]));
    expect(withHolidays(null)).toBeNull();
    expect(withHolidays(undefined)).toBeUndefined();
  });

  test("a holiday already on the family calendar is not doubled", async () => {
    setFlag(true);
    await refreshHolidays(new Date(2026, 9, 3), fakeFetch([{ start: "2026-10-05", title: "Labour Day" }]));
    const cal = [{ title: "labour day", start: new Date(2026, 9, 5).toISOString(), allDay: true }];
    expect(withHolidays(cal).filter((e) => /labour day/i.test(e.title))).toHaveLength(1);
  });

  test("⚠ a failed fetch is retried next refresh, not cached as a year without holidays", async () => {
    setFlag(true);
    const now = new Date(2026, 9, 3);
    let calls = 0;
    const failing = async () => { calls += 1; return { ok: false, json: async () => [] }; };
    await refreshHolidays(now, failing);
    await refreshHolidays(now, failing);
    expect(calls).toBe(2);
    await refreshHolidays(now, fakeFetch([{ start: "2026-10-03", title: HOLIDAY }]));
    expect(holidayToday(new Date(2026, 9, 3, 12))).toBe(HOLIDAY);
  });

  test("a year read today is not re-read within the day; December also reads January", async () => {
    setFlag(true);
    const calls = [];
    const f = fakeFetch([], calls);
    await refreshHolidays(new Date(2026, 9, 3, 9), f);
    await refreshHolidays(new Date(2026, 9, 3, 14), f);
    expect(calls).toHaveLength(1);
    const dec = [];
    await refreshHolidays(new Date(2026, 11, 20), fakeFetch([], dec));
    expect(dec.some((u) => u.includes("year=2027"))).toBe(true);
  });

  test("holidayToday names today's holiday and only today's", async () => {
    setFlag(true);
    await refreshHolidays(new Date(2026, 9, 3), fakeFetch([{ start: "2026-10-05", title: "Labour Day" }]));
    expect(holidayToday(new Date(2026, 9, 5, 15))).toBe("Labour Day");
    expect(holidayToday(new Date(2026, 9, 4, 15))).toBeNull();
    expect(holidayToday(new Date(2026, 9, 6, 0, 30))).toBeNull();
  });
});

/* ── On the page ──────────────────────────────────────────────────────────── */

async function boot(page, on) {
  const today = ymd(new Date());
  return bootV3(page, {
    "/api/calendar/holidays": [{ start: today, title: HOLIDAY }],
    "/api/calendar/all": [{ title: "Dentist", start: `${today}T09:30:00` }]
  }, { features: { v3PublicHolidays: on } });
}

async function showDay(page) {
  await page.evaluate(() => window.__v3Refresh?.());
  return page.evaluate(async () => {
    await window.__v3Transcript("show me my day");
    const mount = document.getElementById("subject-mount");
    return {
      subject: window.__v3().subject,
      rows: mount.querySelectorAll(".subject__row").length,
      text: mount.textContent
    };
  });
}

const tint = (page) => page.evaluate(() => {
  const photo = document.querySelector(".photo");
  return {
    attr: document.body.dataset.holiday ?? null,
    shadow: photo ? getComputedStyle(photo, "::after").boxShadow : null
  };
});

test("flag on: today's holiday is on the day, and the wall is warmed", async ({ page }) => {
  const { pageErrors } = await boot(page, true);
  await expect.poll(async () => (await tint(page)).attr, { timeout: 8000 }).toBe(HOLIDAY);
  const t = await tint(page);
  expect(t.shadow, "the photo's ::after paints no edge").toContain("inset");

  const got = await showDay(page);
  expect(got.subject).toBe("show.day");
  expect(got.text).toContain("Dentist");
  expect(got.text).toContain(HOLIDAY);
  expect(got.rows).toBe(2);
  expect(pageErrors).toEqual([]);
});

test("⚠ flag off: no holiday on the day and no tint — the wall as before", async ({ page }) => {
  const { pageErrors } = await boot(page, false);
  const got = await showDay(page);
  // Positive control first: the day mounted and shows the one real event, so
  // the missing holiday is the flag at work and not an empty mount.
  expect(got.subject).toBe("show.day");
  expect(got.text).toContain("Dentist");
  expect(got.text).not.toContain(HOLIDAY);
  expect(got.rows).toBe(1);
  const t = await tint(page);
  expect(t.attr).toBeNull();
  expect(t.shadow).toBe("none");
  expect(pageErrors).toEqual([]);
});
