# House Mind — target architecture, the case for and against it, and the slices

> **Verdict: YES-BUT.** Adopt the owner's diagram as the **direction**, and build it in
> small flag-gated slices. **Do not** do it as a rewrite. A rewrite that pushes every input
> through "the mind" breaks the property the wall depends on most: reflexes such as the
> doorbell, timers and barge-in stay local and fast.

**Written 2026-09-22.** Derived from a read-only gap analysis (an Explore subagent reading
the code). The claims that carry the argument were **re-verified by reading the source
before this was written**. Those are marked **[V]**. Anything taken from the subagent
report and not re-read is marked **[I]**.

**Status (2026-09-23):** S0 is live with both flags on. S1 is live (test-only). S2 is built
with its three flags off. S3 and S4 are owed. Each slice ships on its own; §5 has the
detail.

---

## 1. The diagram, as drawn

```
                       ┌──────────────────────┐
                       │     HOUSE MIND       │
                       │ memory · personality │
                       │ inference · attention│
                       │ prediction           │
                       └──────────┬───────────┘
                           HOUSE EVENT BUS
              ┌───────────────────┼───────────────────┐
          OBSERVATION          CONTEXT             HISTORY
       HA / cameras          presence             memories
       weather · calendar    time · location      patterns · moments
       media                 conversation         photos
              └───────────────────┼───────────────────┘
                         CAPABILITY LAYER
                ┌─────────────────┼────────────────┐
              VISUAL             VOICE             ACTION
           V3 GPU substrate   conversation       HA/services
```

## 2. The diagram, revised

The revision makes three changes. Each one comes from §4's costs:

```
   OBSERVATION ──► OBSERVATION STORE (server, sticky last-value, one fetch per source)
   CONTEXT     ──►        │  pushed over ONE SSE
                          ▼
             ┌──── HOUSE MIND (separate modules, one shared store) ────┐
             │ attention · memory · personality · routines · predict   │
             └────────────────────────┬────────────────────────────────┘
                                      ▼
   REFLEX LANE ─────────────►  CAPABILITY ARBITER  (owns "who has the screen
   doorbell · timers ·          │         │         and the mouth")
   commands · barge-in          ▼         ▼         ▼
   (bypasses the mind,        VISUAL    VOICE     ACTION
    NOTIFIES it after)          └─────────┴─────────┘
                                          │  what was shown / said / ignored
                                          ▼
                                HISTORY (server, bounded retention) ──► back into the mind
```

1. **A reflex lane.** Some inputs must reach the output without waiting for a ranker tick.
2. **An observation store in place of a pure bus.** The consumers here want the *current
   value*, not a stream of events. A bus cannot give a late subscriber the current value;
   a store can.
3. **A feedback loop from capability to history.** The mind learns from what it showed and
   whether anyone looked. `routineRuntime` already learns dwell-vs-ignore, so this loop is
   partly built. It needs to appear in the picture.
   **Conversation is a loop, not a lane.** It is context coming in and voice going out.

---

## 3. Where the code is today

### Buses: four mechanisms, not one
- **`eventBus`** (`src/js/core/eventBus.js`) **[V]**
  - Bare `on`/`off`/`emit`.
  - **Synchronous** dispatch over a snapshot of the listeners. Each handler is isolated
    with try/catch, and the error is re-thrown on `setTimeout` so `pageerror` still sees
    it (`:57-73`).
  - No replay, no sticky state, no typing. A late subscriber misses the event.
- **`contextStore`** (`src/js/core/contextStore.js`) **[I]**
  - A second, stateful pub/sub.
  - Written by intentEngine and context-feed. Read by the attention, memory, personality
    and routine runtimes, and by atmosphere-fx.
- **Server:**
  - **`voiceBus`** (`server/routes/voice.js`) → `/api/voice/stream` SSE.
  - **`HaWsManager`** (`server/ha/haWs.js`) → `/api/ha/stream` SSE.
  - **Only the HA stream is bridged into `eventBus`.** Voice has two EventSources of its
    own. **[I]**
