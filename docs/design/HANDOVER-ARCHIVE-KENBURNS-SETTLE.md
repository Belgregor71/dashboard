# Handover — settle the archive's Ken Burns (depth 0 is over its GPU budget)

> **Status: not started, fully unblocked.** The diagnosis is finished and measured; what
> is left is one CSS decision, two test updates, one doc amendment, and a live re-measure.
> Nothing is blocked on the owner except the *feel* of the result on the wall.

**One sentence:** `v3Archive` went default-on in `aab9acc`, which put depth 0 at **27.4%
gpu-process against a 25% ceiling**, and the entire overage is one uncounted animation —
`arch-kenburns` — which should *settle* instead of looping forever.

---

## 1. What is wrong

`v3Archive: true` (shipped `aab9acc`, 2026-08-20) moves V3's depth 0 out of the quiescent
row and into **live ambient**: `≤ 25% sustained` on `gpu-process`, `% of one core`
(`docs/design/DESIGN_SYSTEM.md` §5.4). Measured on the wall the same morning:

```
gpu-process 1161   27.4 %   (30 s window, settled)   → OVER by 2.4
renderer    1306   24.0 %
/proc/pressure/cpu avg10 = 0.00                      → never pins a core
state: depth 0 · anims 5 · panelDark 0 · daylight
```

Two independent 30 s windows read 27.7 and 27.4, so this is **not** a post-reload warm-up
artifact. Full derivation and the table row: `docs/audit/HOST-BASELINES.md`.

## 2. Why — the fifth loop

§5.4 describes **four** loops at depth 0 (card, two drifting ghosts, engraved year). The
wall runs **five**. `document.getAnimations()` names the extra one:

| Animation | Target | In §5.4? |
|---|---|---|
| `arch-pivot` | `.archive__card-wrap` | yes — the card |
| `arch-ghost-a` / `arch-ghost-b` | `.archive__ghost` | yes — the two ghosts |
| `arch-year` | `.archive__year` | yes — the engraved year |
| **`arch-kenburns`** | `.archive__img.is-top` | **no — never counted** |

`src/v3/css/archive.css:347-358`:

```css
:root[data-archive="1"][data-depth="0"]:not([data-panel-dark="1"]) .archive__img.is-top {
  animation: arch-kenburns 96s ease-in-out infinite alternate;
}
@keyframes arch-kenburns {
  to { transform: scale(calc(1 + 0.075 * var(--arch-amp))); }
}
```

**A/B/A on the live kiosk, 30 s windows, suppressing only that one animation:**

| | gpu-process | renderer |
|---|---|---|
| A — 5 loops (shipped) | 27.4 | 24.0 |
| **B — `arch-kenburns` suppressed** | **21.5** | **15.1** |
| A′ — restored | 28.0 | 24.3 |

**~6.3 points of gpu-process, ~9 of renderer.** It is not part of the 2.4 overage — it is
more than all of it. Suppressing it alone puts depth 0 at 21.5%, inside the ceiling with
headroom, and **nothing else has to change to become legal.**

## 3. ⛔ What is already ruled out — do not re-try these

- **`will-change: transform` on `.archive__img`.** This is the obvious read of the 9-point
  renderer cost, and `.archive__ghost` and `.archive__card-wrap` both carry it while
  `.archive__img` does not — so it looks like a missing layer promotion. **It was injected
  on the live wall and measured 28.5 / 24.0, indistinguishable from baseline.** The image
  is already composited; the cost is the scaled texture itself, not the layer. Tested
  negative, not an untried idea.
- **Animating both slots.** Already solved — the rule is keyed to `.is-top` precisely so an
  exchange does not composite a scaling texture for a photograph nobody can see
  (`archive.css:347`, measured at 3.1% on the surface this replaced).
- **Deleting the move outright.** Legal, but it contradicts `archive.css:351` — *"a fresh
  memory also earns a fresh move"* — which is a stated design intent, not decoration.

## 4. The recommended fix — a settle

🔑 **The repo has already solved this exact shape once.** `project-ambient-substrate`
records a Ken Burns **settle** taking Mode-0 GPU from **80% → 0%**. That is the precedent,
on this hardware, for this animation.

Run the move **once per photograph** and let it come to rest, instead of scaling forever:

```css
/* sketch, not a prescription — pick the duration in §5 */
animation: arch-kenburns 40s ease-out forwards;
```

**Why this fits rather than merely costs less:** the exchange moves `is-top` onto the
incoming slot (`src/v3/core/archive.js:441-442`), so the animation **restarts on a fresh
element every time a new memory arrives**. Each photograph still earns its move; the wall
simply stops paying for one between exchanges. The design intent survives intact.

## 5. Decide before writing the CSS

