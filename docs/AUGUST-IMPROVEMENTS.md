# August Improvements — the five gaps

**Written 2026-08-29** against `258b671`, from a read of the code rather than of the
backlog: `server/routes/*` (26 modules), `src/v3/{core,subjects}/`, the `features:` block
in `src/js/config.js`, and every `router.post|put|patch|delete` in the tree.

`docs/BACKLOG.md` is the delivery authority and it is down to **one open item (M2, the 72h
soak)**. This file is the *next* set — not defects, not cleanup. It is a list of things the
wall cannot do, ranked by what each one costs **per day of ordinary use**, and it is
deliberately unflattering.

Each item states the gap, the **evidence already in this repo** that it is real, and the
smallest shape that would close it.

---

## 1 · Nothing proves a feature is still ALIVE on the wall

**The gap.** Tests prove a path *can* execute. `healthService` proves a *feed* is fresh
(eight of them). **Nothing proves a candidate ever won, a flag's branch ever executed, or
an entity ever changed state** on the actual glass. ~78 flags, ~100 spec files, a green
suite, and a watchdog — and none of them can answer "what has been silently dead for a
month?"

**Why this is first: it is the repo's dominant bug class, and it has already cost shipped
functionality.** Every one of these was live, green, and dead at the same time:

| Silently dead | For how long | Found by |
|---|---|---|
| `bomWarning` — **the wall could not say a storm was coming** | since the V3 cutover | chasing an unrelated flag (F3) |
| `motionWakeGate` — 0 occurrences in the shipped bundle | unknown | `grep -c` on `dist/` |
| `robotCandidate` — `houseSnapshot()` never read it | unknown | F3 |
| `__intent` — `undefined` on the wall, two postures unreachable | cutover → 2026-08-16 | CDP measurement |
| 24 of 26 HA `dashboard_command` scripts — never fired | unknown | orphan sweep |
| `media.js` — undrivable, 0% coverage | unknown | F2 |
| four cameras — dead **upstream of HA** | weeks | divergence detector |
| `kiosk-sweep.sh` — every hook `undefined` on V3 | since cutover | M1 |

A green suite was compatible with all eight. So was the watchdog.

**Shape.** `src/v3/core/census.js` is already the correct machine — subscribed from
outside the thing it measures, bounded aggregates, POST-deltas so a reload cannot zero the
history, on-device, flag-gated, and `depth.js` contains not one line about it. **Point that
same machine at features instead of depths:** last-fired day + count per attention
candidate, per local intent id, per alert route, per gated branch. Then one read of
`/api/census/features` answers the question that has now been asked eight times the
expensive way.

⚠ The trap this must avoid is the one `reference-literal-sweep-blind-to-computed-names.md`
records: **a registry written by hand is a literal sweep with extra steps.** What is
counted has to be recorded at the point the thing actually fires, not enumerated in a list
someone maintains.

---

## 2 · The wall has exactly ONE input, and it is the least reliable part of the system

**The gap.** `grep` for `click` / `pointerdown` / `touchstart` across `src/v3/` returns
**nothing**. Voice is the sole way to operate the surface. `subjects/lists.js` says so in
its own header: *"this surface has no touch and no pointer, so there is nothing to operate
it with."*

**Evidence it bites.** The mic capture stalled and the house went **deaf** (`ff0d7f5`).
Barge-in does not stop a reply. A whole feature had to be built so it could admit it had
not heard you (V1 failure cues). Whisper hallucinated `"Okay."` out of room tone. Two lanes
were mute (`4691d25`). Wake scores 0.66–0.82 are a false band. **When any of that breaks, a
32" display becomes a photo frame and the only recovery path is SSH.**

**Shape.** Not touch hardware — a **remote**. The phone-surface pattern is already proven
twice (`static/memories/`, `static/recipes/`). One LAN page that can force a camera, skip
or veto the photo, set depth, and type a question the wall answers aloud. Every route it
needs exists. It doubles as a way to drive the wall while debugging that is not CDP.

---

## 3 · The house knows everything and can change almost nothing

**The gap.** Every write endpoint in the tree is about the *dashboard's own* state — photo
vetoes, memories, recipes, routines, census, delight, TTS, display wake. **Not one is about
the household's state.**

