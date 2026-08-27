import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { matchIntent, matchCamera, normalise, resolveDay, DAY_BEYOND, INTENT_IDS } from "../src/js/services/localIntents.js";
import { answer, capSentences, ANSWERABLE } from "../src/js/services/localAnswers.js";
import { pickLastCameraEvent, refreshVoiceCache, voiceSnapshot } from "../src/js/services/voiceSnapshot.js";
import { vocabularyFor, railPhrase, ALL_CANDIDATES } from "../src/js/services/vocabulary.js";

/* The fast lane's contract. These are pure-node tests — no browser, no server,
   no DOM — because the whole point of the lane is that it answers without any
   of those. If this file needs a page, the lane has regressed.

   The important assertions here are the PRECEDENCE ones. The matcher is an
   ordered list and first match wins, so a general pattern sitting above a
   specific one silently eats it and everything still "passes" if you only
   assert that something matched. Every test below names the intent it expects. */

/* The forecast feed keys every day by a bare local YYYY-MM-DD — the answerers
   look days up by that date rather than by index, so a fixture without one is a
   fixture that cannot produce the defect. Built relative to the real clock
   because matchIntent resolves days against it and cannot be handed a fake now. */
const isoDay = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const SNAP = {
  sun: { sunrise: "2026-08-07T06:22:00+10:00", sunset: "2026-08-07T17:20:00+10:00" },
  weather: {
    now: { temp_c: 17.9, feels_like_c: 18.3, uv: 0.45, wind_kph: 6.4, rain_chance_pct: 10, condition: { label: "Clear" } },
    day: { high_c: 22.4, low_c: 9.1 }
  },
  forecast: {
    days: [
      { date: isoDay(0), high_c: 22, low_c: 9 },
      { date: isoDay(1), high_c: 24, low_c: 11, condition: { label: "Partly cloudy" } }
    ]
  },
  nowcast: { startsInMin: 20 },
  calendar: [
    { title: "Dentist", start: new Date(Date.now() + 3 * 3600e3).toISOString() },
    { title: "Soccer", start: new Date(Date.now() + 5 * 3600e3).toISOString() }
  ],
  menu: "Chicken Fajitas",
  bins: { configured: true, due: true, label: "Tonight", bins: ["yellow", "green"] },
  people: [{ name: "Greg", home: true }, { name: "Brett", home: false }],
  media: [{ title: "Nightswimming", artist: "R.E.M." }],
  sleep: { score: 88, label: "solid" },
  /* ⚠⚠ THIS FIXTURE WAS THE REASON THE DEFECT SURVIVED 1,442 GREEN TESTS. It
     used to read `{greg: {minutes: 24, delayMin: 6}}` — a shape
     `/api/commute/all` has never served — because it was written to match the
     answerer instead of the route. The answerer agreed with it, the sweep below
     passed, and on the wall `self.commute` returned null every time. A fixture
     that cannot produce the defect cannot catch it; this is now the payload the
     live G11 actually returns, measured 2026-08-18. Its contract is pinned
     independently in tests/commute-privacy.spec.js. */
  commute: {
    legs: [
      { id: "greg", label: "Greg", seconds: 683, trafficDelaySeconds: 0 },
      { id: "brett", label: "Brett", seconds: 1092, trafficDelaySeconds: 0 }
    ]
  },
  fuel: { sites: [{ price: 174.9, name: "the Nudgee servo" }] },
  todos: { shopping: ["milk", "bread", "coffee", "eggs"], tasks: ["call the plumber"] },
  camera: { known: true, lastEvent: { name: "front door", at: new Date().toISOString(), person: "Greg" } },
  lastReply: "It's 17 degrees and clear."
};

test.describe("intent matching — precedence", () => {
  const cases = [
    ["what time is it", "time.now"],
    ["what day is it", "time.date"],
    ["when's sunset", "time.sunset"],
    ["what time does the sun set", "time.sunset"],
    ["when is sunrise", "time.sunrise"],
    ["what's the weather", "weather.now"],
    ["how's it outside", "weather.now"],
    ["what's the weather tomorrow", "weather.tomorrow"],
    ["do i need an umbrella", "weather.umbrella"],
    ["is it going to rain", "weather.umbrella"],
    ["do i need a jacket", "weather.jacket"],
    ["do i need sunscreen", "weather.sunscreen"],
    ["is it windy", "weather.wind"],
    ["what's on today", "cal.today"],
    ["what's on tomorrow", "cal.tomorrow"],
    ["what's next", "cal.next"],
    ["am i free", "cal.free"],
    ["who's home", "house.who"],
    ["what bins go out", "house.bins"],
    ["what's playing", "house.media"],
    ["how did i sleep", "self.sleep"],
    ["how's the traffic", "self.commute"],
    ["where's the cheapest petrol", "self.fuel"],
    ["what's on the shopping list", "list.shopping"],
    ["who was at the door", "camera.last"],
    ["what can i say", "meta.vocabulary"],
    ["say that again", "meta.repeat"],
    ["goodnight", "action.goodnight"]
  ];

  for (const [utterance, expected] of cases) {
    test(`"${utterance}" -> ${expected}`, () => {
      const got = matchIntent(utterance);
      expect(got, `"${utterance}" matched nothing`).not.toBeNull();
      expect(got.id).toBe(expected);
    });
  }
});

// Regression, 2026-08-09: asked about sleep, the house answered "I don't have
// access to your sleep or the time" — from Claude, three lanes down, while
// sensor.cpap_total_myair_score sat in memory reading 98. Only "how did i
// sleep" was in the pattern, so every other way of asking fell through. The
// point of the fast lane is that it OWNS the questions the house can answer.
test.describe("self.sleep — the ways people actually ask", () => {
  for (const utterance of [
    "how did i sleep",
    "how'd i sleep",
    "how was my sleep",
    "how did you sleep",
    "how was my sleep last night",
    "did i sleep well",
    "what's my sleep score",
    "how's my sleep quality",
    "how long did i sleep last night",
    "what was my ahi",
    "how did the cpap go",
    "what's my myair score"
  ]) {
    test(`"${utterance}" -> self.sleep`, () => {
      const got = matchIntent(utterance);
      expect(got, `"${utterance}" matched nothing`).not.toBeNull();
      expect(got.id).toBe("self.sleep");
    });
  }

  // The widening must not reach across the table. action.goodnight sits ABOVE
  // self.sleep precisely so bedtime keeps its own verbs, and a pattern greedy
  // enough to take "sleep mode" would silently stop the goodnight routine.
  for (const [utterance, owner] of [
    ["goodnight", "action.goodnight"],
    ["sleep mode", "action.goodnight"],
    ["i'm going to bed", "action.goodnight"]
  ]) {
    test(`"${utterance}" still belongs to ${owner}`, () => {
      expect(matchIntent(utterance)?.id).toBe(owner);
    });
  }
});

test("an utterance the lane does not own falls through to null", () => {
  // These must NOT be claimed locally — they belong to Assist or the model.
  for (const text of [
    "why is the sky blue",
    "tell me a joke about wombats",
    "add oat milk to the shopping list",
    "turn on the lounge lamp"
  ]) {
    expect(matchIntent(text), `"${text}" was wrongly claimed by the local lane`).toBeNull();
  }
});

test("normalise strips the wake word and punctuation the STT sprinkles in", () => {
  expect(normalise("Hey Mycroft, what's the time?")).toBe("what's the time");
  expect(normalise("  MYCROFT   what   day  is it!! ")).toBe("what day is it");
});