**How long does one photograph hold?** The settle duration must be shorter than the card's
dwell, or it never settles and nothing is saved. The exchange entry point is
`archivePhoto(frame, meta)` (`src/v3/core/archive.js:394`), called from outside the module —
**find its caller and the real cadence before choosing the number.** `DEFAULT_EXCHANGE_MS`
(1200) is the *crossfade*, not the dwell; do not mistake it for the answer.

Observed on the wall 2026-08-20: the plate read `On this day · 2022` at ~06:55 and
`On this day · 2019` by 07:04, so it does cycle within minutes — but that is an anecdote
from two screenshots, not a measurement. Measure it.

## 6. ⚠ Three things that WILL break

1. **`tests/v3-archive.spec.js:380` — `expect(probe.anims).toBe(5)`.** Its comment reads
   *"five loops at depth 0 in daylight, four after dark"* and says the number is pinned so a
   later change cannot move it silently. **This is that change.** A settled animation is not
   `running`, so the count drops once it finishes. Update the number **and** its comment
   deliberately — do not just make it pass. Note `anims` counts
   `playState === "running"`, so a spec sampling *during* the settle sees a different number
   than one sampling after: pin the sample point or the spec becomes timing-dependent.
2. **`docs/design/DESIGN_SYSTEM.md` §5.4** describes "four continuous loops" and puts depth 0
   in the live-ambient row *because* of them. If the settle lands, depth 0 may return to the
   **quiescent** row (≤ 8%) between exchanges, with a peak episode at each one. That is a law
   amendment, and §5.4's own rule is that a shipped surface contradicting a written law
   silently repeals it — so amend the doc in the same change.
3. **`docs/audit/HOST-BASELINES.md`** carries the `V3 archive — depth 0` row at 27.4 ⚠ OVER.
   Replace with the post-fix reading; the **24 h and 72 h rows are still owed** regardless.

Not broken, but do not disturb: `tests/verify/v3-contrast.spec.js` and
`tests/v3-caption-legibility.spec.js` both pin `v3Archive: false` on purpose — the archive
hides `#ground-caption` at depth 0 and those specs exist to measure the caption. Pinning
them *on* buys the plate's words and loses the caption's.

## 7. How to verify — the method, so it is not re-derived

Measurement is the whole point of this task; a fix that is not measured is not done.

```bash
# 1. find the pids (safe: the candidate set is chromium processes only)
ssh pi-dashboard 'for p in $(pgrep chromium); do tr "\0" " " </proc/$p/cmdline \
  | grep -q "type=gpu-process" && echo "gpu=$p"; done'

# 2. sample over 25-30s — short windows on a bursting compositor are noise
ssh pi-dashboard 'cd /home/dashboard/dashboard && bash scripts/kiosk/gpucpu.sh <gpu>,<renderer> 30'

# 3. and the invariant that must hold regardless
ssh pi-dashboard 'cat /proc/pressure/cpu'      # avg10 must stay ~0.00
```

⚠ **`gpucpu.sh` is bash, not sh** — `sh scripts/kiosk/gpucpu.sh` dies with
`Syntax error: redirection unexpected`.

⚠ **Judge the LOOK in daylight.** The plate and the engraved year hide at night by design,
so a night capture reads as an empty right two-thirds and overstates the problem. Both
earlier year rails were rejected within the hour of being looked at — this surface is on
trial, and a settle changes how it *feels*, not just what it costs.

⚠ **The kiosk keeps the old bundle after a deploy.** Reload it in **its own** ssh call:
`node scripts/kiosk/kiosk-drive.cjs reload`. And note its staleness check is the
**stylesheet hash only** — a CSS-only change like this one *will* be caught by it, but a
config/JS-only change would not. Confirm what actually loaded rather than trusting the
"reloaded" line.

## 8. Rollback

Unchanged and already verified reversible at flip time
(`flag-reversibility.mjs --flag v3Archive` flipped it back and ran the whole suite green):

```
v3Archive: false        # src/js/config.js
```

`initArchive()` then returns before building anything — no host children, no listener, no
hook, no CSS var — and depth 0 is the full-bleed photograph and the solved scrim, unchanged.
That path is exercised by production on every doorbell.

## 9. State at handover

- **Live on the wall:** `aab9acc`, archive default-on, running at 27.4% — over budget but
  stable, pressure 0.00, nothing pinned. Not an emergency; it is a debt with a number on it.
- **Unpushed (local only):** `feec160` and `174fe7e` — both `docs/audit/HOST-BASELINES.md`
  measurement records. Push them with the fix or before it.
- **The wall was left exactly as shipped** — probes removed, `willChange` back to `auto`,
  `anims: 5`. No experiment is still running on the kiosk.
