# Handover — rebuild the ambient archive as ONE PLANE

---

## ⚠⚠ AMENDED 2026-09-05 — READ THIS BEFORE THE GEOMETRY BELOW

**The whole of this brief SHIPPED** (`843c561` flag-off, `facb4a9` default-on) and then
the owner sat in front of it and moved three things. Everything below this section is the
brief AS WRITTEN, and three of its numbers are now wrong. They are kept rather than edited
because the reasoning is what makes the new numbers legible.

**Owner's verdict at the wall, 2026-09-05** — with a marked-up screenshot, two arrows:

> "The On this Day section doesn't need to take up so much screen real estate — my thought
> below the clock, smaller font. The error pills are too big as well and up top left is
> distracting — would put them below the media on bottom right."

and, asked how compact:

> "should just be one line not 3 — would also remove the 37 Memories from this date, that
> is information not needed" · "one line at 32px. The place doesn't need to be larger."

### What changed

| | Brief said | On the wall now |
|---|---|---|
| The plate | four rows (eyebrow 32 · place 72 said · who 32 · hint 32), opaque backdrop, right-aligned `x1425–1824`, vertically centred | **ONE measured line at 32px**, `left: var(--safe)`, `bottom: var(--safe)`, **no ground of its own**, capped at 1050px — `On this day · 2023 · Nudgee` |
| The count line | *"six memories from this date"* — the deleted spine's surviving fact | **DELETED.** `memoryHint()` and `poolCount()` are gone, not hidden: the line had one reader and the owner took it off the wall |
| The fault pill | top-left, stepped down to `y168` to clear the date | **bottom-right**, `right/bottom: var(--safe)`, under `.now-playing` — which is lifted 74px unconditionally to make room |
| The hour | `bottom: var(--safe)` | **`--hour-lift: -62px`** on this surface, to clear the caption beneath it. Returns to the margin at night, when the caption fades out |
| `PLANE_CARD_MID_Y` | 524 — band bounded by the pill's `y227` above and the hour's `y833` below | **462** — the band lost 62 at the bottom (the hour rose) and gained the same 62 at the top (the pill left the corner). **The height did not change: 550.** |

🔑 **`--hour-lift` and `PLANE_CARD_MID_Y` are ONE number in two files.** The hour is the
card's floor. Move either by 62 without the other and the photograph lands on the clock;
`tests/v3-archive.spec.js` measures the painted card against the painted hour so the pair
is checked rather than trusted.

🔑 **The caption's cap is the GHOST, not the media column.** The ghost's `closest-side`
radial mask is centred on (1470, 820) with a 350px radius; at the caption's band
(y945–984) the mask first has alpha at `x = 1470 - sqrt(350² - 145²) = 1152`. 1050 keeps
the line's far edge at x1146. A longer caption ellipsizes rather than sliding under a
lifted photograph — `--ink-dim` over a mid-grey wash is the 1.96:1 shape this house has
already paid for once.

### ⏳ STILL OPEN: the portrait case, and the premise has changed

The brief measured its geometry for a **landscape** memory (978 wide). A portrait paints
at **413** and the card is left-pinned at 88, which used to leave ~890px of near-empty wall
between the card and the plate. **The plate is no longer there** — it is in the bottom-left
corner — so that specific gap no longer exists, and the right-hand half of the wall now
holds the sky, the engraved year, the soft ghost, the media and the pill.

⚠ **A portrait is still 413 × 550, unchanged**, and it cannot grow without MOVING: the only
height left is below y743, and that belongs to the hour, which is directly beneath the
left-pinned card. Making a portrait bigger means giving up the left pin for tall prints —
a print hung where it fits rather than always at the same edge. **That is an owner call
and it has not been made.** Judge it on the glass first: the composition it sits in is not
the one the original complaint was about.

---

> **Status: NOT STARTED. Fully unblocked.** The design is settled, published and
> approved by the owner; nothing is waiting on a decision. What is left is code.
>
> **⚠ Do not confuse this with what shipped on 2026-09-04.** That session shipped
> `efb27c4` — the **said typeface** (Fraunces → Figtree), which is live and verified
> on the kiosk. The archive's *composition* is **untouched**: the sloping year spine,
> the two black-slab ghosts and the three-axis tilt are all still on the wall. The
> only thing that changed on the archive is the typeface of its plate.

**Design canvas (approved):** <https://claude.ai/code/artifact/35d30f9d-81a9-4481-971f-01d6ef78095d>
· page 1 = the chosen direction and the type specimen · page 2 = the two rejected
directions, kept for one finding each.

---

## One sentence

Depth 0's archive reads as *accidental* rather than designed, and the causes are three
specific, measured things — a compound rotation, a canvas ruler projected onto a
receding deck, and two hard-edged ghosts — each of which has a named fix.

## The owner's verdict, 2026-09-04

> "I'm not liking the overall look of the ambient archive. The spine looks haphazard
> and often is obscured. The tilt on the main photo often looks skewed and out of
> kilter as opposed to designed."

Plus a scope addition: depth 0 must also carry **the day/date** and **the weather for
the day**, keeping everything it already carries (hour, fault pill, now-playing), and
be *"animated enough that it's noticeable but not jarringly so."*

## Why it looks wrong — three causes, all confirmed on the glass

**1. The tilt is three axes at once.** `--arch-plane` is
`rotateY(-12deg) rotateX(8deg) rotateZ(2deg)` (`archive.css:25`).
🔑 **The `rotateZ` is the culprit.** A 2° roll has no cause a room can see, so the eye
files it as a mistake rather than as perspective. Compounding it with `rotateX` under a
**1400px** perspective keystones the card instead of foreshortening it — no edge ends up
parallel to any screen edge or to any neighbour.

