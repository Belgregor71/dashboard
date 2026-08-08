# V3 Migration — bringing the house onto the new surface

**Status:** **Phase 1 complete and live (`3efb426`, 2026-08-08).** Written 2026-08-08, after
the wall was flipped to `/v3/` for ~15 minutes and pointed back. See
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

**B · SUBJECTS** — depth 3, one thing full-bleed. Camera and radar are **built**. Six
remain: calendar, recipe, memories, media, briefing, lists.

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

### Phase 2 — The composer

Depth 2 currently renders an empty lattice. `e3e9630` had to add a guard so it could not be
*entered* empty and black the wall out mid-sentence — that guard is a placeholder for this
phase.

| # | step | size |
|---|---|---|
| 2.1 | `core/grammar.js` — 12×7 module grid, the fixed legal rectangles, ~6 named templates | M |
| 2.2 | `core/composer.js` — pick a template from the ranked queue; never free-form | M |
| 2.3 | Haiku authors **words only**, never placement; `personality.phrase()` on failure | S |

**Invariant:** layout composed by rules, language composed by the model. This is the whole
defence against slop and against destroying learnability, and it is not negotiable.

### Phase 3 — The events that must interrupt

The household-critical ones. All small, because the camera subject already exists.

⚠ **Phase 1 already did part of this.** An `interrupt` candidate reaches D1 with nobody in
the room, and `cameraTriggerCandidate` already exists in `candidateSources.js`. So 3.2 is
largely done, and what 3.1 still owes is the forced depth **3** subject, not the wake.

| # | step | size |
|---|---|---|
| 3.1 | Doorbell → forced D3 camera subject with decay (`doorbellAlert.js` is 104 lines, 1 DOM ref) | S |
| 3.2 | Camera motion trigger → D1 glance — mostly covered by 1.4; verify rather than build | S |
| 3.3 | Arrival greeting → D1 (⚠ `arrivalGreeting.js:289` still has no minimum-away guard) | M |
| 3.4 | Morning briefing at its window → D2 | S |

**Done when:** someone at the door puts the door on the screen without anyone asking.

### Phase 4 — The remaining subjects

Six depth-3 modules against the built pattern in `subjects/index.js`. Each owns its mount
and must tear itself down on leave — a subject left mounted holds its MJPEG connection open
forever.

Calendar · Recipe · Memories · Media · Briefing · Lists — S–M each, parallelisable.

### Phase 5 — Ambient parity

| # | step | size |
|---|---|---|
| 5.1 | **Energy saver** — display off overnight. Port before any permanent flip | S |
| 5.2 | **Immich asset filter** — see the open defect below | M |
| 5.3 | Decide the temporal spine's fate: D1 cell, part of the ground, or retired | M |
| 5.4 | Archive/memories as a ground mode, if wanted at all — V3 holds one photo per day *by design* (§5.1: time passing is not a cause) | M |

### Phase 6 — The invisible layer

Watchdog, self-heal, health indicator, system status. No surface, but the box degrades
silently without them. **Explicitly scheduled so it is not forgotten.**

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
- [ ] Doorbell reaches the screen unasked (3.1)
- [ ] Depth 2 renders something (Phase 2)
- [ ] Display sleeps overnight (5.1)
- [ ] Ground never shows a screenshot (5.2)
- [ ] Watchdog + self-heal running (Phase 6)
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
