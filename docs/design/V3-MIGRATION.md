# V3 Migration — bringing the house onto the new surface

**Status:** **Phases 1, 2, 3 and 4 complete (`3efb426`, `7d89002`, `c20525a`, `b65085c`,
2026-08-08)**, including 3.4, which Phase 4 carried. Phase 1 is live and was demonstrated on
the G11; **Phases 2, 3 and 4 are committed but unpushed and have never been seen by eye.**
Suite 898. Written 2026-08-08, after the wall was flipped to `/v3/` for ~15 minutes and
pointed back. See
[DESIGN_SYSTEM.md](DESIGN_SYSTEM.md) for the design law and
`~/.claude/plans/i-want-to-see-synthetic-hummingbird.md` for the original V3 plan.

> **Two steps below were described wrongly and have been corrected in place** — 1.1 (the DOM
> coupling was not where this document said it was) and 1.4 (there is no `band` field). Both
> corrections are marked ⚠ and are worth reading before trusting any other step's phrasing:
> the same "described from memory rather than from the code" risk applies throughout.

---

## Why this document exists

V3 was flipped onto the wall and the immediate reaction was the right one: *"it has none of
the features we built."* That is true, and it is worth being precise about why, because the
reason determines the plan.

V3 is not a fork of the incumbent with improvements layered on. Its plan opens by rejecting
the incumbent's architecture outright — "eleven phases of accretion" whose rules were
written for a Pi 4 rendering at 2.7 fps, navigated by a six-view click-cycling router on a
screen with no touch, mouse or keyboard. V3 replaced the *surface*: no pages, one
composition at four depths, voice as the only input. What shipped so far is that surface's
foundation. The house was never ported onto it.

**The good news, and it is the whole reason this plan is short:** the incumbent's decision
layer is already separated from its rendering layer, and the decision layer is almost
entirely DOM-free. We are not rewriting the house's intelligence. We are re-hosting it.

---

## What the audit found

Measured 2026-08-08 against `2cac2d3`.

| module | lines | DOM refs | verdict |
|---|---|---|---|
| `services/attentionEngine.js` | 237 | **0** | portable as-is |
| `services/candidateSources.js` | 327 | **0** | portable as-is |
| `services/attentionRank.js` | 96 | **0** | portable as-is |
| `services/insightEngine.js` | 93 | **0** | portable as-is |
| `services/voiceSnapshot.js` | 250 | **0** | already shared by both surfaces |
| `modules/focusHero.js` | 459 | **40** | ⛔ **the blocker** |
| `core/presence.js` | 92 | 3 | ⚠ derived from the screensaver, not a sensor |

### The keystone: one file stands between V3 and the entire house

`attentionEngine.js` is DOM-free, but its own header admits where its inputs come from:
candidates are *"scraped from the DOM by focusHero each tick."* `focusHero.js` reads the
house out of forty `getElementById(...).textContent` calls — `current-conditions`,
`current-temp`, `commute-greg`, `next-event-name`, `.media-panel__title`, and so on.

V3 has **34 DOM nodes** and not one of those IDs. So the engine cannot run there, and every
feature that depends on it — which is nearly all of them — is blocked behind that one fact.

**This is a solved problem in this codebase.** The fast lane hit exactly this wall and
broke through it: `voiceSnapshot.js` is 250 lines, zero DOM, reads the in-memory HA entity
cache plus a prefetched `/api/*` cache, and it already serves both surfaces. The migration
is to widen that pattern until it covers what `focusHero` scrapes.

That single piece of work is the difference between a plan and a pile of ports.

### The second finding: presence is a proxy, not a sensor

`core/presence.js` sets its mode off a `screensaver:changed` event, and `motionTrigger.js`
imports `wakeScreensaver` directly. Presence in the incumbent *means* "the screensaver is
awake." V3 has no screensaver — depth 0 **is** the resting state — so presence cannot be
ported. It has to be re-sourced from where the signal actually enters: the
`binary_sensor.kitchen_motion_detected` / `..._person_detected` entities arriving on the
`/api/ha/stream` SSE. Small job, but it is new code, not a move.

---

## The four buckets

The 33 modules in `src/js/modules/` do not map one-to-one onto V3. They sort into four
kinds, and only one of them is per-feature work.

**A · CAUSES** — things that are *data feeding a ranked queue*, with no UI of their own in
V3. Weather, commute, next event, media, Plex, tonight's menu, bins, fuel, Sonarr activity,
todo, camera triggers, robot, insights, memories, delight, occasions. In the incumbent each
owns a panel; in V3 they are candidates and the composer decides if they are ever seen.
**Most already exist as candidate functions in `candidateSources.js`.** Once the keystone
lands, these arrive in bulk rather than one at a time.

