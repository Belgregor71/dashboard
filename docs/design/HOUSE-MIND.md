# House Mind — target architecture, the case for and against it, and the slices

> **Verdict: YES-BUT.** Adopt the owner's diagram as the **direction**, and build it in
> small flag-gated slices. **Do not** do it as a rewrite. A rewrite that pushes every input
> through "the mind" breaks the property the wall depends on most: reflexes such as the
> doorbell, timers and barge-in stay local and fast.

**Written 2026-09-22.** Derived from a read-only gap analysis (an Explore subagent reading
the code). The claims that carry the argument were **re-verified by reading the source
before this was written**. Those are marked **[V]**. Anything taken from the subagent
report and not re-read is marked **[I]**.

**Status (2026-09-25):** S0 is live with both flags on. S1 is live (test-only). **S2 is
complete: all six consumers read the store, every flag is on, and each rollback was proven
on the wall.** The wall's 5-minute poll now fetches none of the store's keys; fuel and
news are all that remain. S3 (arbiter) and S4 (departure card) are live with their flags
on. Each slice ships on its own; §5 has the detail.

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
| **S2 — observation store** ✅ complete 2026-09-25, all six consumer flags ON | Server keeps a sticky last value per source (weather, calendar, commute, bins, media) and pushes it over one SSE, `/api/house/stream`. Consumers move over one at a time. | One flag per consumer. Off = its own fetch, as today. | Fetches of `/api/weather/now` and `/api/calendar/all` per 5 min drop, measured in the server log. Glance and field agree. `/kiosk-metrics` shows no heap growth. | About 6 duplicate fetchers per source |
| **S3 — capability arbiter** ✅ built 2026-09-24, flag off | One owner of depth and speech. A declared **reflex lane** (doorbell, timers, commands, barge-in) goes straight through, then notifies. | Flag. Off = direct calls, as today. | Two simultaneous authors resolve by policy, not by call order. Doorbell latency is unchanged, measured. | The collision class in §4 pro 2 |
| **S4 — prediction** ✅ first rule built 2026-09-24, flag off | Rules fed by routine distributions and the store, ranking through S0's weights. | Flag. | A predicted card earns the glance with a data line behind it. | Three hand rules as the whole of "prediction" |
| **S5 — one decision for the room** ⏳ proposed 2026-09-25, nothing built | A candidate must carry its evidence (a store key or entity, plus its age). A spoken author speaks only when its candidate won the ranking. The arbiter picks the surface, not the source. | S5a: test-only first, then a flag for the runtime gate. S5b: one flag per migrated author. | Every candidate names its evidence, and a spec goes red on one that does not. A lost arrival stays silent, and a won one speaks as it does today. | "A module decides to speak, and the arbiter can only veto it" |
| **S6 — the presentation log** ⏳ proposed 2026-09-25 (amended the same day), nothing built | Rows about the WALL (what was shown, where, how long, on what evidence), and COUNTERS about the people (present, cut off, asked about it after), never joined. The owner reads a weekly digest. Nothing feeds back into ranking or wording. | A flag for the page's writes. Off = nothing written. | "Why was X on the wall at 07:12?" is answered from the log. No row carries a person. The digest's counts match what the wall did, spot-checked. | The wall having no history of itself |
| **S7 — today, answered** ⏳ proposed 2026-09-25, nothing built | A server-side fold of today's timed WORLD events (weather changes, rain crossings), handed to `/converse` next to House Lately. Answered, never announced; never about people. | Its own flag. Off = nothing folded. | A forced day yields exactly its entries. A live `/converse` answer cites only times in the fold. | "What's the day been like?" having no times to answer with |
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

### S2 second half: the three missed consumers (2026-09-24/25)

Built in `baa3e13` + `bbda34b` and deployed with all three flags off (inert live). Each
was then flipped on its own, with a live rollback proof.

