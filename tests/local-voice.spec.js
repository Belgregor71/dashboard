import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
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
  menu: "Chicken Fajitas",
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
