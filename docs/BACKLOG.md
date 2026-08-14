# Priority Backlog — post-cutover

**Written 2026-08-14** against `855cf49` (working tree clean, nothing unpushed).
Every item below was **verified against current code**, not carried forward from a doc.
Where a doc and the code disagreed, the code won and the doc is flagged for correction.

Ordering: **security → new features → the measurement debt that gates them → cleanup.**

> ## ✅ P0, **F1**, **P4** and **M1's repair** ARE CLOSED. Start at **F2**.
>
> **2026-08-15 — the instrument is repaired.** It was dark on V3: every hook
> `kiosk-sweep.sh` drove was `undefined` on the wall, so it would have logged ambient three
> times and called one a peak. It is surface-aware now, it **refuses to sample** when a
> declared seam is missing, and `tests/kiosk-instrument.spec.js` keeps it that way. **F3 is
> unblocked**; one real sweep on the G11 is still owed, and it is a reading, not a blocker.
>
> ⛔ **F4 is NOT unblocked — it is re-scoped.** The ambient archive does not exist in `src/v3/`
> at all, so `archiveMotionLoop` has no V3 half to flip. Read the item before picking it up.
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

### F2 · The three voice dispatch entries that have never fired
**~3 h. This is feature completion, not cleanup.**

`src/v3/subjects/index.js` — `show.sky` (:181, plus `showSky()` at :117-154), `show.tonight`
(:183) and `show.media` (:187, plus all of `media.js`, the only V3 file at **0%** coverage).
Three things the house is supposed to be able to show and currently cannot.

⚠⚠ **This is the same dispatch table that already shipped a real defect** — Phase 6's
`show.status` was shadowed by `NAV_KEYWORD_MAP` because `matchIntent` runs before `matchNav`,
and nobody noticed. An unexercised entry in *this* table is not a theoretical gap; it is the
exact shape of a bug this project has already had once.

⚠ `tests/local-voice.spec.js:273` still lists `show.sky` as *"handled by the incumbent"*.
**Re-read that assumption** — since the cutover, `/` serves V3, so "the incumbent handles it"
may no longer describe the wall.

**Done when:** each of the three is driven end-to-end and lands a subject on the surface.

---

### F3 · The three remaining built-but-unflipped flags
**~1 h each, all gated on M1 below.**

| Flag | `config.js` | Waiting on |
|---|---|---|
| `motionWakeGate` | :770 | a real person event still waking the panel |
| `robotCandidate` | :412 | the flag-off no-op proven on the panel |
| `gamingQuiet` | :423 | a live judgement call |

Each is byte-identical when off and carries a one-line revert. ✅ **Unblocked 2026-08-15** —
the instrument can take an honest V3 reading again. Take the ambient and peak rows on the G11
first and write them into `HOST-BASELINES.md`: you still cannot judge a new flag's cost
against a baseline that predates the engine and the SSE, and the peak row does **not**
continue across the cutover, so there is nothing to diff until a V3 peak is on record.

---

### F4 · Ambient Archive — ⛔ **RE-SCOPED 2026-08-15: there is no V3 half to flip**

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

### F5 · Owed live sightings — features shipped that no human has watched work
**Time-gated; fold into other sessions rather than scheduling.**

- **The voice tool lane (Lane 3 + HA tools)** — shipped, **never executed live**.
- **`photoVeto`'s spoken path** on the real wall (the visual path is proven).
- **A real degradation on the glass** — every health/status reading so far is a stubbed feed.
- **A real doorbell** reaching the V3 screen unasked.

---

## P2 — Measurement debt (gates P1)

### M1 · Re-measure CPU/GPU ⭐ *do before F3/F4* — **REPAIRED 2026-08-15; one sweep still owed**