test("all three contraction forms whisper produces resolve to the same intent", () => {
  // Identical audio reaches us as any of these depending on how much context
  // the recogniser had. Each group must land on one intent, or the phrase is
  // dead in the room while green in CI.
  const groups = [
    [["who's home", "who is home", "whos home"], "house.who"],
    [["what's the weather", "what is the weather", "whats the weather"], "weather.now"],
    [["what's on today", "what is on today", "whats on today"], "cal.today"],
    [["what's next", "what is next", "whats next"], "cal.next"],
    [["when's sunset", "when is sunset"], "time.sunset"],
    [["what's playing", "what is playing", "whats playing"], "house.media"]
  ];
  for (const [forms, expected] of groups) {
    for (const form of forms) {
      const got = matchIntent(form);
      expect(got, `"${form}" matched nothing`).not.toBeNull();
      expect(got.id, `"${form}" resolved to the wrong intent`).toBe(expected);
    }
  }
});

test("camera aliases resolve, and longer aliases are not shadowed by shorter ones", () => {
  expect(matchCamera("show me the side gate")).toBe("side_gate");
  expect(matchCamera("show me the driveway")).toBe("driveway");
  expect(matchCamera("show me the front yard")).toBe("front_yard");
  expect(matchCamera("show me the door")).toBe("doorbell");
  expect(matchCamera("show me the kitchen")).toBeNull();
});

test("show-me carries the camera as a slot", () => {
  const got = matchIntent("show me the driveway");
  expect(got.id).toBe("show.camera");
  expect(got.slots.camera).toBe("driveway");
});

/* ── The Phase 4 surfaces ────────────────────────────────────────────────────
   Six depth-3 subjects landed at once, and every noun they answer to ALREADY
   belonged to a spoken intent higher up the table. The resolver only runs when
   a show verb is present, and these tests are the two halves of why that
   works. Both halves are load-bearing: the first is the feature, the second is
   the incumbent not regressing while V3 gains it.
─────────────────────────────────────────────────────────────────────────── */
test.describe("show-me surfaces — the new subjects", () => {
  const cases = [
    ["show me the shopping list", "show.list", { list: "shopping" }],
    ["show me the groceries", "show.list", { list: "shopping" }],
    ["show me my list", "show.list", { list: "todo" }],
    ["bring up the to do list", "show.list", { list: "todo" }],
    ["show me my day", "show.day", {}],
    ["pull up the calendar", "show.day", {}],
    ["show me the recipe", "show.recipe", {}],
    ["let me see what's playing", "show.media", {}],
    ["show me the year", "show.year", {}],
    ["show me the photos", "show.year", {}],
    ["show me the briefing", "show.briefing", {}],
    ["show me the status", "show.status", {}],
    ["check the system", "show.status", {}],
    ["pull up diagnostics", "show.status", {}]
  ];

  for (const [utterance, expected, slots] of cases) {
    test(`"${utterance}" -> ${expected}`, () => {
      const got = matchIntent(utterance);
      expect(got, `"${utterance}" matched nothing`).not.toBeNull();
      expect(got.id).toBe(expected);
      for (const [key, value] of Object.entries(slots)) {
        expect(got.slots?.[key], `"${utterance}" lost its ${key} slot`).toBe(value);
      }
    });
  }

  test("a camera still outranks every other surface", () => {
    // "check the side gate" contains no surface noun, but "look at the front
    // door" is exactly the collision: doorbell is a camera alias and "the
    // door" could read as a list of nothing. The camera resolver runs first.
    expect(matchIntent("look at the front door").id).toBe("show.camera");
    expect(matchIntent("check the side gate").id).toBe("show.camera");
  });

  test("⚠ a bare \"status\" is left alone for the incumbent's nav lane", () => {
    /* Phase 6's precedence trap, and the reason the regex requires a show verb.
       voiceCommands' NAV_KEYWORD_MAP matches a bare substring "status" and
       switches the incumbent to its status view — but matchNav runs AFTER
       matchIntent, so anything this table claims never reaches it. Requiring
       the verb keeps the bare word on the nav lane exactly as it was. */
    expect(matchIntent("status")).toBeNull();
    expect(matchIntent("system")).toBeNull();
  });

  test("two questions with no show verb reach a subject anyway", () => {
    // These have a natural question form and previously matched nothing at
    // all, so they cost no existing phrase.
    expect(matchIntent("what's for dinner").id).toBe("show.recipe");
    expect(matchIntent("what are we having").id).toBe("show.recipe");
    expect(matchIntent("catch me up").id).toBe("show.briefing");
  });

  test("⚠ REGRESSION GUARD: the spoken phrasings are untouched", () => {
    /* Every one of these was answered out loud before Phase 4 and must still
       be. The incumbent has NO depth 3 — it reaches a show.* id and falls
       through to answer() — so a resolver that swallowed one of these would
       turn a working spoken reply on the wall into a trip to Assist, and
       nothing would throw. This is the assertion that stops that. */
    const spoken = [
      ["what's on the shopping list", "list.shopping"],
      ["what's on my list", "list.todo"],
      ["what's playing", "house.media"],
      ["what's on today", "cal.today"],
      ["what's on tomorrow", "cal.tomorrow"],
      ["am i free", "cal.free"],
      ["what's next", "cal.next"]
    ];
    for (const [utterance, expected] of spoken) {
      expect(matchIntent(utterance).id, `"${utterance}" was stolen by a surface`).toBe(expected);
    }
    // And the one the resolver was explicitly kept away from: a show verb plus
    // a bare time word is still the calendar's question, not the screen's.
    expect(matchIntent("show me what's on today").id).toBe("cal.today");
  });

  test("⚠ the ONE phrase show.tonight cannot have, and why that is right", () => {
    /* `show.tonight`'s own pattern offers `what's (on )?tonight`, and the second
       half of it is unreachable: cal.today's `what.s on` sits seven rows higher
       and eats "what's on tonight" whole. Found driving the row for the first
       time, 2026-08-15, and deliberately left alone — cal.today ANSWERS OUT
       LOUD in a fifth of a second, and taking the whole wall to depth 3 for a
       question someone asked in passing is the calm law's plainest violation.
       The phrases that do reach the subject all ask for the screen. */
    expect(matchIntent("what's on tonight").id).toBe("cal.today");
    for (const utterance of ["show me tonight", "what about tonight", "what's tonight"]) {
      expect(matchIntent(utterance).id, `"${utterance}" no longer reaches the subject`).toBe("show.tonight");
    }
  });

  test("⚠ every surface the INCUMBENT can reach can still say something", () => {
    /* ⚠ READ THIS BEFORE TRUSTING THE WORD "INCUMBENT" HERE — it was written
       before the cutover and describes a surface that is no longer on the wall.
       `/` has served V3 since `77f5fb1`, so voiceCommands.js is not what
       answers a spoken "show me the radar" in this house any more; V3's
       registry mounts a depth-3 subject and every id below reaches one
       (tests/v3-subjects.spec.js drives all ten). The list still earns its keep
       for one reason: the incumbent tree is the DOCUMENTED ROLLBACK PATH
       (`V3_DEFAULT=0`, V3-CUTOVER.md:504), and a rollback surface that has gone
       mute is a rollback nobody can use. Cold standby, still checked.

       The incumbent handles show.camera and show.sky itself and falls through
       to answer() for everything else. Two ids are silent BY DESIGN and are
       named here rather than inferred: the year is answered by the
       photographs, and the briefing's text does not exist until it has been
       generated, so its subject speaks its own opening. Any OTHER show.* id
       without an answerer is a spoken reply that silently became an Assist
       round trip. */
    /* ⚠ show.status is a THIRD id the incumbent handles itself, added in Phase
       6, and it had to be: `matchIntent` runs BEFORE `matchNav`, so the moment
       the table learned the word "status" the incumbent's status view became
       unreachable by "show me the status" unless voiceCommands answered the id
       explicitly. It does — see the branch beside show.sky. */
    const surfaceHandledByIncumbent = ["show.camera", "show.sky", "show.status"];
    /* show.tonight is silent because it OPENS THE DAY, and the calendar on the
       glass is the answer — the same reason the year is silent. On the
       incumbent it reaches neither, which is a rollback-only gap and the
       cheapest kind: it costs one Assist round trip on a surface nobody is
       looking at. */
    const silentByDesign = ["show.year", "show.briefing", "show.tonight"];
    const mustAnswer = INTENT_IDS.filter(
      (id) =>
        id.startsWith("show.") &&
        !surfaceHandledByIncumbent.includes(id) &&
        !silentByDesign.includes(id)
    );
    expect(mustAnswer.length, "no surfaces left to check — the filter is wrong").toBeGreaterThan(0);
    const missing = mustAnswer.filter((id) => !ANSWERABLE.includes(id));
    expect(missing, `surfaces the incumbent would go mute on: ${missing.join(", ")}`).toEqual([]);
  });

  test("⚠ …and 'handled by the incumbent' is CHECKED, not just declared", () => {
    /* The list above is an assertion about voiceCommands.js that the list
       itself cannot make. Delete the `show.status` branch there and every test
       in this file still passes, while the wall quietly loses its status view
       to an Assist round trip — the exact silent regression the list was
       written to prevent. So read the file and require the branch.

       Source-reading as a guard has precedent here: the composer's spec parses
       compose.css because the stylesheet, not the design study, is the truth. */
    const src = readFileSync(new URL("../src/js/core/voiceCommands.js", import.meta.url), "utf8");
    for (const id of ["show.camera", "show.sky", "show.status"]) {
      expect(src, `voiceCommands.js has no branch for ${id} — the incumbent goes mute`)
        .toContain(`intent.id === "${id}"`);
    }
  });

  test("⚠ every action.* id has a branch on the surface that is actually up", () => {
    /* `action.*` is exempt from needing an answerer here — the test above says
       so, and it is right: an action changes the house, it does not describe
       it. But the exemption is only safe while SOME surface handles the id, and
       from the V3 cutover until 2026-08-17 none did. `action.goodnight` matched,
       `answer()` correctly returned null, and the turn fell through to the model,
       which chatted about bedtime. Nothing in this file could see it: the
       matcher was never the broken half.

       So the exemption is made conditional on the handler existing. `/` serves
       V3, so V3 is the surface that must have it; the incumbent's dispatch table
       is checked too, because it is the rollback host. */
    const actions = INTENT_IDS.filter((id) => id.startsWith("action."));
    expect(actions.length, "no action.* ids left — the filter is wrong").toBeGreaterThan(0);

    const v3 = readFileSync(new URL("../src/v3/core/voice.js", import.meta.url), "utf8");
    const incumbent = readFileSync(new URL("../src/js/core/voiceCommands.js", import.meta.url), "utf8");
    for (const id of actions) {
      expect(v3, `V3 (the surface on the wall) has no branch for ${id}`)
        .toContain(`intent.id === "${id}"`);
      expect(incumbent, `the rollback host has no dispatch entry for ${id}`)
        .toContain(`"${id}"`);
    }
  });

  test("the surface answers match what the spoken intent used to say", () => {
    // Same snapshot, same words. This is what makes the matcher change
    // invisible on the wall rather than merely non-fatal.
    expect(answer(matchIntent("show me the shopping list"), SNAP).speech)
      .toBe(answer(matchIntent("what's on the shopping list"), SNAP).speech);
    expect(answer(matchIntent("let me see what's playing"), SNAP).speech)
      .toBe(answer(matchIntent("what's playing"), SNAP).speech);
  });

  test("NOT LOADED IS NOT EMPTY on every new surface", () => {
    // A cold cache must fall the turn through, never claim the list is empty
    // or the day is clear. Each of these has said the opposite in this repo.
    for (const utterance of [
      "show me the shopping list",
      "show me my list",
      "show me my day",
      "show me the recipe",
      "let me see what's playing"
    ]) {
      expect(answer(matchIntent(utterance), {}), `"${utterance}" answered from a cold cache`).toBeNull();
    }
    // ...but a loaded-and-genuinely-empty one earns a sentence.
    expect(answer(matchIntent("show me my day"), { calendar: [] }).speech).toBe("Nothing on today.");
    expect(answer(matchIntent("show me the shopping list"), { todos: { shopping: [] } }).speech)
      .toBe("The shopping list is empty.");
    expect(answer(matchIntent("show me the recipe"), { calendar: [], menu: null }).speech)
      .toBe("Nothing's planned for dinner.");
  });
});

