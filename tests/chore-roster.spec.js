import { test, expect } from "@playwright/test";

import {
  BIN_ROSTER,
  DOG_ROSTER,
  binPersonFor,
  describeCollection,
  dogFeederOn,
  loadChores,
  nextCollection,
  rosterRules
} from "../server/services/choreRoster.js";
import { collectionsFromDateMath, resetBinScheduleCache } from "../server/services/binSchedule.js";
import { buildBriefPayload } from "../src/js/modules/aiBriefing.js";
import { matchIntent } from "../src/js/services/localIntents.js";
import { answer } from "../src/js/services/localAnswers.js";
import { vocabularyFor } from "../src/js/services/vocabulary.js";
import { refreshVoiceCache, voiceSnapshot } from "../src/js/services/voiceSnapshot.js";

/* THE CHORE ROSTER — pure unit tests, no HTTP and no DOM, so they run straight
   in the Playwright node process alongside bin-schedule.spec.js.

   Every date here is written LOCAL, deliberately, for the reason binSchedule's
   own spec gives: the most dangerous bug in this area is a UTC-midnight parse
   putting a night on the wrong day, and a test that uses the same wrong idiom
   as the code cannot see it. */

const localDate = (y, m, d, hour = 0) => new Date(y, m - 1, d, hour, 0, 0, 0);

// The night the alternation starts. Owner's instruction, 2026-08-27: Brett.
const ANCHOR = localDate(2026, 8, 27);

test.describe("the dog roster", () => {
  test("alternates by night from the anchor", () => {
    expect(dogFeederOn(ANCHOR)).toBe("Brett");
    expect(dogFeederOn(localDate(2026, 8, 28))).toBe("Greg");
    expect(dogFeederOn(localDate(2026, 8, 29))).toBe("Brett");
    expect(dogFeederOn(localDate(2026, 8, 30))).toBe("Greg");
  });

  test("the roster is a property of the DATE, not of the hour", () => {
    // One name all day, turning over at midnight. Someone asking at 6am and
    // someone asking at 11pm on the same date must hear the same name.
    for (const hour of [0, 6, 12, 17, 23]) {
      expect(dogFeederOn(localDate(2026, 8, 27, hour))).toBe("Brett");
    }
  });

  /* ⚠ THE TRAP THIS WHOLE TEST EXISTS FOR. `days % 2` is NEGATIVE before the
     anchor and -1 !== 1, so a plain remainder inverts the entire roster for
     every past date — silently, and on the half of the calendar nobody thinks
     to write a test for. The wall reads yesterday whenever a briefing is
     regenerated after midnight. */
  test("holds before the anchor as well as after it", () => {
    expect(dogFeederOn(localDate(2026, 8, 26))).toBe("Greg");
    expect(dogFeederOn(localDate(2026, 8, 25))).toBe("Brett");
    expect(dogFeederOn(localDate(2026, 8, 20))).toBe("Greg");
  });

  test("never gives the same person two nights running, across a year", () => {
    let previous = null;
    for (let i = -180; i <= 180; i += 1) {
      const day = new Date(ANCHOR);
      day.setDate(day.getDate() + i);
      const feeder = dogFeederOn(day);
      expect([DOG_ROSTER.onAnchor, DOG_ROSTER.alternate]).toContain(feeder);
      if (previous) expect(feeder, `two ${feeder} nights in a row at offset ${i}`).not.toBe(previous);
      previous = feeder;
    }
  });
});

test.describe("the bin roster", () => {
  test("reads the SECOND bin — red is on every collection and decides nothing", () => {
    expect(binPersonFor(["red", "green"])).toBe("Brett");
    expect(binPersonFor(["red", "yellow"])).toBe("Greg");
    // Order must not matter: the council's word order is not the roster's.
    expect(binPersonFor(["green", "red"])).toBe("Brett");
  });

  test("declines rather than guessing when the colours name nobody", () => {
    // binSchedule's fallback produces red alone when BIN_YELLOW_REFERENCE is
    // unset. "Someone takes them out" is not an answer worth speaking.
    expect(binPersonFor(["red"])).toBeNull();
    expect(binPersonFor([])).toBeNull();
    expect(binPersonFor(null)).toBeNull();
    expect(binPersonFor(["red", "unknown"])).toBeNull();
  });

  test("declines when the colours name two people", () => {
    // Impossible on this council's schedule — which is exactly why the honest
    // answer is that the roster does not cover it, rather than a coin toss.
    expect(binPersonFor(["red", "yellow", "green"])).toBeNull();
  });

  test("the rules are generated from the roster, never written out beside it", () => {
    const rules = rosterRules().join(" ");
    expect(rules).toContain(DOG_ROSTER.onAnchor);
    expect(rules).toContain(DOG_ROSTER.alternate);
    expect(rules).toContain(BIN_ROSTER.green);
    expect(rules).toContain(BIN_ROSTER.yellow);
  });
});

