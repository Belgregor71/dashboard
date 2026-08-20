# Priority Backlog — post-cutover

**Written 2026-08-14** against `855cf49` (working tree clean, nothing unpushed).
Every item below was **verified against current code**, not carried forward from a doc.
Where a doc and the code disagreed, the code won and the doc is flagged for correction.

Ordering: **security → new features → the measurement debt that gates them → cleanup.**

> ## ✅ P0, **F1**–**F5**, **F7**, **F8**, **P4** and **M1** ARE CLOSED. **F6 is half done.**
> **F4 was rebuilt on V3 2026-08-18 and owes only its GPU reading and the panel's verdict** —
> it is flag-off until someone has looked at it in daylight.
>
> **2026-08-15 — F3 is closed, and it was not a flag chore.** Two of its three flags were
> **dead levers**: `motionWakeGate` has 0 occurrences in the V3 bundle and is now retired
> unflipped, and `robotCandidate` had 0 because `houseSnapshot()` never read it. Chasing the
> second found the defect worth the session: **two readers were handed an ARRAY when they are
> keyed by entity id**, so `bomWarning` has been permanently empty since the cutover — and
> `bom` (95, interrupt) is the only candidate that survives an empty room. **The wall could
> not tell you a storm was coming.** Fixed, gated, four new specs. `gamingQuiet` skipped on the
> owner's call. 🔑🔑 **`grep -c <flag> dist/assets/v3-*.js` before touching any flag in this
> file** — byte-identical-when-off is trivially true when neither state is reachable.
>
> **2026-08-15 — F5 is closed: all four owed sightings have now been watched.** Two were the
> owner's (the spoken veto, a real doorbell); two were driven this session. The tool lane
> moved a physical floodlight for the first time, and inducing a genuine TTS outage put a real
> fault on the glass. Both found things no test could have: **`[]` from HA is not a failure**
> (Eufy reports state asynchronously), **"turn on the X" can never reach the tool lane**
> (`MUTATION_RE` sends it to Assist), the **NAS is only the TTS fallback** so stopping it
> proves nothing, and **on-demand health feeds are reported from a stored level** that lags a
> minute behind the truth. Read the item.
>
> ⚠ **Left open on purpose:** the house voice says "backyard light's on now" when the device
> never responded, and it cannot currently know better. Four of five floodlights ignore
> `switch.turn_on` entirely — a **new and separate** fault from the dead cameras (the two sets
> barely overlap), so it needs its own item rather than being filed under motion divergence.
>
> **2026-08-15 — F6's dominant cause was not the one this file assumed.** The crop arithmetic
> was right and was not the main event: `slim()` was deriving `aspect` from the **pre-rotation
> sensor dimensions**, so **32% of the day's pool was telling the ground a portrait was a
> landscape** — which meant the diptych, the feature built to protect portraits, never saw
> them. Fixed off a field that was already in the payload (`d710e99`), seen on the glass. The
> framing half remains and is now the smaller one. 🔑 **`archiveModel.js:110` had this written
> down in its own JSDoc the whole time** — the knowledge was in the repo, one module across.
>
> **2026-08-15 — F2 is closed** and it was not the three-hour dispatch-table chore it read
> as. The matcher was fine; what the driving found was a turn that threw away the fast lane's
> answer whenever a subject declined, and a debug hook that announced entities without ever
> writing them to the cache — which is why `media.js` had 0% coverage. Read the item.
>
> **2026-08-15 — the instrument is repaired.** It was dark on V3: every hook
> `kiosk-sweep.sh` drove was `undefined` on the wall, so it would have logged ambient three
> times and called one a peak. It is surface-aware now, it **refuses to sample** when a
> declared seam is missing, and `tests/kiosk-instrument.spec.js` keeps it that way. **F3 is
> unblocked**; one real sweep on the G11 is still owed, and it is a reading, not a blocker.
>
> ✅ **F4 is closed as of 2026-08-18** — the archive was rebuilt on V3's depth 0 rather than
> ported, and the year rail the owner missed is back. Flag-off pending the panel. (It was
> re-scoped on 2026-08-15 when the grep showed the archive did not exist in `src/v3/` at all.)
>
> **And the headline finding is that two of the three P0 items were already done** before this
> session began — H6 at the time of the audit, the security contract inside `api.spec.js`. Both
> were listed open here because of how they were looked for, not what was found:
>
> 🔑🔑 **A raw `grep` count is not a finding, and a filename is not coverage.** S2 was counted
> off 34 `innerHTML` hits without asking which interpolate upstream text (five do; all five
> escaped). S3 was declared uncovered because no file was *named* `security.spec.js`. The
> audit's own H6 estimate ("47 sites, mechanical, ~4 h") was made the same way, so this is the
> second time this specific mistake has been paid for. **Read what the code does before
> recording what it lacks.**
>
> Net real work: one dependency fix, and five assertions closing three genuine
> never-asserted invariants. Suite **1190 → 1194**, 0 failed.

---

## P0 — Security ✅ COMPLETE

### S1 · `npm audit fix` — one live high advisory
**~15 min. Do this first; it is the cheapest item in the file.**

`npm audit --omit=dev` reports **1 high**: `fast-uri` 3.1.4 (host confusion via backslash
authority introducer, GHSA-7p8r-x3mc-p8w7), reached via `ajv@8.20.0`. This is a *new*
advisory — the original four from the audit (C1) are all closed.

Transitive and not directly reachable from our own code, so the risk is low — but the fix is
`npm audit fix` plus a suite run, and leaving a known high in the tree costs more in review
noise than it saves.

**Done when:** `npm audit --omit=dev` is clean and `npm test` is green.

---

### S2 · ✅ **DONE — and it was already done before this session started**

**H6 was closed at the time of the audit and its register was never ticked.** I listed it as
open here on 2026-08-14 off a raw grep count, which is the same mistake the audit made.

`tests/escape-html.spec.js` already existed, cites *"Audit 2026-07-26 S6/H6"* in its header,
and records the correct classification: of the 51 sites, most are `innerHTML=""` clears,
static shells, or numeric/date-only interpolations; **five genuinely interpolate
upstream-controlled strings, and all five escape.** Re-swept by hand 2026-08-14 — still true,
across `src/js` and `src/v3` both.

⚠ **Two corrections to what this file said in its first draft:**
- The `modules/screensaver.js` row claimed 2 refs from `src/v3/`. Those two hits are
  **comments** in `v3/core/presence.js:22,35` citing screensaver's `IDLE_MS` constants, not
  imports. **Zero** of the `innerHTML` sites are in V3's closure — the authority is the
  manifest in `tests/v3-closure.spec.js`, not a path grep.
- "None of it runs on the wall" is true but does **not** make it dead code: the incumbent
  tree is the documented rollback path (`V3_DEFAULT=0`, `V3-CUTOVER.md:504`). Cold standby,
  not deletable. This weakens **C3** below — read it again before acting on it.

