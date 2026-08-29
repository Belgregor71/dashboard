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
