# Priority Backlog — post-cutover

**Written 2026-08-14** against `855cf49` (working tree clean, nothing unpushed).
Every item below was **verified against current code**, not carried forward from a doc.
Where a doc and the code disagreed, the code won and the doc is flagged for correction.

Ordering: **security → new features → the measurement debt that gates them → cleanup.**

---

## P0 — Security

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

### S3 · The security middleware has no dedicated contract test
**~2 h. Highest-leverage security item in the file.**

`server/middleware/security.js` is real and **is mounted** (`server.js:90`, `applySecurity(app)`).
It carries helmet, a CORS allowlist, a global `/api` rate limiter, and `blockCrossOriginWrites()`
— i.e. audit items C2, C3, C4 and H4 all landed there.

**But no spec covers it.** Only `tests/api.spec.js` mentions Origin at all; there is no
`tests/security.spec.js`. That is precisely this project's own recorded failure mode — *a gate
is green for a node it never looked at* — sitting on the one middleware whose silent removal
has no visible symptom. Nothing on the wall changes if `applySecurity` stops being called.

**Do:** add `tests/security.spec.js` asserting, per house practice, **each one proven red by
neutering it first**:
- helmet's headers present on an `/api` response;
- a cross-origin `POST` to a mutating route is rejected, same-origin passes;
- the rate limiter trips at its configured ceiling;
- the CORS allowlist rejects an origin outside it.

**Done when:** the four assertions exist, each demonstrated red with its own fix neutered.

---

## P1 — New features

Everything here is **already built**. None of it is new code of consequence; all of it is
waiting on a live verification that nobody has run. That makes this the cheapest feature
value in the repo.

### F1 · Flip `v3EnergySaver` on ⭐ *start here*
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

Each is byte-identical when off and carries a one-line revert. **Do these after M1** — you
cannot judge a new flag's cost against a baseline that predates the engine and the SSE.

---

### F4 · Ambient Archive — finish the half that never reached the panel
**~3 h + a soak.**

`docs/design/HANDOVER-AMBIENT-ARCHIVE.md:3` still reads *"BUILT 2026-08-01, flag-off, not yet
seen on the panel."* Partly stale — `archiveFitToPrint` is now `true` — but
**`archiveMotionLoop` is still `false`** (`config.js:932`) and owes a GPU reading.

Open judgements from `AMBIENT-ARCHIVE.md:264`, all of which need a portrait memory on the wall:
the −12° yaw foreshortening (`--arch-deck-plane` is the one-line lever), whether the echo reads
as visible tiling on a bright frame (`brightness(.17)` assumes a dark one), and the §8.5 soak,
which is unstarted.

---

### F5 · Owed live sightings — features shipped that no human has watched work
**Time-gated; fold into other sessions rather than scheduling.**

- **The voice tool lane (Lane 3 + HA tools)** — shipped, **never executed live**.
- **`photoVeto`'s spoken path** on the real wall (the visual path is proven).
- **A real degradation on the glass** — every health/status reading so far is a stubbed feed.
- **A real doorbell** reaching the V3 screen unasked.

---

## P2 — Measurement debt (gates P1)

### M1 · Re-measure CPU/GPU ⭐ *do before F3/F4*
**~1 h.** The parity bar's *"quiescent ≤8% of one core, live ≤25%, peak ≤35%"* has **not been
re-measured since the attention engine and the SSE landed**, and the ground has since gained
the diptych, on-this-day memories and the veto. The A/B on record predates all of it.

`docs/audit/HOST-BASELINES.md:165` also carries a **"live ambient ≤25% sustained —
*new state, unmeasured*"** row, open since the calm law was rewritten. Close both in one pass
and write the numbers into HOST-BASELINES as a new row.

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

## P4 — Do now, unrelated to the above

**`.agents/`, `.codex/` and `AGENTS.md` are untracked** in the working tree (created
2026-08-12). ⚠ A `git clean` in a second session has already destroyed untracked files in this
tree once. Commit them or `.gitignore` them — do not leave them loose.

`AGENTS.md` is currently a near-copy of `CLAUDE.md`. If it is meant to stay, it will drift;
decide now whether it is generated, symlinked, or maintained.

---

## Docs that are stale and should be corrected in passing

- `docs/design/V3-MIGRATION.md:511` — the parity bar shows `[ ] Ground never shows a
  screenshot (5.2)`, but `isScreenshot()` is **live** in `immichClient.js:96` with
  `IMMICH_EXCLUDE_SCREENSHOTS=1` set. Tick it, with the caveat that real-photo junk (the
  supplement bottle, the sandwich) is what `photoVeto` now answers.
- `docs/design/HANDOVER-AMBIENT-ARCHIVE.md:3` — "flag-off" is now only half true
  (`archiveFitToPrint` is on).
- `tests/local-voice.spec.js:273` — "handled by the incumbent" predates the cutover. See F2.
