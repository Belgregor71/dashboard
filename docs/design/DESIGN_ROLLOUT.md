# HomeOS Design Rollout — bringing the whole surface up to the system

**Goal:** the dashboard currently reads as a *mixture* — the new presence surfaces (hero line,
ambient clock, glass stack, arrival card, tender memory) are shipped, but they sit inside **old
chrome**: the clock is boxed in a glass card, the weather is a panel with a moon icon + wind + hi/lo,
the hero line has a container border, the aurora-stars gradient shows instead of a photo, and an ABC
news ticker runs along the bottom. This plan removes the old chrome and pulls every remaining awake
surface onto the `DESIGN_SYSTEM.md` language — flag-gated, one WP at a time, through the same ship
loop that landed WP1–WP4.

**Read first:** `DESIGN_SYSTEM.md` (the target) · `PLAN.md` (the four shipped surfaces + the
shipping contract) · `README.md` (the handoff brief).

**Current-state reference (2026-07-13 live capture):** awake home = bare-ish presence surface with
the concierge hero already showing, but wearing: `#time-panel` glass card, `#current-weather-panel`
with `#weather-lottie` + wind + range, a bordered `#focus-hero`, `#background` aurora/stars (no
photo), and `#news-ticker`. Panels below the hero (media/bins/menu/timeline/cameras) are already
`is-hidden is-collapsed`.

---

## Guardrails (every WP below — from `PLAN.md`)

1. One new `features.*` flag per WP in `src/js/config.js`; **flag-off byte-identical**; one-line revert.
2. **Extend `variables.css`, don't fork.** Reference tokens; add the ones in `DESIGN_SYSTEM.md` §8.
3. **Motion passes the cause test** (`DESIGN_SYSTEM.md` §5.1) and lands inside the §5.4 budget —
   verify with `/kiosk-metrics` after each WP. *(Was "0% GPU at rest"; revised 2026-08-01 for the
   G11, see `DESIGN_SYSTEM.md` §0.1.)*
4. Ship loop: `npm test` green → deploy flag-off (no-op) → flip on the Pi → verify at 3–4 m +
   `/kiosk-metrics` flat → commit default-on. Real photos, never gradients.
5. Keep the code-not-taste invariants (`DESIGN_SYSTEM.md` §9) intact; add/keep a test per surface.

---

## Sequencing

```
WP-F  Foundations (tokens)            ── no visible change; unblocks the rest
  │
WP-A  Drop the news ticker            ── smallest, self-contained, immediate win
  │
WP-B  Bare top row (clock + weather)  ── remove the biggest old chrome
  │
WP-C  Un-chrome the hero/concierge    ── strip the container, center, matte concierge
  │
WP-D  Photographic ground for awake   ── the biggest lift: photo + atmosphere under Glance/Lean-in
  │
WP-E  Memory whisper + polish sweep   ── captioned whisper, spacing/type pass, retired-view cleanup
```