`MUTATION_RE` (`src/js/services/localIntents.js:519`) deliberately returns `null` for
`add|put|remove|set|remind|create|schedule…` and hands it to HA Assist. That boundary is
principled — Assist owns the devices and the lists. But this repo has already recorded that
**Assist confirms things that never happened**: the voice says *"backyard light's on now"*
when four of five floodlights ignore `switch.turn_on` entirely.

So the daily fact is: you stand in front of a wall that knows the shopping list, tonight's
dinner, whose turn it is to feed the dogs and what colour bin goes out — and to add oat
milk you take out your phone. **That is the exact moment this project exists to delete.**

**Shape.** `server/ha/haRoutes.js:161-190` already exposes `shopping_list`
GET/POST/PATCH/DELETE and the fast lane never calls them. A narrow write lane for lists and
one-off calendar events (*"we're out Thursday"*), **confirmed by readback rather than by
optimism** — which is also the fix for the Assist honesty problem.

### ▶ Built 2026-08-30 — the LISTS half, flag-off, pending the glass

`voiceListWrites` (browser) + `VOICE_LIST_WRITES=1` (box), two keys, both default off.
*"Add oat milk to the shopping list"*, *"we got the milk"*, *"take bread off the list"* and
an undo, matched before `MUTATION_RE` the way the photograph veto is. `server/routes/lists.js`
writes through `todo.add_item`/`update_item`/`remove_item`, **re-reads the list, and builds
the spoken line from the re-read** — `not-on-list` (the write returned and the item is not
there) is a distinct, spoken failure, and so is `unknown` (we could not find out). The wall
also renders the list the server read back, so the confirmation is visible as well as heard.

Three corrections to the shape proposed above, each measured rather than reasoned:

- **The legacy `/api/ha/shopping_list` endpoints are not the right lane.** They work — the
  `shopping_list` integration is installed — but they reach only the shopping list, and the
  house's second writable list is `todo.both`. One mechanism (`todo.*`) covers both.
- **`SAFE_SERVICES` was deliberately NOT widened.** Adding `todo.add_item` there would hand
  every todo entity in the house to the generic `/api/ha/services` proxy *and* the Claude
  tool lane, including `todo.greg` and `todo.brett` — the two private lists this lane
  excludes on purpose. It carries its own narrower allowlist instead.
- ⚠ **A defect found on the way past, and fixed here:** `extractTodoItems`
  (`services/homeAssistant/client.js`) did not know the `service_response` spelling HA
  actually answers with, and returned `[]` for it — so **every to-do list on the wall
  (`todo.both`, `todo.greg`, `todo.brett`) has been rendering as empty regardless of what
  was on it.** The shopping list was unaffected: it reads through the legacy REST path. This
  is §1's thesis arriving on schedule — green suite, live watchdog, silently dead.

### ⛔ The CALENDAR half is blocked on Home Assistant, not on code

Probed live 2026-08-30: the only `calendar.*` entities in this house are
`calendar.brisbane_city_council` and `calendar.radarr`, **neither of which declares
`CREATE_EVENT`**. Google and Apple reach the wall as read-only iCal share URLs and there is
no CalDAV or Google-API client in the tree, so *"we're out Thursday"* has nowhere to go.
Adding HA's **Local Calendar** integration (a UI action in HA) unblocks it; the intent seam
and the readback are already built and are what it would reuse.

---

## 4 · The house has no memory of ITSELF

**The gap.** `data/weather-history.jsonl` is **nine lines**. The depth census is six days
old. `depth.js` keeps one integer and one reason string, both overwritten in place. Phase 8
routine learning exists but is confidence-gated and only nudges `timeBudget` and ranking —
it never produces anything a person can read.

So the wall can never say the things that would prove it lives here: *"third Tuesday
running you were out past nine"*, *"the driveway camera has not changed state in 19 days"*,
*"you ask about the commute every weekday at 7:40 — here it is before you ask"*, *"warmest
August night since we started counting."*

**Shape.** One append-only daily record — actual weather, who was home when, what was
asked, what surfaced, what fired. Bounded, on-device, same discipline as `data/routines/`
and `data/census/`. It is the substrate for #1 **and** for most of what makes year two feel
different from year one. The wall is superb at **now** and has no access to **lately**.

### ▶ Built 2026-09-01 — the WEATHER half, live. The shape above was wrong in three ways.