**What this session added**, since the escaping discipline was real but only half-pinned:
three upstream-carrying sites used a **local** escaper rather than the shared helper
(`cameraTiles.js` `escHtml`, `recipePanel.js` its own `escapeHtml`) or took upstream text raw
for a correct reason (`mediaPanels.js`'s detached-`<textarea>` entity decoder, `699d1d8`).
The old spec's comment waved all three through as "already escaped" without asserting it — and
a local helper is easier to drop in a refactor than an imported one, because deleting it
breaks no import. Four assertions added, **each proven red by neutering the thing it guards**.

⚠ **A regex cannot do this job in general — do not try again.** A scanner rule was written
and thrown away the same session: it fired on **18 sites that are all correct**, because
separating upstream-derived strings from locally-computed ones (`bucket.label`, `iconId`,
`points.join(" ")`) is a taint analysis. `scan-patterns.mjs`'s own principle applies —
*a rule nobody trusts gets disabled*. The narrow source-reading spec is the durable form.

---

### S3 · ✅ **DONE — and this one was already covered too**

⚠ **The claim in this file's first draft was wrong, and how it was wrong is the part worth
keeping.** It said *"no spec covers it — only `tests/api.spec.js` mentions Origin; there is no
`tests/security.spec.js`."* That was a **filename search reported as a coverage finding**. The
coverage was there all along, at `tests/api.spec.js:122-220`, which is exactly where this
repo's convention puts it — *"when adding a server route, add its contract test in the same
change"*. Absence of a file named after a concern is not absence of the concern.

Already covered, 14 tests: helmet's headers; CSP report-only **and** its directives **and** the
absence of `upgrade-insecure-requests` on a plain-HTTP LAN; the loopback rate-limit exemption
(asserted as an exemption, with the measured reason a real ceiling would throttle the kiosk);
the foreign-origin CORS grant plus the preflight 403; **eight** distinct cross-origin write
vectors; the `Sec-Fetch-Site`-only browser; and the kiosk's own same-origin write still
passing. `loopbackOnly`'s LAN leg is a **documented** gap — the test client is loopback, so it
is proved live on the Pi instead (`api.spec.js:807`).

**What this session added — the one genuinely unasserted invariant.** `security.js:158` calls
the mount ORDER load-bearing: `applySecurity` (`server.js:90`) must stay above
`express.json({ limit: "256kb" })` (`:91`), so a rejected write is never parsed. Nothing
checked it.

🔑 **Reversing those two lines left all 14 other security tests green.** Every body they send
is small and legal, so both orders agree on all of them — the invariant would have gone
quietly, which is this repo's recorded order-invariant shape (the `entityFeed` cache-before-
broadcast lesson). An **over-limit** body is the only discriminator: guard-first returns
**403** and never reads it; parser-first returns **413**, having buffered a quarter-megabyte
for a request it was always going to refuse. Beyond one wasted read, that is the shape that
lets an attacker page make this box do work before it says no.

Proven red by actually reversing the two lines in `server.js` — not by neutering the test.

---

## P1 — New features

Everything here is **already built**. None of it is new code of consequence; all of it is
waiting on a live verification that nobody has run. That makes this the cheapest feature
value in the repo.

### F1 · ✅ **DONE 2026-08-14 — flipped, and seen across a real 21:00 transition**

Verified flag-on **before** the default moved (CDP-injected via a `window.CONFIG` setter, no
deploy), then shipped. At 21:01 X's own `monitor` read `off`, `data-panel-dark` → "1",
substrate paused. The saving is measured: **15.0 fps → 0 frames** in the next 30.6 s,
gpu-process **5.9% → 0.0%** of one core, renderer **5.3% → 0.0%**. A synthetic doorbell then
took the whole path back: X `off` → `on`, `wakes` 1, depth 3 `alert:doorbell`, substrate
resumed, and it fell back on its own after the 90 s hold.

🔑 **The flip's real risk was the SUITE, not the panel.** Default-on means every V3 spec that
does not stub `/api/**` fetches `/api/display/state`, and no dev box has `xset` — so inside
the off-window `monitor: null` is not `"on"` and the substrate pauses. Forcing the window to
cover the whole day: **245 tests across all 23 V3-booting specs stayed green**, and a
throwaway probe proved the dark path was actually *reached* rather than passing unlooked-at.

⚠ **This is the flag that made `displayWake` real** — it has been on since 2026-08-08 and had
never taken effect, because `/` serves V3. And `displayWake`'s "six triggerEntityIds /
driveway / backyard at 3am" warning describes the **incumbent**: V3's night-wake scope is
`alertRouter.LOCATIONS`, **three** entities, doorbell + side gate only. Zero wakes across the
previous night's whole off-window, with the doorbell sensor confirmed alive.

<details><summary>original item</summary>

**~1 h, at/after 21:00, on the real panel.**

`src/js/config.js:1025` is still `false`. The feature is complete — `v3/core/display.js`,
`setPaused()` on both substrate backends, `services/displayWindow.js`. It is the **last
actionable unticked box on the V3 parity bar** (`docs/design/V3-MIGRATION.md:511`).

What it buys: V3 currently animates its substrate at up to 15fps against a **powered-down
panel** all night — the calm law's plainest violation, in the one situation where the room can
see nothing at all.

⚠ Also needs `features.displayWake` (already `true`) for the wake half. ⚠ Every unknown in
this path fails **towards LIT** by design — do not "fix" that if a probe reads lit.

**Done when:** seen paused after 21:00 on the real panel, and a security event still lights it.

</details>

---

### F2 · ✅ **DONE 2026-08-15 — all three driven end to end, and two defects were under them**

**The matcher was never the problem.** All three ids resolve from real phrases and always did
("show me the radar", "what about tonight", "show me what's playing"), and nine tests now
drive each the whole way — transcript → `matchIntent` → registry → mounted node → depth 3.
What the driving found was two silent defects, both invisible to every check run so far, and
each proven red by neutering the thing it guards:

- 🔑 **A subject that DECLINES threw the fast lane's answer away.** `voice.js` fell straight
  to HA Assist when `showSubject()` returned false — so `show.media` with nothing playing (the
  exact state measured on the wall at 06:44) took a **2-4 s round trip to an agent that does
  not own the question**, in place of "Nothing's playing." in 0.015 ms. *Nothing to SHOW is
  not nothing to SAY.* The answerers already are the absent-is-not-empty authority, so a cold
  cache still falls through untouched.
- 🔑🔑 **`__emitHaState` never wrote the entity cache** — it emitted `ha:state-updated` only,
  while `entityFeed.js`'s own header calls the cache-before-broadcast order load-bearing. A
  probe could announce a playing `media_player` to the page and every **reader** —
  `houseSnapshot`, `voiceSnapshot`, the attention queue — still described the house as it was
  before it. **That is why `media.js` was the one V3 file at 0% coverage: it was undrivable**,
  and it declined every single time it was asked. Same disarmed-instrument shape as M1, third
  time now.
- **`media.js` also carried its own copy of the now-playing precedence**, and the copy never
  learned what the ambient band learned on 2026-08-13: a Plex session names the **room**. The
  band said "Lounge Room TV" and the depth-3 subject said "Playing" about the same stream.
  `playingFrom()` is imported now, not repeated.

⚠ **One phrase is deliberately not the subject's:** `show.tonight`'s own `what's (on )?tonight`
alternative is unreachable — `cal.today`'s `what.s on` sits seven rows higher and eats it.
Left alone on purpose and now pinned by a test: that question is answered out loud in a fifth
of a second, and taking the whole wall to depth 3 for it would be the calm law's plainest
violation. "show me tonight" / "what about tonight" / "what's tonight" all reach the subject.

⚠ `tests/local-voice.spec.js`'s "handled by the incumbent" list is **corrected, not deleted**:
it describes the rollback surface (`V3_DEFAULT=0`), not the wall.

#### ✅ And then it was driven on the actual glass — which found three more

All three mounted, spoken, on the G11, 2026-08-15 (`scrot` for each). `show.sky` at depth 3
with 18 tiles, `show.tonight` reading "SATURDAY 15 AUGUST · 6pm Steak with Peppercorn Sauce"
(the `Meal:` prefix correctly stripped), `show.media` declining and **speaking** for the first
time. Looking at them cost about ten minutes and found three defects, which is the same rate
as the Phase 5 viewing:

- ⛔ **The radar threw away 44% of the map.** Tiles are 256×256 and a 3×3 mosaic is a SQUARE
  map; it was stretched over the whole 1920×1080 panel, so each cell was 640×360 and
  `object-fit: cover` cropped 140px off the top and bottom of every tile — nine strips butted
  together and passed off as a continuous coastline, with the house nowhere near the centre.
  Now 1080×1080 centred; Brisbane sits in the middle where `buildTileGrid` always put it.
  🔑 **Only a geometry assertion could have caught this** — every tile loaded, the grid had its
  nine children, and a map has no text to read.
- ⛔ **The house said "TV."** `mediaSource.js` names THREE readers that must share the
  TV-audio rule and its spec asserted TWO; `voiceSnapshot` never had it. Live:
  `media_player.living_room` playing with `source: "TV"`, the screen correctly showing nothing
  playing, the voice answering "TV." 🔑 **A test that enumerates N things and asserts N−1 is
  worse than one that asserts nothing, because it reads as coverage.**