Rationale: **WP-F** lands the shared tokens with zero visual change so later WPs are pure
application. **WP-A** is a clean deletion (fast confidence). **WP-B/C** remove the most jarring
old chrome using tokens already shipped. **WP-D** is sequenced late because it's the largest and
riskiest (it changes what's *behind* everything). **WP-E** finishes the long tail.

---

## WP-F — Foundations: land the tokens (no visible change) ✅ SHIPPED (Pi-verified 2026-07-13, `b81b5ba`)

Landed `--cool`, `--glass-*-hero`, `--space-1…10`, `--safe-margin`/`--content-max`/`--hero-offset`,
`--t-hero`/`-settle`/`-arrival`; pinned `--fs-hero-line-a/b/c` to 144/104/72px. Pi probe confirmed
all resolve; zero existing consumers → render byte-identical; suite green.

| | |
|---|---|
| **Flag** | none — additive tokens only; nothing consumes them yet |
| **Target** | `src/css/base/variables.css` |
| **Do** | Add per `DESIGN_SYSTEM.md` §8 "Add": `--cool` (alias `--accent-2`), `--glass-*-hero`, the `--space-1…10` px scale, `--safe-margin`/`--content-max`/`--hero-offset`, `--t-hero`/`--t-settle`/`--t-arrival`. Pin `--fs-hero-line-a/b/c` to fixed `144/104/72px`. **Do not** touch `--layout-gutter` (legacy panels use it). |
| **Verify** | `npm run build` clean; suite green; **byte-identical render** (no component references the new tokens yet). The pinned hero sizes are the only intended visual delta — confirm at 1920 they match the prior clamp output (they do, ±1px) so `heroType` is unchanged. |
| **Risk** | Very low. Pure additive. The only care point is the hero-size pin — verify `__heroType` still reports 144/104/72 on the Pi. |

## WP-A — Drop the ABC news ticker ✅ SHIPPED (Pi-verified 2026-07-13, `77bc52c`)

Removed the ticker UI entirely (markup, init, module, CSS incl. the 38s marquee + the
screensaver-pause rule). `/api/news` kept — `briefingData.js` still reads it, so the route + its
api.spec contract test are intact. Pi: `#news-ticker` gone from the DOM, bottom edge clean, 0 JS
errors, suite green (186 pass).

| | |
|---|---|
| **Flag** | none needed (a removal); revert = `git revert` |
| **Target** | `src/index.html` (`#news-ticker` block, ~L172), `src/js/core/app.js` (`initNewsTicker()` L212 + import L51), `src/js/modules/newsTicker.js`, `src/css/components/*` (ticker styles), the `/api/news` route only if nothing else uses it |
| **Do** | Remove the markup, the init call + import, the module, and the ticker CSS. Confirm no other surface reads `/api/news` before removing the route + its contract test; if shared, leave the route and just drop the UI. |
| **Verify** | Suite green (drop/adjust any ticker test); boot smoke test still passes; on the Pi the bottom edge is clean, no console error, hero/stack unaffected. `/kiosk-metrics` DOM count drops slightly (one fewer marquee) — a small win. |
| **Risk** | Low. Self-contained. Watch: the ticker had its own `requestAnimationFrame`/marquee — confirm its timer is fully torn down (removed with the module). |

## WP-B — The bare top row (clock + weather) ✅ SHIPPED (default-on, Pi-verified 2026-07-13, `a3f258e`)

Time bare top-left (tabular / 500 / `--ink` / quiet meridiem), `15°` over `NUDGEE · CLEAR` bare
top-right; icon/wind/hi-lo/date/middle-slot gone; weather lottie not loaded (0 wrappers). Composed
the condition line via CSS grid-areas + `display:contents` + an `::after` middot so JS content is
untouched (the screensaver still reads `#current-conditions` = "Clear"). Flag-off byte-identical.
**Follow-up noted:** media / now-playing still render as old glass panels below the hero when active
— fold them into the attention stack in a later WP. Decision #2 (middle-slot coverage) is
code-confirmed (`isPanelActive` ignores parent `display`) but wasn't observed live (no active commute
this evening) — re-check when a commute is live.

| | |
|---|---|
| **Flag** | `bareTopRow` |
| **Target** | `src/index.html` (`#top-bar`, `#time-panel`, `#current-weather-panel`), `src/css/layout/top-bar.css`, `src/css/components/weather-strip.css`, `src/js/modules/clock.js` + the weather render (`current-temp`/`current-conditions`) |
| **Do** | Flag-on: strip `.panel` glass off `#time-panel` and `#current-weather-panel` → **bare over the ground**. Time top-left = display 500 / 64px / tabular, meridiem .5em @ ink .60. Weather top-right = temp display 600 / 64px + a single condition line `NUDGEE · CLEAR` (Inter 500 / 19px / .14em / UPPER / ink .60). **Remove from this row:** `#weather-lottie` (borrowed-light law — no icon), `#weather-wind`, `#weather-range` (hi/lo). Pad the row by `--safe-margin`. Keep the middle-slot commute/next-event **out** of the Glance/Lean-in top row (their content already flows into the attention/hero queue) — hide them behind the flag. |
| **Verify** | Matches screenshots 03/05/07: bare time left, `18° / NUDGEE · CLEAR` right, no icon/wind/range, no card borders. Flag-off byte-identical (old panels return). `/kiosk-metrics` flat (removing the weather lottie should *reduce* GPU if it was animating). |
| **Risk** | Medium. The weather lottie removal is a real behavior change — confirm nothing else depends on `#weather-lottie`. The hi/lo + wind data still exist in the service; we're only removing them from *this* row. |

## WP-C — Un-chrome the hero + concierge line ✅ SHIPPED (default-on, Pi-verified 2026-07-13, `ff2e411`)