**2. The spine is a canvas on the receding deck.** It therefore slopes, and its geometry
has to be derived against the projection rather than in canvas space — which is where
`core/archive.js` keeps ~120 lines of hand-probed constants (`AXIS_X0`, `AXIS_SPAN`, the
canvas-x→frame-x table) that exist *only* to keep the ruler on the glass. That geometry
has already produced two shipped defects.

⚠ **BOTH ENDS COLLIDE, not just one.** The 2026-08-20 fix addressed the right end (the
newest year's 48px lit label painted half off the screen). Captured 2026-09-05 06:21:
the **left** end now collides too — the lit `2011` sits directly on the card's top-left
corner. And on 2026-09-04 20:59 the fault pill `MOTION COVERAGE DOWN` was painted over
the strip's left end, burying `2011` completely.

**3. The two ghosts composite as flat black rectangles.** `.archive__ghost` at 22% over a
dark photograph does not read as a ghost of the photograph — it reads as a black slab with
visible corners, and it clips the engraved year behind the plate. Most of what reads as
"haphazard" is these two shapes.

## The chosen direction — B, "One Plane"

Two layers, one job each.

**THE ROOM** holds the memory and is the only thing on the wall with an angle:

- **ONE axis.** `rotateY(-9deg)` alone. No `rotateX`, no `rotateZ`.
- **Perspective 1400px → 2800px.** A longer lens: same depth, far less distortion.
- 🔑 **`perspective-origin` and the plane's `transform-origin` are THE SAME POINT**
  (`33% 50%`, behind the card's own centre). That is what makes the card *foreshorten*
  instead of keystone, and it is the difference between "tilted" and "skewed".
- **One ghost, not two** — `brightness(2.15) grayscale(0.85) contrast(0.5)` at 0.22 so a
  dark photograph still resolves as a photograph, and a **radial mask** so it has no edge.
  ⚠ A ghost with a corner is not a ghost, it is a rectangle.

**THE GLASS** holds everything the house *says*, flat, with no transform of any kind:
date, sky, fault pill, hour, plate, now-playing. Nothing readable ever sits on a receding
plane — that is the other half of why the shipped surface is hard to read.

**The year spine is deleted.** Owner's call: shrink it to a hint. What it was actually
saying survives as one line under the plate — *"six memories from this date"*. This
removes the entire projected-axis geometry and the class of bug that comes with it.

**New on the surface:** `Thursday 4 September`, and the sky as one line —
`22° · partly cloudy · 14° / 25°`.

## Geometry that is measured, not guessed

| | |
|---|---|
| Card, plane-space | `left: 88px; top: 240px; width: 978px; height: 550px` |
| Card, **projected** | **986 × 577** — today's is 1040 × 585, so the photograph keeps its size |
| ⚠ Card top edge | **Set by how far the fault pill can reach**, not by taste. The top-left stack is date (96–152) + 16 gap + pill (168–227). The first draft put the card at `y152` and **the pill landed on its corner — the original complaint, reproduced.** |
| Card bottom | 819 projected, clearing the hour at 836 |
| Plate | right-aligned, `x1425–1824`, vertically centred |

⚠ **The projected box is ~5% taller than the element box** under this perspective, so
sizing the card from its CSS height alone puts it through the hour. Measure the rect.

## Motion — settled with the owner

*"Very slow drift + exchange."* ~**2 px/s**, which `core/archive.js` already measured on
the wall as the floor of "a person can see this happening" (gain 4: ghost a 2.81 px/s).

🔑 **The FRAME never moves — only the image inside it.** Drift inside a fixed mask can
never be mistaken for a crooked photograph, which is the whole point on a surface whose
complaint was that things look askew. The plane may breathe its tilt ~1.8° over 90 s;
that is life, not an event.

The exchange keeps its 300 ms blur beat and the 2600 ms ceiling — both already correct in
`core/archive.js`, both already the thing that makes the swap an event with an end.

## How to ship it

Flag-gated, default-off, per the house rule — suggest `v3ArchivePlane`. The flag-off
build must be byte-identical to what is on the wall now, and flipping it off is the
rollback path. Flip the default only after the owner has seen it on the glass.

Touches `src/v3/core/archive.js` and `src/v3/css/archive.css`. `tests/v3-archive.spec.js`
measures painted boxes and **will need updating** — the strip assertions become deletions,
and the new assertions worth writing are:

1. the card's **projected** rect clears the hour and the fault pill's maximum extent;
2. the plane carries **exactly one** rotation axis (assert the computed transform);
3. the ghost is masked (assert it has no hard edge at the frame boundary).

⚠⚠ **Inject the defect in BOTH directions** before shipping any of those — a veil or a
guard set unconditionally passes its own test and is half a test. See `/inject-defect`.

## Two rejected directions, kept for one finding each

**A · Printed Page** (flat, no perspective). Its top band and centred fault pill are worth
stealing: the pill in the centre of the top band is the one place on this wall no other
element can reach. Measured cost of the direction itself: the print lands at 937 × 527
against today's 1040 × 585, about 20% of the photograph.

**C · Full Bleed.** Kept for a finding that is **true of the current wall too**:
`--scrim` is `to top` and transparent by 88%, so at `top: var(--safe)` there is *nothing*
between the top band and the photograph. Anything ever written into that band needs a
second scrim that does not exist yet. Proven: over a lit face, `14° / 25°` was simply
not there until the top scrim was deepened.

## Also unverified, from the font swap that did ship

- **Figtree in daylight.** All kiosk verification ran at night (`data-night="1"`), so the
  night ramp is confirmed and the day ramp is not.
- **`.vocab__item` at 48px italic** never appeared on screen. It computes correctly and
  shares `.rail`'s face, so it is sound by inference, not by sight.
