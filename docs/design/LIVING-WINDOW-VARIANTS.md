# The Living Window on V3 — three directions, judged on the wall

## ✅ DECIDED 2026-09-12: **A, the overlay.** The owner picked it off this evidence.

B (grade) and C (mat-as-window) were **deleted in the merge commit** — their flags,
renderers and CSS are gone, and this document is the only record that they existed. It is
kept for that reason: the numbers below are why A won, and the next person to wonder
"why not just tint the mat?" should read the B column rather than rebuild it.

✅ **FLIPPED ON 2026-09-12 (`68a5c0e`), live on the wall.** Suite 2044 green with it on,
flag-reversibility green with it off, rollback proven on the panel (the layer disappears and
the wall is otherwise unchanged).

🔑 **Teaching the contrast sweep to pin the flag AND force the weather paid for itself in one
run.** The warm wash at 0.5 opacity pushed `#heard` — 48px `--ink-faint`, the dimmest ink on
the wall and already a known-open debt with a 2.8 floor — from 2.90:1 to **2.72:1** over the
bright-sky ground. Dimming it enough to be safe (0.22) left it at 2.81, a 0.01 margin that
would have flaked. **Masking the wash out of the top band instead** keeps 0.22 everywhere
below and reads **2.90 / 2.94** — the debt pays nothing for the weather. A layer pinned but
not forced would have measured none of this and gone green.

⚠ Also learned there: the rain pane goes `display:none → block`, and `@starting-style` holds
its opacity at 0 for the first frame — killing transitions does not skip it. A single read
after forcing measures the fade-in and reports the layer as absent. The sweep polls.