- ⛔⛔ **A declined subject left the wall HELD at depth 3 with nothing in it** —
  `{depth: 3, held: true, subject: null, mount: 0}`, a blank stage owning the whole screen for
  30 s and re-armed by every repeat. `showSubject()` empties the stage before it looks the new
  id up, and **`deepen()` falls through to `sustain()` for a shallower target** — the trap
  Phase 1 wrote down and did not close. Reachable from every lane, not just the new one.

---

### F3 · ⚠ **NOT a flag chore — two of the three were DEAD LEVERS, and a real defect sat under one**

**`gamingQuiet` skipped on the owner's call (2026-08-15) — no value seen in it.** The other
two were both picked up, and neither could change what is on the wall. Same class as F4, and
that now makes **three** flags in this file whose premise the cutover quietly invalidated.

| Flag | Occurrences in `dist/assets/v3-*.js` | Outcome |
|---|---|---|
| `motionWakeGate` | **0** | **RETIRED unflipped** |
| `robotCandidate` | **0** (before the fix) | left **off**, but it is a real lever now |
| `gamingQuiet` | — | skipped, owner's call |

🔑🔑 **A flag whose code is not in the bundle the wall loads is not "unflipped", it is
decorative** — and the flag-off-is-byte-identical property that made both look cheap is what
hid it: byte-identical is trivially true when neither state is reachable. `grep -c <flag>
dist/assets/v3-*.js` is one command and answers this before any of the rest is worth doing.

**`motionWakeGate` — retired.** It lived in `cameraPopupOverlay.js`, which V3 does not import.
V3's only unasked wake path is `core/alerts.js` → `services/alertRouter.js`, whose entire
trigger set is three entities: `doorbell_ringing`, `doorbell_person_detected`,
`side_gate_person_detected`. **Plain motion cannot reach the panel on V3 at all**, so the
gate's own rule is already structural and stricter than the gate. The flag and its branch are
gone; the *measurement* that justified it (61 camera wakes/24h, 49 plain motion, driveway 33)
is preserved in a note in the module, because it is still true of the incumbent. Its spec
became `tests/camera-popup-trigger.spec.js` — the three ungated cases are kept deliberately,
since `V3_DEFAULT=0` is a one-line rollback and that chain should not come back untested.

**`robotCandidate` — the flag was dead for a different reason, and finding out why found a
real bug.** `houseSnapshot()` builds both an array and a map of the entity cache and handed
the **ARRAY** to the two readers that are keyed by entity id. Nothing throws: `getBomWarnings`
looks up a numeric index that cannot exist, `robotAttentionFrom` regex-tests `"0"`, `"1"`,
`"2"`… against `/roborock/i`. Both return a cheerful empty answer — the exact "absent read as
empty" failure this module's own header warns about.

⚠⚠ **The robot was the cheap half. `bom` is the ONLY interrupt-band candidate (95) that
survives an empty room** — `selectForMode` filters AMBIENT down to `c.interrupt` alone — so
since the cutover **V3 has had no way to break through to an empty room to say a storm was
coming.** Fixed in `c6ddb87`; the incumbent was never affected (`focusHero.js:120` passes
`getAllEntities()`, which is the map). The robot read is gated on the flag **in the same
commit**, because the live house has three overdue consumables today and repairing the shape
alone would have flipped a default-off feature on by side effect.

🔑 **Why 1309 green tests sat on top of two dead readers:** every case in
`house-snapshot.spec.js` asserted what a COLD path produces, and empty is the *correct* answer
when HA is disconnected. Disconnected was the only state anyone ever tested. Four specs added
that can produce the defect; all four fail without the fix.

⏳ **Still owed:** the ambient/peak rows on the G11 for `HOST-BASELINES.md`. Not a blocker for
anything above — F3 needed no new baseline in the end, because it shipped no new cost.

**New item spun out:** `sensor.roborock_s7_maxv_dock_dock_error = "duct_blockage"` on the live
house — a real fault the house knows and nobody is told. `ROBOT_PROBLEM_LABELS` covers only
the three water binary sensors, so the dock's own error enum is invisible to every surface.

---

### F4 · Ambient Archive — ✅ **REBUILT ON V3 2026-08-18. ⏳ Not yet seen on the wall.**

**Built, suite +28 green, behind `v3Archive` (default-off).** The owner's call on the
2026-08-15 re-scope was **port it**, and not as a port: the two complaints about what
shipped were structural, so depth 0 gets a rebuilt composition rather than the old one
moved across.

- *"The background tiles were too many"* — the echo was a 2900×1800 plane tiled at 620×349,
  ~30 repeats. Now **two large ghosts** bleeding off opposite edges, which is what the
  reference frames actually do.
- *"The year rail got lost"* — it had been **deleted** (`38f0320`), after two year-axis
  builds were rejected on the panel. It is back and bold, and it is not those two: it draws
  **the years this date reaches** with the card's own year lit, off `ground.poolYears()`,
  and it takes the empty top band so the card keeps its full 1040×609 box.

Files: `src/v3/core/archive.js`, `src/v3/css/archive.css`, `tests/v3-archive.spec.js`, plus
`poolYears()`/`frameParts()` on `ground.js` and one line in `main.js`. Design record:
`docs/design/AMBIENT-ARCHIVE.md` → *The V3 rebuild*.

**Three things came out of it that are not the feature:**

- 🔑 **A real defect in `ground.js`, not the archive.** Its second `onPhoto` fires from a
  timer armed a whole settle earlier, so a slow ambient dissolve interrupted by a brisk veto
  delivers the **old** frame's hand-off last — the scrim re-solved for a photograph that had
  gone and the archive put it back on the card. Guarded; spec proven red by injection.
- ⚠⚠ **A spec passed twice against a deliberately injected defect.**
  `expect(path).toContain(id)` with single-letter fixture ids matched incidental letters in
  `/api/immich/asset/…`. It compares a path segment now. *Injecting the defect is the only
  reason this was ever known.*
- ⚠ **`oklch()` does not resolve through `ctx.fillStyle` alone** — it round-trips the same
  string. The colour has to be painted and the pixel read back.

**What is left, and the last one is the gate:**

1. **The §5.4 reading, at 0 h / 24 h / 72 h**, into `HOST-BASELINES.md` as a *V3 archive —
   depth 0* row. Depth 0 moves from the quiescent band (≤8%) to live ambient (≤25%); both
   `compose.css` and `DESIGN_SYSTEM.md` §5.4 now say so, and neither has a number yet. It
   should cost **less** than the ~21% the incumbent measured — two ghost layers instead of a
   ~30-tile plane, the crush filter split off the animated wrapper, and the loops gated off
   `data-panel-dark` — but that is a prediction, not a measurement.
2. **The Live Photo burst** (`ambientArchiveMotion`, `archiveMotionLoop`) is still
   incumbent-only. Deferred behind the reading above, not forgotten.
3. ⏳ **JUDGE IT ON THE PANEL, IN DAYLIGHT, BEFORE FLIPPING.** Deployed flag-off and proven a
   no-op on the wall 2026-08-18, then driven flag-on over CDP: **eleven years on the strip**
   off the live library (2012 and 2020 genuinely absent, which is the argument for placing
   labels by value), a portrait card at **457×609** fit exactly to the print, and `anims` 0 at
   depth 3 — the cause-binding seen on the glass rather than asserted. ⚠ **The 457px card is
   the first thing to look at**: it is 45% of the reference's width, and "the photograph is
   the point of a screensaver" is what killed rejected build 1. Both earlier year rails were
   rejected within the hour of being looked at, and this is the third. A night capture will
   lie: the plate and the engraved year hide at night by design, so the right two-thirds
   reads empty and overstates the problem.

<details><summary>the 2026-08-15 re-scope this closes</summary>

