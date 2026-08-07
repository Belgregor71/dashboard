import { test, expect } from "@playwright/test";
import { matchIntent, matchCamera, normalise, INTENT_IDS } from "../src/js/services/localIntents.js";
import { answer, capSentences, ANSWERABLE } from "../src/js/services/localAnswers.js";
import { pickLastCameraEvent } from "../src/js/services/voiceSnapshot.js";
import { vocabularyFor, railPhrase, ALL_CANDIDATES } from "../src/js/services/vocabulary.js";

/* The fast lane's contract. These are pure-node tests — no browser, no server,
   no DOM — because the whole point of the lane is that it answers without any
   of those. If this file needs a page, the lane has regressed.

   The important assertions here are the PRECEDENCE ones. The matcher is an
   ordered list and first match wins, so a general pattern sitting above a
   specific one silently eats it and everything still "passes" if you only
   assert that something matched. Every test below names the intent it expects. */

const SNAP = {
  sun: { sunrise: "2026-08-07T06:22:00+10:00", sunset: "2026-08-07T17:20:00+10:00" },
  weather: {
    now: { temp_c: 17.9, feels_like_c: 18.3, uv: 0.45, wind_kph: 6.4, rain_chance_pct: 10, condition: { label: "Clear" } },
    day: { high_c: 22.4, low_c: 9.1 }
  },
  forecast: { days: [{ high_c: 22, low_c: 9 }, { high_c: 24, low_c: 11, condition: { label: "Partly cloudy" } }] },
  nowcast: { startsInMin: 20 },
  calendar: [
    { title: "Dentist", start: new Date(Date.now() + 3 * 3600e3).toISOString() },
    { title: "Soccer", start: new Date(Date.now() + 5 * 3600e3).toISOString() }
  ],
  bins: { configured: true, due: true, label: "Tonight", bins: ["yellow", "green"] },
  people: [{ name: "Greg", home: true }, { name: "Brett", home: false }],
  media: [{ title: "Nightswimming", artist: "R.E.M." }],
  sleep: { score: 88, label: "solid" },
  commute: { greg: { minutes: 24, delayMin: 6 } },
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
    const lost = ALL_CANDIDATES.filter((u) => !matchIntent(u) && u !== "brief me");
    expect(lost, `candidates the matcher cannot resolve: ${lost.join(", ")}`).toEqual([]);
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