**B · SUBJECTS** — depth 3, one thing full-bleed. ✅ **All eight built** (`b65085c`): camera
and radar from Phase 1, plus calendar, recipe, memories, media, briefing and lists.

**C · AMBIENT** — the resting surface. Substrate, ground, scrim, hour, presence-light are
**built**, and built better than the incumbent's equivalents. The screensaver largely
*dissolves* here rather than porting: depth 0 is what it was for.

**D · INVISIBLE** — behaviour with no surface, which must keep working or the box degrades.
Energy saver (display off at night, 91 lines), watchdog, self-heal, health indicator,
system status. Easy to forget precisely because nothing shows.

---

## The plan

Ordered by dependency first, household value second. Sizes are rough.

### Phase 1 — The causal spine  ⭐ the unlock — ✅ **COMPLETE 2026-08-08**

This phase is what the V3 plan means by *"the house pushes you deeper."*

| # | step | size | |
|---|---|---|---|
| 1.1 | Subscribe V3 to `/api/ha/stream` — see the ⚠ correction below | S | ✅ `12437be` |
| 1.2 | **`services/houseSnapshot.js`** — widen the `voiceSnapshot` pattern to cover every input `focusHero` scrapes. Pure, cached, server-backed | **L** | ✅ `af8b0ea` |
| 1.3 | Wire `collectSources(houseSnapshot())` → `attentionEngine.getSelection()` in V3 | S | ✅ `7fff6b6` |
| 1.4 | Map the queue to depth — see the ⚠ correction below | M | ✅ `3efb426` |
| 1.5 | Real presence from the kitchen motion/person sensors, direct (not via screensaver) | M | ✅ `3efb426` |
| 1.6 | Recession timers | S | ✅ `3efb426` |

**Done when:** the wall moves off depth 0 with nobody speaking to it, and always recedes.
**Demonstrated live on the G11** (headless, wall untouched): real kitchen motion → present,
mode AMBIENT→GLANCE, depth held at 0 because the top real candidate scored 42; a score-80
candidate → depth 1, reason `attention:camera`, glance cell filled; presence lost → depth 0,
reason `attention:absent`, cell cleared.

> ⚠ **1.1 as written above was wrong.** There is no `document.dispatchEvent` in
> `client.js` — it was already DOM-free and already on the event bus. The coupling was one
> layer up: `events.js` owned the only three `updateEntity()` calls in the codebase and it
> imports `core/viewManager.js`. Those three handlers now live in
> `services/homeAssistant/entityFeed.js`; `events.js` keeps its `document` re-broadcast by
> subscribing to the bus event the feed emits. **The load-bearing invariant is order** — the
> cache must be written *before* `ha:state-updated` fires, because twelve modules read the
> cache from inside that handler. Reversing it throws nothing and makes the whole house one
> tick stale forever.