**The estimate below is wrong and the item is bigger than it reads.** Verified by grep across
`src/v3/`: the ambient archive does not exist on the V3 surface at all — one hit, a CSS
comment. `archiveMotionLoop` is an *incumbent* flag, and `/` has served V3 since the cutover,
so flipping it changes nothing on the wall. The same fact retires `heap-metrics.cjs`'s old
liveness block (fixed; see M1) and explains why it has been "not assessable" ever since.

So F4 is not "flip a flag and take a GPU reading". It is either **a port of the archive onto
V3** (real work, real design questions, and V3's ground already answers much of what the
archive was for) or **a decision to let it stay an incumbent-only feature**. That is the
owner's call and it should be made before any of the open judgements below are chased —
every one of them assumes a surface that is not on the wall.

</details>

<details><summary>original item</summary>

**~3 h + a soak.**

`docs/design/HANDOVER-AMBIENT-ARCHIVE.md:3` still reads *"BUILT 2026-08-01, flag-off, not yet
seen on the panel."* Partly stale — `archiveFitToPrint` is now `true` — but
**`archiveMotionLoop` is still `false`** (`config.js:932`) and owes a GPU reading.

Open judgements from `AMBIENT-ARCHIVE.md:264`, all of which need a portrait memory on the wall:
the −12° yaw foreshortening (`--arch-deck-plane` is the one-line lever), whether the echo reads
as visible tiling on a bright frame (`brightness(.17)` assumes a dark one), and the §8.5 soak,
which is unstarted.

</details>

---

### F7 · ✅ **DONE 2026-08-15 — the lane has a day slot, and refuses the days it cannot reach**

**Built, suite green at 1246 (+10), both halves neuter-verified. ⏳ Not yet heard on the wall.**

`resolveDay()` in `localIntents.js` resolves today/tomorrow/weekday × morning/afternoon/
evening and attaches it as `slots.day`; `cal.today`/`cal.free`/`cal.tomorrow` read it. With no
day named every sentence is **byte-identical** to before, which is the rollback.

🔑 **The range is bounded by the FEED, not by the parser — and that is the whole reason the
refusal half exists.** `/api/calendar/all` expands recurring events only inside
`getRecurrenceWindow()` (first of month −7d → last of month +7d, `calendar.js:20`), while
one-off events arrive unfiltered. Past that window the feed is **silently incomplete**, so
"you're free" would be a lie of exactly the kind this item was about. Measured live:
**383 events, only 8 future days carry one, and nothing at all between 27 Aug and 19 Nov.**
A weekday can never resolve more than 7 days out and the window always reaches at least 7
days ahead, so every day the resolver *can* name is inside the complete part of the feed **by
construction**. Everything past it — a month, a date, "next week", "the weekend", anything in
the past — is **refused**, and the turn falls through to a lane that can reason about it.

Three findings that were not in the original diagnosis:

- ⚠ **"Next Tuesday" is genuinely ambiguous and cannot be parsed correctly.** Resolved as the
  nearest future occurrence, and the reply **says the date back** — *"nothing on Tuesday
  afternoon, the 18th"* — so a mismatched reading is audible and self-correcting instead of
  silent. Owner's call.
- ⚠ **An all-day event has a start time and that time means nothing** — the live feed carries
  "Bob's Birthday" at 10:00 with `allDay:true`. Bucketing by hour drops it out of every
  question about an afternoon, which is the same wrong-window bug one level down.