The scored line sits bare over the ground (no box), fixed-centred at +120px, glyph with the
borrowed-light glow; the idle concierge goes matte (ink .78, no glyph glow). The stack is
bottom-anchored (centring took the hero out of flow, so the stack was repositioned so it reads
below, not above). Pi: rect y587 h147 → centre 660 = 540 + 120px; matte concierge legible; no
overlap with the legacy media panel. Flag-off byte-identical.

| | |
|---|---|
| **Flag** | `bareHero` |
| **Target** | `src/css/components/home-panels.css` (`#focus-hero`), `src/js/modules/focusHero.js` (concierge variant class) |
| **Do** | Flag-on: remove the `#focus-hero` container background + border + padding → the hero line sits **bare** over the ground, glyph + text only (28px gap), vertically centered **+120px** (`--hero-offset`) below true center. Confirm the tiers (`heroType`, shipped) drive the sizes. Apply the **matte concierge** treatment (`.concierge`): text ink .78, softer shadow, glyph ✨ with no glow, opacity .8 — restyle only; the `maybeFetchConcierge()` plumbing is unchanged. |
| **Verify** | Screenshot 03 (scored hero, glowing glyph) and 04 (matte concierge) reproduced; hero centered + offset; no container box. Flag-off byte-identical. `/kiosk-metrics` flat. |
| **Risk** | Low–medium. The hero container currently provides contrast; over a bright photo the bare line leans on its text-shadow — verify legibility at 4 m over a real photo (WP-D provides the photo; until then verify over the substrate tint). |

## WP-D — Photographic ground for the awake modes ✅ SHIPPED (default-on, Pi-verified 2026-07-13, `15b4793`)

The awake home renders content over a static Immich family photo lit by the weather tint +
readability gradient; the animated aurora/stars/time-tint are retired. **gpu-process 0% over 25s in
Mode 0 (idle-freeze intact) AND 0% awake-idle** — retiring the aurora loop is a net GPU *reduction*.
Top row + concierge hero legible over the photo. Flag-off byte-identical. **Deferred to a follow-up:
the weather-based living accent (§6, accent stays time-based) and a day-boundary photo cross-dissolve
(the photo holds for the session).**

| | |
|---|---|
| **Flag** | `awakeGround` |
| **Target** | `src/js/modules/background.js`, `src/js/modules/screensaver.js` (photo source is already here — `loadImmichPhotos`), `src/css/layout/background.css`, `src/js/services/atmosphere.js` |
| **Do** | The biggest lift. Today only the screensaver draws an Immich photo; the awake modes show `#background` aurora/stars. Flag-on: draw a **single Immich photo held static while awake** + atmosphere **tint** + the readability gradient (`DESIGN_SYSTEM.md` §6 layer order) **behind the awake Glance/Lean-in layers**. **Decision (confirmed): static-at-rest** — the photo does **not** rotate on a timer while awake; it crossfades on `--t-settle` (60s) **only** when the weather/day changes (or on the awake→ambient boundary). This is the cheapest, GPU-safest option and the invariant the 0% gate depends on — no per-photo timer, no Ken-Burns while awake. Extend `atmosphere.js` to emit the **accent** (§6) so the clock color follows the weather awake too. Reuse the screensaver's photo pool. Retire `#aurora-sky`/`#stars`/`.aurora-blobs` behind the flag. |
| **Verify** | Awake home shows a real photo under the bare top row + hero, lit by the weather; text legible over it (readability gradient). **`/kiosk-metrics` GPU 0% at rest is the gate** — a static awake photo must not reintroduce compositing cost. Flag-off byte-identical (aurora returns). |
| **Risk** | **Highest.** Changes what's behind every awake surface + touches the GPU-idle-freeze that was hard-won. Verify quiescent ambient *and* Glance against the `DESIGN_SYSTEM.md` §5.4 budget. Legibility of the bare hero/top-row (WP-B/C) over real photos is validated here — budget for a readability-gradient tune. |

## WP-E — Memory whisper + polish sweep + retired-view cleanup ◀ PARTLY SHIPPED

- **E.1 captioned memory whisper** ✅ SHIPPED (default-on, Pi-verified 2026-07-14, `f9148ba`) — the
  Mode-0 "on this day" surface moved from the footer line to the study-01 bottom-right whisper
  (eyebrow + title), fading on the 60s settle, hidden when today has no anniversary. `memoryWhisper`.