> ✅ **The repair is done and tested.** `scripts/kiosk/surface.cjs` declares the seams the
> instrument drives, `kiosk-eval.cjs --detect` refuses to sample when one is missing,
> `kiosk-sweep.sh` aborts instead of logging three ambients, `kiosk-drive.cjs` gained a V3
> subject cycle and a real peak, `perf-metrics.cjs` measures `substrateFps`, and
> `heap-metrics.cjs` judges V3's ground instead of an archive that does not exist here.
> `tests/kiosk-instrument.spec.js` pins the whole contract (neuter-verified: renaming
> `__ground` in the source turns two of its assertions red — after a rebuild, since the suite
> serves `dist/`).
>
> ⏳ **Owed: one real sweep on the G11**, in daylight, and the peak row transcribed into the
> table above. That is a reading, not a repair — F3/F4 are unblocked either way, but the peak
> number is what F3's flags get judged against.
>
> ⛔ **F4 needs re-scoping before it is picked up** — see the correction on it above.

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
- **`heap-metrics.cjs`'s liveness block is permanently not-assessable** — it reads
  `window.__archive()`. It refuses rather than passing falsely, but nothing watches Live Photo.
- 🔑 **`anims` cannot see the substrate** (rAF on a canvas, not a Web Animation), so the
  table's own "record `anims`" rule would file a live-ambient sample under the quiescent row.
  On V3 the discriminator is `__substrate().animating`/`paused`.

**Next:** give V3 the seams the sweep needs, then re-run it. **F3/F4 stay gated behind that** —
they cannot be judged against a baseline the instrument cannot take.

### M2 · The 72 h soak
Never run. A 23.6 h soak ran clean at the cutover (`V3-CUTOVER.md:576`) — the 72 h one is still
owed. Take `/kiosk-metrics` at 0 h / 24 h / 72 h.

---

## P3 — Cleanup

### C1 · `ground.js`'s dissolve path — still uncovered
`dissolve()`, `tick()`, `oneShot()` have never run under test, and `ground.js` has grown
substantially since that was measured (diptych, memories, veto) without the path being
exercised. `window.__groundDissolve` exists **specifically to drive this from a probe** and now
has callers — use it.

### C2 · Ten dead seams — wire them in or delete them
Verified 2026-08-14: each of these has **exactly one reference repo-wide, its own definition**:

```
__resetAlerts  __resetArrival  __resetBriefingWindow  __resetDisplay  __resetHealth
__resetNowPlaying  __resetPresence  isPanelDark  reportUnheard  __groundRetry
```

Seven are `__reset*` test seams no test uses. C1 and S3 want exactly these — wire them into
those specs, or delete them. They should not survive another cycle unexamined.

### C3 · Delete the modules V3 no longer loads
Fed by **S2**. The `innerHTML`-heavy modules with zero refs from `src/v3/` are dead weight on
the live surface. Deleting beats sanitizing. ⚠ Confirm each is not reached via a non-V3 entry
point (the Memory Studio / Recipe Book LAN portals) **before** removing.

### C4 · The audit's remaining MEDIUM items
- **M6** — 18 MB of weather MP4s in `static/assets/weather_bg/` → ~6 MB H.264 (~3 h).
- **M7** — 236 lottie JSONs shipped, ~120 believed unreachable (~2 h; grep computed names first).
- **M8** — 30 dead CSS classes + 8 dead event subscriptions (~2 h).
- **M10** — verify the `atmoFx` rAF loop fully stops in Mode 0 via `/kiosk-metrics` (~1 h;
  fold into M1).

### C5 · Housekeeping
- **L2** — 6 docs still at repo root (`CALENDAR_UPGRADES_TESTING`, `CAMERAS`,
  `CLAUDE_CODE_PROMPT`, `KIOSK_TROUBLESHOOTING`, `STYLE_GUIDE`, `WEATHER_BG_LOOPS`) → `docs/`.
- **L3** — `config/cameras.js` → `server/config/`, delete the root `config/`.
- **L7** — `scripts/audit-weathercodes.js` and `scripts/test-bom-bundle.js` **cannot run**
  (broken imports). Delete.
- **L8** — `.reference/` (265 MB) + `.playwright-mcp/` (129 MB) off the dev machine.
- **L4, L5, L9, L10** — untouched, no urgency (config split, interval scheduler,
  config-precedence doc, drop `node-fetch` for global `fetch`).

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
- `tests/local-voice.spec.js:273` — "handled by the incumbent" predates the cutover. See F2.
