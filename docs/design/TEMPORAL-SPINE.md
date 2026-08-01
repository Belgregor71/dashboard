# The Day, Rendered — the temporal spine

> Source: *The Day, Rendered — Proposal v2* (Claude Design, July 2026), answering
> `BRIEF-AMBIENT-2030.md`. This file is the **implementation authority** for what
> shipped; the proposal is the argument, this is the contract.
>
> Flag: `features.temporalSpine` · default **off** · one-line revert.

## The idea

The day is the architecture. Light is its clock.

A thin line of light low across the wall holds everything the house knows — the
plans ahead as anticipation, the morning behind as embers, other years as
fainter strata beneath — and **now** is the brightest point on it, travelling at
the sun's speed. Nothing on the spine is a card or a container: everything is
**pre-verbal light** until it is near enough and heavy enough to earn words, and
at most one thing speaks at a time.

Eleven domains coexist because they share one vocabulary: **a point of light
with a time, a weight and a temperature.** "One hero, never a grid" survives —
the hero was never the only thing *present*, only the only thing *speaking*.

## Geometry

| | |
|---|---|
| Span | **05:00 → 24:00**, left to right — the panel's waking life |
| Scroll | **None.** The day is fixed architecture. A feed begs to be watched |
| Now | Travels ~**1.5 px/min** at 1920 (89.7 px/hour) |
| Horizon | 79.63% down the surface; 108/1920 safe margin each end |
| Weight | The **existing attention score**, 40–100 → weight 1–3. Size and glow, nothing else |

There are no categories, no colour-per-domain, and no icons. A school morning
reads dense; a Saturday reads loose. An empty afternoon looks like an empty
afternoon — the wall never fills silence with furniture.

## Temperature

| State | Reads as |
|---|---|
| Ahead of now | Cool anticipation |
| Passed (**ember**) | Spent, warm, dim — *the day as it actually went, not as it was planned* |
| Structural anchor (a meal) | Always warm, always heaviest |

Unplanned things land as embers too — the doorbell, the dog walk. **The spine
gives events an afterlife, which is what lets announcements be brief.**

## How each domain lives on it

Implemented as pure adapters in `src/js/services/dayModel.js`, one per domain,
all emitting the same shape. Not a container per domain — a way of being present.

| Domain | On the spine |
|---|---|
| Calendar | Timed events are marks at their hour. All-day events have no geometry — they live in language |
| Meals | `Meal:`-prefixed events are structural anchors: warm, weight 3 |
| Cameras | Never scheduled — they happen, then remain as embers |
| Bins | A small weekly evening anchor. Lid colour goes in the utterance, never an icon |
| Weather | Already solved: it is the light. One mark only when rain has a time |
| Memory | The strata — `STRATA_ROWS` previous years as faint parallel lines; a surfacing memory lights its own year-line and joins it to now by a hairline |
| Media | **A property of now, not an event.** Light aggregates, language ranks: three streams in three rooms are still one now and one breath |
| Home state | ~200 entities do not earn the wall. Voice |
| World / news | Cut from the wall. No household time coordinate, no action |

## Language is rationed by presence

The spine never leaves. Presence rations its words (`languageBudget`):

| Mode | Words |
|---|---|
| **ambient** — nobody | None. The day as pure light. No breath. 0 fps |
| **glance** — passing | One utterance, grown out of its mark and anchored to its minute by a hairline |
| **dwell** — staying | The utterance plus the **three** nearest-heaviest ahead, as short labels dimmed by rank |
| **voice** | The spine holds and stills |

Rank is rendered as **ink, not position** — the spine must never become a queue.
The scored attention queue survives the rewrite unchanged: it now allocates
*language*, not presence.

## Motion — how this passes law 1

`DESIGN_SYSTEM.md` §0 law 1: *never move for a reason the room can't see.*

- **There is no `requestAnimationFrame` loop.** Marks, embers, strata and the
  now-point are drawn into one canvas repainted only on a cause: the minute
  rolling over, a calendar refresh, bins landing, presence moving, a resize.
  At 1.5 px/min the now-point is never caught moving — it is a *change*, which
  §5.1 permits, not an animation, which it would not.
- **One continuous element**, the now-point's breath: ±4% luminance, ~6s, **no
  positional component**. It is bound to `body.spine-alive`, set only while
  media is playing **and** someone is in the room. Music you chose is a cause
  the room can name. Drop either half and the CSS animation does not exist.
- **Amplitude follows `--clock-dim`** (§5.2), the sun-altitude curve the ambient
  clock already computes. At 2 a.m. the spine still breathes; it breathes faintly.
  No night gate, no second threshold.
- `prefers-reduced-motion: reduce` switches all of it off.

Budget (§5.4): quiescent ambient is a canvas repaint every 30 s and no animation
at all, which is the ≤ 8% row by construction. The breath is a compositor-only
opacity swing on a single 120×92 element.

## Memory discipline

The 24/7 rules in `CLAUDE.md`, applied:

- **The spine allocates nothing per mark.** `buildDay` folds every source into a
  fixed **64-slot** model, overwritten in place, with oldest-**ember** eviction
  (the future is never dropped to make room for the past). The detached-node
  failure class cannot occur here because there is no node per mark.
- **Language is five permanent DOM nodes** — eyebrow, utterance, connector, and
  three labels — created once at boot and reused: filled, shown, hidden. Never
  cloned, never detached.
- Label text is blanked on a **`setTimeout` longer than the transition**, never
  on `transitionend` (which does not fire while an ancestor is `display:none`).
- `stopTemporalSpine()` is a full symmetric teardown.
- Data absence renders as **silence**: a dead source means marks simply do not
  appear. The wall never draws an error state.

## Verification

- `window.__spine()` — marks (hour/weight/warm/spent/kind), `nowHour`, strata,
  the live utterance and labels, `alive`, `dim`.
- `window.__spineStratum(year, at?)` — light a year-line from the outside; `null` clears.
- Tests: `tests/temporal-spine.spec.js` (pure day model + the structural runtime
  invariants + the CSS cause-binding guardrail).

## What this replaces, and what it does not

Flag-on hides `#focus-hero` and `#focus-stack` — the centred hero and the glass
stack stand down, because the spine is now the surface. Flag-off restores both
untouched. The recipe panel still outranks the spine while it is up.

**Not implemented from the proposal** (deliberately, each its own work package):

- §11 **calm law v3 / the Ambient Archive screensaver** — the Mode-0 rewrite
  (`Ambient Archive Screensaver.html`). Mode 0 is still today's screensaver, so
  the spine is an awake-and-ambient overlay rather than the archive surface.
- §10 **the festival register** — the once-per-morning, person-caused ceremony
  and the all-day light signature.
- §8's **WebGL2 SDF band**. The canvas 2D implementation meets the same
  structural guarantee (no DOM per mark, no per-frame allocation) on a surface
  that repaints twice a minute; there is no WebGL pipeline in this repo to
  inherit, and the proposal's claim that there is describes v1's *proposal*, not
  shipped code.
- The **leave-by** and **rain nowcast** marks. Both adapters exist and are
  tested (`rainMark`); neither is wired, because the nowcast and the traffic
  leave-by are computed inside the attention refresh rather than published as
  clock times. Wiring them is a small follow-up on the producer side.