test("a named person becomes a slot on house.who", () => {
  const got = matchIntent("is brett home");
  expect(got.id).toBe("house.who");
  expect(got.slots.person).toBe("brett");
  // ...but "is anyone home" must not produce a person called "anyone".
  expect(matchIntent("is anyone home").slots.person).toBeUndefined();
});

test.describe("vocabulary — the house only offers what it can actually answer", () => {
  const at = (hour) => { const d = new Date(); d.setHours(hour, 0, 0, 0); return d; };

  test("THE property: every offered phrase really is answerable right now", () => {
    // This is the whole contract. A rail that suggests something which then
    // falls through teaches the family that the suggestions are decorative,
    // and after two of those they stop reading it.
    const snapshots = [
      {},                                                     // every upstream down
      { calendar: [] },                                       // loaded but empty
      SNAP,                                                   // fully populated
      { weather: { now: { temp_c: 30, uv: 11, rain_chance_pct: 0 } } }
    ];
    for (const snap of snapshots) {
      for (const hour of [7, 12, 18, 22]) {
        for (const phrase of vocabularyFor(snap, { now: at(hour) })) {
          if (phrase === "brief me") continue;               // routed to the AI path, not the lane
          const intent = matchIntent(phrase);
          expect(intent, `offered "${phrase}" but the matcher lost it`).not.toBeNull();
          if (intent.id.startsWith("show.") || intent.id.startsWith("action.")) continue;
          expect(
            answer(intent, snap),
            `offered "${phrase}" at ${hour}:00 but it would have fallen through`
          ).not.toBeNull();
        }
      }
    }
  });

  test("with every upstream down it offers little, and never the calendar", () => {
    const offered = vocabularyFor({}, { now: at(8) });
    expect(offered).toContain("what time is it");
    expect(offered).not.toContain("what's on today");   // would have lied "nothing on"
    expect(offered).not.toContain("how did I sleep");
  });

  test("suggestions are gated on context, not sprayed", () => {
    const wet = { weather: { now: { temp_c: 14, feels_like_c: 13, rain_chance_pct: 80 } }, nowcast: { startsInMin: 12 } };
    const dry = { weather: { now: { temp_c: 28, feels_like_c: 29, rain_chance_pct: 0, uv: 9 } } };
    expect(vocabularyFor(wet, { now: at(9) })).toContain("do I need an umbrella");
    expect(vocabularyFor(dry, { now: at(9) })).not.toContain("do I need an umbrella");
    expect(vocabularyFor(dry, { now: at(9) })).toContain("do I need sunscreen");
    // Sleep is a morning question. Nobody asks how they slept at 10pm.
    expect(vocabularyFor(SNAP, { now: at(8) })).toContain("how did I sleep");
    expect(vocabularyFor(SNAP, { now: at(22) })).not.toContain("how did I sleep");
  });

  test("the rail rotates deterministically rather than repeating by luck", () => {
    const seen = new Set();
    for (let t = 0; t < 8; t++) seen.add(railPhrase(SNAP, { now: at(9), tick: t }));
    expect(seen.size).toBeGreaterThan(4);
    expect(railPhrase({}, { now: at(9), tick: 0 })).not.toBeNull();
  });

  test("every candidate is a phrase the matcher can resolve", () => {
    /* ⚠ FLAG-GATED ROWS ARE ARMED HERE, and that is not a weakening of the
       assertion. This test is about PHRASING drift — a candidate whose wording
       the matcher no longer knows — and a row that is merely OFF is a different
       statement, one this test would otherwise report as a lost phrase every
       time a flag ships default-off. The off state is not going unwatched:
       vocabularyFor's truth filter drops an unclaimed phrase from the card, and
       tests/chore-roster.spec.js pins both directions of it. */
    const prior = globalThis.window;
    try {
      globalThis.window = { CONFIG: { features: { choreRoster: true } } };
      const lost = ALL_CANDIDATES.filter((u) => !matchIntent(u) && u !== "brief me");
      expect(lost, `candidates the matcher cannot resolve: ${lost.join(", ")}`).toEqual([]);
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });
});

test.describe("the last camera event is derived from the entity cache", () => {
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();

  test("a sensor still detecting beats a more recent clear elsewhere", () => {
    const got = pickLastCameraEvent([
      { entity_id: "binary_sensor.driveway_motion_detected", state: "off", last_changed: ago(1) },
      { entity_id: "binary_sensor.doorbell_person_detected", state: "on", last_changed: ago(4) }
    ]);
    // "on" wins even though the driveway changed more recently — a camera that
    // is detecting right now is the better answer to "is anyone out there".
    expect(got.lastEvent.name).toBe("doorbell");
  });

  test("with nothing live, the most recent change wins", () => {
    const got = pickLastCameraEvent([
      { entity_id: "binary_sensor.driveway_motion_detected", state: "off", last_changed: ago(2) },
      { entity_id: "binary_sensor.patio_motion_detected", state: "off", last_changed: ago(30) }
    ]);
    expect(got.lastEvent.name).toBe("driveway");
  });

  test("a matching person sensor names who it was, and junk states do not", () => {
    const base = [{ entity_id: "binary_sensor.doorbell_person_detected", state: "on", last_changed: ago(1) }];
    expect(pickLastCameraEvent([...base, { entity_id: "sensor.doorbell_person_name", state: "Greg" }]).lastEvent.person).toBe("Greg");
    for (const junk of ["unknown", "unavailable", "none", ""]) {
      expect(pickLastCameraEvent([...base, { entity_id: "sensor.doorbell_person_name", state: junk }]).lastEvent.person).toBeNull();
    }
  });

  test("stale events fall outside the window, and an empty cache is not an event", () => {
    expect(pickLastCameraEvent([
      { entity_id: "binary_sensor.patio_motion_detected", state: "off", last_changed: ago(60 * 9) }
    ]).lastEvent).toBeNull();
    expect(pickLastCameraEvent([]).lastEvent).toBeNull();
    expect(pickLastCameraEvent(null).lastEvent).toBeNull();
  });

  test("non-camera binary sensors are never mistaken for camera events", () => {
    expect(pickLastCameraEvent([
      { entity_id: "binary_sensor.archer_ax11000_wan_status", state: "on", last_changed: ago(1) },
      { entity_id: "binary_sensor.radarr_health", state: "on", last_changed: ago(1) }
    ]).lastEvent).toBeNull();
  });

  test("the answer reads back as something a person would say", () => {
    const snap = { camera: pickLastCameraEvent([
      { entity_id: "binary_sensor.side_gate_person_detected", state: "on", last_changed: ago(1) },
      { entity_id: "sensor.side_gate_person_name", state: "Brett" }
    ]) };
    expect(answer(matchIntent("who was at the door"), snap).speech).toMatch(/^Brett at the side gate, /);
  });
});

test.describe("answers", () => {
  test("every matcher id is either answerable here or handled by the surface", () => {
    // show.* and action.* are surface concerns (they change depth or fire a
    // routine) rather than spoken answers. Everything else must have an answerer,
    // so a new intent cannot be added without a matching reply.
    const surfaceHandled = INTENT_IDS.filter((id) => id.startsWith("show.") || id.startsWith("action."));
    const needsAnswer = INTENT_IDS.filter((id) => !surfaceHandled.includes(id));
    const missing = needsAnswer.filter((id) => !ANSWERABLE.includes(id));
    expect(missing, `intents with no answerer: ${missing.join(", ")}`).toEqual([]);
  });

  test("the sentence cap does not mangle abbreviations", () => {
    // A "." inside an abbreviation is not a sentence end. This exact case was
    // shipping as "Nightswimming by R.E." before the terminator required
    // trailing whitespace.
    expect(capSentences("Nightswimming by R.E.M.")).toBe("Nightswimming by R.E.M.");
    expect(capSentences("Dr. Patel at 9 a.m.")).toBe("Dr. Patel at 9 a.m.");
    expect(answer(matchIntent("what's playing"), SNAP).speech).toBe("Nightswimming by R.E.M.");
  });

  test("answers are capped at two sentences", () => {
    expect(capSentences("One. Two. Three. Four.")).toBe("One. Two.");
    for (const utterance of ["what's on today", "what's on the shopping list", "who's home"]) {
      const a = answer(matchIntent(utterance), SNAP);
      const sentences = a.speech.match(/[^.!?]+[.!?]/g) ?? [a.speech];
      expect(sentences.length, `"${utterance}" spoke ${sentences.length} sentences`).toBeLessThanOrEqual(2);
    }
  });

  test("a list of more than three is never spoken in full", () => {
    const a = answer(matchIntent("what's on the shopping list"), SNAP);
    expect(a.speech).toContain("milk");
    expect(a.speech).not.toContain("eggs");   // the fourth item stays on screen
    expect(a.speech).toMatch(/1 more|And 1 more/);
  });

  test("the nowcast wins over a percentage, because a time is actionable", () => {
    const a = answer(matchIntent("do i need an umbrella"), SNAP);
    expect(a.speech).toBe("Yes — rain in about 20 minutes.");
  });

  /* ── self.commute · the lane that had two defects stacked ──────────────────
     The cache slice was declared and never fetched, AND the answerer read a
     shape the route has never served. The top one hid the bottom one: filling
     the cache alone would have changed nothing and looked like a wasted fix.
     Every case below is against the real payload.
  ─────────────────────────────────────────────────────────────────────────── */
  test.describe("self.commute", () => {
    const leg = (id, label, seconds, delay = 0) =>
      ({ id, label, seconds, trafficDelaySeconds: delay });

    test("two drives are each NAMED — neither becomes 'the' commute", () => {
      // houseSnapshot's own rule, one surface across: the leg that survives
      // stays named rather than quietly becoming the only one. The old answerer
      // took `c.greg ?? c.brett` and spoke one number with no name on it.
      expect(answer(matchIntent("how's the traffic"), SNAP).speech)
        .toBe("Greg's is 11 minutes, Brett's is 18.");
    });

    test("one drive needs no name — 'about eleven minutes' is the whole answer", () => {
      const snap = { commute: { legs: [leg("greg", "Greg", 683)] } };
      expect(answer(matchIntent("how long's my commute"), snap).speech).toBe("About 11 minutes.");
    });

    test("traffic is named only when it is worth naming", () => {
      const light = { commute: { legs: [leg("greg", "Greg", 683, 120)] } };   // 2 min
      const heavy = { commute: { legs: [leg("greg", "Greg", 1400, 400)] } };  // 7 min
      expect(answer(matchIntent("how's the traffic"), light).speech).toBe("About 11 minutes.");
      expect(answer(matchIntent("how's the traffic"), heavy).speech)
        .toBe("About 23 minutes, 7 of that traffic.");
    });

    test("⚠ A DEAD LEG IS DROPPED, not spoken as a number it does not have", () => {
      // The route returns `seconds: null` for a leg whose upstream failed, in a
      // 200 alongside the leg that worked. Reading that as a drive would put
      // "NaN minutes" in the room.
      const snap = { commute: { legs: [leg("greg", "Greg", null), leg("brett", "Brett", 1092)] } };
      expect(answer(matchIntent("how's the traffic"), snap).speech).toBe("About 18 minutes.");
    });

    test("⚠ every leg dead is silence, not a confident zero", () => {
      const snap = { commute: { legs: [leg("greg", "Greg", null), leg("brett", "Brett", null)] } };
      expect(answer(matchIntent("how's the traffic"), snap)).toBeNull();
    });

    test("⚠ the OLD invented shape now answers nothing — the fixture cannot drift back", () => {
      /* `{greg: {minutes, delayMin}}` is what both the answerer and this file's
         fixture believed in until 2026-08-18. If someone reshapes either one
         back to it, this goes red instead of going quiet. */
      expect(answer(matchIntent("how's the traffic"), { commute: { greg: { minutes: 24, delayMin: 6 } } }))
        .toBeNull();
    });
  });

  test("self.fuel reads the payload the route actually serves", () => {
    // Measured on the live G11 2026-08-18: {sites:[{price, name, address,
    // distanceKm}]}. This answerer was right all along and simply never fed.
    const snap = { fuel: { sites: [{ price: 194.9, name: "EG Ampol Deagon", address: "180 Braun St", distanceKm: 4.6 }] } };
    expect(answer(matchIntent("where's the cheapest petrol"), snap).speech)
      .toBe("194.9 cents at EG Ampol Deagon.");
    // Configured but nothing returned is silence, not "0 cents at undefined".
    expect(answer(matchIntent("where's the cheapest petrol"), { fuel: { sites: [] } })).toBeNull();
  });

  test("answers carry refs so the screen can light what is being talked about", () => {
    expect(answer(matchIntent("what's the weather"), SNAP).refs).toContain("weather");
    expect(answer(matchIntent("who's home"), SNAP).refs).toContain("people");
  });

  test("NOT LOADED IS NOT EMPTY — every intent, not just the ones we remembered", () => {
    // Three separate bugs of this exact shape shipped in one day: the calendar
    // said "nothing on today", the shopping list said "empty", and the TTS
    // cache treated an unread entry as an unused one. Each was found by
    // accident. This makes the invariant mechanical instead of remembered.
    //
    // Given a COMPLETELY EMPTY snapshot — every upstream down, HA disconnected —
    // an answerer may only speak if its answer is true without any data at all.
    // Everything else must return null and let the turn fall through.
    const ALLOWED_WITHOUT_DATA = new Set([
      "time.now",          // the clock is always available
      "time.date",         // ditto
      "meta.vocabulary",   // points at the screen; needs nothing
      "meta.repeat"        // honestly reports having said nothing yet
    ]);

    const offenders = [];
    for (const id of ANSWERABLE) {
      const result = answer({ id, slots: {} }, {});
      if (result && !ALLOWED_WITHOUT_DATA.has(id)) {
        offenders.push(`${id} -> "${result.speech}"`);
      }
    }
    expect(
      offenders,
      `these answered from an empty snapshot, which means an upstream being DOWN reads as data being ABSENT:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });

  test("an upstream being down is never reported as 'nothing on'", () => {
    // The dangerous case: calendar undefined (never loaded) must NOT answer
    // "nothing on today" — that is a confident lie on exactly the day someone
    // is relying on it. Only a genuinely empty array earns that reply.
    for (const utterance of ["what's on today", "what's on tomorrow", "what's next", "am i free"]) {
      expect(answer(matchIntent(utterance), {}), `"${utterance}" invented an empty calendar`).toBeNull();
      expect(answer(matchIntent(utterance), { calendar: [] })).not.toBeNull();
    }
    expect(answer(matchIntent("what's on the shopping list"), {})).toBeNull();
    expect(answer(matchIntent("what's on the shopping list"), { todos: { shopping: [] } }).speech)
      .toBe("The shopping list is empty.");
  });

  test("missing data returns null rather than an empty or invented answer", () => {
    for (const utterance of ["what's the weather", "how did i sleep", "how's the traffic", "where's the cheapest petrol"]) {
      expect(answer(matchIntent(utterance), {}), `"${utterance}" invented an answer`).toBeNull();
    }
  });

  test("a broken answerer falls through instead of throwing at the room", () => {
    // calendar as a non-array is the kind of shape a half-loaded cache produces.
    expect(() => answer(matchIntent("what's on today"), { calendar: "not-an-array" })).not.toThrow();
  });

  test("the vocabulary answer points at the screen instead of reciting a menu", () => {
    const a = answer(matchIntent("what can i say"), SNAP);
    expect(a.showVocabulary).toBe(true);
    expect(a.speech.length).toBeLessThan(60);
  });
});

/* ── F7 · which day is the question about? ──────────────────────────────────
   The defect these exist for, reported on the wall 2026-08-15: "am I free next
   Tuesday afternoon?" answered "You've got 1 thing on today." The STT was
   perfect; `cal.free` carried no day slot, so every word after "free" was
   discarded and the reply was confident, fast, and about a different day.

   Two halves are tested, and the second matters more than it looks. The
   resolver is the feature. The DECLINES are the safety floor: the feed expands
   recurring events only inside a window (server/routes/calendar.js:20), so any
   day past it is one the house must refuse rather than guess about.
─────────────────────────────────────────────────────────────────────────── */
test.describe("the calendar's day slot", () => {
  // Saturday. Pinned, because every offset below is relative to a weekday.
  const SAT = new Date(2026, 7, 15, 10, 0, 0);

  /* Events built relative to the real clock, because the answerers bucket by
     toDateString() at answer time and cannot be handed a fake now. Only the
     DATE matters to onDay(), so these are stable at any hour of the day. */
  const at = (offset, hour, minute = 0, extra = {}) => {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    d.setHours(hour, minute, 0, 0);
    return { start: d.toISOString(), ...extra };
  };

  /* ⚠⚠ THIS SPEC RAN ON TWO DIFFERENT CLOCKS AND ONLY AGREED ON SATURDAYS.
     Fixed 2026-08-16, having failed the moment the date rolled over.

     The resolveDay() assertions below are pinned to SAT, which is right — label
     formatting and offsets must be deterministic. But the FIXTURE is built from
     the real clock, and the end-to-end say() calls resolve their day from the
     real clock too. Hard-coding the events at +3 and asking about "Tuesday"
     lined those up only on the Saturday this was written; from a Sunday, "next
     Tuesday" is two days away while the events sat three, so the lane correctly
     answered "You're free" about an empty day and the spec reported the very
     defect it exists to catch. A false alarm that looks exactly like the real
     one is worse than no test.

     So the WEEKDAY IS DERIVED FROM THE FIXTURE, not hard-coded against it.
     +3 is chosen because it can never be today — which matters, since "next
     Tuesday" said ON a Tuesday means a week away (asserted below), and that is
     the one case where the plain and "next" forms diverge. */
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const TARGET_OFFSET = 3;
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + TARGET_OFFSET);
  const DAY = WEEKDAYS[targetDate.getDay()];

  const CAL = [
    { title: "Meal: Steak with Peppercorn Sauce", ...at(0, 18) },
    { title: "Dentist", ...at(0, 9) },
    { title: "Bob's Birthday", allDay: true, ...at(TARGET_OFFSET, 10) },
    { title: "Physio", ...at(TARGET_OFFSET, 14, 30) }
  ];
  const say = (utterance) => answer(matchIntent(utterance), { calendar: CAL })?.speech ?? null;

  /* The label the resolver produces for that day, so the end-to-end sentences
     assert the COUNT and the SHAPE without restating the date formatting the
     pinned assertions below already cover exactly. */
  const labelFor = (utterance) => {
    const day = resolveDay(utterance);
    if (!day || typeof day.label !== "string") {
      throw new Error(`the resolver refused "${utterance}" — the fixture day is outside its horizon`);
    }
    return day.label;
  };

  test("THE REPORTED DEFECT: a question about Tuesday is no longer answered about today", () => {
    const day = resolveDay("am i free next tuesday afternoon", SAT);
    expect(day.offset).toBe(3);                       // Sat 15th -> Tue 18th
    expect(day.part.word).toBe("afternoon");
    expect(day.label).toBe("Tuesday afternoon, the 18th");

    // And end to end, the sentence the room actually hears — asked about the
    // day the fixture is actually on, whatever weekday today happens to be.
    const utterance = `am i free next ${DAY} afternoon`;
    const spoken = say(utterance);
    expect(spoken).not.toContain("today");
    expect(spoken).toBe(`You've got 2 things on ${labelFor(utterance)}.`);
  });

  test("the day is NAMED WITH ITS DATE, which is what makes 'next Tuesday' safe to read", () => {
    /* "Next Tuesday" is ambiguous in English and speakers genuinely disagree.
       The lane takes the nearest future occurrence and says the date back, so a
       mismatched reading is audible instead of silent. Remove the date from the
       label and the ambiguity goes back to being invisible. */
    expect(resolveDay("am i free next tuesday", SAT).label).toBe("Tuesday, the 18th");
    // Said ON that weekday, "next" cannot mean today — that is the one case it moves.
    expect(resolveDay("am i free saturday", SAT).offset).toBe(0);
    expect(resolveDay("am i free next saturday", SAT).offset).toBe(7);
    expect(resolveDay("am i free next saturday", SAT).label).toBe("Saturday, the 22nd");
    // Ordinals: the 11th-13th exception is not reachable from the 15th.
    expect(resolveDay("anything on wednesday", new Date(2026, 7, 8, 10, 0, 0)).label)
      .toBe("Wednesday, the 12th");
  });

  test("a weekday inside the next two days is named the way people name it", () => {
    // Asked on Saturday, "sunday" is tomorrow and should be said as tomorrow.
    expect(resolveDay("what's on sunday", SAT).label).toBe("tomorrow");
    expect(resolveDay("what's on monday", SAT).label).toBe("Monday, the 17th");
  });

  test("⚠ THE DECLINES — a day past the feed's window is refused, never guessed", () => {
    /* /api/calendar/all expands recurring events only inside getRecurrenceWindow().
       Past it the feed is silently INCOMPLETE — a standing weekly commitment is
       simply absent — so "you're free" would be the exact confident lie the day
       slot was built to stop. Measured on the live feed 2026-08-15: 383 events,
       8 future days carrying one, nothing at all between 27 Aug and 19 Nov. */
    const beyond = [
      "am i free this weekend",
      "am i free next week",
      "anything on the 20th",
      "am i free in september",
      "what's on next month",
      "anything on yesterday",
      "was i busy last tuesday",
      "am i free in 3 weeks"
    ];
    for (const utterance of beyond) {
      expect(resolveDay(utterance, SAT), `"${utterance}" was parsed instead of refused`).toBe(DAY_BEYOND);
      expect(matchIntent(utterance), `"${utterance}" reached the fast lane`).toBeNull();
    }
  });

  /* ⚠ "what's on next month" is in the list above and MUST STAY THERE. The
     refusal is the default build's behaviour and it is still correct there:
     v3CalendarAhead is off, so nothing recognises the sentence and it falls
     through exactly as it always has.

     What changed is that the refusal is now a FLAG STATE rather than a
     permanent property of the lane. The month became answerable in two halves:
     a subject that draws it, and CALENDAR_LOOKAHEAD_DAYS widening the server's
     recurrence window so the span behind it is actually populated. The gate is
     in matchIntent rather than in the subject registry precisely because of the
     sentence above it — the answerer would otherwise count a truncated feed and
     say "3 things coming up" with authority, which is the confident lie this
     whole block exists to prevent.

     This test pins the OTHER direction, so the two states cannot drift apart
     silently: with the flag on, the phrase must reach show.ahead and not be
     swallowed by cal.today's much greedier `what's on` pattern. */
  test("the month is refused by default and claimed by show.ahead when armed", () => {
    const prior = globalThis.window;
    try {
      globalThis.window = { CONFIG: { features: { v3CalendarAhead: true } } };
      expect(matchIntent("what's on next month")?.id).toBe("show.ahead");
      expect(matchIntent("what have i got on for the next month")?.id).toBe("show.ahead");
      // Unqualified calendar questions must be untouched by the new row.
      expect(matchIntent("what's on today")?.id).toBe("cal.today");
      expect(matchIntent("what's on tomorrow")?.id).toBe("cal.tomorrow");
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });

  test("the week is refused by default and claimed by show.forecast when armed", () => {
    // Off: "the weather" alone still belongs to weather.now, which is the
    // behaviour that made the wall say it only had today.
    expect(matchIntent("what's the weather for the next 7 days")?.id).toBe("weather.now");

    const prior = globalThis.window;
    try {
      globalThis.window = { CONFIG: { features: { v3ForecastWeek: true } } };
      expect(matchIntent("what's the weather for the next 7 days")?.id).toBe("show.forecast");
      expect(matchIntent("show me the forecast")?.id).toBe("show.forecast");
      // ⚠ The bare question is NOT a week question and must not be stolen.
      expect(matchIntent("what's the weather")?.id).toBe("weather.now");
      expect(matchIntent("what's the weather tomorrow")?.id).toBe("weather.tomorrow");
    } finally {
      if (prior === undefined) delete globalThis.window;
      else globalThis.window = prior;
    }
  });

  test("each calendar intent declines the days it cannot honour", () => {
    /* ⚠ `${DAY}`, NOT A HARD-CODED WEEKDAY — this test read "tuesday" and so
       passed six days in seven. On a Tuesday "on tuesday" resolves to TODAY,
       show.day's gate correctly allows it, and the spec reported a defect that
       was the calendar behaving exactly as designed. Found 2026-08-18, which
       was a Tuesday. The block above already derives DAY from the fixture for
       precisely this reason and says so; this test simply did not use it. */
    // cal.next has no day to take; show.day's subject draws today and only today.
    expect(matchIntent(`what's next ${DAY}`)).toBeNull();
    expect(matchIntent(`show me my day on ${DAY}`)).toBeNull();
    // cal.tomorrow is reached only by its own word, so any other day declines.
    expect(matchIntent("what's on tomorrow").id).toBe("cal.tomorrow");
    // The unslotted forms still work exactly as before.
    expect(matchIntent("what's next").id).toBe("cal.next");
    expect(matchIntent("show me my day").id).toBe("show.day");
  });

  test("parts of the day narrow the window, and the preposition follows English", () => {
    expect(say("am i free this morning")).toBe("You've got 1 thing this morning.");
    expect(say("am i free this arvo")).toBe("You're free — nothing this afternoon.");
    expect(say("am i free tomorrow night")).toBe("You're free — nothing tomorrow night.");
    // "nothing on this morning" is the kind of small wrong that is audible every time.
    expect(say("am i free this morning")).not.toContain("on this morning");
  });

  test("⚠ an all-day event belongs to EVERY part of its day", () => {
    /* It carries a start time and that time means nothing — the live feed has
       "Bob's Birthday" at 10:00 with allDay:true. Bucketing it by its hour drops
       it out of every question about an afternoon. */
    expect(say(`am i free next ${DAY} afternoon`)).toContain("2 things");
    expect(say(`what's on ${DAY}`)).toContain("Bob's Birthday");
  });

  test("a dinner plan does not make you busy, but it is still what's on", () => {
    // Today holds the Dentist plus a "Meal:" entry. Only one is a commitment.
    expect(say("am i free")).toBe("You've got 1 thing on today.");
    expect(say("what's on today")).toContain("Dentist");
    // ...and the "Meal: " routing prefix never reaches the room.
    expect(say("what's on today")).toContain("Steak with Peppercorn Sauce");
    expect(say("what's on today")).not.toContain("Meal:");
  });

  test("with no day named, every existing sentence is unchanged", () => {
    /* The flag-off equivalent: an utterance that names no day must reach the
       same words it reached before the slot existed. */
    expect(resolveDay("am i free", SAT)).toBeNull();
    expect(resolveDay("what's on today", SAT).label).toBe("today");
    expect(answer(matchIntent("am i free"), { calendar: [] }).speech)
      .toBe("You're free — nothing on today.");
    expect(answer(matchIntent("what's on today"), { calendar: [] }).speech)
      .toBe("Nothing on today.");
    expect(answer(matchIntent("what's on tomorrow"), { calendar: [] }).speech)
      .toBe("Nothing on tomorrow.");
    expect(answer(matchIntent("what's on today"), { calendar: [{ title: "Dentist", ...at(0, 9) }] }).speech)
      .toBe("Today: Dentist.");
  });

  test("a cold calendar cache still refuses to claim the day is empty", () => {
    // The absent-is-not-empty rule survives the day slot, on every day.
    for (const utterance of ["am i free", "am i free next tuesday afternoon", "what's on tuesday"]) {
      expect(answer(matchIntent(utterance), {}), `"${utterance}" invented a day`).toBeNull();
    }
  });
});

/* ── F8 · the weather family answers about the day it was asked about ────────
   Found while fixing F7 and deliberately left out of it, because the BOUND is
   different. Measured then: "what's the weather on tuesday" reached weather.now
   and said "It's 18 degrees and clear" — the same shape of harm as the calendar
   defect, confident and fast and about a different day.

   The calendar's limit was knowable in the parser (getRecurrenceWindow). The
   forecast's is not: it is however many days the last refresh returned — SEVEN
   from Open-Meteo on the live G11, TWO from the BOM-via-HA fallback (see
   bom-weather.spec.js), NONE when there are no coordinates. So these tests are
   mostly about the horizon, and every one of them asserts the DECLINE as
   carefully as the answer.
─────────────────────────────────────────────────────────────────────────── */
test.describe("the weather's day slot", () => {
  const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

  /* A weekday that is always exactly `n` days from now, whenever the suite runs.
     The end-to-end path resolves days against the real clock — matchIntent takes
     no `now` — so the utterance has to be built from it rather than pinned. */
  const weekdayIn = (n) => WEEKDAYS[(new Date().getDay() + n) % 7];

  /* The spoken form of that day, with its date — the same string the resolver
     builds, derived independently here so a test cannot pass by sharing a
     mistake with the code under test. */
  const dayName = (n) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    const day = d.getDate();
    const teen = day % 100;
    const suffix = teen >= 11 && teen <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] ?? "th";
    const name = WEEKDAYS[d.getDay()];
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}, the ${day}${suffix}`;
  };

  /* Shaped exactly like the live feed: seven days, days[0] today, bare dates. */
  const FEED = {
    forecast: {
      days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({
        date: isoDay(i),
        high_c: 20 + i,
        low_c: 8 + i,
        condition: { label: i === 3 ? "Cloudy" : "Light drizzle" },
        rain_chance_pct: [68, 29, 49, 72, 60, 12, 5][i]
      }))
    },
    weather: {
      now: { temp_c: 17.9, feels_like_c: 18.3, uv: 0.45, wind_kph: 6.4, rain_chance_pct: 10, condition: { label: "Clear" } },
      day: { high_c: 22.4, low_c: 9.1 }
    },
    nowcast: { startsInMin: 20 }
  };
  const say = (utterance, snap = FEED) => answer(matchIntent(utterance), snap)?.speech ?? null;

  test("THE REPORTED DEFECT: a question about Tuesday is no longer answered about now", () => {
    const day = weekdayIn(3);
    expect(matchIntent(`what's the weather on ${day}`).id).toBe("weather.now");
    const spoken = say(`what's the weather on ${day}`);
    // The measured wrong answer was the live reading — "It's 18 degrees and clear."
    expect(spoken).not.toContain("degrees");
    expect(spoken).toBe(`${dayName(3)}: 23 and 11, cloudy.`);
  });

  test("the day is NAMED BACK, so a mis-parse is audible rather than silent", () => {
    // The same rule the calendar's reply follows, and the reason reading "next
    // Tuesday" as the nearest Tuesday is safe to do at all.
    expect(say(`what's the weather on ${weekdayIn(4)}`)).toContain(dayName(4));
  });

  test("⚠⚠ THE HORIZON — a day past what the feed returned is refused, never guessed", () => {
    /* This is the bound F8 exists for. resolveDay will happily name a day seven
       out; a seven-day feed reaches six. The parser is not the limit — the data
       is, and only the answerer can see it. */
    const seventh = `next ${WEEKDAYS[new Date().getDay()]}`;                      // offset 7
    expect(resolveDay(`what's the weather ${seventh}`).offset).toBe(7);
    expect(matchIntent(`what's the weather ${seventh}`).id).toBe("weather.now");  // matched...
    expect(say(`what's the weather ${seventh}`)).toBeNull();                      // ...and declined

    // A SHORTER feed is refused sooner. The BOM-via-HA fallback returns two days.
    const bom = { ...FEED, forecast: { days: FEED.forecast.days.slice(0, 2) } };
    expect(say(`what's the weather on ${weekdayIn(3)}`, bom)).toBeNull();
    expect(say("what's the weather tomorrow", bom)).toBe("Tomorrow: 21 and 9, light drizzle.");

    // With no coordinates at all the fallback returns no days whatsoever.
    expect(say("what's the weather tomorrow", { ...FEED, forecast: { days: [] } })).toBeNull();
    expect(say("what's the weather tomorrow", {})).toBeNull();
  });

  test("⚠ days are found BY DATE, not by index — days[1] is not a promise", () => {
    /* Two upstream shapes that an index read gets confidently wrong, and note
       that BOTH still return a record at the index asked for — so this is the
       case a "did it answer at all?" assertion cannot see. It has to compare the
       NUMBERS. */

    // 1. A GAP. The +2 day is missing; days[2] now holds the +3 day's numbers.
    const gap = { ...FEED, forecast: { days: FEED.forecast.days.filter((_, i) => i !== 2) } };
    expect(gap.forecast.days[2].date).toBe(isoDay(3));      // the index really is misleading
    expect(say(`what's the weather on ${weekdayIn(2)}`, gap)).toBeNull();
    // ...while the days on the far side of the gap are still answered exactly.
    expect(say(`what's the weather on ${weekdayIn(3)}`, gap)).toBe(`${dayName(3)}: 23 and 11, cloudy.`);

    // 2. A SHIFT. An upstream that drops the current day late in the evening
    // moves every index by one, and days[1] becomes the day after tomorrow.
    const shifted = { ...FEED, forecast: { days: FEED.forecast.days.slice(1) } };
    expect(shifted.forecast.days[1].date).toBe(isoDay(2));
    expect(say("what's the weather tomorrow", shifted)).toBe("Tomorrow: 21 and 9, light drizzle.");
  });

  test("⛔ UV and WIND decline every day but today — the feed does not carry them", () => {
    /* A permanent refusal rather than a horizon one: the per-day record holds a
       high, a low, a condition and a rain chance, and nothing else. Answering
       from the CURRENT uv is the exact defect this change is about. */
    for (const utterance of [
      `do i need sunscreen on ${weekdayIn(2)}`,
      `will it be windy on ${weekdayIn(2)}`,
      `what's the uv on ${weekdayIn(4)}`,
      "is it windy tomorrow"
    ]) {
      expect(matchIntent(utterance), `"${utterance}" reached the lane with a day it cannot honour`).toBeNull();
    }
    // The answerers hold the same line from the other side, so neither of them
    // alone is the only thing between the room and a wrong reading.
    const day = { offset: 3, label: dayName(3), dayLabel: dayName(3) };
    expect(answer({ id: "weather.sunscreen", slots: { day } }, FEED)).toBeNull();
    expect(answer({ id: "weather.wind", slots: { day } }, FEED)).toBeNull();
    // Today still answers exactly as it did.
    expect(say("do i need sunscreen")).toBe("Not really, UV is only 0.");
    expect(say("is it windy")).toBe("It's fairly calm, 6 k p h.");
  });

  test("⚠ the NOWCAST never reaches a future day", () => {
    /* It is a radar extrapolation of the next ~90 minutes. "Rain in about 20
       minutes" is true about now and nonsense about Thursday — and the snapshot
       is carrying one the whole time. */
    const spoken = say(`will it rain on ${weekdayIn(3)}`);
    expect(spoken).not.toContain("minutes");
    expect(spoken).toBe(`Probably — 72 percent chance on ${dayName(3)}.`);
    // Today's answer still prefers it, because a time is actionable.
    expect(say("do i need an umbrella")).toBe("Yes — rain in about 20 minutes.");
  });

  test("the two sibling phrases that used to fall through now match and answer", () => {
    // Both were logged as "safe today because they match nothing" — safe only
    // while the lane had no way of being right about Saturday.
    expect(matchIntent(`will it rain on ${weekdayIn(2)}`).id).toBe("weather.umbrella");
    expect(matchIntent(`how hot will it be on ${weekdayIn(5)}`).id).toBe("weather.today");
    expect(say(`how hot will it be on ${weekdayIn(5)}`)).toBe(`${dayName(5)}: 25 and 13, light drizzle.`);
    // Unslotted they answer about today — and "how hot IS it" is still weather.now,
    // because a question about right now must not be given a daily high.
    expect(matchIntent("will it rain").id).toBe("weather.umbrella");
    expect(matchIntent("how hot will it be").id).toBe("weather.today");
    expect(matchIntent("how hot is it").id).toBe("weather.now");
    expect(say("how hot will it be")).toBe("Today's top is 22, low of 9.");
  });

  test("a jacket question about a future day is answered from the LOW, and says so", () => {
    // The forecast carries no apparent temperature, so the verdict names the
    // number and which part of the day it means.
    expect(say(`do i need a jacket on ${weekdayIn(1)}`)).toBe("Yes, first thing — down to 9 tomorrow.");
    expect(say(`will i need a jumper on ${weekdayIn(6)}`)).toBe(`Maybe early — down to 14 on ${dayName(6)}.`);
    // A day that is cold all day is not a "first thing" answer.
    const cold = {
      ...FEED,
      forecast: { days: FEED.forecast.days.map((d, i) => (i === 2 ? { ...d, high_c: 15, low_c: 11 } : d)) }
    };
    expect(say(`do i need a jacket on ${weekdayIn(2)}`, cold)).toBe(`Yes — 11 to 15 on ${dayName(2)}.`);
  });

  test("⚠ a part of the day is NOT echoed back by a source that only knows the day", () => {
    /* The calendar can honour "Tuesday afternoon" because its events carry a
       time. The forecast is daily, so repeating "afternoon" would claim a
       precision it does not have. It answers the day, and says the day. */
    const day = resolveDay(`what's the weather on ${weekdayIn(3)} morning`);
    expect(day.label).toContain("morning");
    expect(day.dayLabel).not.toContain("morning");
    expect(say(`what's the weather on ${weekdayIn(3)} morning`)).toBe(`${dayName(3)}: 23 and 11, cloudy.`);
  });

  test("a day the parser refuses outright never reaches the weather either", () => {
    // The same refusals as the calendar: the resolver is shared, and it stays
    // the WIDEST range any caller may ask about.
    for (const utterance of [
      "what's the weather next week",
      "what's the weather this weekend",
      "what's the weather in september",
      "what's the weather on the 20th",
      "what was the weather yesterday"
    ]) {
      expect(matchIntent(utterance), `"${utterance}" reached the fast lane`).toBeNull();
    }
  });

  test("with no day named, every existing weather sentence is unchanged", () => {
    /* The rollback. Nothing in the family may have moved for the utterances the
       house has been answering all along. */
    expect(say("what's the weather")).toBe("It's 18 degrees and clear.");
    expect(say("how's it outside")).toBe("It's 18 degrees and clear.");
    expect(say("what's the weather today")).toBe("It's 18 degrees and clear.");
    expect(say("what's today's top")).toBe("Today's top is 22, low of 9.");
    expect(say("what's the weather tomorrow")).toBe("Tomorrow: 21 and 9, light drizzle.");
    expect(say("do i need a jacket")).toBe("Maybe a light one, it feels like 18.");
    expect(say("do i need sunscreen")).toBe("Not really, UV is only 0.");
    expect(say("is it windy")).toBe("It's fairly calm, 6 k p h.");
    expect(say("do i need an umbrella")).toBe("Yes — rain in about 20 minutes.");
    expect(say("is it going to rain", { ...FEED, nowcast: null })).toBe("No, only 10 percent chance of rain.");
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE CACHE FILL — the defect underneath the answerer.

   `cache.commute` and `cache.fuel` were declared in voiceSnapshot's cache the
   day the module was written and `refreshVoiceCache()` never fetched either of
   them, so both were permanently null to every answerer. Nothing failed and
   nothing logged; the two lanes just always fell through to a 2-4 second round
   trip to an agent that does not own the question.

   ⚠ This is the assertion the answerer tests above CANNOT make. They pass a
   snapshot in by hand, so they are true of a house whose cache is filled — and
   for months no house's was.
   ═══════════════════════════════════════════════════════════════════════════ */
test.describe("refreshVoiceCache fills what it declares", () => {
  /* Workers are reused across spec files, so a stubbed global left behind would
     follow this file into the next pure-node spec in the same process. */
  const realFetch = globalThis.fetch;
  test.afterEach(() => { globalThis.fetch = realFetch; });

  const ROUTES = {
    "/api/commute/all": { legs: [{ id: "greg", label: "Greg", seconds: 683, trafficDelaySeconds: 0 }] },
    "/api/fuel": { sites: [{ price: 194.9, name: "EG Ampol Deagon" }] }
  };

  function stub(routes) {
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      const hit = Object.keys(routes).find((k) => String(url).includes(k));
      if (!hit) return { ok: false, status: 404, json: async () => null };
      return { ok: true, status: 200, json: async () => routes[hit] };
    };
    return asked;
  }

  test("⚠ it ASKS for the commute and the fuel at all — it never used to", async () => {
    const asked = stub(ROUTES);
    await refreshVoiceCache();
    expect(asked.some((u) => u.includes("/api/commute/all")), "never asked for the commute").toBe(true);
    expect(asked.some((u) => u.includes("/api/fuel")), "never asked for the fuel").toBe(true);
  });

  test("and the two lanes answer from it end to end", async () => {
    stub(ROUTES);
    await refreshVoiceCache();
    const snap = voiceSnapshot();
    expect(answer(matchIntent("how's the traffic"), snap).speech).toBe("About 11 minutes.");
    expect(answer(matchIntent("where's the cheapest petrol"), snap).speech)
      .toBe("194.9 cents at EG Ampol Deagon.");
  });

  test("⚠ a failed fetch leaves the last good value standing rather than blanking it", async () => {
    stub(ROUTES);
    await refreshVoiceCache();
    stub({});                                   // every upstream 404s
    await refreshVoiceCache();
    expect(answer(matchIntent("how's the traffic"), voiceSnapshot()).speech).toBe("About 11 minutes.");
  });
});