`a2a7beb`. Researched 2026-08-31, shipped the next morning once the measurements below
changed what the item was. **The other four signals are NOT built** — see §4.6 at the end of
this section for why they are a second writer, and what the shape above understated.

**The headline: the substrate already exists, and it is broken in a way that would make every
claim built on it false.** `server/services/weatherHistory.js` writes one line a day and
carries its own banner — *"⚠ THIS DOES NOTHING TODAY. It is planted, not harvested."* Its
reader `history()` has **zero callers** outside `tests/memory.spec.js:184`. So §4 is not
"start counting". It is **"the counting that exists is wrong, and nothing reads it"** — §1's
thesis arriving again, on a file that was written to anticipate it.

That reframing matters because keeping count is not a nice-to-have here.
`docs/design/CHARACTER.md:61-64` names it *"its most distinctive habit and the one that makes it
worth having"*, and `:91` gives the line it is supposed to produce — *"The bin went out at
8:41, which is the latest all month"*, offered there as the case where the house is *"funny
and useful in the same breath"*. **That sentence is unbuildable today**, and every sentence of
that form would be invented.

#### 1 · There IS history, and more than expected

Live kiosk, measured 2026-08-31: **122 lines, 16 distinct days, 2026-08-16 → 08-31, no gaps.**
The writer is good code — Brisbane day keys, per-line `try/catch`, last-wins-per-day, cold
start to `[]`, `MAX_DAYS = 1100`, deliberately not backfilled. There is real history to harvest.

#### 2 · ⚠⚠⚠ Three defects make a harvest WRONG, not merely absent

A harvest over this data produces confident false claims — the failure `CHARACTER.md:105`
calls the rule that *"outranks everything else on this page"*.

- **`high`/`low` are a FORECAST, sampled at an arbitrary moment.** `weatherService.js:129-131`
  reads `daily.temperature_2m_max[0]` — today's *prediction*. `recordDay` writes once per
  **process lifetime** (the `lastWritten` guard, `weatherHistory.js:43`), so the stored value
  is whatever the last service restart of that day happened to predict. **12 of 16 days carry
  more than one distinct reading:**

  ```
  2026-08-20   8 distinct readings   high 20.2 → 21.4   low 11.7 → 12.4
  2026-08-23   5 distinct readings   high 21.5 → 22.2   low 10.7 → 11.5
  ```

  A 0.7–1.2 °C sampling error across a window whose nights span ~10.7–12.9 °C is **large
  enough to flip a superlative**. `now.temp_c` (`weatherService.js:115`) *is* a real
  observation, is already fetched on the same call, and is thrown away.

- **`condition` is one instantaneous sample.** 2026-08-20 recorded `Clear`, `Mostly clear`,
  `Partly cloudy` and `Cloudy`; last-wins kept `Partly cloudy`. As a *daily* descriptor that
  is close to meaningless.

- **The BOM fallback records nothing.** `tryBomFallback()` returns without calling `recordDay`,
  so a day Open-Meteo is down is silently missing — and a missing day is indistinguishable
  from a day nothing happened, which is fatal to "since we started counting".

Also: **`MAX_DAYS` is read-side only.** Nothing prunes or compacts. 122 lines for 16 days is
~7.6 service restarts a day — deploys.

#### 3 · 🔑 Four of the five signals are BROWSER facts, so this is TWO writers

`arrival.js`, `presence.js` and `attention.js` all live in `src/v3/core/`. The only thing that
reaches the server is day-granular counters via `/api/census/features` — no timestamp, no
candidate text, no id. "One append-only daily record" understates the job.

Server-side at full fidelity today: weather (`getWeatherNormalized`), coarse occupancy
(`healthService.occupancyFrom`), and **every HA state change**
(`haWs.getHaWsManager().on("event")`). The richest client tap, if a second writer is ever
built, is `lastSelection()` (`v3/core/attention.js:357`) — it already carries what won, what
lost, what the bar was, and whether it reached the glass.

#### 4 · ⛔ The example lines above straddle a line this repo already drew

`unresolved.js:36-45` states it as an absolute, and it is enforced in three places
(`phase-8-learn.md:81`, `routineRuntime.js:148`, and `personality.js:39-48` stripping
"I noticed…"):