> ⚠ **1.4's `must`/`should` bands do not exist as a field.** Bands are only a documented
> score ladder in `candidateSources.js` — Interrupt 90–100 · High 70–89 · Medium 50–69 ·
> Low 40–49 — plus a real `interrupt` boolean. The shipped rule is therefore: `interrupt` →
> D1 regardless of presence; `score >= 70` → D1 when present; below that, nothing. Measured
> on the live wall, the entire ordinary queue is Low band (commute 42, now playing 41, Plex
> 41, tonight's menu 40), so a naive band mapping would have lit the screen up for "Chicken
> Fajitas".
>
> **The "dwell 30 s → D2" clause was deliberately NOT built.** `#spread-lattice` renders
> empty until Phase 2, and `e3e9630` already had to guard against entering SPREAD empty after
> it blacked the wall out mid-sentence — a dwell timer would rebuild that bug with a slower
> fuse. Depth 2 is Phase 2's to open.
>
> **1.6 needed almost no code:** `setDepth` already arms its own hold (GLANCE 90 s / SPREAD
> 45 s / SUBJECT 30 s) and steps down one level. Only presence-loss was worth adding.
>
> ⚠ **`deepen()` falls through to `sustain()`** when the target is shallower than current, so
> a 30 s tick at SUBJECT would re-arm a voice-held depth forever — silently, throwing nothing.
> Attention only acts while `getDepth() <= GLANCE`. Keep that.

**Do not skip 1.2 by letting features reach the screen directly.** That shortcut is
precisely how the incumbent became eleven phases of accretion, and V3 exists to escape it.

### Phase 2 — The composer — ✅ **COMPLETE 2026-08-08 (`7d89002`)**

| # | step | size | |
|---|---|---|---|
| 2.1 | `core/grammar.js` — the legal rectangles and the named templates | M | ✅ |
| 2.2 | `core/composer.js` — pick a template from the ranked queue; never free-form | M | ✅ |
| 2.3 | Haiku authors **words only**, never placement; `personality.phrase()` on failure | S | ✅ |
| 2.4 | `core/spread.js` + the dwell rule — not in the plan, and depth 2 does not render without it | M | ✅ |

**Invariant, and it held:** layout composed by rules, language composed by the model.

**Done when:** depth 2 renders something. It does — `pair-note` on the live low-band queue,
opened by dwelling and nothing else.

> ⚠ **The plan's "~6 named templates" landed at four, and "five rectangles" at four plus
> `full`.** Both numbers were written from the design study rather than from the shipped
> `compose.css`, and **the CSS is the truth** — a rectangle named in JS with no class in the
> stylesheet is an invisible cell, content placed nowhere with no error anywhere. A spec now
> parses the stylesheet and compares coordinates. `cell--rail` is deliberately excluded: it
> spans rows 7–8 and therefore **overlaps both `wide` and `side`**, and depth 2 already
> prints the vocabulary rail in that corner. Five- and six-cell templates would be geometry
> nothing can reach, because `selectForMode` caps the DWELL stack at three.

> ⚠ **The High band gates depth 1 and must NOT gate depth 2.** They are opposite
> transactions: D1 is the house interrupting you (score ≥ 70, or the wall lights up for
> "Chicken Fajitas"), D2 is you having stayed in the room for thirty seconds. The entire
> Low-band readout queue — commute 42, now playing 41, menu 40 — is exactly what belongs at
> D2 and nowhere else.

> ⚠ **`sustain()` re-arms a depth WITHOUT changing it, so no `onDepth` listener fires.** Any
> ownership flag maintained from that subscription is therefore stale the moment the voice
> takes over a depth attention opened — and the vocabulary card reaches depth 2 through
> exactly that path when the surface is already there. The composer took the screen back off
> the card on the next 30 s tick, mid-conversation, silently. **Ownership is asked, never
> remembered:** `getReason()` (new export on `depth.js`) plus `spreadMounted()`, which reads
> the DOM. The same shape as the render signature, for the same reason.

> ⚠ **2.3 was already true and the work was keeping it true.** Text reaches the composer
> already phrased by `attentionEngine` — AI via `/api/ai/brief`, `personality.phrase()` when
> it fails — so the honest job was making sure the composer does not quietly become a second
> author. No fetch, no interpolation, no fallback copy, and a spec that reads the two pure
> files and fails on `document`/`window`/`fetch(`/`localStorage`/`setTimeout`.

> ⚠ **`tests/v3-spread.spec.js` answers every `/api/**` 503.** Its first run composed a
> `triple-footer` instead of the expected pair because a **real Plex candidate arrived from
> the developer's own NAS** — the same trap as the suite hitting live HA. Which template is
> chosen is a function of how many candidates there are, so a template spec cannot share the
> queue with whatever happens to be playing in the living room.

> **Two latent bugs fixed in passing.** `css/type.css` has carried
> `.said[data-len="long"]` since V3 shipped and **nothing ever set it**, so every long line
> has been trying to hold 132px; `setSaidText()` now applies it at both depths, at
> focusHero's own 41-character threshold. And `__v3()` had **two writers for `presence`**, so
> the second ate the first and the presence *light* was unreachable from the handle — it is
> now `light`.

**Still owed:** depth 2 has never been seen by eye, and the spread's marginal GPU cost is
unmeasured. `__v3Presence("dwell")` collapses the 30 s wait for a CDP probe.

### Phase 3 — The events that must interrupt — ✅ **COMPLETE 2026-08-08 (`c20525a`)**, except 3.4

| # | step | size | |
|---|---|---|---|
| 3.0 | **Recession must land somewhere inhabited** — not in the plan, and 3.1 is unsafe without it | S | ✅ |
| 3.1 | Doorbell → forced D3 camera subject with decay | S | ✅ |
| 3.2 | Camera motion trigger → D1 glance — verify rather than build | S | ✅ **verified: it must NOT** |
| 3.3 | Arrival greeting → D1, with the minimum-away guard | M | ✅ |
| 3.4 | Morning briefing at its window → D2 | S | ⛔ **deferred — see below** |

**Done when:** someone at the door puts the door on the screen without anyone asking. **It
does** — with nobody in the room, from the real entity feed, and it takes the screen off
whatever subject was already up.

> ⚠ **3.0 had to come first, and it is the finding of this phase.** `setDepth`'s recession
> stepped down **exactly one level**, and depth 2 is empty unless something composed it while
> depth 1 is empty unless something wrote its cell. So a subject timing out dropped the wall
> onto a blank rectangle and held it there for that depth's full hold — 45 s of black, then
> 90 more. **Nothing had hit it because every route to depth 3 so far was a spoken one**,
> with a person standing there to say something else. Phase 3 is the first set of things
> that drive the surface deep *with nobody watching*. Recession now falls to the deepest
> **inhabited** depth, and the probe is **asked of the DOM at the moment the timer fires** —
> what is on screen a minute later is not what was there when the timer was armed. Depth 0
> is the floor because the hour and the photograph mean it can never be empty.

> ⚠ **FORCED, not deepened.** `deepen(SUBJECT)` from depth 3 falls through to `sustain()`,
> which re-arms the hold and **leaves the old camera mounted** — the doorbell would be
> announced over a picture of the side gate, silently, looking exactly like the doorbell
> camera being broken. The alert calls `setDepth` directly. This is the one thing in V3 that
> overrides a subject the room asked for, and it should be the only one.

> ⚠ **The boot snapshot again.** The opening SSE frame replays every entity including any
> `binary_sensor` stuck `on` since this morning. presence.js paid for this once (a stuck PIR
> faking someone in the kitchen at every load); here it would **announce a visitor out loud
> and take the wall to depth 3 on every single page load.** `routeAlert` takes a
> `minFreshMs`; V3 passes 30 s. A missing `last_changed` is treated as live, because that is
> what a genuine push event looks like.

> ⚠ **3.2's plan entry was wrong: a camera trigger CANNOT reach D1, and should not.**
> `cameraTriggerCandidate` scores **45** (Low band, under the glance's 70) and carries
> `stackOnly`, which bars it from ever being the hero — so an empty room never sees it at
> all and a present-but-unsettled room doesn't either. It is **depth-2 traffic**, visible
> only while someone is dwelling. That is the right answer, not a gap: the two cameras that
> must interrupt are the front door and the side gate, and **both go through the alert path
> and force depth 3**. A driveway that lit the wall every time a car went past would be the
> "Chicken Fajitas" failure with a picture attached. Locked with three pure tests.

> ⛔ **3.4 is deferred, and the plan mis-specified it twice.** There is no briefing candidate
> in `candidateSources.js` and no briefing subject in V3 — Phase 4 lists Briefing as one of
> the six depth-3 subjects still to build, so 3.4 is **blocked on Phase 4**, not small. And
> the target depth is wrong: since Phase 2, depth 2 is a **composition built from ranked
> candidates**, whereas a briefing is one thing at length — which is depth **3**'s shape.
> Do it as the briefing subject in Phase 4, opened at its morning window.

> **3.3 does not touch the screen, and that is the design.** `arrivalGreeting.js` is 313
> lines because it owns a card. V3 already has a place for one true line and a rule for who
> may write it, so arrival **announces a candidate** (`announce()` on `v3/core/attention.js`)
> and stops — inheriting the ranking, the interrupt rule, the personality voice, quiet mode
> and `expiresAt` decay rather than reimplementing any of them. An event that painted the
> glance cell itself would be a **third** author of a node the composer and the voice already
> share, and Phase 2 spent a whole spec on that bug in its second shape.
>
> ⚠ It also ships the **minimum-away guard the incumbent still lacks**
> (`arrivalGreeting.js:289`). July's 27 false arrivals in five days were root-caused upstream
> (`consider_home` 60 s → 900 s), but the dashboard believed all 27. Under 10 minutes away is
> not an arrival. An *unknown* away time is treated as long enough — a missed greeting is a
> worse failure than a duplicate one.

> **`__v3Tick` silently ignored its argument.** There was no way to watch a candidate expire
> without waiting out its real lifetime. It now takes an optional clock — which matters
> because `expiresAt` is the entire lifetime of an announced event; there is no timer behind
> `announce()` and nothing to tear down.

New debug handles: `__v3Alert(entityId, state)`, `__v3Arrival(entityId, state)` (call it
twice — a greeting needs a transition observed this session), `__v3Tick(now)`, and
`__depth().recedesTo`, which answers where the current hold would land without waiting for it.

### Phase 4 — The remaining subjects ✅ **COMPLETE 2026-08-08 (`b65085c`), suite 898**

Six depth-3 modules against the built pattern in `subjects/index.js`. Each owns its mount
and must tear itself down on leave — a subject left mounted holds its MJPEG connection open
forever.

Calendar · Recipe · Memories · Media · Briefing · Lists — all six shipped, plus **3.4**.

**What landed:** `subjects/dom.js` (the shared frame/column/plate vocabulary, and the
teardown that matters) · `calendar.js` · `lists.js` · `recipe.js` · `memories.js` ·
`media.js` · `briefing.js` · `core/briefing-window.js` · three extracted shared services ·
`tests/v3-subjects.spec.js` (22) + `tests/briefing-schedule.spec.js` (16) + 8 lane specs.

> **The registry inverted, and that was the design decision of the phase.** A subject now
> **builds** its node and `subjects/index.js` **mounts** it, rather than six modules each
> having an opinion about `replaceChildren`. The payoff is that "did anything actually
> mount" is checked in exactly one place — the check Phase 2 spent a whole review learning
> to make after both routes into depth 2 were found deepening into an empty lattice.
> `showSubject()` now returns `false | {speech, refs}` rather than a boolean, because one
> subject's words are not knowable in advance. `alerts.js` reads it as truthy and stores
> `Boolean(shown)`.

> ⚠ **A CLOCK IS NOT AN EXTERNAL CAUSE — and the fix is one line that is easy to leave out.**
> `core/briefing-window.js` gates the fire on `isPresent()`. The window is a PERMISSION; the
> person in the room is the cause. An empty kitchen at 5:35am gets nothing and the window
> stays open for its full `CATCHUP_MS`, which is doing real work here that it never did on
> the incumbent (where the briefing fired into an empty room and was over). It also
> subscribes to presence as well as ticking, so walking in at 6:10 opens it immediately
> rather than up to 30 s later. **Neuter-verified:** removing the gate fails exactly the
> test named for it.

> ⚠ **A new `show.*` intent cannot be added to the table — it will be shadowed, or it will
> shadow.** Every noun the six subjects answer to ALREADY belongs to a spoken intent higher
> up `localIntents.js` ("shopping list" → `list.shopping`, "what's playing" →
> `house.media`). The resolver therefore runs **before** the table and **only when a show
> verb is present**. And each new id **must carry an answerer in `localAnswers.js`**: the
> incumbent has no depth 3, so it reaches these ids and falls straight through to
> `answer()` — an id without one silently turns a working spoken reply on the wall into an
> Assist round trip. Two ids are silent by design and are named in the spec rather than
> inferred: `show.year` (the photographs are the answer) and `show.briefing` (its subject
> speaks its own opening). ⚠ An earlier draft matched bare `today` / `what's on` and quietly
> took "show me what's on today" off `cal.today`; the resolver's nouns are all **surface**
> nouns now, and a regression guard asserts seven spoken phrasings are untouched.

> ⚠ **A REAL PARITY BUG, found in passing and now fixed.** `houseSnapshot` returned the raw
> HA `entity_picture`, but `focusHero` reads that value out of a rendered `<img src>` which
> `mediaPanels` had already put through the image proxy. So the media candidate on V3 was
> carrying a URL that would never load — nothing threw, and it would have surfaced as "the
> artwork is broken on V3 only" long after the cause was forgettable. One resolver
> (`services/mediaImage.js`), imported by both. **`tests/house-snapshot.spec.js:284` was
> pinning the bug** and now pins the resolved URL with the reason written down.

> **Three services extracted, following Phase 3's `alertRouter` precedent** — two surfaces
> needing the same answer is the trigger, every time. `services/briefingSchedule.js` (when a
> briefing is due; `morningBriefing.js` refactored onto it with behaviour unchanged),
> `services/mealEvent.js` (tonight's dish — the `Meal:` regex had **four** copies; two are
> converted, `modules/calendar.js` and `modules/recipePanel.js` still carry their own),
> `services/mediaImage.js`. ⚠ **The briefing's fired-today key is deliberately NOT shared:**
> both surfaces are served from the same origin, so one key would let the incumbent's 5:35
> briefing mark V3's as done. V3 uses `dashboard:briefing-fired-v3`.

> ⚠ **`/api/recipe` is the one billable leg in Phase 4** — a dish with no cache entry costs
> one Claude web search. Same trade the incumbent's dinner panel has always made, and the
> cache is shared, so asking out loud cannot cost more than the panel was going to spend.
> Worth knowing rather than discovering on a bill.

> **`show.tonight` and `show.day` both open the calendar.** The plan's original four `show.*`
> ids predate the six subjects, and "what about tonight" is a question about the evening's
> shape — the calendar's answer, not the recipe's.

New debug handles: **`__v3Refresh()`** (await both halves of the prefetched cache — the boot
tick reads a cold one and six subjects read it), **`__v3Subject(id, slots, snapshot)`**
(mount any subject against an INJECTED snapshot, without speaking and without changing
depth), **`__v3Briefing({now}|{force})`**, and `__v3().briefing`.

⏳ **Owed on Phase 4:** never seen by eye; no GPU reading; and **the contrast sweep still
only visits `/`** while Phase 4 has added far more V3 text than existed when that gap was
first noted. `.subject__caption-sm` over a photograph is the likeliest worst case.

### Phase 5 — Ambient parity

| # | step | size |
|---|---|---|
| 5.1 | ✅ **DONE** — but not as written; see the correction below | S |
| 5.2 | **Immich asset filter** — see the open defect below | M |
| 5.3 | Decide the temporal spine's fate: D1 cell, part of the ground, or retired | M |
| 5.4 | Archive/memories as a ground mode, if wanted at all — V3 holds one photo per day *by design* (§5.1: time passing is not a cause) | M |

#### ⚠ 5.1 was mis-specified, and the correction is the useful part

**"Display off overnight. Port before any permanent flip" describes a job that was already
done, by something outside the repo.** Measured on the G11 before any code was written:

- **The panel already goes dark on V3.** DPMS is a property of the X display, not of the URL
  Chromium happens to be showing, and the `dashboard` crontab survived the Pi→G11 migration
  intact (`0 21 * * * DISPLAY=:0 xset dpms force off`, `0 5 … force on`). `GET
  /api/display/state` on the live box: `dpmsEnabled: true`, window 21:00→05:00. It has been
  powering V3's panel down all along.
- **The incumbent's `modules/energySaver.js` is very nearly a no-op.** Its only real effect
  is an HA switch toggle gated on `homeAssistant.energySaver.monitorEntityId`, which is `""`.
  What remains is a body class that paints the background black and hides three views V3 does
  not have. **The 91 lines this step was sized against would have ported to nothing.**

So the real gap was never "turn the panel off" — it was the two things that follow from the
panel being off, and V3 had neither:

1. **The surface kept moving in the dark.** DPMS fires no `visibilitychange`, so nothing told
   the page. The substrate's rAF loop is the only continuously-running thing in V3, and on a
   windy or rainy night it ran at 15fps until 05:00 for a dead panel in an empty room — the
   calm law's plainest possible violation, in the one situation where the room can see
   *nothing at all*.
2. **Nothing could light the panel** (audit SS4). V3 sharpens this beyond the incumbent:
   `core/alerts.js` is the one path that puts itself on the wall unasked, so a 3am doorbell
   forced depth 3, mounted the camera and spoke out loud to a powered-down screen. The
   picture is the half that matters and it was the half nobody saw.

**Built:** `src/v3/core/display.js`, `setPaused()` on both substrate backends, and
`services/displayWindow.js` — the midnight-wrap extracted so the route and the browser share
one answer rather than two copies (the `alertRouter` precedent again).

⚠ **The clock triggers, X decides.** The audit records two boot-time actors running
`xset -dpms`; they are losing today, and that is the **only** reason the crontab can blank the
panel at all. A client that trusted the clock would, the day one of them wins, freeze the
atmosphere every night on a fully lit 32" panel — which reads as a broken dashboard, not a
broken assumption, and would be blamed on V3. So the window says when to go and *ask*, and X's
own `monitor` reading answers. **Every unknown — no window, no route, no `xset` — fails
towards LIT.**

⚠ **`initSubstrate` holds the paused flag itself, not just the backend.** The context-loss
path *replaces* the backend, so a GPU reset at 3am would otherwise resume a 15fps loop against
a dark panel and leave no trace by morning.

⚠ **Two flags, two different questions.** `features.v3EnergySaver` is whether V3 knows about
the panel at all. Waking *additionally* requires the existing `features.displayWake`, because
"may a security event light the panel" is a decision the incumbent already publishes and the
household already made — **security events only, never kitchen presence** (someone up at 2am
for a glass of water should not get a 32" dashboard in the face). Flipping `displayWake` on
enables it on **both** surfaces at once, which is correct and worth knowing.

### Phase 6 — The invisible layer — ✅ **COMPLETE 2026-08-09**

Watchdog, self-heal, health indicator, system status. No surface, but the box degrades
silently without them. **Explicitly scheduled so it is not forgotten.**

⚠ **THIS ENTRY WAS WRONG IN THE SAME WAY 5.1's WAS, AND THE CORRECTION IS MOST OF THE
VALUE. The watchdog and the self-heal already run on V3, and always did.** Both are
**server-side** — `server/services/healthService.js` and `recoveryService.js`, started from
`app.listen` and driven by the Home Assistant manager. Neither knows or cares which URL
Chromium is showing. Verified live on the G11 before a line was written: both log their
start lines, `/api/system/health` reads `overall: "ok"`. **A faithful port of either builds
nothing.**

The one way a surface change could have broken this was checked and is clear. Six of the
eight feeds are server- or HA-driven, but **two are request-driven** — `weather`
(`staleMs` 45 min) and `calendar` (2 h) only mark themselves healthy when their routes are
actually hit, and on the incumbent it is the *page* that hits them. V3 does too:
`refreshHouseCache()` fetches `/api/weather/now` and `/api/calendar/all` every 300 s, which
is 9× and 24× inside those thresholds. Had it not, the watchdog would have pushed a false
"Calendar degraded" to the owner's phone caused purely by the surface flip.

**What was actually missing was the room.** Every escalation path is a phone push, with two
holes that V3 made total rather than partial:

1. ⚠ **`wan` is `notify: false` BY DESIGN** — a push about the internet being down would
   travel over the internet that is, by hypothesis, down. It is *display-only*, and V3 had
   no display. **The one fault that can only ever be seen was the one V3 could not show.**
2. Quiet hours suppress every push 22:00–07:00, so an overnight degradation is display-only
   too, whichever feed it is.

**Built:** `v3/core/health.js` — an error-level feed becomes a candidate via `announce()`
and rides the attention queue, the seam Phase 3.3's arrival used. Not a corner chip: V3's
four corners already have owners (hour BL · rail BR · title TL · transcript TR), and a
degraded feed is a **cause**, which V3 already has a path for. It adds **no new writer of
the glance cell** — a second writer is how Phase 2's ownership bug happened. Score **72**
(High band) so it earns depth 1 only when someone is in the room, and it **never speaks**.

⚠ **ONE CAUSE, NOT THREE SYMPTOMS.** `worstFault()` ranks `wan` above everything it breaks,
lifting healthService's own reasoning: with the internet down, weather + AI + calendar all
fail separately and a wall printing three lines about one fault is worse than one line.

**Also built:** `v3/subjects/status.js`, the **ninth** depth-3 subject — "show me the
status" gives feeds, the self-heal log and the box's own line, full bleed.

⚠ **`show.status` had a precedence trap the other `show.*` ids did not.** The noun was
already spoken for — not by the intent table, which has no status intent, but by
`voiceCommands.js`'s `NAV_KEYWORD_MAP`, which matches a bare `"status"` and switches the
incumbent to its status view. **`matchIntent` runs BEFORE `matchNav`**, so the moment the
table learned the word, the incumbent's status view became unreachable by "show me the
status" — silently, falling through to Assist. Fixed the way `show.sky` already was: an
explicit branch in voiceCommands. **The spec now reads that file** and requires the branch,
because the "handled by the incumbent" list is a claim about a file it cannot see.

⚠ **The subject carries its own `speech`** (the briefing's precedent) — the box's health is
a server reading and is not in the voice snapshot, and does not belong there.

⚠ **A 200 carrying `feeds: []` is silence, not a clean bill of health** — found by trying to
neuter the guard and discovering a null check did not catch it. Without a length clause the
readout mounts a titled panel with no rows and says "Everything's healthy" out loud. Fifth
instance of absent-is-not-empty in this codebase.

---

## Open defect, promoted by V3

**The ground photo has no content filter.** The first real V3 ground on the wall was a
screenshot of a parcel-locker website — map, "Return locations" tab and all. `ground.js`
pulls a random asset from `/api/immich/asset/{id}/thumb`.

On the incumbent a junk asset was one frame in a rotation. On V3 the ground **is** the
screen and it is held all day by design. The long-deferred "Immich asset filter" item is now
a front-of-house defect. It is listed as 5.2 but is worth doing early — it is the single
most visible thing about V3 and it is currently embarrassing.

---

## The parity bar

What must be true before the wall flips permanently. Until then `/v3/` stays a lab surface
and the flip stays a URL.

- [x] Depth moves without speech (Phase 1) — ✅ `3efb426`, demonstrated live
- [x] Motion wakes the surface (3.2) — ✅ falls out of 1.4/1.5; still wants a real-event sighting
- [x] Doorbell reaches the screen unasked (3.1) — ✅ `c20525a`; **wants a real-doorbell sighting**
- [x] Depth 2 renders something (Phase 2) — ✅ `7d89002`; **not yet seen by eye**
- [x] The eight subjects exist (Phase 4) — ✅ `b65085c`; **not yet seen by eye**
- [x] The briefing arrives without being asked (3.4) — ✅ `b65085c`, presence-gated
- [x] Display sleeps overnight (5.1) — ✅ and it always did: the crontab, not the page. What
      landed is V3 *knowing* it: substrate paused while dark, and the door able to ask for the
      panel back. ⏳ **Flag-off; owed a flag-on verification at/after 21:00 on the real panel**
- [ ] Ground never shows a screenshot (5.2)
- [x] Watchdog + self-heal running (Phase 6) — ✅ and they always were: both are
      server-side and surface-independent, verified live. What landed is V3 *showing* it —
      the announced fault line and the status subject. ⏳ **Owed: a real degradation seen on
      the glass; every reading so far is a stubbed feed.**
- [ ] 72 h soak clean — heap, DOM, listeners at or below t0
- [ ] Quiescent ≤8% of one core, live ≤25%, peak ≤35% — **not re-measured since the engine
      and the SSE landed; the old A/B predates both**
- [ ] Seen by eye on the actual panel — every V3 verification so far is a headless read

## Measuring V3 without taking the wall

The lever that does **not** cost the household its dashboard. A second Chromium on the G11,
headless, on its own port and its own profile — `/v3/` against real house data while the wall
keeps running `/`:
```
/usr/bin/chromium --headless=new --remote-debugging-port=9223 \
  --user-data-dir=/tmp/v3probe-profile --no-first-run http://localhost:3000/v3/
```
⚠ The separate `--user-data-dir` is **not optional**: the kiosk's profile is
`~/.config/chromium`, and sharing it opens a tab on the wall.
⚠ `scripts/kiosk/kiosk-eval.cjs` hardcodes port 9222 — copy it and parameterise the port.
⚠ Killing it: never `pkill -f` (see CLAUDE.md). Iterate `ps -eo pid,args` and check each
`/proc/$p/cmdline` for the profile name — the first PID you find is usually a child.
⚠ The boot tick reads a cold HTTP cache, so the first `__v3().attention` is empty and looks
broken. Call `__v3Tick()` first.

V3 debug handles: `__v3()`, `__v3Tick()`, `__emitHaState(entity)`, `__v3Presence(bool)`,
`__depth()`, `__setDepth(n)`, plus the engine's own `__forceCandidate` / `__refreshAttention`.
⚠ **Depth 2 needs `__v3Presence("dwell")`**, not `true` — dwelling is 30 s of sustained
presence and the spread is gated on it, so `true` alone will only ever show you a glance.

## Flipping, and getting back

Runtime, no root, instant — this is the lab lever:
```
Page.navigate → http://localhost:3000/v3/     # and back to /
```

Durable — needs the owner's password; passwordless sudo covers only four `systemctl` verbs:
```
sudo sed -i 's#--kiosk http://localhost:3000 #--kiosk http://localhost:3000/v3/ #' \
  /etc/systemd/system/dashboard-kiosk.service && sudo systemctl daemon-reload
```
Rollback is the reverse `sed`. **Leave the durable layer pointing at `/` for now** — it
means any Chromium restart self-heals back to the working house.

---

## Traps carried forward

- ⚠ A `Log.enable` set before `Page.navigate` blames the **old** page's teardown on the new
  one. Verify with `Network.enable` + a clean reload before believing any error.
- ⚠ **Absent is not empty.** Three bugs in one day from returning `[]`/"Nothing on today"
  when the upstream was merely down. `houseSnapshot` touches every data path in the house —
  this is where that bug class will breed. Return `null` and let the turn fall through.
- ⚠ A flat test image cannot catch a scrim bug; drive a gradient. More generally: a green
  test that passes with the fix neutered is worth nothing.
- ⚠ Contrast: check **which** node is worst, not just that the gate passed. `--ink-faint`
  can never reach 7:1 (ceiling 4.29 day / 3.16 night).
- ⚠ Any bundle deploy restarts a soak clock, as does a CDP navigate. Check `uptimeMin`
  before touching the kiosk.