test.describe("which collection is next", () => {
  // A Thursday council run, yellow on 2026-08-06 — the same shape
  // bin-schedule.spec.js measured against the live calendar.
  const collections = collectionsFromDateMath({
    collectionDay: 4,
    yellowRef: "2026-08-06",
    now: localDate(2026, 8, 24),
    count: 4
  });

  test("today still counts while the truck has not been", () => {
    const next = nextCollection(collections, localDate(2026, 8, 27, 6));
    expect(next.date.getDate()).toBe(27);
  });

  /* ⚠ AFTER 7AM TODAY IS IN THE PAST. Calling this morning's collection "next"
     would put a bin night in the future that has already happened — the same
     reason binWindow stops reminding, which is why the boundary is BORROWED
     from binSchedule rather than restated here. */
  test("today is skipped once the truck has been", () => {
    const next = nextCollection(collections, localDate(2026, 8, 27, 9));
    expect(next.date.getDate()).toBe(3);
    expect(next.date.getMonth()).toBe(8); // September
  });

  test("the eve is the night BEFORE the truck, and that is what gets said", () => {
    const described = describeCollection(
      nextCollection(collections, localDate(2026, 8, 27, 9)),
      localDate(2026, 8, 27, 9)
    );
    expect(described.date).toBe("2026-09-03");
    expect(described.weekday).toBe("Thursday");
    expect(described.inDays).toBe(7);
    // The bins go out Wednesday night. Every sentence the house says about a
    // bin night is about THIS date.
    expect(described.eve.date).toBe("2026-09-02");
    expect(described.eve.weekday).toBe("Wednesday");
    expect(described.eve.inDays).toBe(6);
  });

  test("the fortnight alternates the owner with the colour", () => {
    const owners = collections.map((c) => describeCollection(c, localDate(2026, 8, 24)))
      .map((d) => `${d.colours.join("+")} ${d.person}`);
    expect(owners).toEqual([
      "red+green Brett",
      "red+yellow Greg",
      "red+green Brett",
      "red+yellow Greg"
    ]);
  });
});

test.describe("the whole roster", () => {
  const priorDay = process.env.BIN_COLLECTION_DAY;
  const priorRef = process.env.BIN_YELLOW_REFERENCE;
  const priorCal = process.env.BIN_CALENDAR_ENTITY;

  test.beforeAll(() => {
    process.env.BIN_COLLECTION_DAY = "thursday";
    process.env.BIN_YELLOW_REFERENCE = "2026-08-06";
    // No calendar entity: HA is unreachable under test anyway, and this makes
    // the degrade-to-date-math path the one being measured rather than a race.
    delete process.env.BIN_CALENDAR_ENTITY;
    resetBinScheduleCache();
  });

  test.afterAll(() => {
    // Module state and env both leak between specs in a worker — see
    // reference-boot-module-state-leak. Put them back.
    if (priorDay === undefined) delete process.env.BIN_COLLECTION_DAY;
    else process.env.BIN_COLLECTION_DAY = priorDay;
    if (priorRef === undefined) delete process.env.BIN_YELLOW_REFERENCE;
    else process.env.BIN_YELLOW_REFERENCE = priorRef;
    if (priorCal === undefined) delete process.env.BIN_CALENDAR_ENTITY;
    else process.env.BIN_CALENDAR_ENTITY = priorCal;
    resetBinScheduleCache();
  });

  test("names tonight, tomorrow and the next bin night", async () => {
    const chores = await loadChores({ now: localDate(2026, 8, 27, 18) });
    expect(chores.configured).toBe(true);
    expect(chores.dogs).toEqual({ tonight: "Brett", tomorrow: "Greg" });
    expect(chores.bins.configured).toBe(true);
    expect(chores.bins.next.person).toBe("Greg");
    expect(chores.bins.next.eve.weekday).toBe("Wednesday");
  });

  /* ⚠ THE ASSUMPTION aiBriefing MAKES, PINNED. choresText attaches a name to
     the Bins line by reading `bins.next.person` — which is only the right name
     if the collection the reminder is about and the collection `next` picks are
     the same one. They are, by construction (both windows sit inside the eve
     boundary `nextCollection` borrows), but "by construction" is exactly the
     kind of claim that stops being true when someone edits one of the two. */
  test("when the reminder is DUE, `next` is the collection it is about", async () => {
    resetBinScheduleCache();
    // The evening before a Thursday collection: the eve window is open.
    const eve = await loadChores({ now: localDate(2026, 9, 2, 19) });
    expect(eve.bins.due).toBe(true);
    expect(eve.bins.eve).toBe(true);
    expect(eve.bins.next.date).toBe("2026-09-03");
    expect(eve.bins.next.eve.inDays).toBe(0); // out TONIGHT

    resetBinScheduleCache();
    // Collection morning before 7: the last-chance window, same collection.
    const morning = await loadChores({ now: localDate(2026, 9, 3, 6) });
    expect(morning.bins.lastChance).toBe(true);
    expect(morning.bins.next.date).toBe("2026-09-03");
    expect(morning.bins.next.eve.inDays).toBe(-1); // the night before has gone
  });

  test("the dogs survive the bins being unconfigured", async () => {
    const priorEnvDay = process.env.BIN_COLLECTION_DAY;
    delete process.env.BIN_COLLECTION_DAY;
    resetBinScheduleCache();
    try {
      const chores = await loadChores({ now: localDate(2026, 8, 27, 18) });
      // Nothing in the house observes a feed, so the dog roster is date math
      // and only date math — a dead council calendar cannot touch it.
      expect(chores.dogs.tonight).toBe("Brett");
      expect(chores.bins).toEqual({ configured: false });
    } finally {
      process.env.BIN_COLLECTION_DAY = priorEnvDay;
      resetBinScheduleCache();
    }
  });
});