| Flag | Consumer | Keys from the store | Still fetched |
|---|---|---|---|
| `v3HouseStoreBriefing` | `briefingData.gatherBriefingContext` (briefing, insight and attention context, S4's predictive lane) | weather, forecast, nowcast, calendar, bins | fuel, news, chores, the per-leg `?leg=` commute, leave-by drive |
| `v3HouseStoreIntent` | `intentEngine` 5-min calendar read | calendar | — |
| `v3HouseStorePersonality` | `personalityRuntime` 6-hourly birthday read | calendar | — |

- **Same four rules as the first three:** apply the push, skip the fetch while fresh,
  drop a late fetch, last good value wins. briefingData is PULLED, not polled, so it holds
  the last push per key (bounded, one per key). A push drops its 5-minute context cache.
- **Intent and personality read at boot BEFORE the stream opens,** so only their
  interval refresh can show the skip. `__intentRefreshCalendar()` and
  `__personalityRefreshCalendar()` run it now. `__v3HouseCalendar()` reports where each
  consumer's last calendar reading came from. That is personality's only live witness,
  because at a 6-hour cadence a request count proves nothing.
- **Spec:** `tests/house-store.spec.js` +10 tests (19 in total). The calendar fixture
  names the path: "Storey's birthday" and 2 later events from the store, "Routey's
  birthday" and 1 from the route. **Inject-defect 12/13 RED**, each on the test named
  for it.
  - The first pass found 3 GREEN: the interval skips and the briefing's drop-late were
    unreached. Tests were added for both.
  - The one GREEN left is the briefing's `readHouse` gate alone. The push-handler gate
    covers it, and removing both is RED.
- ⚠ **A flag name in a constant or an array is invisible to `flag-surface.spec.js`.** The
  first build replaced main.js's literal `flag("v3HouseStoreGlance") || …` with a list.
  Glance and Voice then read as INERT-ON-V3. Use literal `flag("x")` / `features?.x`.
- **`v3HouseStoreBriefing` flipped ON 2026-09-25 (`16ab9f3`), rollback proven on the
  wall.** CDP counts over 11 minutes, starting 30 s after each boot:

  | Boot | forecast | bins | nowcast | weather/now | calendar | reads from |
  |---|---|---|---|---|---|---|
  | ON | 0 | 0 | 0 | 0 | 2 | store |
  | forced OFF (rollback) | 1 | 1 | 1 | 1 | 3 | fetch |
  | restored ON | 0 | 0 | 0 | 0 | 2 | store |

  Fuel and news kept fetching in every boot (the positive control), with 0 exceptions.
  A preview with the flag forced ON through CDP before the deploy gave the same numbers.
- **`v3HouseStoreIntent` flipped ON 2026-09-25 (`5708410`), rollback proven on the wall.**
  `/api/calendar/all` per 11 minutes: ON 0, forced OFF 2 (its 5-minute poll), restored ON
  0. It read 1 event later today either way, with 0 exceptions.
- **`v3HouseStorePersonality` flipped ON 2026-09-25 (`7a20d42`), rollback proven on the
  wall** by `from` rather than a count: `store` → forced OFF `fetch` → restored `store`,
  with 0 exceptions. Intent and briefing stayed on `store` through personality's rollback,
  which shows on the real wall that each flag is its own lever.
- **S2 done.** All six consumer flags are ON. The one remaining observation fetch in the
  wall's poll is fuel, which the store does not hold. News is fetched only by the briefing.

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
  - ~~The async predictive lane (`predictiveRules.js`) still reads `briefingData`'s own
    fetches rather than the S2 store.~~ Closed 2026-09-25: `v3HouseStoreBriefing` is ON,
    so `briefingData` reads the store.
  - The insight rules emit no `source`, so learned weights cannot reach them.
  - Each of these is a separate rule or slice, not a gap in this one.

### S5 — one decision for the room (proposed 2026-09-25, nothing built)

**The proposal (owner, 2026-09-25):** make the arbiter the one authority for who deserves
the room. It would take a richer candidate (`priority`, `urgency`, `confidence`,
`freshness`, `reason`, `presentation`, `expiry`) and decide screen, voice and action from
it.

**Verdict: YES-BUT.** The direction is right: one place should decide what earns the
room, across the glass and the voice. Most of the pipeline already exists, though, and
the proposed object would bring back the scored-lane problem this repo keeps paying for.

**What already exists:**
- **Sources → candidates:** `candidateSources.js` builds
  `{id, source, score, sub, interrupt, expiresAt}`.
- **Attention engine:** the V3 ranker (`src/v3/core/attention.js`), with learned weights
  (S0), presence mode and intent gating.
- **Arbiter:** S3 owns speech by priority and the stage by lane, with a reflex lane.

**The real gap: there are two deciders, and speech sits outside the ranking.** The ranker
decides the glance. A spoken author starts speech itself and then only *asks* the
arbiter. The arrival greeting is the plainest case:
- `arrival.js:136` calls `announce()`. The function returns the resulting selection
  (`attention.js:438`: "so the caller can see whether it landed").
- `arrival.js:154` ignores that result and calls `speak()` anyway.
- So the greeting is spoken whether or not it won the room. The arbiter can drop it
  (priority 10), but nothing ever asks whether it *deserved* the room.

The briefing, the timer and the doorbell speak the same way, from their own modules.

**How S5 departs from the proposal, and why:**
1. **One score, not four blended numbers.** Once `priority`, `urgency`, `confidence` and
   `freshness` are blended, the blending function becomes the real priority, and nobody
   can reason about it. The same kind of hidden ranking already bit this repo once:
   health's `announce()` at 72 replaced a spec's own fixture for a month. **Confidence
   and freshness are gates**: below the bar, the candidate does not exist.
   `departureCandidate` already works this way (no confident routine, no live drive time,
   no card).
2. **A source declares what it *can* do, never where it goes.** A source declaring
   `presentation: {surface: "glance", speech: false}` would still be deciding how it is
   shown. A source says `speakable`, and whether it has a data line. The arbiter picks
   the surface.
3. **`evidence` is mandatory, and it points at something that can be checked.** It names
   an S2 store key (`weather`, `forecast`, `nowcast`, `calendar`, `commute`, `bins`,
   `plex`) or an HA entity, and the observation's age. No evidence, no candidate. This
   turns the "8:41" lesson and the forecast invented 24/24 times into a structural rule
   instead of a prompt rule. It is the most valuable part of the proposal.
4. **The reflex lane stays outside.** The doorbell, timers, barge-in and commands do not
   wait for a ranking. S3 measured the doorbell → TTS path at a 1.1 ms median, and that
   is the bar.
5. **ACTION is out of scope.** A ranker that fires HA service calls means the house acting
   on its own. That is a different class of risk, and it needs its own decision
   (§6 item 4). It is not a side effect of an attention refactor.

**Precondition: see the arbiter decide something real first.** As of 2026-09-25, no real
arbitration decision has been seen live (`__v3().arbiter.decisions` is still owed from a
voice turn or a doorbell). Two S3 gaps are also still open: the presence rim has no
owner, and the timer chime plays outside the TTS channel. Read a week of real decisions
before making the arbiter the single authority.

**The slices:**

| Slice | What | Flag / rollback | It worked when |
|---|---|---|---|
| **S5a — evidence** | Every candidate carries `evidence: {key, at}`, an S2 key or an HA entity. First, a spec derives the inventory the way `event-registry.spec.js` does, with an explicit exempt list, and goes red on an undeclared candidate. Then, behind a flag, the ranker drops a candidate with no evidence or stale evidence. | The spec is test-only. The runtime gate gets its own flag; off = today's queue. | Inject a candidate without evidence: the spec goes red, and with the gate on the ranker drops it. Nothing on the wall changes with the gate off. |
| **S5b — arrival speaks only if it won** | `arrival.js` reads the selection `announce()` returns and calls `speak()` only when its own id is the hero. Arrival is the lowest-risk spoken author: priority 10, and not reflex. | A flag, read per arrival (no reload). Off = speak unconditionally, as today. | Both directions, forced at boot: a higher candidate holding the glance means the greeting is shown in the queue but not spoken; an empty room means it is spoken exactly as before. Both are injected RED. |
| **S5c — the next authors** | The briefing, then dinner, one at a time, if S5b's live decisions hold up. The timer and doorbell stay reflex. | One flag per author. | The same as S5b, per author. |

**Not yet inventoried, and not guessed here:**
- How many live candidate sources already have a data line that could become `evidence`.
- Which candidate sources have no `source` at all (the insight rules, per S4).
- Whether the V3 closure pulls in any candidate producers from `src/js/` that the
  incumbent also ranks. If it does, S5a's gate must keep the incumbent green.

### S6 — the presentation log (proposed 2026-09-25, nothing built)

**The proposal (owner, 2026-09-25):** build the missing loop, presentation → history →
mind. The house should know what it showed, for how long, who was there, whether it was
ignored, interrupted, asked about or acted on, and it should learn from that. For example,
it might phrase a rain warning differently if someone asked "is it going to rain?" after
the card had shown.

**Verdict: YES-BUT.** Build the log. It is cheap, and "why did the wall show X at 07:12?"
(§4, pro 7) still has no answer. But what it produces should be a **report the owner
reads**, not something the house learns from on its own. One household gives too few
samples to learn phrasing from, and the proposal's own example can be read either way.

**A crude form of the loop already exists, and it is live:**
- `routineRuntime.js:51-115` records every glance hero as `{source, dwelt}`.
  - "dwelt" = the room reached DWELL presence while it was showing.
  - The record is finalised when the hero changes or the room goes ambient.
- `routineStore.js:154` turns the dwell/shown ratio into a score nudge. It needs 4
  appearances, the baseline is 0.4, and it is clamped −15…+10.
- S0's `v3AttentionWeights` (ON) applies that nudge on the wall.
- The aggregates are counters only, kept in `aggregates.json` on the server and written
  whole by the page through `PUT /api/routines`. They record no rows and no times, so they
  cannot answer "when" or "why".

**Audit that loop before building a larger one:**
- The live aggregates contain `"test"` and `"spec"` sources (seen at S0's deploy). The
  nudge is being learned partly from probes and specs.
- Whether "dwelt" means *attended to* has never been checked against reality. It could
  just mean someone was standing in the kitchen. HYPOTHESIS, not probed: in a busy room,
  dwell is mostly about the room and hardly about the card.

**How S6 departs from the proposal, and why:**
1. **"Asked about it later" is ambiguous, so it is recorded, not judged.** A rain question
   after a rain card could mean the card failed. It could equally mean the card worked and
   the person wanted the detail. A learner cannot tell these apart; a person reading a
   week of rows can.
2. **The log never names someone the wall did not identify.** Presence is room-level
   (glance / dwell), and `person.*` is only home or away. Only a voice turn can name a
   person, and only where speaker ID is live. A row that says "Greg saw it" would be an
   invented fact, the same class as "8:41". Rows record the room's presence mode and who
   was *home*, labelled as such.
3. **Wording never changes because of the log.** Learning phrasing from inferred failure
   means generating copy from a guess. That conflicts with the S4 rule: learned timing,
   live words. The owner changes wording; the house does not.
4. **The samples are tiny.** A rain card shows a handful of times a week, and the
   per-source nudge already needs 4 appearances just to move. Learning per phrasing would
   take months and still be mostly noise.
5. **It lives on the server, bounded, and it is private.** Per-person presence history is
   a privacy log and, in the browser, a leak surface (§4.3). The page sends a row and keeps
   nothing. The server keeps a fixed retention. None of it goes near the public repo or
   the shipped `config.js`.

**⚠ Amended 2026-09-25, same day. The first draft broke a standing rule.**
`docs/vision/phase-8-learn.md` (Rollout & risk) says **"aggregates-not-logs"** and **"No
individual-event log persisted"**. The first draft's S6a stored "presence mode during it"
and "who was home" on every row, and S6b attached each later question to one of those
rows. That is an individual-event log about the residents, the very thing the rule
forbids. The draft did not notice. The amended S6 splits the log in two:
- **Rows about the WALL are allowed.** What was shown, where, when, for how long, on what
  evidence, and what the arbiter decided. These are facts about the machine. They answer
  "why was X on the wall at 07:12?".
- **Anything about the PEOPLE is counters only.** Presence while shown, a barge-in cutting
  it off, a question following it. These are per-source, per-day counts, in the style of
  the feature census, which already counts `attn:<source>:shown`. They are never joined
  to a row.
- **Joining the two, one row per presentation with the people on it, needs the phase-8
  rule lifted.** That is the owner's decision, §6 item 6, and it is not assumed here.

**The slices (amended):**

| Slice | What | Flag / rollback | It worked when |
|---|---|---|---|
| **S6-0 — audit the existing loop** | Clear the `test` / `spec` sources out of the live aggregates, and find out how they got there (probe, spec or `PUT`). Spot-check a sample of "dwelt" presentations against what the wall and the room were actually doing. | None; it is a probe and a data fix. | No non-product source in `__routines().weights`. A stated, measured answer to what "dwelt" means. |
| **S6a — the wall's log** | One row per presentation, **with no people on it**: candidate id, source, evidence key (from S5a), surface (glance / stage / voice), start and end, and the arbiter decision if there was one. Append-only, server-side, fixed retention. The page's writes are fire-and-forget. **Nothing reads it back into ranking.** | A flag for the page's writes. Off = no requests, byte-identical. | A forced presentation produces exactly one row with the right fields, and **no presence, person or home field**, which a spec asserts. Retention drops the oldest rows. `/kiosk-metrics` is flat. Inject: a missing end time, a double row and a person field all go RED. |
| **S6b — the people's counters** | Per source, per day: shown while someone was present, cut off by a barge-in, followed by a question on the same topic within N minutes. Counts only, alongside the existing census counters, with no times and no row ids. | Rides S6a's flag. | Forced: rain card, then a rain question inside N → `followed` +1. The same question outside N, or a different topic → no change. Both directions injected. The stored file holds only counts, which a spec asserts. |
| **S6c — the weekly digest** | Per source: shown (from the rows), total seconds on the glass (from the rows), shown while present, cut off, followed by a question (from the counters). Read by the owner, e.g. "Rain card shown 9×, followed by a rain question 3×, cut off once." | A read-only route; it changes nothing. | The digest reconciles with the rows and the counters, and one day is spot-checked against the wall. |

**What would reopen automatic learning:** only a digest showing a stable pattern that
points one way, over weeks. Even then it would feed ranking alone (the existing nudge
path), never the words.

**Not inventoried, and not guessed here:**
- How a voice turn's topic is classified today, and whether that maps cleanly onto
  candidate sources (S6b depends on it).
- What retention is right. The briefing's TTS cache and the census have their own; neither
  has been compared yet.
- Whether speaker ID is live enough to name anyone, and on which turns.

### S7 — today, answered (proposed 2026-09-25, nothing built)

**The proposal (owner, 2026-09-25):** a canonical "House Lately" timeline of the day, with
timestamped entries ("07:18 Greg left", "17:31 Storm arrived"). Personality would then
work from actual experience, with volunteered lines such as "You left eight minutes later
than usual" or "That's the fourth storm you've ignored this week".

**Verdict: YES-BUT.** Most of it is already built, under the same name. The two parts it
adds collide with standing decisions. The part that is genuinely missing is narrow and
allowed.

**What already exists:** `server/services/houseLately.js`, served by
`server/routes/house.js` and handed to `/converse` (`routes/ai.js:185`). It is built over
data the house was already recording:
- **The feature census:** what reached the glass, what was asked, what fired, when the
  house spoke, what came to the door.
- **`occupancyDays.js`:** who was home, sampled every 5 min, kept 60 days.
- **`weatherHistory.js`:** one line a day, kept about 3 years.

It already guards the traps in the proposal's examples:
- **A sleeping wall looks like a quiet house.** Every claim is counted only over days the
  wall was awake for at least 8 h. "Nothing happened today" is exactly the claim it was
  built to stop the house inventing.
- **Never-fired is not quiet.** A counter that has never worked cannot back "the doorbell
  hasn't rung in a month".
- **⛔ Answered, never announced** (its header, lines 59-66). Nothing about the residents
  becomes a glance line or a spontaneous remark.

**What the proposal adds, and why it is out:**
1. **A timestamped event log about people.** `phase-8-learn.md` rules it out:
   "aggregates-not-logs", "No individual-event log persisted", and "Resist turning
   learning into a visible 'insights about you' feature". "07:18 Greg left / 16:57 Greg
   returned" is exactly that log. Lifting the rule is §6 item 6.
2. **Volunteered judgements about the residents:**
   - **"You left eight minutes later than usual"** is word for word what the owner banned
     on 2026-09-24 in "learned timing, live words": never the learned clock time, never
     "usually".
   - **"The fourth storm you've ignored this week"**: "ignored" cannot be observed (S6
     point 1), and the line volunteers a remark about the residents.
   - Both would be grounded in memory, but the judgement on top of that memory would still
     be manufactured. `CHARACTER.md:105` says that rule "outranks everything else on this
     page".

**What is genuinely missing:** House Lately works by the day. Nothing holds **today's
timed facts about the world rather than the people**, such as "rain crossed 50% at 07:11"
or "the storm arrived at 17:31".

**S7 — today, answered:**
- **What:** a server-side fold of the current day's **world** events, each with its time:
  - weather condition changes
  - rain chance crossing 50%
  - the first rain and the last rain
  - optionally, a door or gate being routed. That is a fact about the door, with no
    identity, no image and no name.

  The source is the S2 store, which already reads weather and nowcast every 5 minutes on
  the server, so times are accurate to about 5 min and are stated that way. The store is
  lazy, so a fold must not keep it polling with no subscriber.
- **Bounds:** today only. It resets at the house day's rollover, and yesterday's day-level
  summary is already `weatherHistory.js`'s job. It holds a fixed maximum number of
  entries.
- **Reach:** handed to `/converse` alongside House Lately's claims. **Answered, never
  announced.** It feeds no attention candidate and no glance line. The personality speaks
  from it only when asked "what's the day been like?".
- **Never in it:** who was home, who left or arrived, presence, anything a voice turn said.
- **Flag:** its own. Off = nothing folded and nothing handed to `/converse`.
- **It worked when:** a forced day (rain crossing, then a condition change) produces
  exactly those entries at the store's read times. A spec asserts that no entry carries a
  person, presence or home field. A `/converse` answer about the day cites a time that is
  in the fold, and none that is not: a real call, since only a LIVE call finds invented
  particulars. Inject: a person field, and an entry outside today, both go RED.

**Not inventoried, and not guessed here:**
- Door and gate routing is decided in the page, and the server stores only daily counts
  from it. A timed door entry needs a new page → server write. It could be left out of
  the first cut.
- "Delivery" detection does not exist anywhere. The proposal's "09:42 delivery" has no
  source.
- How `/converse` currently phrases House Lately's claims. S7's entries would have to
  follow the same "answered" path, not a new one.

---

## 6. Open decisions for the owner

1. **Is S0's weights fix wanted as behaviour?** It changes ranking order, slowly. It needs
   four appearances of a source, and each nudge is clamped to −15…+10. The alternative is
   to correct the comment and leave ranking alone.
2. **Where does the mind live?** Recommended: defer. Share the store, not the mind.
3. **Is S3 wanted at all?** It is the biggest architectural change on the list, and the
   collisions it retires have been fixed one by one so far.
4. **May the house ACT, not only show and speak?** (S5, 2026-09-25) The proposal's third
   output is HA actions chosen by the ranker. It is out of S5 on purpose: acting
   unprompted is a different risk class from a line on the glass, and it needs its own
   yes or no.
5. **May the house learn from its own presentations automatically?** (S6, 2026-09-25)
   Recommended: not yet. The log and a weekly digest come first, and the owner decides
   what changes. Automatic learning would affect ranking only, never wording, and only
   after the digest shows a stable pattern over weeks.
6. **Should "aggregates-not-logs" (`phase-8-learn.md`) ever be lifted?** (S6 and S7,
   2026-09-25) Both proposals, as first written, needed a timed log of what the residents
   did. The recommended answer is **no**: S6 keeps people as counters, and S7 keeps to
   world events. If the answer is ever yes, that is a privacy decision taken on its own:
   who is logged, for how long, and who can read it. It should not come in as a side
   effect of a feature.
