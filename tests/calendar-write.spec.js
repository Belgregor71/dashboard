import { test, expect } from "@playwright/test";
import {
  readEventRequest,
  buildEvent,
  judgeReadback,
  parseCollections,
  createCalendarWriter
} from "../server/services/calendarWrite.js";
import { matchIntent, parseCalendarAdd } from "../src/js/services/localIntents.js";
import { bootV3 } from "./fixtures/v3boot.js";

/* Add to the calendar by voice — docs/research/FIELD-SCAN.md round 2, #8.
   "add dentist to the calendar on Tuesday at 3" → the shared iCloud Home
   calendar, saved, RE-READ, and said back with its date; "undo that" removes it.

   Three halves, because the feature can lie in three different places: the
   matcher can hear the wrong day, the server can call a write that did not land
   a success, and the wall can say "saved" over a server that said otherwise. */

// Saturday 24 October 2026, 11:00 local — the day this was built.
const NOW = new Date(2026, 9, 24, 11, 0);

const withFlag = (on, fn) => {
  const prior = globalThis.window;
  try {
    globalThis.window = { CONFIG: { features: { v3VoiceCalendarAdd: on, voiceListWrites: true, voiceTimers: true } } };
    return fn();
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
};

test.describe("what the room said", () => {
  const event = (s) => parseCalendarAdd(s, NOW)?.slots;

  test("a day and a time, said every way whisper writes them", () => {
    expect(event("Hey Mycroft, add dentist to the calendar on Tuesday at 3 p.m."))
      .toEqual({ title: "Dentist", date: "2026-10-27", time: "15:00", minutes: 60 });
    expect(event("Put Brett's haircut in the calendar for Friday at 10:30."))
      .toEqual({ title: "Brett's haircut", date: "2026-10-30", time: "10:30", minutes: 60 });
    expect(event("Add to the calendar school concert on the 14th of November at 6.30pm"))
      .toEqual({ title: "School concert", date: "2026-11-14", time: "18:30", minutes: 60 });
    expect(event("add the vet to the family calendar on the 3rd at half past nine"))
      .toEqual({ title: "Vet", date: "2026-11-03", time: "09:30", minutes: 60 });
  });

  test("the part of the day decides a bare hour, and a bare hour has a default", () => {
    expect(event("add dinner with Sam to the calendar tomorrow night at 7").time).toBe("19:00");
    expect(event("add swim to the calendar on monday morning at 7").time).toBe("07:00");
    expect(event("add swim to the calendar on monday at 7").time).toBe("19:00");
    expect(event("add swim to the calendar on monday at 9").time).toBe("09:00");
    expect(event("add lunch to the calendar on monday at noon").time).toBe("12:00");
  });

  test("a length, a range, and no time at all", () => {
    expect(event("can you add Teddy's grooming to my calendar on Wednesday at three thirty for 2 hours"))
      .toEqual({ title: "Teddy's grooming", date: "2026-10-28", time: "15:30", minutes: 120 });
    expect(event("add footy to the calendar on saturday from 1 to 4"))
      .toEqual({ title: "Footy", date: "2026-10-24", time: "13:00", minutes: 180 });
    // No time is an all-day event, not a guessed one.
    expect(event("add bin day to the calendar on Monday"))
      .toEqual({ title: "Bin day", date: "2026-10-26", time: null, minutes: 60 });
  });

  test("dates roll forward, never back", () => {
    // The 3rd has passed this month, so it is next month's.
    expect(event("add rent to the calendar on the 3rd").date).toBe("2026-11-03");
    // A month already gone is next year's.
    expect(event("add rego to the calendar on the 2nd of march").date).toBe("2027-03-02");
    // "next Saturday" said ON a Saturday is a week away; bare "saturday" is today.
    expect(event("add market to the calendar next saturday").date).toBe("2026-10-31");
    expect(event("add market to the calendar on saturday").date).toBe("2026-10-24");
  });

  test("⚠ a missing day is ASKED FOR, never assumed to be today", () => {
    expect(event("add dentist to the calendar at 3")).toEqual({ problem: "day" });
    expect(event("add a meeting to the calendar next week")).toEqual({ problem: "day" });
    expect(event("add dentist to the calendar on November 31")).toEqual({ problem: "day" });
    expect(event("add it to the calendar on tuesday")).toEqual({ problem: "title" });
  });

  // The owner's own first sentence to it, as whisper wrote it (2026-10-24).
  test("no calendar named: claimed when a day or a time is said", () => {
    expect(event("Added dentist appointment at 2pm next Sunday."))
      .toEqual({ title: "Dentist appointment", date: "2026-10-25", time: "14:00", minutes: 60 });
    expect(event("add dentist on tuesday"))
      .toEqual({ title: "Dentist", date: "2026-10-27", time: null, minutes: 60 });
    expect(event("book the vet for friday at 10"))
      .toEqual({ title: "Vet", date: "2026-10-30", time: "10:00", minutes: 60 });
    // A time with no day still asks for the day rather than guessing today.
    expect(event("add dentist at 3 pm")).toEqual({ problem: "day" });
  });

  test("⚠ no calendar named and no day or time: someone else's sentence", () => {
    withFlag(true, () => {
      for (const s of ["add oat milk", "add five minutes", "add dentist", "book a table"]) {
        expect(matchIntent(s)?.id, s).not.toBe("cal.add");
      }
      // A named list or timer wins even with a day in the sentence.
      expect(matchIntent("add oat milk to the shopping list for tomorrow").id).toBe("list.add");
      expect(matchIntent("add five minutes to the timer tonight")?.id).not.toBe("cal.add");
      expect(matchIntent("add a reminder for tuesday")?.id).not.toBe("cal.add");
    });
  });

  test("⚠ precedence — a list or a lookup is someone else's sentence", () => {
    withFlag(true, () => {
      expect(matchIntent("add dentist to the calendar on tuesday at 3").id).toBe("cal.add");
      expect(matchIntent("add dentist on tuesday").id).toBe("cal.add");
      expect(matchIntent("add oat milk to the shopping list").id).toBe("list.add");
      expect(matchIntent("what's on the calendar today").id).toBe("cal.today");
      // A duration in the sentence does not make it a timer.
      expect(matchIntent("put the dentist on the calendar on tuesday at 3 for half an hour").id).toBe("cal.add");
    });
  });

  test("undo, named and bare", () => {
    withFlag(true, () => {
      expect(matchIntent("take that off the calendar").id).toBe("cal.undo");
      expect(matchIntent("undo that event").id).toBe("cal.undo");
      // A bare undo is still photo.restore: the WALL decides what it meant.
      expect(matchIntent("undo that").id).toBe("photo.restore");
      // How whisper wrote the owner's spoken "undo that", twice (2026-10-25).
      expect(matchIntent("and do that.").id).toBe("photo.restore");
      expect(matchIntent("And do that.").id).toBe("photo.restore");
      // Only as the whole sentence.
      expect(matchIntent("go to the shop and do that")?.id).not.toBe("photo.restore");
    });
  });

  test("⚠ flag off: not one of these is claimed", () => {
    withFlag(false, () => {
      expect(matchIntent("add dentist to the calendar on tuesday at 3")).toBeNull();
      expect(matchIntent("Added dentist appointment at 2pm next Sunday.")).toBeNull();
      expect(matchIntent("take that off the calendar")).toBeNull();
      expect(matchIntent("undo that event").id).toBe("photo.restore");
    });
  });
});

test.describe("what the server will write", () => {
  test("a timed event, in UTC", () => {
    const req = readEventRequest({ title: "Dentist", start: "2026-10-27T05:00:00.000Z", end: "2026-10-27T06:00:00.000Z" }, NOW);
    const ics = buildEvent(req, "voice-1@dashboard", NOW);
    expect(ics).toContain("\r\nDTSTART:20261027T050000Z\r\n");
    expect(ics).toContain("\r\nDTEND:20261027T060000Z\r\n");
    expect(ics).toContain("\r\nSUMMARY:Dentist\r\n");
    expect(ics).toContain("\r\nUID:voice-1@dashboard\r\n");
  });

  test("an all-day event ends the NEXT day, as RFC 5545 has it", () => {
    const req = readEventRequest({ title: "Bin day", date: "2026-10-31" }, NOW);
    const ics = buildEvent(req, "voice-2@dashboard", NOW);
    expect(ics).toContain("\r\nDTSTART;VALUE=DATE:20261031\r\n");
    expect(ics).toContain("\r\nDTEND;VALUE=DATE:20261101\r\n");
  });

  test("⚠⚠ a title cannot add a property of its own", () => {
    const req = readEventRequest({ title: "Dentist\r\nATTENDEE:mailto:x@example.com", date: "2026-10-31" }, NOW);
    const lines = buildEvent(req, "voice-3@dashboard", NOW).split("\r\n");
    expect(lines.filter((l) => l.startsWith("ATTENDEE"))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("SUMMARY:"))).toEqual(["SUMMARY:Dentist ATTENDEE:mailto:x@example.com"]);
    // Not only line breaks: no control character reaches the calendar at all.
    expect(readEventRequest({ title: "Den\u0000tist\u0007", date: "2026-10-31" }, NOW).title).toBe("Den tist");
    expect(buildEvent(readEventRequest({ title: "Tea, cake; jam", date: "2026-10-31" }, NOW), "u", NOW))
      .toContain("SUMMARY:Tea\\, cake\\; jam");
  });

  test("refused: no title, a backwards or day-long span, an unreal day, the far future", () => {
    expect(readEventRequest({ title: " ", date: "2026-10-31" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "x".repeat(81), date: "2026-10-31" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "A", start: "2026-10-27T06:00:00Z", end: "2026-10-27T05:00:00Z" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "A", start: "2026-10-27T00:00:00Z", end: "2026-10-27T13:00:00Z" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "A", date: "2026-02-30" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "A", date: "2029-01-01" }, NOW).error).toBeTruthy();
    expect(readEventRequest({ title: "A", start: "soon", end: "later" }, NOW).error).toBeTruthy();
  });
});