Step 2 of `docs/design/HANDOVER-LIVING-WINDOW-V3.md`. Branch `lw-variants`, nothing merged.
Each direction was served to the **real kiosk** (G11, 32" panel) by CDP fetch interception —
the branch's own bundle, its flag on, no deploy — for 16 minutes, then the wall was handed
back to `main` (verified by bundle name after each). Daylight, 07:00-07:48 AEST, 2026-09-12,
weather "mostly clear" — so every probe below was **forced** through `window.__v3Atmo.force`.

Screenshots of the family's own photographs are **not in this repo** (it is public); they are
in `C:\Users\gdee7\projects\lw-variants-shots\` with an `index.html`.

## What each one is

| | Direction | How the weather is drawn | Where it lives |
|---|---|---|---|
| **A** | Overlay | a compositor-only rain pane (one texture, translated), a warm wash, a horizon flash | one layer at z4 — above the card and the mat, below every word |
| **B** | Grade | the mat turns cool/dark in rain and warm at dusk; the card's photograph desaturates/warms; a strike brightens the whole archive | no new layer — the mat, the card's `filter`, the archive's `filter` |
| **C** | Mat as window | the mat goes 45% transparent onto the live substrate (sun, wind, cloud, rain); a strike brightens the field | the substrate, un-paused; the full-bleed photo + scrim hide at depth 0 |

## The evidence

GPU, 60 s windows, depth 0 pinned, Ken Burns settled, each taken ≥ 10 min after the trial's
reload (the HOST-BASELINES rule). Control: `main` with `v3SubstrateCoveredPause` on reads
**18.2** gpu / 6.3 renderer in the same state.

| | rest (real weather) | rain, sustained | a strike every 4 s |
|---|---|---|---|
| **A · overlay** | 17.1 / 6.0 | **19.4** / 6.2 | **18.9** / 6.3 |
| **B · grade** | 19.5 / 6.4 | **18.6** / 6.1 | **22.6 / 11.7** |
| **C · mat** | **20.9 / 15.2** | 21.0 / 13.8 | 21.2 / 14.4 |

(gpu-process / renderer, % of one core. Ceilings: live ≤ 25 sustained, peak ≤ 35.)

What the glass showed (one frame per probe, verified fresh — see the capture note below):

- **A** — rain reads as rain on a pane in front of the picture: fine slanted streaks over the
  card *and* the mat, and never across a word. The flash is a cool glow rising from the bottom
  edge. Dusk is a warm wash from the top. Subtle, legible, obviously "weather".
- **B** — rain turns the mat a dark cool **teal** (hue 235 at L 0.13 leans green on this
  panel — worth a hue re-tune if B is chosen) and flattens the photograph. Dusk is a deep amber
  mat — the most visible dusk of the three. A strike lights the **whole archive at once**,
  card blown out, ghost surfacing — dramatic, and the most expensive moment.
- **C** — in daylight the field under a 45% mat is itself dark, so rain barely registers; the
  mat looks much as it does today. A strike is the most beautiful frame of the set: the flash
  reveals the substrate's own structure — a warm glow low-left where the sun is, cool above.
  Dusk is a warm floor to the field.

## Judgement

- **A is the cheapest and the most legible.** +2.3 gpu for sustained rain, +1.8 for a storm,
  no filter, no blend, no text under it. It is the only one where rain is *recognisably rain*
  at a glance, which is the brief (walk in and sense the weather without reading).
- **B is the calmest and the most "designed"** — nothing new moves, the room just changes
  colour — but its storm is the costliest row in the table (renderer doubles: a brightness
  filter over the whole archive), its rain hue needs work, and it cannot show rain *falling*.
  Its rest row sits ~2 above A's: the identity-valued `filter` it leaves on the moving card
  image is the likely cause (not isolated).
- **C is the most honest to V3's own idea** (the weather field *is* the atmosphere) and has the
  best strike, but in daylight it is nearly invisible, it costs the most AT REST — 20.9 / 15.2
  against the control's 18.2 / 6.3, i.e. the covered pause's saving re-spent plus more, all
  day, whatever the weather (the substrate is visible and animating on wind) — and it removes the opaque mat that the
  date and sky lines in the top band rely on for contrast (`archive.css:1004-1011`). It is the
  only direction with a real legibility risk.

**Recommendation: A**, with two borrowings worth considering in Step 3: B's dusk mat (a hue
move, contrast-neutral — lightness is untouched by warmth, asserted) as the sky-ramp
expression, and C's idea of the flash revealing structure, if a cheap form exists.
It is the owner's call on the wall — this document is the evidence, not the verdict.

## The §5.4 weather-episode row — DRAFT, for the owner to confirm

The owner raised the ceiling for weather (2026-09-12). Measured, no direction needs it for a
**storm** (worst: B 22.6, inside the existing ≤ 25 live row). Proposed wording:

> **Weather episode** — a live weather cause (rain falling, a storm with strikes): **≤ 30**
> gpu-process averaged over any 60 s window while the cause is live, returning to the live
> ambient row (≤ 25) within 60 s of the cause ending; peak ≤ 35 unchanged. Quiescent (≤ 8)
> and live sustained (≤ 25) unchanged. Still: never pin a core, `scriptPct` < 5%, `tempC`
> < 70 °C.

Headroom that row gives over the measured worst: A 10.6, B 7.4, C 8.8 — but C spends its cost AT REST, all day, whatever the weather.

## A capture note, because it nearly misled this judgement

`scrot` on the G11 returned **stale frames** — 6 of 16 probe shots were byte-identical to
earlier ones (one read 7:18 when taken at 07:33). The first B "strike" and most of C's set
were stale and looked like "the effect does nothing". Every frame used above was checked
(unique hash, painted clock matches the time); C's set was retaken with CDP
`Page.captureScreenshot`, which on the G11 includes the WebGL substrate.

## To act on the choice

```bash
# after the owner picks — merge the branch, then delete the two unchosen renderers and flags
git merge --no-ff lw-variants          # from main
git worktree remove ../pi-lw-variants  # once merged or abandoned
```
Nothing is merged and no flag is flipped. Step 3 (one effect at a time, each behind its own
`v3…` flag, cheapest first) starts in the chosen direction.