/* ── The three surfaces ─────────────────────────────────────────────────────
   The roster is one server answer read by three readers. What follows pins
   each reader's ON state and, more importantly, its OFF state — the flag's
   whole promise is that a flag-off build behaves exactly as it did before the
   roster existed.
─────────────────────────────────────────────────────────────────────────── */

const CHORES = Object.freeze({
  configured: true,
  dogs: { tonight: "Brett", tomorrow: "Greg" },
  rules: rosterRules(),
  bins: {
    configured: true,
    due: true,
    eve: true,
    lastChance: false,
    next: {
      date: "2026-08-28",
      weekday: "Friday",
      inDays: 1,
      eve: { date: "2026-08-27", weekday: "Thursday", inDays: 0 },
      colours: ["red", "green"],
      words: ["Rubbish", "Garden"],
      person: "Brett"
    },
    source: "fallback"
  }
});

function briefCtx(extra = {}) {
  return {
    type: "morning",
    generatedAt: localDate(2026, 8, 27, 7, 30),
    calendar: { today: [], tomorrow: [] },
    news: [],
    people: [],
    ...extra
  };
}

test.describe("the briefing", () => {
  test("names who is on tonight, and only who", () => {
    const payload = buildBriefPayload(briefCtx({
      bins: { due: true, eve: true, colours: ["Red", "Green"] },
      chores: CHORES
    }));
    expect(payload.chores).toBe("Brett feeds the dogs tonight, the bins are Brett's turn");
    /* ⚠ THE COLOURS ARE NOT IN IT. The Bins line already states which bins and
       when; a Chores line that restated them would hand the model two ways to
       say one thing, and it takes both. */
    expect(payload.chores).not.toContain("Red");
    expect(payload.bins).toBe("tonight: Red + Green");
  });

  test("the bins clause exists only when the bins do", () => {
    // No bin reminder tonight: the dogs still have a turn, the bins do not.
    const payload = buildBriefPayload(briefCtx({ bins: null, chores: CHORES }));
    expect(payload.chores).toBe("Brett feeds the dogs tonight");
  });

  test("flag off is no line at all, not an empty one", () => {
    // briefingData does not fetch /api/chores with the flag off, so ctx.chores
    // is null and buildPrompt omits the line entirely — the prompt is byte for
    // byte the prompt it was before this feature existed.
    const payload = buildBriefPayload(briefCtx({ bins: null, chores: null }));
    expect(payload.chores).toBeNull();
  });
});

/* The flag lives on `window.CONFIG`, which node does not have — so with no
   window every gated row reads as OFF, which is exactly the historical
   behaviour the rest of the suite sees. Both states are set explicitly here
   rather than inherited. */