- **Plus:** about 5 private V3 observer lists (`onPresence`, `onDepth`, `onPanelDark`,
  `onStrike`, `setSpeakingObserver`), direct imports standing in for events (`announce()`,
  `collectMemory`, `collectDelight`, `speak`), and `window.__forceCandidate` used as a
  real call path. **[I]**

### Observations are fetched, not published
Only HA state and sound-presence arrive as events. Weather and calendar are fetched
separately by about six consumers each: houseSnapshot, voiceSnapshot, intentEngine,
personalityRuntime, context-feed and health. **[I]**
Two consumers can therefore hold different readings of the same fact at the same moment.

### The mind is split across two machines
- **In the browser:** the attention, memory, personality, intent and routine engines. Their
  state lives in localStorage plus server JSON.
- **On the server:** character, conversation memory, unresolved, lately and occupancy,
  behind `/api/voice/converse` and `/api/ai/brief`. **[I]**
- Neither side can see what the other knows. The voice cannot say what the wall is showing.

### Prediction amounts to three rules and one unused lever
- `predictiveRules.js` has `rainIncoming`, `binNight` and `onThisDay`. **[I]**
- The ranking lever exists but is unused:
  - `rankQueue()` accepts `weights` (`attentionRank.js:32`). **[V]**
  - So does `getSelection()` (`attentionEngine.js:169`). **[V]**
  - `routineRuntime.attentionWeights()` produces them (`:171`). **[V]**
  - **V3's tick calls `getSelection({ sources, now, mode })` with no weights**
    (`src/v3/core/attention.js:281`). **[V]**
- **The comment at `src/v3/main.js:647-656` says that arming routines switches the weights
  on. On V3 it does not. [V]** Learned distributions reach intent (`learnedDeparture`) and
  voice (`learnedTimes`), but not ranking.

### Dead wiring on V3
| Event | State | |
|---|---|---|
| `arrival:home` | subscribed at `personalityRuntime.js:278`; **only emitter is the incumbent's `arrivalGreeting.js:304`**, which is not in the V3 closure | **[V]** the home-after-away delight **cannot fire on the wall** |
| `intent:changed` | emitted at `intentEngine.js:78`; **no subscriber anywhere** | **[V]** |
| `delight:fired` | emitted at `personalityRuntime.js:197`; only listener is `arrivalGreeting.js:242` (incumbent) | **[V]** |
| `ha:connected` / `ha:disconnected` | published; no V3 subscriber | **[I]** |

### There is no capability layer
alerts, arrival, briefing-window, dinner and commands each call `setDepth` / `showSubject`
/ `speak` directly. **[I]** Attention is one author of depth among several, not the
arbiter. On V3 there is no browser caller of `callHAService`. Real actions happen
server-side, through the voice tools, HA Assist and recoveryService. **[I]**

---

## 4. The challenge

### What the change would give you
1. **One truth per observation.** Each source is fetched once, pushed, and kept sticky.
   That removes the class of bug where the glance and the field disagree about the
   same weather.
2. **Arbitration of the wall and the voice.** This repo's collisions all have the same
   shape: `.archive__sky` over `#heard`, the fault pill over the media band, a scored
   `announce()` displacing a spec's own fixture. Several modules write depth and speech,
   and none of them owns it. An arbiter retires the class, not one instance.
3. **Grounding in one place.** The invented "8:41" and the forecast invented 24/24 times
   were both an instruction with no data line behind it. A single observation store is
   the one place to ask "is there a data line for this claim?", for both the briefing
   prompt and `/converse`.
4. **Voice and glance share a model.** "What's that on the screen?" becomes answerable.
5. **Prediction gets real inputs.** The routine distributions already exist, and are
   dropped at `attention.js:281`.
