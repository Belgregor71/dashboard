# HomeOS — Design Brief & Working Guide

The design track for the presence-first display (the "Home OS" behavioural layer;
see [`../vision/`](../vision/)). This is the **shared source of truth for Claude
Design**: point Claude Design at this repo and it reads the real tokens
(`src/css/base/variables.css`), the conventions (`docs/STYLE_GUIDE.md`), and this
brief, then reconciles new designs against all three.

The artifacts below are *design intent*, not production code — the standalone HTML
uses fallback fonts (the artifact host blocks webfonts) and represents photography
with gradients. Translate them into the real tree; don't copy-paste.

Standalone copies of every study live alongside this file as `docs/design/homeos-*.html`
(open them in a browser, or let Claude Design read them from the repo). The links in
the table below point to the same studies rendered on the artifact host.

## The design studies (live artifacts)

| # | Surface | Artifact |
|---|---|---|
| — | Design Language (overview: the four modes, light-as-material, the 10 principles) | https://claude.ai/code/artifact/3eb96b85-5123-40d0-b25b-a2b18a4bf09f |
| 01 | Ambient memory surface (incl. the tender, wordless case) + Lean-in glass stack | https://claude.ai/code/artifact/723c753d-2295-4485-9c8a-8c43b5e0929f |
| 02 | The hero line — length-responsive type system, 3–4m legibility | https://claude.ai/code/artifact/16693eb8-84a2-4f35-a977-a76341a2ca60 |
| 03 | The arrival "welcome home" card | https://claude.ai/code/artifact/ff244753-4b06-4325-81ba-ba6bec27a920 |
| 04 | Colour & atmosphere token reference | https://claude.ai/code/artifact/c21b8daf-ecb8-4f0d-b5b8-a94c92d98c08 |
| 05 | The ambient night clock | https://claude.ai/code/artifact/0172bb5c-ad52-4d60-8796-9f02bcda5e54 |

## The decisions, distilled

**The spine — four presence modes** (one continuous room, presence sets the floor):
- **Ambient (0)** — nobody near. Near-textless: weather-tinted photo, a dim clock, a rare earned memory. Glass *dissolves*.
- **Glance (1)** — motion, <2s. One scored hero line. Glass dissolves.
- **Lean-in (2)** — dwell 30s+. The next 3 things, curated. **The only mode where glass earns its edges.**
- **Conversation (3)** — voice. Reserved (no mic yet); the `MODE.VOICE` seam exists.

**The hero line is length-responsive** (three tiers by character count; shorter = bigger; the longest permitted line still clears the 4m legibility floor). Copy is trimmed by the temperament (`personality.phrase`) *before* it's set, so type never has to shrink below legible. Cap-height ~27–37mm on the 32" 1080p panel (~69 ppi).

**Colour has two halves:** *borrowed light* (the `atmo-*` weather washes + the time-of-day `--accent`) is the only source of colour and comes from the sky, never chrome; *fixed inks & signals* (`--ink` #eef3fb / never pure white, status semantics, the reserved `--warm`) never shift, so legibility holds in any light.

**Glass is all-or-nothing** — the five properties (`--glass-bg / -border / -blur / -shadow / -sheen` + radius) travel together, never piecemeal.

**Invariants that are code, not taste:**
- **Tender memories** (`sensitivity:"tender"`) are ambient-only, **never captioned**, held longer — enforced in `memoryEngine.toSurface`.
- **Silence is the default.** Most of the time, nothing surfaces. `shouldSpeak()` is the one gate and its default answer is no.
- **One voice.** Every line routes through `personality.phrase`; delight fires ≤ 2–3×/year on a hard budget.
- **Never move for a reason the room can't see.** *(Replaced "0% GPU at rest" on 2026-08-01 when the dashboard moved to the G11 — `DESIGN_SYSTEM.md` §0.1 has the evidence.)* Motion may be continuous and may live on the resting ambient surface, **provided the room can attribute it to something outside the screen** — the sun moved, rain started, someone came home, the track changed. Decorative loops, breathing and drift are still banned. Cause test: `DESIGN_SYSTEM.md` §5.1. Budget: §5.4.

## Working with Claude Design (visual-first; code is the medium)

1. **Ingest the repo.** Have Claude Design read this codebase so it uses `variables.css` tokens + `docs/STYLE_GUIDE.md` conventions + this brief. Fonts are already loaded in `index.html` (Barlow Condensed / Inter) — the artifact fallbacks are only a host limitation.
2. **One surface per session.** Give it the target artifact for that component and ask it to render that surface on the canvas using the real tokens. Refine via chat / inline comments / sliders.
3. **Keep it shippable on the canvas** — pass the constraints below so the design doesn't collide with the Pi.
4. **Hand off via the Claude Code bundle**, then land it with the shipping discipline (next section). Claude Design shapes the look; Claude Code makes it shippable.

### Prompt seed (adapt per surface)

> Read this repo and apply `src/css/base/variables.css` tokens and `docs/STYLE_GUIDE.md`
> conventions. Render **[surface]** on the canvas, matching the target look in
> [artifact URL]. Constraints: dark, weather-tinted ground; Barlow Condensed
> (display) + Inter (body), already loaded; **motion is available and may be
> continuous, but every moving thing must report a cause outside the screen —
> the sun, the weather, an arrival, the track. No decorative loops, no breathing,
> no drift-for-its-own-sake; animate compositor properties only**; text legible at 3–4m;
> colour comes only from the `atmo-*` wash / `--accent`, never chrome; glass uses
> all five glass tokens together. Don't fork the token system — extend it.

## Shipping discipline (the Claude Code handoff)

Every landing follows the loop that shipped Phases 1–10:

- **Behind a `features.*` flag** in `src/js/config.js`; flag-off must be byte-identical; one-line revert.
- **Extend `variables.css`, don't fork it.** Touch the real component (`focusHero.js`, `screensaver.js`, `arrivalGreeting.js`, `atmosphere.js`, the matching `src/css/`), follow `docs/STYLE_GUIDE.md`. No parallel CSS tree.
- **Motion passes the cause test** (`DESIGN_SYSTEM.md` §5.1) and lands inside the §5.4 budget — verify with `/kiosk-metrics`. Quiescent ambient (no active cause) is the tight one: ≤ 8% of one core.
- **Photos are real** (Immich / screensaver), not gradients.
- **`npm test` green**, then **deploy flag-off (no-op) → flip on the Pi → verify at 3–4m + `/kiosk-metrics` flat → default-on.** Dev-session rendering is unreliable (see `CLAUDE.md`); verify on the actual panel.

## Suggested order (lowest risk → highest signal)

1. **The hero line** (study 02) — self-contained, no layout upheaval, and the type scale + voice link is the highest-signal win. `focusHero.js` + its CSS.
2. **The ambient clock** (study 05) — isolated, Mode-0 only, GPU-safe.
3. **The lean-in stack** (study 01) — the glass system; touches the DWELL reveal.
4. **The arrival card** (study 03) — a self-contained overlay; ties to the delight registry.
5. **The ambient memory surface** (study 01) — subtle, grief-capable; do it once the surrounding system feels right.