- ✅ observations about the **HOUSE** and its devices — the house witnessed these
- ⛔ inferences about the **RESIDENTS'** habits — *"that is what phase-8 bans, and it stays
  banned… answered only when asked"*

*"Third Tuesday running you were out past nine"* and *"you ask about the commute every weekday
at 7:40"* are both the banned class. *"Warmest August night since we started counting"* is
fine — weather is the one thing the house experiences directly (`CHARACTER.md:54`).

**The correction is the split, not the ban:** weather and house facts may reach the glass;
resident inferences are answer-only, via a `latelyContext()` sitting beside `unresolvedContext`
at `voice.js:167`.

#### 5 · The shape, if it is ever built

Sequenced so the read side is proven before a second writer exists.

1. **Fix the plant.** Fold observed `now.temp_c` into per-day extremes; conditions as a set;
   record on the BOM path; add the `compact()` the file has never had. ⚠ **The trap: seed the
   accumulator from today's row on restart.** A reset writes a *narrower* range and last-wins
   prefers it, so the bug would look like a working day and read as a quieter one.
2. **A pure claim builder** that returns `null` below a coverage floor and keeps a sticky
   `since` — the `censusFeatures.js` lesson, where shipping without `since` made the wall
   report `dead: 71` of 73 on day one.
3. **PULL first.** The answer lane is the payoff. **PUSH stays flag-off**, because "warmest in
   six weeks" cannot be seen working until the record is six weeks deep.
4. **The client ledger, deferred** — the census machine pointed at the day, POSTing deltas,
   never a blob.

#### 6 · ▶ What shipped, and what is still owed

Steps 1-3 above are built and live (`a2a7beb`, deployed 2026-09-01 06:00). New:
`server/services/lately.js` (pure claim builder), `latelyContext()` beside
`unresolvedContext()` in `voiceShape.js`, and `GET /api/weather/lately`, which computes the
verdict on read the way `/api/census/features` does. `weatherHistory.js` now folds observed
extremes, records on the BOM path, and compacts — **first run on the kiosk collapsed 123 lines
to 18.**

⚠ **No new feature flag, deliberately.** The PUSH-to-glass lane is not built, and a flag with
no code behind it is precisely the dead lever §1 is about. The answer lane rides
`VOICE_HOUSE_CONTEXT`.

⏳ **The record honestly starts at deploy.** The 16 pre-existing days are forecast-only, so the
reader is correctly silent on them — `observedDays: 1` on day one. `ready` flips around
**2026-09-08**; that is the first moment any of this can be heard, and the first real check
that a shipped superlative is true.

⛔ **Still not built, and it is the larger half:** who was home, what was asked, what surfaced,
what fired. All four are BROWSER facts — `arrival.js`, `presence.js` and `attention.js` all
live in `src/v3/core/`, and only day-granular counters reach the server. "One append-only
daily record" understates it: that half is a **second writer**, and the read side above should
be proven against real data first. Richest client tap when it happens: `lastSelection()`
(`v3/core/attention.js:357`) — it already carries what won, what lost, the bar, and whether it
reached the glass.

---

## 5 · Nothing survives the empty room

**The gap.** Everything terminates in display + speech, in that room, at that moment. The
only outward path is `healthService`'s HA notify, and it is scoped to degraded feeds —
`wan` is `notify: false` by design (a push about the internet, over the internet), and
quiet hours suppress 22:00–07:00.

So an unusual door event at 2pm with the house empty, bins that needed to go out last
night, tomorrow's vet appointment — announced to nobody, then decayed by `expiresAt`. And
there is no reciprocal move either: no *"here is what happened while you were out"* at the
moment of first presence.

**Shape.** Arrival detection exists (`core/arrival.js`), the scored queue exists, the
personality voice exists. The catch-up is mostly wiring. It is what turns the wall from
*a screen that was on* into *something that was minding the house.*

---

## Ordering

**Do #1 first.** Not because it is the most exciting — because it is the only one that has
*already cost real shipped functionality*, eight times, and the machine that fixes it is
already in the tree. **Every other item on this list is a new feature that can also go
silently dead.**

**#3 is the one to argue for anyway.** It is the difference between a dashboard you read
and a house you talk to, and daily habit flags the gap every time a phone comes out in
front of the wall.