6. **Dead wiring becomes testable.** A declared event registry lets a spec go red on
   "published, never heard" and "heard, never published", the same way
   `flag-surface.spec.js` derives `INERT-ON-V3`. Four such events exist today, and
   nothing noticed any of them.
7. **History becomes a log.** "Why did the wall show X at 07:12?" gets an answer.

### What it would cost you, and where the diagram is wrong
1. **The diagram has no reflex lane.** The doorbell, timers, barge-in and
   `dashboard_command` go from input straight to output today, **and they should**.
   Putting the doorbell behind a 30 s ranker tick is a regression. A strict layering breaks
   the most time-critical features first.
2. **Pub/sub hides causality, and silent failure is this repo's commonest defect.** A
   direct `speak()` call can be grepped. An event with no listener fails silently, and four
   have. More bus without a registry and a spec means more dead levers, of the
   INERT-ON-V3 kind.
3. **A sticky, logging bus in the browser is a new leak surface** on a page that runs for
   weeks. Leaks are the main failure mode here: 709 lottie wrappers, 230k detached nodes.
   **History lives on the server with bounded retention. The browser holds last values
   only.**
4. **Async dispatch brings ordering nondeterminism.** The top flake causes here are hooks
   registered after an async load, and time-of-day dependence. **Keep dispatch
   synchronous.** The current `emit` is simple and deterministic.
5. **It is hard to flag cleanly.** A migration is byte-identical with the flag off only if
   both paths coexist, and that briefly makes the duplication worse. It also touches shared
   modules (`eventBus`, `contextStore`, `attentionEngine`) that the incumbent rollback
   surface (`V3_DEFAULT=0`) depends on. **Every slice must keep the incumbent green.**
6. **Where the mind lives is the expensive decision.**
   - **On the server:** the browser becomes a renderer, every glance waits on a push, a
     service restart blanks the mind, and more logic moves out of Playwright's reach.
   - **In the browser:** the conversational mind, which needs Claude and the vault, cannot
     come along.
   - **Defer the merge.** Share the observation store, and let each mind stay where its
     latency lives.
7. **"Mind" as one box becomes a god object.** Memory (daily), attention (30 s),
   personality (occasions) and routines (weeks) run at different cadences. Keep them as
   separate modules around one shared store.

---

## 5. The slices, cheapest and most valuable first

Each slice ships on its own, default-off, with its own rollback.

| Slice | What | Flag / rollback | It worked when | Retires |
|---|---|---|---|---|
| **S0 — dead wiring** | Emit `arrival:home` from `v3/core/arrival.js`. Pass `weights: attentionWeights()` at `attention.js:281`. Delete `intent:changed` or give it a consumer. | The weights change **alters ranking**, so it gets its own flag and `/flag-flip`. The arrival emit goes behind a flag. | `window.__routines().weights` is non-empty **and** the ranked order tilts on the wall. A home-after-away delight fires after a real return. | 3 dead events. The false comment at `main.js:647` |
| **S1 — event registry** ✅ built 2026-09-23 | One declared table: every event, its publisher and its V3 consumers. A spec goes red on orphans, derived like `flag-surface.spec.js`. | None; it is test-only. | Inject an orphan event and the spec goes red. Remove it and the spec is green. | Silent dead events as a class |
| **S2 — observation store** ✅ built 2026-09-23, flags off | Server keeps a sticky last value per source (weather, calendar, commute, bins, media) and pushes it over one SSE, `/api/house/stream`. Consumers move over one at a time. | One flag per consumer. Off = its own fetch, as today. | Fetches of `/api/weather/now` and `/api/calendar/all` per 5 min drop, measured in the server log. Glance and field agree. `/kiosk-metrics` shows no heap growth. | About 6 duplicate fetchers per source |
| **S3 — capability arbiter** ✅ built 2026-09-24, flag off | One owner of depth and speech. A declared **reflex lane** (doorbell, timers, commands, barge-in) goes straight through, then notifies. | Flag. Off = direct calls, as today. | Two simultaneous authors resolve by policy, not by call order. Doorbell latency is unchanged, measured. | The collision class in §4 pro 2 |
| **S4 — prediction** ✅ first rule built 2026-09-24, flag off | Rules fed by routine distributions and the store, ranking through S0's weights. | Flag. | A predicted card earns the glance with a data line behind it. | Three hand rules as the whole of "prediction" |
| *Deferred* | Merge the client and server minds. | — | Only if S2 and S3 show the split still hurts. | — |