test.describe("what the re-read proved", () => {
  const sent = readEventRequest({ title: "Dentist", start: "2026-10-27T05:00:00Z", end: "2026-10-27T06:00:00Z" }, NOW);
  const stored = (uid, extra = "") =>
    `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTART:20261027T050000Z\r\nDTEND:20261027T060000Z\r\nSUMMARY:Dentist appoint\r\n ment${extra}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

  test("our UID in a 200 confirms, and the words come from the STORED copy", () => {
    expect(judgeReadback(200, stored("voice-1@dashboard"), "voice-1@dashboard", sent)).toEqual({
      state: "confirmed", title: "Dentist appointment", allDay: false,
      start: "2026-10-27T05:00:00Z", end: "2026-10-27T06:00:00Z"
    });
  });

  test("⚠⚠ a 404, or a 200 that is not ours, is NOT SAVED", () => {
    expect(judgeReadback(404, "", "voice-1@dashboard", sent).state).toBe("not-saved");
    expect(judgeReadback(200, stored("voice-9@dashboard"), "voice-1@dashboard", sent).state).toBe("not-saved");
    // A UID that merely STARTS with ours is someone else's.
    expect(judgeReadback(200, stored("voice-1@dashboardX"), "voice-1@dashboard", sent).state).toBe("not-saved");
  });

  test("the Home calendar is found by its name", () => {
    const xml = `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/123/calendars/</d:href><d:propstat><d:prop><d:resourcetype><d:collection/></d:resourcetype></d:prop></d:propstat></d:response>` +
      `<d:response><d:href>/123/calendars/home/</d:href><d:propstat><d:prop><d:displayname>Home</d:displayname><d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype></d:prop></d:propstat></d:response>` +
      `<d:response><d:href>/123/calendars/work/</d:href><d:propstat><d:prop><d:displayname>Work</d:displayname><d:resourcetype><d:collection/><c:calendar xmlns:c="urn:ietf:params:xml:ns:caldav"/></d:resourcetype></d:prop></d:propstat></d:response></d:multistatus>`;
    expect(parseCollections(xml, "https://p01-caldav.icloud.com/123/calendars/")).toEqual([
      { href: "https://p01-caldav.icloud.com/123/calendars/home/", name: "Home" },
      { href: "https://p01-caldav.icloud.com/123/calendars/work/", name: "Work" }
    ]);
  });
});

/* A fake iCloud: answers discovery, keeps what is PUT, and can be told to lose
   it — which is the failure the whole re-read exists for. */
function fakeICloud({ dropWrites = false, keepDeleted = false } = {}) {
  const store = new Map();
  const calls = [];
  const xml = (inner) => `<d:multistatus xmlns:d="DAV:"><d:response>${inner}</d:response></d:multistatus>`;
  const fetchImpl = async (url, { method, body }) => {
    calls.push(method);
    const res = (status, text = "") => ({ status, url, text: async () => text });
    if (method === "PROPFIND" && url === "https://caldav.icloud.com/")
      return res(207, xml("<d:href>/</d:href><d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>"));
    if (method === "PROPFIND" && url.endsWith("/principal/"))
      return res(207, xml("<d:href>/123/principal/</d:href><c:calendar-home-set><d:href>https://p01-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set>"));
    if (method === "PROPFIND")
      return res(207, `<d:multistatus xmlns:d="DAV:"><d:response><d:href>/123/calendars/home/</d:href><d:displayname>Home</d:displayname><d:resourcetype><d:collection/><c:calendar/></d:resourcetype></d:response></d:multistatus>`);
    if (method === "PUT") { if (!dropWrites) store.set(url, body); return res(201); }
    if (method === "DELETE") { if (!keepDeleted) store.delete(url); return res(204); }
    if (method === "GET") return store.has(url) ? res(200, store.get(url)) : res(404);
    return res(500);
  };
  return { fetchImpl, store, calls };
}

test.describe("the round trip", () => {
  const cfg = { user: "u", password: "p", calendar: "Home" };
  const event = readEventRequest({ title: "Dentist", start: "2026-10-27T05:00:00Z", end: "2026-10-27T06:00:00Z" }, NOW);

  test("written into Home, read back, confirmed — and discovery happens once", async () => {
    const icloud = fakeICloud();
    const writer = createCalendarWriter(cfg, icloud.fetchImpl);
    expect((await writer.add(event, "voice-1@dashboard", NOW)).state).toBe("confirmed");
    expect([...icloud.store.keys()]).toEqual(["https://p01-caldav.icloud.com/123/calendars/home/voice-1%40dashboard.ics"]);
    await writer.add(event, "voice-2@dashboard", NOW);
    expect(icloud.calls.filter((m) => m === "PROPFIND")).toHaveLength(3);
  });

  test("⚠⚠ the PUT answered 201 and the event is not there — NOT SAVED", async () => {
    const writer = createCalendarWriter(cfg, fakeICloud({ dropWrites: true }).fetchImpl);
    expect((await writer.add(event, "voice-1@dashboard", NOW)).state).toBe("not-saved");
  });

  test("undo: gone afterwards is the only thing that says removed", async () => {
    const icloud = fakeICloud();
    const writer = createCalendarWriter(cfg, icloud.fetchImpl);
    await writer.add(event, "voice-1@dashboard", NOW);
    expect((await writer.remove("voice-1@dashboard")).state).toBe("removed");
    expect(icloud.store.size).toBe(0);

    const stubborn = fakeICloud({ keepDeleted: true });
    const w2 = createCalendarWriter(cfg, stubborn.fetchImpl);
    await w2.add(event, "voice-1@dashboard", NOW);
    expect((await w2.remove("voice-1@dashboard")).state).toBe("still-there");
  });

  test("a calendar that is not there is an error, never a write somewhere else", async () => {
    const writer = createCalendarWriter({ ...cfg, calendar: "Holidays" }, fakeICloud().fetchImpl);
    await expect(writer.add(event, "voice-1@dashboard", NOW)).rejects.toThrow("no calendar named Holidays");
  });
});

/* ── On the wall ────────────────────────────────────────────────────────────
   The wall says what the SERVER read back, and nothing it merely asked for. */
test.describe("wired to the wall", () => {
  // Fixed far ahead so the spoken day is a date, whatever day the suite runs.
  const START = new Date(2027, 9, 26, 15, 0);
  const CONFIRMED = {
    state: "confirmed", calendar: "Home", title: "Dentist appointment", allDay: false,
    start: START.toISOString(), end: new Date(START.getTime() + 3_600_000).toISOString()
  };
  const ON = { features: { v3VoiceCalendarAdd: true } };
  const SAID = "add dentist to the calendar on tuesday at 3 pm";

  const turn = (page, said) => page.evaluate((t) => window.__v3Transcript(t), said);
  const saidText = (page) => page.locator("#glance-said").textContent();
  const watch = (page) => {
    const posts = [];
    page.on("request", (r) => {
      if (r.url().includes("/api/calendar/events")) posts.push({ path: new URL(r.url()).pathname, body: r.postDataJSON() });
    });
    return posts;
  };

  test("⚠ flag off: the sentence never reaches the calendar", async ({ page }) => {
    const posts = watch(page);
    const { pageErrors } = await bootV3(page, { "/api/calendar/events": CONFIRMED });
    const res = await turn(page, SAID);
    expect(posts).toEqual([]);
    expect(res.lane).not.toBe("local");
    expect(pageErrors).toEqual([]);
  });

  test("a saved event is said back from the RE-READ, with its date and time", async ({ page }) => {
    const posts = watch(page);
    const { pageErrors } = await bootV3(page, { "/api/calendar/events": CONFIRMED }, ON);
    const res = await turn(page, SAID);

    expect(res).toMatchObject({ handled: true, lane: "local" });
    // The title the server read back, not the one the room said.
    expect(await saidText(page)).toBe("Dentist appointment is on the Home calendar for Tuesday 26 October 2027 at 3 pm.");

    expect(posts).toHaveLength(1);
    const sent = posts[0].body;
    expect(sent.title).toBe("Dentist");
    const start = new Date(sent.start);
    expect([start.getDay(), start.getHours(), start.getMinutes()]).toEqual([2, 15, 0]);
    expect(Date.parse(sent.end) - Date.parse(sent.start)).toBe(3_600_000);
    expect(pageErrors).toEqual([]);
  });

  test("⚠⚠ the server said NOT SAVED — the wall says so, and never 'is on'", async ({ page }) => {
    await bootV3(page, { "/api/calendar/events": { state: "not-saved", calendar: "Home" } }, ON);
    await turn(page, SAID);
    const said = await saidText(page);
    expect(said).toContain("didn't save");
    expect(said).not.toContain("is on the");
  });

  test("a lane the box has not armed is said as unreachable, not as saved", async ({ page }) => {
    await bootV3(page, { "/api/calendar/events": { error: "calendar writes are not enabled" } }, ON);
    await turn(page, SAID);
    expect(await saidText(page)).toBe("I can't reach the calendar right now.");
  });

  test("⚠ no day: the house asks, and nothing is written", async ({ page }) => {
    const posts = watch(page);
    await bootV3(page, { "/api/calendar/events": CONFIRMED }, ON);
    await turn(page, "add dentist to the calendar at 3");
    expect(await saidText(page)).toContain("What day is that for?");
    expect(posts).toEqual([]);
  });

  // "And do that." is how whisper heard the owner's spoken undo (2026-10-25).
  for (const undo of ["undo that", "And do that."]) {
    test(`'${undo}' after a saved event takes THE EVENT off`, async ({ page }) => {
      const posts = watch(page);
      await bootV3(page, {
        "/api/calendar/events/undo": { state: "removed", calendar: "Home", title: "Dentist appointment" },
        "/api/calendar/events": CONFIRMED
      }, ON);
      await turn(page, SAID);
      await turn(page, undo);
      expect(posts.map((p) => p.path)).toEqual(["/api/calendar/events", "/api/calendar/events/undo"]);
      expect(await saidText(page)).toBe("Dentist appointment is off the Home calendar.");
    });
  }

  test("⚠ a bare 'undo that' with no event saved never asks the calendar", async ({ page }) => {
    const posts = watch(page);
    await bootV3(page, {
      "/api/calendar/events/undo": { state: "removed", calendar: "Home", title: "Dentist appointment" }
    }, ON);
    await turn(page, "undo that");
    expect(posts).toEqual([]);
  });
});