- ⚠ **The "1 thing on today" in the report was a `Meal:` entry** — the dinner plan. 73 of the
  feed's 383 events are meals. A dinner plan is no longer counted as a commitment in
  free/busy (owner's call), it is still listed by "what's on", and the `Meal: ` routing prefix
  is now stripped before anything is spoken (it was reaching the room through `cal.next` too).

⚠ The preposition is not uniform and is audible every time: *"nothing on today"* and *"nothing
on tonight"* are right, *"nothing on this morning"* is not. The resolved day carries both a
`label` (heads a sentence) and a `when` (carries its own "on").

<details><summary>original report</summary>

**Owner's report, 2026-08-15: asked "am I free next Tuesday afternoon?", answered "nothing on
today."** Reproduced exactly, in one line. **The microphone and the STT were perfect** — the
agent logged `heard: 'Am I free next Tuesday afternoon?'`. The whole failure is the intent
table.

```
"am i free on tuesday afternoon" -> cal.free  => "You've got 1 thing on today."
"are we free on saturday"        -> cal.free  => "You've got 1 thing on today."
"anything on wednesday"          -> cal.free  => "You've got 1 thing on today."
"what's on tuesday"              -> cal.today => "Today: Dentist."
```

`cal.free`'s regex matches the bare phrase `am i free` and **carries no day slot at all**
(`localIntents.js:106`), so every word after it is discarded. `cal.tomorrow` is the only
day-aware row in the family, and only because it is a separate intent — no weekday is
reachable.

⚠⚠ **The failure mode is worse than not answering, and that is the part to fix first.** The
reply is confident, fast, and about a different day: someone who asks about Tuesday and hears
a sentence containing the word "today" has been told something false in the house's own
voice. This repo already has the principle — *absent is not empty* — and this is it applied
to time.

**So the cheap half is a REFUSAL, not a parser.** If an utterance names a day the lane cannot
resolve, `matchIntent` should decline and let the turn fall through to Assist and the house
voice, which can at least reason about Tuesday. A day-slot parser (`next tuesday`, `saturday`,
`this arvo`) is the full fix and much larger — `voiceSnapshot.calendar` already holds the
whole feed, so the data is there; the windowing and the copy are the work.

⚠ Whatever is built, the two answerers must move together: `cal.free` and `cal.today` both
hard-code "today" in their sentences (`localAnswers.js`), so a matcher that gains a day slot
and answerers that do not would keep saying "today" about Tuesday.

</details>

---

### F8 · ✅ **DONE 2026-08-15 — the weather lane has a day slot too** (`d733f76`)

`resolveDay()` was already exported and pure, so the matcher half was nearly free. The work
was the horizon: unlike the calendar's, the forecast's is **not knowable in the parser** — it
is however many days the last refresh returned (seven on the live G11 today, but the
BOM-via-HA fallback returns two and `weatherFallbackForecast()` returns none). So
`forecastDay()` reads the horizon **by date**, not by index, and returns null when the feed
does not reach the day asked about.

⚠ **UV and wind decline every day but today, on purpose.** The per-day record carries a high,
a low, a condition and a rain chance and nothing else, so those two questions refuse a future
day at the matcher *and* again at the answerer rather than quietly reporting the current
reading for Saturday. The nowcast is held to today for the same reason.

<details><summary>original item</summary>

**Measured, not suspected:** `"what's the weather on tuesday"` → `weather.now` →

**Measured, not suspected:** `"what's the weather on tuesday"` → `weather.now` →
**"It's 18 degrees and clear."** Same shape as F7 and the same harm: confident, fast, and
about a different day. `weather.tomorrow` is the only day-aware row, exactly as `cal.tomorrow`
was.

Deliberately **not** folded into F7, because the bound is different and has to be measured
first: the calendar's horizon came from `getRecurrenceWindow()`, but the forecast's comes from
however many days `/api/weather/forecast` actually returns (`forecast.days[]`). Establish that
length before parsing a day, or this reintroduces the confident lie one surface across.

`resolveDay()` is already exported and pure, so the matcher half is nearly free — the work is
the horizon, and the copy in five answerers that each hard-code "today"/"now".

Two sibling phrases already fall through and are safe today: `"will it rain on tuesday"` and
`"how hot will it be on saturday"` match nothing.

</details>

---

### F6 · ⚠ **HALF DONE 2026-08-15 — the dominant cause was a wrong `aspect`, not a blind crop** (`d710e99`)

**The framing arithmetic below is correct and was not the main event.** Measured on the live
library before any code was changed, by fetching every preview in the day's on-this-day pool
and reading its SOF marker:

| | |
|---|---|
| assets in the pool | 202 |
| **portrait as delivered** | **111 (55%)** |
| exif-derived `aspect` said portrait | 47 |
| **misclassified portrait → landscape** | **64 (31.7%)** |

🔑 **`slim()` derived `aspect` from `exifInfo.exifImageWidth/Height` — the SENSOR pair, which
is pre-rotation.** An iPhone stores a portrait shot as a landscape 4032x3024 buffer plus
`orientation: 6`; Immich applies the rotation when it builds the preview, so the jpeg the wall
loads is 1440x1920 while the exif numbers still describe the sensor.

**And a misclassified portrait draws the worst frame the ground has**: `isKnownPortrait`
rejects it, so **the diptych — built precisely to protect portraits — never pairs it**. It goes
full-bleed instead, where 0.75 into 1.78 keeps 42% and cuts the rest away from the centre
outwards. Faces sit near the top of a portrait frame. That is the report, exactly.

**The fix is a field that was always in the payload**: `width`/`height` sit at the **top level**
of the asset, beside `exifInfo` rather than inside it, and Immich writes them post-rotation.
Across the same 202 they agree with the delivered jpeg for **194**; the exif pair for 138.
Present on `search/random` too, with and without `withExif` (both checked).

🔑 **The repo already knew.** `archiveModel.js:110` documents this trap in its own JSDoc —
*"NOT the EXIF dimensions, which are pre-rotation and would put every portrait iPhone photo in
a landscape card."* The ambient archive reads `naturalWidth` off the loaded `<img>` and got it
right; the V3 ground reads `slim()` and did not.

⚠ **8 assets are unfixable server-side and the code says so**: HEICs whose `orientation` Immich
never recorded — it reports 4032x3024 in every field it has and still delivers 1440x1920. 4% of
the pool. The browser can tell; the server cannot, and must not pretend. Unknown still returns
null, and **null is still not portrait** — guessing would send real landscapes into a 952-wide
diptych half and crop them harder than doing nothing.

✅ **Seen on the glass 2026-08-15**: a real diptych, both halves whole, and both proven to be
orientation-6 assets the old expression called landscape. Live route now serves 62/100 portrait.

#### ▸ What is LEFT of F6 — the framing half, now the smaller one

The centred blind crop is still real for what stays full-bleed, and the numbers below still
stand. ⚠ **But size it before building it: only 34 of 202 assets (16.8%) have any detected
face at all**, and *"the tops of cocktails"* is not a face. Boxes are reachable at
`GET /api/faces?id=<assetId>` — `boundingBoxX1..Y2` plus `imageWidth`/`imageHeight` already in
**display** orientation — but it is **one request per asset**, unlike `withPeople` which rides
the search that already runs. `people[]` in the search response carries **no geometry at all**
(checked: `id, name, birthDate, thumbnailPath, isHidden, isFavorite, updatedAt`), and neither
does `/api/assets/:id`.

**Do not treat any of it as a rendition problem — that question is closed** (`ground.js:150`:
Immich caps previews at a 1920 long edge, `?size=fullsize` 302s to the same file, `/original`
is HEIC and Chromium cannot render it).

The framing numbers:

| photo | aspect | what `object-fit: cover` keeps on a 1.78 panel |
|---|---|---|
| 16:9 | 1.78 | everything |
| 4:3 landscape — most phone photos | 1.33 | **75% of the height**, 12.5% off the top and bottom |
| 3:4 portrait | 0.75 | **~42% of the picture** (`ground.js:156`) |

So the crop is centred and blind, and a face near the top of the frame is exactly what it
takes. ⚠ `LANDSCAPE_MIN_ASPECT = 1.2` sorts landscape photos first, which addresses UPSCALE
and says nothing about how much is cut — a 4:3 photo passes that gate and still loses a
quarter of its height.

⚠ **The 3:4 row is now mostly handled** — that is what `d710e99` bought: a portrait the library
knows about goes into a diptych half and keeps ~84% instead of 42%. **The 4:3 row is what is
left**, and it is the common one. Same family as the radar defect closed in F2: a centred blind
crop that looks plausible until someone looks at it.

---

### F5 · ✅ **DONE 2026-08-15 — all four sightings closed, and two of them found defects**

- ✅ **The voice tool lane** — driven live for the first time. Detail below.
- ✅ **`photoVeto`'s spoken path** — the owner reports having said it to the wall several
  times on 2026-08-15. Closed on the owner's sighting, not a driven probe.
- ✅ **A real degradation on the glass** — induced genuinely (not stubbed) and photographed.
- ✅ **A real doorbell** on V3 — the owner reports having already seen one land unasked.

#### ▸ The tool lane — armed, and it moved a real light

⚠ **It was not merely default-off: `VOICE_TOOLS_ENABLED` was ABSENT from the G11's `.env`
entirely.** The code has been on the wall since the cutover (`6037502`/`65fe0f0` are both
ancestors of `origin/main` — the memory calling them "unpushed" was stale), the roster was
already seeded with real entity ids, and `ANTHROPIC_API_KEY`/`claude-haiku-4-5` were set. One
env line + a restart was the whole arming step. **It is now `=1` and live** (owner's call);
rollback is that line + a restart, no redeploy.

**Before** (disarmed), asked *"it is pretty dark out the back, can you do something about
that?"* — in a house with five smart floodlights on its roster:

> *"I'm not able to control your outdoor lights from here — you'd need to check if they're on
> a smart switch or if there's a manual switch inside that needs flipping."*

**After** (armed), *"it is pitch black on the driveway"*: `/api/voice/assist` returned
`handled:false` ("Sorry, I couldn't understand that") — so the utterance genuinely fell
through to Lane 3 — and the reply was *"Driveway light's on now, so you won't be doing a full
stumble in the dark."* `switch.driveway_light` went `off` → **`on` at 07:14:20Z**. Model →
`tool_use` → `planCall` → `SAFE_SERVICES` → `haPost` → a physical floodlight. Restored after.

🔑🔑 **"Turn on the backyard light" CAN NEVER REACH THIS LANE, so do not test it that way.**
`MUTATION_RE` (`localIntents.js:447`) routes anything opening with `turn` to HA Assist, and
Lane 3 only ever sees what Assist *declines*. Exercising the tools needs a phrasing with no
leading imperative verb — a symptom, not a command. This is by design and it is also the
reason the lane looked untestable.

🔑🔑 **AN EMPTY `[]` FROM HA IS NOT A FAILURE.** HA returns the entities that changed
*synchronously*; Eufy switches report their new state seconds later, so the working light
returned `[]` and came on anyway. **This cost a wrong conclusion mid-session** — `[]` plus a
still-`off` state read five seconds later looks exactly like a dead call. Poll for ~20 s
before judging any Eufy switch.

⚠⚠ **Four of the five floodlights accept the call and never change** — backyard, patio, front
yard and side gate still sit at `last_changed 2026-08-13` twenty minutes after a `turn_on`;
only driveway responds. **This is a SEPARATE fault from the dead cameras, and the sets are the
evidence:** the dead-camera set is kitchen / side_gate / piano_room / tilt_pan, but three of
the four dead *lights* (backyard, patio, front yard) sit on cameras that were **alive**. Only
side_gate overlaps. So it is the control path out, not the event path in, and it wants its own
investigation — **do not fold it into the motion-divergence item.** Untested hypothesis worth
starting from: driveway is the **wired** camera and live view is known wired-only, so this may
be battery cameras refusing commands while asleep. Recorded, not chased.

⚠ **The house said "backyard light's on now" when nothing happened**, and the honesty guard
cannot catch it: `runToolCall` asserts `"done"` from a non-throwing `haPost`, and `[]` is
ambiguous (see above), so there is nothing to test at call time. The design's
"never pretend you did it" rule was built for *refusals*; a **no-op success** goes straight
past it. Fixing this means observing the entity's state after a delay, which is a real change
in shape — deliberately left open rather than patched blind.

#### ▸ The degradation — real, seen, and it exposed two things

Induced by pointing **both** Kokoro legs at a dead port and restarting: three
`/api/tts/speak` calls → `502` → `ECONNREFUSED` in the journal → `tts` at
`3 consecutive failures` → `overall: error`.

⚠ **Stopping the NAS container — the obvious way — would have produced NO fault at all.**
`KOKORO_URL` is **Mandragon.local** (the PC); the NAS is only `KOKORO_FALLBACK_URL`. Both
legs have to fail before `reportFailure("tts")` ever fires.

🔑 **`/api/system/health` reports on-demand feeds from their STORED level, not live.**
`healthService.js:258–265` reads live only for `state` and `coverage` kinds — so `tts`, `ai`
and `cameras` lag by up to the 60 s eval tick. A real fault reads `ok` for a minute, which is
exactly the minute someone is asking why nothing works. The comment above that line gives the
right reasoning and then applies it to two kinds out of four.

✅ **It reached the glass, in the house's own voice:** *"I can't say anything out loud right
now."* Screenshot taken with `DISPLAY=:0 scrot` at 17:21. Recovery is sound too — with Kokoro
restored the fault cleared and the candidate **decayed out of the queue within its 90 s
`LIFE_MS`**, which is the whole retraction mechanism working as documented.

⚠ **`HEALTH_SCORE` 72 collides EXACTLY with `IN_WINDOW_SCORE` 72** (`health.js:72` vs
`candidateSources.js:79`), and `attentionRank.js:38` sorts with a stable `sort`, so on a tie
the collected sources beat the announced ones. Inside `MENU_WINDOW` (17:00–18:30 daily) and
`COMMUTE_WINDOW` (06:30–08:30 weekdays) — ~3.5 h a day — a fault loses the hero slot to
dinner. **This is a demotion, not a suppression**: the health line still rendered in the
secondary slot beside the menu hero, which the screenshot shows. Worth a decision, not a bug.

---

## P2 — Measurement debt (gates P1)

### M1 · Re-measure CPU/GPU — ✅ **CLOSED 2026-08-15: instrument repaired, sweep taken**

> ✅ **The repair is done and tested.** `scripts/kiosk/surface.cjs` declares the seams the
> instrument drives, `kiosk-eval.cjs --detect` refuses to sample when one is missing,
> `kiosk-sweep.sh` aborts instead of logging three ambients, `kiosk-drive.cjs` gained a V3
> subject cycle and a real peak, `perf-metrics.cjs` measures `substrateFps`, and
> `heap-metrics.cjs` judges V3's ground instead of an archive that does not exist here.
> `tests/kiosk-instrument.spec.js` pins the whole contract (neuter-verified: renaming
> `__ground` in the source turns two of its assertions red — after a rebuild, since the suite
> serves `dist/`).
>
> ✅ **The sweep has been run, in daylight, on the wall (2026-08-15 06:44).** Ambient
> **5.7 / 6.8** at 15.0 fps; peak (camera live at depth 3, held 34 s) **7.2 / 9.0**; cycle
> symmetric across two runs. Rows and the three caveats are in `HOST-BASELINES.md`.
> 🔑 **V3's peak is barely above its ambient (+1.5 gpu)** — the substrate is the cost and it is
> paid at rest, so the ≤ 35 peak ceiling is no longer what binds this surface.
> **M1 is closed.**
>
> ✅ **F4 is done** — see the item. What is left of it is a GPU reading and a look at the wall.

✅ **The live-ambient row is closed** (2026-08-14, `HOST-BASELINES.md`): gpu-process **5.9%**
of one core, renderer **5.3%**, one shared 30 s window, substrate animating at a measured
**15.0 fps** on a real windy night. Ceiling ≤25 ⇒ ~4.2× headroom. Plus the dark state the
energy saver creates: **0.0% / 0.0%**, zero frames.

⛔ **The rest of M1 cannot be done by taking readings — the instrument is dark on V3.**
Probed live: `__wakeScreensaver`, `__engageScreensaver`, `__forceAtmoEpisode`, `__switchView`,
`__archive` and `__atmosphere` are **all `undefined`** on the wall. They are incumbent hooks
and `/` has served V3 since the cutover. So:

- **`kiosk-sweep.sh` — the tool `/kiosk-metrics` says to PREFER — would log ambient three
  times and label the second one a peak.** Same disarmed-tripwire shape as the 2026-07-30
  `kiosk-drive.cjs cycle` no-op recorded in that script's own header. Caused again, by the
  cutover.
- **The peak row (≤35) is not measurable on V3 at all** — there is no atmoFx module under
  `src/v3/` (verified), so `rain-heavy` does not exist on the current wall. The 22.5 on record
  is an incumbent number.
- **The heap/DOM baselines describe a ~20× larger page.** V3 measures `domNodes` 42 /
  `cdpNodes` 268 / listeners 29 / lottieWrappers 0, against a "healthy" band of 926 / 2,315 /
  67 / 5. Not a gate any more.
- **`heap-metrics.cjs`'s liveness block was permanently not-assessable** — it reads
  `window.__archive()`, which only the incumbent surface defined. It refuses rather than
  passing falsely, but nothing watched Live Photo. ⚠ **V3's archive now defines
  `window.__archive()` too**, behind `v3Archive`, with a DIFFERENT shape: no `motion` key at
  all, and `ghosts`/`slots`/`years`/`nodes` where the incumbent had `card`/`plate`/`lit`.
  A liveness block that keys off the hook EXISTING will start reporting again, against a
  surface that has no Live Photo clip to watch. Check the shape, not the name.
- 🔑 **`anims` cannot see the substrate** (rAF on a canvas, not a Web Animation), so the
  table's own "record `anims`" rule would file a live-ambient sample under the quiescent row.
  On V3 the discriminator is `__substrate().animating`/`paused`.

**Next:** give V3 the seams the sweep needs, then re-run it. **F4's own reading is the first
customer** — it was built 2026-08-18 and flag-off precisely because it cannot be judged
against a baseline the instrument cannot take, and depth 0 moving from the quiescent band to
live ambient is exactly the transition this row exists to measure.

⚠ **F3 was never actually gated on this, and the gating was the wrong question.** Closed
2026-08-15 without a new baseline, because it shipped no new cost: two of its three flags had
no code in the V3 bundle at all. The reading is still owed for its own sake — see M1.

### M2 · The 72 h soak
Never run. A 23.6 h soak ran clean at the cutover (`V3-CUTOVER.md:576`) — the 72 h one is still
owed. Take `/kiosk-metrics` at 0 h / 24 h / 72 h.

---

## P3 — Cleanup

**Worked and closed 2026-08-20.** Five items. Three done, and the rest closed on
evidence or on the owner's call — nothing here is still open. 🔑 **The recurring finding is that the
audit's own dead-code lists were built by literal-string sweeps, and a literal sweep
cannot see a computed name.** It warned about exactly this for the lottie icons (§8) and
then did not apply the warning to itself two sections earlier (§7). Six of M8's "30 dead
CSS classes" are alive.

### C1 · ✅ **DONE** — `ground.js`'s stall and its second attempt (`88b2a20`)

⚠ **The item was two-thirds stale and one-third right.**

- `dissolve()` **is** covered — `ground-diptych.spec.js` drives it twice through
  `__groundDissolve`, and `photo-veto.spec.js` reaches it through `__groundVeto`.
- `oneShot()` was **never `ground.js`'s**. It lives in `src/js/modules/background.js`, on
  the incumbent surface. The item had it filed against the wrong module.
- What *was* uncovered: the **stall** and the **retry**. Every existing failure test 404s
  the thumb, which fires `onerror` and takes the latch at once; a request that simply
  hangs fires nothing, and `shot.arm(fail, stallMs)` is all that clears `inFlight`.
  And nothing proved that after a failure the *next* attempt succeeds — which is the
  entire reason `loadFirst` leaves `current` null.

`tests/ground-retry.spec.js` covers both. 🔑 **The elapsed time is the assertion.** With
`arm()` removed the latch still clears — at ~2900 ms, when the hung thumb finally arrives
and `half()` settles the frame — so a spec that only polled `inFlight` would go green
against the exact defect it exists for. Both tests neuter-verified, each red on its own
assertion and green on the other's.

### C2 · ✅ **DONE** — eight of the ten seams removed; two are not cleanup (`39f2cb3`)

All ten re-verified at one repo-wide reference each before touching anything.

**Deleted (8):** the seven `__reset*` plus `isPanelDark`. 🔑 **The seven were unreachable
from BOTH halves of the suite, by construction** — which is why no test ever grew into
them. Node-side specs cannot use them (the state they clear is created only by `init*()`,
which needs a real page; the exports a node spec *does* call are pure). Browser-side specs
cannot either (they are ESM exports, never put on `window` — unlike the six drive seams
beside them, `__v3Alert` / `__v3Arrival` / `__v3Briefing` / `__v3PanelDark` /
`__v3DisplayTick` / `__v3Wake`, all of which have callers) — and a browser spec gets a
fresh page per test anyway. **Every reset seam in this repo that IS used
(`__resetEntities`, `__resetHouseCache`, `__resetBoot`, `__resetRoster`) belongs to a
node-safe module.** If a browser spec ever needs a mid-page cold start, the right form is
`window.__resetX` beside `window.__v3X`.

**Kept, deliberately (2):**
- ⚠ **`reportUnheard()` is a DEAD LEVER, not dead code.** `presence-light.js:88` designs
  three distinct failure cues; only `misheard` can ever appear. Nothing calls this, so
  "the house heard nothing" is unreachable — and `cannot` is unreachable too. **Wiring it
  is not cleanup:** the browser's voice stream carries `transcript` / `level` / `barge_in` /
  `sound_presence` and **no wake event** (`server/routes/voice.js:608`), so "a wake fired
  and nothing arrived" is a fact only the out-of-repo agent holds. → new item **V1** below.
- `__groundRetry` was **C1's instrument**. Spent there.

### C3 · ⛔ **WON'T DO — deleting these would destroy the rollback** (closed 2026-08-20)

S2 already weakened this; verified and now closed. The incumbent tree is not dead code, it
is **cold standby**: `V3_DEFAULT=0` is a hard override read at `server/config.js:58`, the
rollback needs **no deploy and no push** (`V3-CUTOVER.md:504`), and those modules are in
the shipped bundle — `dist/assets/index-*.js` carries 14 hits for `screensaver` alone.
Deleting them would turn a one-line rollback into a revert-and-redeploy, silently, and the
day you find out is the day the wall is already broken.

### C4 · The audit's remaining MEDIUM items

- ✅ **M7 — DONE** (`615cf7e`). 181 unreachable lottie icons deleted, 2.4 MB → 936 KB.
  🔑 **The audit's three computed-name warnings reduced to one, and only checking said
  which:** grepping every template literal ending in `.json` across `src/` and `server/`
  finds exactly one construction that names an icon (`getWindBeaufortFilename`), while
  `uv-index` and `moon` appear **nowhere in the repo at all**. Beaufort kept whole, 13/13.
  ⚠ **Found while doing it:** the audit's *other* finding — 6 lottie files that do not
  exist — is a second `WEATHER_ANIMATIONS` map in `src/js/config/config.js` with **zero
  importers**, tree-shaken out of all three bundles. Never a live defect; 31 lines of
  config that looked authoritative and named files that were not there. Deleted.
  🔑 **The failure mode is silent** — a 404 gives lottie-web no animation, no exception and
  no gap, just an empty weather strip — so `tests/lottie-icons.spec.js` now pins both
  directions, proven by restoring the dead map (red, naming all six) and by removing one
  beaufort file (red at `117 km/h -> wind-beaufort-11.json`).

- ⛔ **M8 — NOTHING TO DO, AND THE ITEM WAS WRONG** (closed 2026-08-20).
  **CSS:** 24 of the 30 were already gone. The remaining 6 are **alive**, every one of them
  built from a template literal the audit's sweep could not see —
  `weather-fx-layer--${mode}` (`services/weather/fxOverlay.js:39`, live via
  `renderer.js:19`) and `timeline-stop--${variant}` (`modules/calendar.js:813`).
  **Deleting them on the audit's word would have broken the weather overlay and the
  timeline's now/next highlight.**
  **Events:** 7 of the 8 dead subscriptions are already gone. The 8th, `ha:message`, is a
  **comment at `systemStatus.js:374` explaining the refactor that removed it** and naming
  what replaced it — deleting it would delete the explanation.
  ⏳ Left alone on purpose: `emit("intent:changed")` (`core/intentEngine.js:78`) still has
  no subscriber, but it is in the incumbent-only tree, which C3 just established is frozen
  rollback rather than a place to make cosmetic edits.

- ⛔ **M10 — NOT MEASURABLE, same shape as M1** (closed 2026-08-20). `atmoFx` lives
  entirely in `src/js/` (`services/atmoFx/{planner,runtime}.js`) with **zero references
  from `src/v3/`**. The wall runs V3. **There is no atmoFx rAF loop on the live surface to
  verify has stopped.** If the question is worth answering it is a question about the
  rollback host, not the kiosk.

- ⛔ **M6 — CLOSED, owner's call 2026-08-20. Its justification had evaporated.** 18 MB of weather MP4s →
  ~6 MB. The audit's reason was "each one is hardware-decoded on the Pi while visible" —
  which is now false twice: the wall is a **G11**, and **V3 never plays these at all**
  (0 hits for `weather_bg` in `dist/assets/v3-*.js`; `context-feed.js:10` says "V3 has no
  DOM weather"). What is left is 12 MB of repo and rsync, against a **visual** change to
  the rollback surface that CLAUDE.md says cannot be called done until it is seen — on a
  surface that is not on the glass. **Not worth it: closed rather than deferred.**

### C5 · Housekeeping — ✅ mostly done (`d5cc9cc`)

- ✅ **L2** — five root docs moved to `docs/`. Inbound references followed rather than
  assumed: `STYLE_GUIDE.md` had eight mentions across README + four design docs, one of
  them a relative path (`../../STYLE_GUIDE.md`) the move would have broken.
  ⚠ **The sixth was not repo clutter.** `CLAUDE_CODE_PROMPT.md` is **gitignored**
  (`.gitignore:29`) — the original scaffold prompt, and the thing that created
  `.reference/`. It belongs with L8. Left in place.
- ✅ **L3** — `config/cameras.js` → `server/config/cameras.js`, root `config/` gone. One
  code importer, plus the camera-debug skill in `.claude/` **and** its `.agents/` mirror,
  and `docs/CAMERAS.md` ×3. Verified by importing the route, not by reading it.
- ✅ **L7** — both scripts deleted, re-confirmed broken first (each imports a pre-Vite
  `static/js/...` path and dies on `ERR_MODULE_NOT_FOUND` at resolve time).
- ⛔ **L8 — CLOSED, owner's call 2026-08-20: both stay.** `.reference/` (265 MB) and
  `CLAUDE_CODE_PROMPT.md` are **untracked and gitignored**, so they never reach the repo,
  the deploy rsync or the kiosk — they cost local disk and nothing else, and deleting
  `.reference/` is not recoverable through git. (`.playwright-mcp/` is already gone.)
  🔑 **L8 was filed as repo hygiene and is not** — nothing in it is in the repo.
- **L4, L5, L9, L10** — untouched, no urgency (config split, interval scheduler,
  config-precedence doc, drop `node-fetch` for global `fetch`).

### V1 · ✅ **DONE — all three failure cues are reachable** (`0638f53`, `a61a374`)

⏳ **Not yet on the wall.** Flag `voiceFailureCues` is default OFF, and the agent half is
`tools/voice-agent/voice_agent.py`, which **a deploy does not ship** — it needs `scp` +
`sudo systemctl restart voice-agent.service`. See "still owed" below.

`presence-light.js:92` designs three distinct failures because the repair differs by type,
and exactly one of them could ever appear. Both gaps turned out to have the same shape —
**the fact belonged to a process that had no way to say it** — and both are fixed by a
report rather than an inference.

**`unheard`.** Its raiser was exported and uncalled, and no page-side code could have
called it: every path that ends a turn in nothing happens inside the mic agent (the VAD
hearing no speech after the wake, whisper returning `""`, whisper unreachable, a barge-in
that never won the floor) and the dashboard sees **no request at all** on any of them. The
rim lifted on the level frames and decayed — which is what a broken wall looks like too.
New `POST /api/voice/unheard` (loopback only) fans out as `voice_unheard` on the **kiosk**
half of the stream, never the agent half; the agent calls it on all four dead ends with the
reason that separates them, and `transcribe()` now returns `None` for an unreachable STT
against `""` for a genuinely empty one, because those are different facts about the house
and used to collapse into one empty string.
- 🔑 **NOT a page-side watchdog.** The obvious design — arm a timer on wake, fire if no
  transcript arrives — cannot be tuned: the agent's own STT call waits up to **30 s**, so
  any timeout short enough to be a useful cue calls a turn failed a beat before it answers.
- ⚠ **Never raised while a turn is in flight** (`|| busy`). The barge-in timeout reports
  unheard while a reply is still PLAYING, and `setFailure()` opens by dropping the phase to
  idle — it would take the sweep off a voice the room can still hear. Neuter-verified: the
  spec paints `unheard` over a 30 s reply with the guard removed.

**`cannot`.** A tool call that is refused or fails is handed to the model as a
`tool_result`, and the model writes an ordinary sentence about it — so the room heard an
apology and the wall showed a success. The difference had already been dissolved into
prose by the time anything downstream could see it. `converseWithClaude` now takes an
optional `onToolError` (an out-parameter, not a widened return — it answers string-or-null
to several callers and tests), the route emits `toolFailed` on both legs and **only when
true**, and the page raises the cue **after the reply has finished speaking** on both.
- 🔑 **The neuter is what wrote the spec's comment.** Raising it the moment the payload
  arrives makes the cue flash and vanish — `trackSpeech()`'s own `setPhase("speaking")`
  wipes it within milliseconds and it never returns. So the mid-flight `null` check
  **passes against the defect**; only the assertion after the turn catches it.
- It does not touch `consecutiveFailures`. The turn succeeded.

⚠ **The server half of `cannot` is not integration tested,** for the reason
`voice-tools.spec.js` already records: `playwright.config.js` stubs `ANTHROPIC_API_KEY` to
`""`, so `getAnthropic()` returns null and the tool loop never runs in this suite. The nine
new specs (3 contract, 6 browser) pin the route, the fan-out, and the half that paints.

⚠ **A suite consequence of flipping the flag on:** `voiceBus` is process-wide, so one
`/api/voice/unheard` POST reaches **every page in the run**. Inert while the flag is off;
with it on, a contract spec can paint `data-fail="unheard"` on an unrelated worker's page.
The `cannot` control asserts `not.toBe("cannot")` rather than an empty fail state for
exactly this reason.

**✅ Both shipped and live-verified 2026-08-20** — pushed `6169f10`, agent copied to
`/home/dashboard/voice-agent/` and restarted (md5s reconciled; the deploy timer does NOT
do this, it only pulls the repo copy), kiosk reloaded.

🔑 **The DOM read is not the paint read, and both were taken.** Driving the route from the
page gave `{before:null → during:"unheard" → after:null}`, which also settles what the
reload check cannot: `kiosk-drive.cjs reload` compares STYLESHEET hashes only, and this
change was JS — the listener firing at all *is* the proof the new bundle is live. Then the
pulse itself was sampled through its animation on `.presence::before`: 0.24 at 80 ms, peak
**0.42 at 320 ms**, 0.014 at 650 ms, 0 by 900 ms, over a 1920×260 band at the foot of the
screen. The cue is real and renders as designed.

⛔ **AND THE FLAG IS STILL OFF, on the owner's call — the cue arrives ~10 s too late.**
Two genuine wakes (0.89, 0.98) reported cleanly and the owner **saw nothing at all**. See
the new item below; V1's mechanism is not what is wrong.

### V2 · The capture cannot tell when you stopped talking *(new, from V1's live test)*

**The failures are systematically the slow path, and that is a property of the loop rather
than bad luck.** `capture_utterance` (`tools/voice-agent/voice_agent.py`) ends an utterance
after `TRAIL_SILENCE_MS` (800 ms) of frames below `SILENCE_RMS` (500). A wake followed by
real speech gives it a clean speech-then-silence shape to end on. A wake followed by
**nothing** never does — room tone keeps `trail` reset — so it runs to `MAX_UTTER_MS`
(8000 ms) every time, and only then pays the STT round trip.

Measured on the wall 2026-08-20, from `journalctl -u voice-agent.service`:

| outcome | wake → result |
|---|---|
| short command heard | **3 s** |
| longer command heard | 7–10 s |
| **`empty transcript`** — every instance, Aug 16 through Aug 20 | **10–13 s** |

So success is fast and failure is slow, which is precisely backwards for a cue whose whole
job is to answer the person who just spoke. V1 built the report; it can never be timely
until this is fixed.

⚠ **The obvious fix is the wrong one, and the evidence is already in this repo.**
`/api/voice/ambient` reads `floorDb -36.5`, `medianDb -35.6`, `peakDb -20.1` — a floor of
roughly **RMS 518 against a threshold of 500**. But that is *marginal, not uniformly over*:
the 3-second turns above prove the break does fire sometimes. **Re-tuning `SILENCE_RMS` is
therefore a coin flip, not a fix** — and this exact conclusion was already reached in this
exact room for `soundPresence`, whose own comment records it: *"Loudness was tried first and
MEASURED AGAINST THIS KITCHEN on 2026-08-09. It does not work here, and no threshold fixes
it"* — conversation sat 2.2 dB above the floor and the EMPTY room reached 6.5 dB. The
distributions overlap.

🔑 **The discriminator the agent needs is already loaded.** `_speech_probability()` runs
silero, bundled inside the installed openWakeWord — no new dependency, no new listener, one
float. The **ambient relay was moved onto it and the capture loop never was.** That is the
whole item: endpoint `capture_utterance` on speech probability rather than loudness.

⚠ **Risk: this is the mic's core loop.** A bad move here does not degrade the cue, it makes
the house deaf. Wants its own live verification (a real spoken command still heard, AND a
silent wake ending in about a second), not a flag flip.

Then: flip `voiceFailureCues` on and watch for the pulse.

---

## P4 — ✅ **DONE 2026-08-14 — gitignored** (`e3af8b0`)

Answered as **generated, local, disposable**, matching the `.claude/` precedent already at
`.gitignore:13`.

The decision was made easy by what the files turned out to be: **`.agents/` is a generated
MIRROR of `.claude/`** — every file byte-identical apart from `s/CLAUDE.md/AGENTS.md/`, and
`AGENTS.md` is `CLAUDE.md` with a different H1. (The od-contribute files that looked wholly
different were CRLF vs LF.) Since the *original* is ignored, tracking the *copy* would have
made the copy canonical.

🔑 **And it had already drifted, two days in, in the way that matters.** The generator also ran
`s/.claude/.Codex/` — wrong twice (the directory is `.codex/`, and the skills live in
`.agents/`) — leaving `.agents/skills/audit/SKILL.md` instructing the reader to run
`node .Codex/skills/audit/scripts/reachability.mjs`, a path that does not exist, inside a
skill whose whole job is to be trusted. Fixed; both referenced scripts now resolve.

---

## Docs that are stale and should be corrected in passing

- ✅ `docs/design/V3-MIGRATION.md` — **done 2026-08-14.** 5.2 ticked (all three of
  `isScreenshot()` at `immichClient.js:96`, its application at `:167`, and
  `IMMICH_EXCLUDE_SCREENSHOTS=1` in the G11's `.env` re-confirmed first), with the `photoVeto`
  caveat recorded. The 5.1 row now carries the live evidence instead of the ⏳.
- `docs/design/HANDOVER-AMBIENT-ARCHIVE.md:3` — "flag-off" is now only half true
  (`archiveFitToPrint` is on).
- ✅ `tests/local-voice.spec.js` — **done 2026-08-15.** "Handled by the incumbent" now says
  which surface it means: the rollback one, not the wall. The list is kept, not dropped — a
  rollback surface that has gone mute is a rollback nobody can use.