### S1 as built (2026-09-23)

- **The table** is `tests/fixtures/event-registry.js`: 24 events, each with its publishing
  and consuming files. **The spec** is `tests/event-registry.spec.js` (8 tests). It derives
  the same facts from source, using the comment stripper and closure walk that
  `flag-surface.spec.js` now shares from `tests/fixtures/source-scan.js`.
- **It goes red on:**
  - an undeclared event or a stale row
  - a publisher or consumer list that drifted from the source
  - an event published and never heard, or heard and never published, within either
    surface's import closure
  - a declared orphan whose cause is gone
  - a computed event name, or a bus wrapper it does not know about
- **Proven by injection, all RED for the named reason, each restore diff clean:**
  - a V3 emit of an unheard event
  - S0's `arrival:home` emit removed from `v3/core/arrival.js`
  - a computed name in `client.js`
  - a V3 listener that ends a declared orphan
- **Five orphans on V3, declared with reasons, all published-and-unheard:**
  - `ha:connected` and `ha:disconnected`: the shared client announces the stream either
    way, and no V3 module subscribes.
  - `command:executed` and `command:unknown`: V3 records these in `commands.js`'s `last`
    instead.
  - `delight:fired`: its only listener arms the incumbent's arrival card. V3 gets the
    delight by polling `collectDelight()`.
- **On the incumbent:** no orphans.
- **Out of scope:** the `document` CustomEvent channel (`ha:state-updated` is re-dispatched
  there). It is a second bus, and it has no registry.

### S2 as built (2026-09-23, `c040dfc`, all three flags OFF)