function withFlag(on, fn) {
  const prior = globalThis.window;
  try {
    globalThis.window = { CONFIG: { features: { choreRoster: on } } };
    return fn();
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
}

/* ⚠ THE SAME HELPER WITH AN `await` IS NOT THE SAME HELPER. A `finally` that
   sits after an await runs in a microtask AFTER the test function has already
   returned, so a sync helper handed an async callback restores `window` some
   time after the next test has started reading it. Two helpers, one rule each. */
async function withFlagAsync(on, fn) {
  const prior = globalThis.window;
  try {
    globalThis.window = { CONFIG: { features: { choreRoster: on } } };
    return await fn();
  } finally {
    if (prior === undefined) delete globalThis.window;
    else globalThis.window = prior;
  }
}

test.describe("the voice", () => {
  const say = (utterance, snapshot = { chores: CHORES }) =>
    answer(matchIntent(utterance), snapshot)?.speech ?? null;

  /* ⚠ THE FLAG IS AT THE MATCHER. Off, the sentence is claimed by nothing and
     falls through to the model exactly as it did before — except for the two
     phrasings that were ALREADY claimed by something else, which must go back
     to claiming them. That second half is the rollback nobody checks. */
  test("flag off leaves every sentence where it was", () => {
    withFlag(false, () => {
      expect(matchIntent("whose turn is it to feed the dogs")).toBeNull();
      expect(matchIntent("whose turn is it")).toBeNull();
      // These two were answered — wrongly, but answered — before the roster.
      expect(matchIntent("who's on the bins")?.id).toBe("house.bins");
      expect(matchIntent("whose turn is it to do the bins")?.id).toBe("list.todo");
    });
  });

  test("flag on, the roster claims the ownership questions", () => {
    withFlag(true, () => {
      for (const utterance of [
        "whose turn is it to feed the dogs",
        "who feeds the dogs tonight",
        "who's on the bins",
        "who takes the bins out",
        "whose turn is it to do the bins",
        "is it my turn to feed the dogs",
        "whose turn is it"
      ]) {
        expect(matchIntent(utterance)?.id, `"${utterance}" was not claimed`).toBe("house.chores");
      }
    });
  });

  /* ⚠ IT MUST NOT STEAL IN THE OTHER DIRECTION. Every phrase below contains a
     word the roster's pattern looks at, and every one belongs to somebody
     else. `list.todo`'s bare "to do" and `house.bins`' bare "bins" are the two
     the roster had to be placed above, so they are the two most at risk of
     being swallowed whole. */
  test("flag on, it takes nothing that was not asking about a turn", () => {
    withFlag(true, () => {
      expect(matchIntent("what's on my to do list")?.id).toBe("list.todo");
      expect(matchIntent("what's on the shopping list")?.id).toBe("list.shopping");
      expect(matchIntent("when are the bins")?.id).toBe("house.bins");
      expect(matchIntent("which bins go out")?.id).toBe("house.bins");
      expect(matchIntent("who's home")?.id).toBe("house.who");
      expect(matchIntent("who was at the door")?.id).toBe("camera.last");
      expect(matchIntent("what's on today")?.id).toBe("cal.today");
    });
  });

  test("it answers the chore it was asked about", () => {
    withFlag(true, () => {
      expect(say("whose turn is it to feed the dogs")).toBe("Brett feeds the dogs tonight.");
      expect(say("who takes the bins out")).toBe("Red and green go out tonight — that's Brett.");
      // Neither named: both, and still inside the two-sentence cap.
      expect(say("whose turn is it"))
        .toBe("Brett feeds the dogs tonight. Red and green go out tonight — that's Brett.");
    });
  });

  /* ⚠ THE F7 DEFECT, ONE CHORE OVER. "Whose turn tomorrow" answered with
     tonight's name is fast, confident and wrong — the failure mode that costs
     the lane the trust it runs on. The dog roster is per night, so tomorrow is
     a real question with a real answer; anything past tomorrow declines. */
  /* ⚠ A HARDCODED WEEKDAY NAME IS A DATE-DEPENDENT ASSERTION. This line read
     "on saturday", which was two nights out on the Thursday it was written and
     IS TOMORROW every Friday — a night the roster answers by design. So the
     assertion inverted itself on a day of the week rather than on a code
     change, and it went red on the flag flip having never been about the flag.
     The claim is "further out than tomorrow"; let the clock name that day. */
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const inDays = (n) => WEEKDAYS[(new Date().getDay() + n) % 7];

  test("a named day picks the night, and past tomorrow it declines", () => {
    withFlag(true, () => {
      expect(say("who feeds the dogs tomorrow")).toBe("Greg feeds the dogs tomorrow night.");
      expect(say("whose turn is it tomorrow")).toBe("Greg feeds the dogs tomorrow night.");
      expect(matchIntent(`who feeds the dogs on ${inDays(3)}`)).toBeNull();
      expect(matchIntent("whose turn is it next week")).toBeNull();
    });
  });

  test("a bin question about a night that is not the out-night declines", () => {
    withFlag(true, () => {
      // The bins go out tonight in this fixture. "Are the bins mine tomorrow"
      // has one honest answer and it is not the next collection's name.
      expect(say("who's on the bins tomorrow")).toBeNull();
    });
  });

  test("an unowned bin night is declined, not guessed", () => {
    withFlag(true, () => {
      const noOwner = {
        chores: {
          ...CHORES,
          bins: { ...CHORES.bins, next: { ...CHORES.bins.next, person: null } }
        }
      };
      expect(say("who takes the bins out", noOwner)).toBeNull();
      // The dogs are unaffected — one chore going quiet is not both.
      expect(say("whose turn is it", noOwner)).toBe("Brett feeds the dogs tonight.");
    });
  });

  /* A chore rota nobody knows they can ask about is answered by asking the
     other person, which is what the house is for. The card is where the
     phrasing gets taught — and with the flag off the truth filter drops it,
     which is the flag-off promise arriving somewhere nobody would have gone
     looking for it. */
  test("the card teaches the phrase, and only while the roster is on", () => {
    const snap = { chores: CHORES };
    const evening = { now: localDate(2026, 8, 27, 18) };
    const PHRASE = "whose turn is it to feed the dogs";

    withFlag(true, () => expect(vocabularyFor(snap, evening)).toContain(PHRASE));
    withFlag(false, () => expect(vocabularyFor(snap, evening)).not.toContain(PHRASE));
    // A night job, offered from mid-afternoon. Nobody asks at breakfast.
    withFlag(true, () =>
      expect(vocabularyFor(snap, { now: localDate(2026, 8, 27, 8) })).not.toContain(PHRASE));
    // And never when the roster itself is absent.
    withFlag(true, () => expect(vocabularyFor({}, evening)).not.toContain(PHRASE));
  });

  test("an absent roster is silence, not an invented turn", () => {
    withFlag(true, () => {
      // The route being down must never read as "nobody is on tonight".
      expect(say("whose turn is it", {})).toBeNull();
      expect(say("whose turn is it", { chores: { configured: false } })).toBeNull();
    });
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE CACHE FILL — the defect underneath every answerer above.

   `cache.commute` and `cache.fuel` sat DECLARED AND NEVER FETCHED in
   voiceSnapshot from the day that module was written: the answerers were
   correct, the snapshot they read was permanently null, nothing failed and
   nothing logged (local-voice.spec.js's closing block). `cache.chores` is
   declared the same way and fetched conditionally, which is the same shape
   with one more way to be wrong — so it gets the same guard, in both flag
   states.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("the cache fill", () => {
  // Workers are reused across spec files; a stubbed global left behind would
  // follow this file into the next pure-node spec in the same process.
  const realFetch = globalThis.fetch;
  test.afterEach(() => { globalThis.fetch = realFetch; });

  function stub() {
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      const chores = String(url).includes("/api/chores");
      return {
        ok: chores,
        status: chores ? 200 : 404,
        json: async () => (chores ? CHORES : null)
      };
    };
    return asked;
  }

  test("⚠ with the roster on, it ASKS for it", async () => {
    const asked = await withFlagAsync(true, async () => {
      const seen = stub();
      await refreshVoiceCache();
      return seen;
    });
    expect(asked.some((u) => u.includes("/api/chores")), "never asked for the roster").toBe(true);
  });

  test("with the roster off, it does not ask at all", async () => {
    const asked = await withFlagAsync(false, async () => {
      const seen = stub();
      await refreshVoiceCache();
      return seen;
    });
    // Flag-off is NO FETCH, not a discarded one. The off state has to be the
    // network behaviour the lane had before the roster existed.
    expect(asked.some((u) => u.includes("/api/chores"))).toBe(false);
  });

  test("and the fast lane answers from the cache, end to end", async () => {
    await withFlagAsync(true, async () => {
      stub();
      await refreshVoiceCache();
      const snap = voiceSnapshot();
      expect(answer(matchIntent("whose turn is it to feed the dogs"), snap).speech)
        .toBe("Brett feeds the dogs tonight.");
      // …and the conversational lane sees it too, rule and all.
      expect(snap.chores.rules.length).toBeGreaterThan(0);
    });
  });
});