- **E.2 spacing/type sweep** ✅ SHIPPED (`7b69fe3`) — near-empty: WP-A–E were built token-first, so
  the only migration was the bare-hero gap → `--space-7` (byte-identical). Legacy panels keep their
  tokens; the design type scale stays literal px (fixed-1920, documented in `DESIGN_SYSTEM.md §2.1`).
- **E.3 retired views** ✅ SHIPPED (Pi-verified 2026-07-14, `6f74bfd`) — **looking** at the force-only
  views revealed they were **already token-coherent** (briefing 100% on tokens; status/weather mostly
  glass + `--status-*` dots + mono, rendering over the WP-D photo ground). The actual inconsistency was
  the **attention surface bleeding over them** — WP-C fixed-positions `#focus-hero`, so a live hero
  (e.g. the folded menu candidate) floated over the status view. Fixed by scoping `#focus-hero` +
  `#focus-stack` to home (`body:not([data-view="home"])`). Status view now renders clean; no big CSS
  restyle was needed. (Weather's cinematic video bg can't be CDP-screenshotted; its chrome is
  tokenized. Briefing was empty at capture but is fully tokenized.)

| | |
|---|---|
| **Flag** | `memoryWhisper` (for the captioned whisper); the rest is un-flagged polish |
| **Target** | `src/js/modules/screensaver.js` + memory CSS; a spacing/type pass across the touched HomeOS CSS; `viewManager.js` `RETIRED_VIEWS` |
| **Do** | (1) The **captioned** ambient memory whisper (bottom-right, faint — `DESIGN_SYSTEM.md` §2.1/§7), the non-tender counterpart to the shipped tender lane. (2) A spacing/type reconciliation pass: migrate the touched HomeOS surfaces from `--space-xs…xl` / `--layout-gutter` to the new `--space-*` / `--safe-margin` tokens. (3) **Retired-view deletion (confirmed): delete `weather` / `briefing` / `system` entirely** — their markup + CSS + view modules + registrations + any now-dead services/routes. **Keep `cameras` reachable as a force-only overlay** (doorbell/voice) since it has a live trigger, but remove it from any navigation surface; leave it visually as-is (not a refresh target). Do this as its **own commit**, driven end-to-end with `/verify` to catch a still-referenced view or route, and adjust/remove the corresponding contract + UI tests. |
| **Verify** | Whisper matches screenshot 01; spacing consistent at 4 m; no orphaned CSS/JS/routes (grep for the deleted view ids); doorbell → cameras still works; suite green. `/kiosk-metrics` flat. |
| **Risk** | Medium — the view deletion is broad. Split it: (a) delete weather/briefing/system, verify boot + all flows; (b) reduce cameras to force-only. Each its own commit + `/verify`. |

---

## Decisions

**Confirmed (2026-07-13):**
1. **Retired views** — ✅ **REVISED: restyle, don't delete.** Investigation found all three are still
   actively triggered — `weather` ← voice/AI, `briefing` ← the scheduled morning/evening briefing
   (`morningBriefing.js`, which also speaks) + voice, `status` ← HA system alerts (`homeAssistant/
   events.js`), `cameras` ← doorbell/voice. Deleting them would break/degrade those features, so
   instead bring their CSS onto the design tokens (consistent when they do appear); keep the views +
   triggers working. (WP-E)
2. **Awake photo** — ✅ **Static at rest**: one held photo, crossfades only on weather/day change
   (60 s), no rotation timer while awake. (WP-D)

**Still to confirm before the relevant WP (don't block WP-F/A):**
3. **Middle-slot** (commute + next-event panels) — confirm their content is fully covered by the
   attention/hero queue (leave-by insight, next-event candidate) so removing them from the top row
   loses nothing. (Affects WP-B — verify on the Pi before hiding them.)
4. **News route** — is `/api/news` used anywhere but the ticker? If not, remove the route + its
   contract test in WP-A; if shared, keep the route and drop only the UI. (Cheap to grep at WP-A.)

---

## Definition of done

- Every awake surface resolves to `DESIGN_SYSTEM.md` — no old glass cards on clock/weather/hero, no
  news ticker, a photographic ground lit by the weather, one consistent type/spacing rhythm.
- Each WP shipped through the full loop, default-on, Pi-verified at 3–4 m, `/kiosk-metrics` flat.
- `DESIGN_SYSTEM.md` and this file updated as WPs land (mirror the ✅-per-WP convention in `PLAN.md`).
- The invariants (`DESIGN_SYSTEM.md` §9) still hold, each guarded by a test.