- **The server half** is `server/services/houseStore.js` + `server/routes/houseStream.js`.
  - Seven sources, 5-minute cadence: weather, forecast, nowcast, calendar, commute, bins,
    Plex. That covers every key V3's two pollers fetched, except fuel and chores.
  - **It reads the house's own routes over loopback** instead of refactoring them. The
    payload is byte-identical to what the clients parsed, and route-level behaviour
    (commute's 4-minute bound, health reporting) is kept. Loopback is exempt from the
    flood ceiling.
  - **It is lazy.** It polls only while a page subscribes, so the flag-off server makes no
    request. A failed read keeps the last good value and pushes nothing.
  - `/api/house/stream` sends the held snapshot first, then one `house_obs` per good read.
    `/api/house/store` reports per-source read and failure counts, never values. This is
    the number that proves "once, not six times" on the box.
- **The page half** is `src/js/services/houseStream.js`. It opens one EventSource for the
  page's life and re-publishes each read as `house:observation` (a row in the S1 table).
  V3 opens it only when one of the three flags is on.
- **Three consumers, one flag each, all default OFF:**

  | Flag | Consumer | Keys |
  |---|---|---|
  | `v3HouseStoreGlance` | `houseSnapshot` (the attention engine's HTTP half) | weather, calendar, commute, Plex |
  | `v3HouseStoreVoice` | `voiceSnapshot` (fast lane + digest) | weather, forecast, nowcast, calendar, bins, commute |
  | `v3HouseStoreField` | V3's `loadWeather` (substrate, Living Window, sky line) | weather |

- **The fallback is per key, and it is the safety net.** A consumer skips its own fetch
  of a key only while the store delivered that key within 11 minutes. A dead stream, a
  stalled source or the incumbent (which never connects) is "not fresh", so the consumer
  fetches exactly as before. A fetch that resolves after the store delivered is dropped,
  so a boot fetch cannot overwrite the shared reading.
- **The spec** is `tests/house-store.spec.js` (9 tests). Each asserts the READING the
  consumer holds: the store says "Fixture Drizzle", the direct route says "Fixture Sun".
  - It covers the store against a fixture server, both routes' contracts, both flag
    states, the stream being down, and each flag alone.
  - **Inject-defect: 6/6 RED for the named reason.** The six defects:
    - the store not lazy
    - a failed read overwriting the last good value
    - a refresh that ignores the store
    - voice gated on the glance's flag
    - the stream opened with every flag off
    - pushes applied with the flag off
  - ⚠ **Not covered:** the in-flight drop (a boot fetch resolving after the snapshot). The
    stubbed routes answer too fast to order the race deterministically.
- ⚠ **At flip time:** a spec that stubs `/api/weather/now` with `page.route` cannot stub
  the SERVER's loopback read. `bootV3` specs are safe, because the stream gets a 503 and
  the consumers fall back to their fixtures. A spec that serves the real stream would see
  the test server's answer.
- ⛔ **Loopback is load-bearing, not only convenient.** The health watchdog marks the
  weather (45 minutes) and calendar (2 hours) feeds healthy **only when their routes are
  hit** (`src/v3/core/health.js:11-18`). The store reads through those routes, so the
  watchdog stays fed even with every consumer moved over. If the store is ever changed to
  call the route internals, it starves the watchdog into a false alarm.
- **`v3HouseStoreField` flipped ON 2026-09-23 (`80761a9`).**
  - The rollback was proven at boot on the wall: `config.js` was served with the flag false
    through CDP Fetch interception. The stream never started and the store dropped to 0
    subscribers with polling stopped.
  - Counted over 11 live minutes with CDP `Network.requestWillBeSent`: the field's
    10-minute poll made no request. `/api/weather/now` fell from 6 to 5 per 10 minutes.
  - The same count found **three V3 fetchers the first map missed**. They are the next
    consumers for this slice:
    - `briefingData.js`, which is in V3's closure: weather now, forecast, calendar and
      bins, every 10 minutes.
    - the calendar polls in `intentEngine.js:44` and `personalityRuntime.js:136`.
  - ⚠ An open EventSource never gets a resource-timing entry. Prove the stream with
    `houseStream.started`/`readyState`, never with a resource count.
- **Open for the live proof:**
  - `/api/house/store` should show one read per source per 5 minutes.
  - The kiosk's resource timing should show `/api/weather/now` and `/api/calendar/all`
    dropping from about 2–3 per 5 minutes to 0 while the store stays fresh.
  - `/kiosk-metrics` should show no heap growth.

### S3 as built (2026-09-24, `9031694`; flag `v3Arbiter` FLIPPED ON `cfa8af6` + `a067b3f`)

- **Flipped on 2026-09-24 by the owner.**
  - The first flip push was refused by the contrast sweep. The sweep forces the briefing
    right after a voice subject, and the arbiter refused the briefing's *scheduled*
    author.
  - A forced briefing is now the operator, and unauthored.
  - The rollback was proven at boot on the wall: `config.js` was served with the flag
    false, and the arbiter read `on:false`, then `on:true` once restored. There were 0
    exceptions.

- **The policy is one file**, `src/js/core/arbiter.js`. It sits in `src/js` because the
  speech chokepoint (`core/tts.js`) is shared runtime. The two chokepoints only ask.
- **Speech, by priority:** voice 50 · doorbell 40 · timer 30 · briefing 20 · arrival 10.
  - A new utterance pre-empts when its priority is equal or higher. A lower one is
    **dropped** and resolves when the air is free, so its caller's `setPhase("idle")`
    cannot drop the rim under the higher voice.
  - A claim holds from the request, so a doorbell line still being synthesised is
    already the doorbell's.
  - Barge-in (`silence()`) stays the unconditional reflex.
  - A timer ring that gets dropped comes back: the ring repeats every 30 s.
- **Stage, by lane:**
  - Reflex authors always take the stage: doorbell, voice, command.
  - Scheduled authors take only a free stage, or one held by a lower scheduled author:
    briefing 20, dinner 10.
  - The briefing asks **before** marking itself fired, so a refused briefing keeps its
    window.
- **Three defects this retires**, each found by reading the code and each reproduced
  by the spec with the flag OFF:
  1. A barge-in during Kokoro's synthesis stopped nothing, because there was no audio
     yet to pause. The reply played over the person who had cut in.
  2. Two speakers in flight both played. `silence()` ran only before each fetch.
  3. A subject resolving after a newer one had started still mounted, and the older
     one's `teardown` never ran. A recipe that landed after the door rang replaced the
     camera and left its MJPEG open.
- **Unauthored calls are never arbitrated.** The incumbent names no authors, so it is
  unchanged even with the flag on.
- **The spec** is `tests/house-arbiter.spec.js` (15 tests). Every race runs in both
  orders and both flag states.
  - Doorbell → TTS request median: **off 1.1 ms · on 1.2 ms**.
  - Inject-defect: 7/7 RED for the named reason, including the flag being ignored,
    which turns all four OFF tests red.
- **Not in scope, still open:**
  - The presence rim has no owner. A superseded speaker's `.then` can set `idle` under
    the new one.
  - The timer chime plays on Web Audio, outside the TTS channel, so a barge-in does not
    stop it.
  - The flip is the owner's call, because the priority table decides who wins in the
    room.

### S4 as built (2026-09-24, `c11eda9`, flag `v3PredictDeparture` OFF)

- **The owner's rule, decided 2026-09-24: learned timing, live words.**
  - A learned routine may decide WHEN a card appears. Its words cite live facts only:
    never the learned clock time, "usually" or "leave by".
  - `routineRuntime.js`'s pull-only comment was stricter than its own source,
    `phase-8-learn.md`. It is now narrowed to that source: the phrasing is banned, the
    timing is not.
- **The first rule is `departureCandidate`**, in `candidateSources.js`, as its own source
  `departure`.
  - The learned weekday or weekend departure, above its confidence bar, opens a window
    from 45 min before to 5 min after.
  - While someone is present, the card shows each driver's **live** drive time. It
    scores 74, which earns the glance.
  - Its data line (`sub`) names live rain from the nowcast (≥ 50%) or a live traffic
    delay (≥ 2 min).
  - No live drive time, no card.
  - `interrupt` applies in the last 30 min. At that moment the intent engine reads the
    house as "rushed", and the ranker then admits interrupts only.
  - While the card shows, the plain commute line stands down.
- **The spec** is `tests/house-predict.spec.js` (11 tests).
  - The central assertion: the words are identical at every minute of the window and
    contain no clock time or habit words.
  - On the V3 glance, with a seeded 8:00 departure:
    - 7:40 with the flag on → `attention:departure`
    - 6:30 → no card
    - 7:40 with the flag off → no card
  - Inject-defect: 8/8 RED.
- **Not yet, and why:**
  - Departure is household-wide. The legs are per person, but the routine is not.
  - There are no per-weekday buckets; only weekday and weekend.
  - There is no bedtime routine, so there is no bins-before-bed rule.
  - The async predictive lane (`predictiveRules.js`) still reads `briefingData`'s own
    fetches rather than the S2 store.
  - The insight rules emit no `source`, so learned weights cannot reach them.
  - Each of these is a separate rule or slice, not a gap in this one.

---

## 6. Open decisions for the owner

1. **Is S0's weights fix wanted as behaviour?** It changes ranking order, slowly. It needs
   four appearances of a source, and each nudge is clamped to −15…+10. The alternative is
   to correct the comment and leave ranking alone.
2. **Where does the mind live?** Recommended: defer. Share the store, not the mind.
3. **Is S3 wanted at all?** It is the biggest architectural change on the list, and the
   collisions it retires have been fixed one by one so far.
