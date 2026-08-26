# Handover — two docs still gate on a law repealed 25 days ago

> # ✅ DONE — 2026-08-26. Docs-only; nothing deployed.
>
> **Kept as the record of the diagnosis, not as work to pick up.** Both fixes shipped, plus a
> third instance this document’s own grep could not see.
>
> **FIX 1** (`DESIGN_ROLLOUT.md`) — done as suggested. The `Verify` gate now reads *quiescent
> ambient ≤ 8% (`DESIGN_SYSTEM.md` §5.4)* with the `(Was …; revised 2026-08-01)` annotation, and
> “the invariant the 0% gate depends on” became “the invariant the **quiescent-ambient** gate
> depends on”. The reason clause was kept verbatim — only the number moved.
>
> ⚠ **§3 misattributes that line, and overstates the urgency.** The gate is in **WP-D**’s
> `Verify` row, not WP-A’s — WP-A is *“Drop the ABC news ticker”* and never touched the ground.
> More to the point, **every WP in this file is ✅ SHIPPED except WP-E**, and WP-D shipped
> 2026-07-13 (`15b4793`): nobody was ever going to run it and fail the bar, so it was a stale
> *record*, not the live ship gate §3 describes. The edit still stands — WP-D’s row is the
> reference for the two follow-ups it explicitly defers (the weather-based living accent and the
> day-boundary photo cross-dissolve), which **are** unshipped and would be verified against it.
> Right fix, wrong reason.
>
> **FIX 2** (`homeos-design-language.html`) — **owner chose the marker**, on the evidence that
> `d64d25c` added it as one of “the six HomeOS design studies … as standalone HTML” and nothing
> in the repo links to it: a period study, not live guidance. A `.superseded` banner now sits
> above the hero in the voice of `design_handoff_homeos_home/README.md:22`, built from the
> study’s own tokens and `.wrap`/`.eyebrow`, verified rendering in **both** themes with zero
> page errors. **:519 and :554 keep their 0% figures** — the banner names both by their exact
> wording, so the record of the old law survives inside the document that asserts it.
>
> ⚠ **A THIRD instance, and §6 predicted its shape exactly.** `DESIGN_ROLLOUT.md:125-126`
> — WP-D’s shipped-record, *“gpu-process 0% over 25s in Mode 0 … AND 0% awake-idle”* — is
> **not matched by §5’s grep**: the string is `0% awake-idle`, which has neither “rest” nor
> “idle” in the guarded position. Found by grepping the **number** (`grep -n "0%" | grep -v
> "100%"`), which is what §6 says to do and what §5 did not encode. It is the same file §3
> was already fixing, mentioning the rule a **third** time, 11 lines above the second.
> Annotated rather than rewritten (it is a measurement, so §4’s precedent applies) — but WP-D
> shipped 2026-07-13, *before* `560a32d` fixed `gpucpu.sh`, so those zeroes mean **“below
> ~25% of a core”**, not zero. Un-annotated it read as evidence the repealed law was once met.
>
> ⚠ **§5’s grep is therefore still incomplete.** If this drift is ever automated into the
> pre-push gate, gate on the **number**, not on either phrase.
>
> Not touched, as instructed: the exempt handoff bundle (`git diff` names 2 files, neither in
> it), the seven correct instances in §2, `homeos-ambient-clock.html:176` per §4, and
> `docs/vision/phase-7-dissolve.md:13`, which already carries its own correction.

> **Status at the time of writing: not started, fully unblocked. Docs-only change — no code,
> no flag, no deploy.** *(Superseded by the banner above — everything below is the handover as
> it was handed over, left unedited so the diagnosis and the fix can be read against each other.)*
> The diagnosis below is finished and verified against the files; what is left is two edits,
> one grep, and a decision about whether to file it in `BACKLOG.md`.

**One sentence:** *"0% GPU at rest"* was repealed **2026-08-01** when the wall moved to the
G11 and replaced by the three-row budget in `DESIGN_SYSTEM.md` §5.4 — seven documents were
updated, **two were not**, and one of the two is a **ship gate that can never pass**.

Found by a `/graphify` update on 2026-08-26, which surfaced the contradiction from two
directions at once (the handoff README striking the law out, and the design-language study
still asserting it). The graph is the map; every line below was then verified in the file.

---

## 1. What replaced the law — read this first, do not re-derive it

`docs/design/DESIGN_SYSTEM.md` §5.4, measured 2026-08-01 on the G11:

| State | Ceiling (gpu-process) | Measured |
|---|---|---|
| **Quiescent ambient** — no legal cause active | **≤ 8%** | 3.1 |
| **Live ambient** — a legal continuous cause is running | **≤ 25%** sustained | — (new) |
| **Peak episode** — a moment, and must decay | **≤ 35%** | 22.5 |

§5.4 names the quiescent row *"the heir to '0% at rest'"*. The law that replaced it is
§0 law 1, **"never move for a reason the room can't see"** (evidence in §0.1); the cause
test is §5.1.

🔑 **Why it was repealed, not merely relaxed** — `docs/audit/HOST-BASELINES.md:62`,
Correction 3: **"0% GPU at rest" is measurably false in daylight.** Daylight Mode-0
ambient costs ~5× the night figure the old law was written against. The old rule did not
become inconvenient; it became **untrue**. Anything that restates it is asserting a
measured falsehood, which is why this is worth fixing rather than leaving.

---

## 2. What is already correct — DO NOT TOUCH

Seven places retired the law properly and agree with each other. Re-editing them is the
main way to make this change worse:

`docs/design/BRIEF-AMBIENT-2030.md:46` (the verdict) · `docs/design/DESIGN_SYSTEM.md:45,373,546` ·
`docs/design/PLAN.md:19` · `docs/design/README.md:46` · `docs/design/DESIGN_ROLLOUT.md:27` ·
`docs/audit/HOST-BASELINES.md:62,159`

⚠ **`docs/design/design_handoff_homeos_home/` is EXEMPT and must stay exempt.** Its
`README.md:22` strikes the law through and declares the whole bundle *"a frozen conformance
spec for what shipped under the old law; it is not being rewritten."* So `README.md:87`
("0% GPU at rest") and the seven screenshots are **correct as they stand** — they describe
what shipped under the old law. Editing that bundle to match today's law destroys the only
record of the old one. **Leave it alone.**

⚠ **The code side is already migrated — do not "fix" it.** `tests/insights.spec.js:677`
carries the rewritten guardrail: it no longer asserts stillness, it asserts *attributability*
(an atmosphere animation is legal only if bound to a cause the room can see; a
`LIGHT_TOKENS`-only rule may not animate, because §5.1 rules that the passage of time is not
a cause). Nothing in `scripts/kiosk/` or `.claude/skills/kiosk-metrics/` enforces 0%.

---

## 3. The two fixes

### FIX 1 — `docs/design/DESIGN_ROLLOUT.md:136` · **the real one, it is a gate**

This file contradicts itself **109 lines apart**. Line 27 already says the guardrail was
revised. Line 136, in **WP-A's `Verify` row**, still reads:

```
**`/kiosk-metrics` GPU 0% at rest is the gate** — a static awake photo must not
reintroduce compositing cost.
```

and line 134 calls it *"the invariant the 0% gate depends on"*.

🔑 **This is the only operative instance.** It is a **ship gate**, not prose — anyone
running WP-A off this document fails a bar that no longer exists and that the G11 cannot
meet: quiescent measures **3.1%**, and the ceiling is **≤ 8%**. A gate that can never pass
gets bypassed, and a bypassed gate stops catching the thing it was for.

**Do:** re-gate on the §5.4 quiescent row. Keep the *reason* — the sentence after the gate
("a static awake photo must not reintroduce compositing cost") is still exactly right and is
the whole point of WP-A; only the number is wrong. Suggested shape, matching how line 27
already annotates itself:

```
**`/kiosk-metrics` quiescent ambient ≤ 8% (`DESIGN_SYSTEM.md` §5.4) is the gate** —
a static awake photo must not reintroduce compositing cost. *(Was "GPU 0% at rest";
revised 2026-08-01 for the G11, see §0.1.)*
```

Line 134's "the invariant the 0% gate depends on" needs the same treatment — the invariant
it describes (**static-at-rest**: no per-photo timer, no Ken Burns while awake) is still the
decision; only its name is stale.

### FIX 2 — `docs/design/homeos-design-language.html:519` and `:554`

- **519:** `One resting wash that settles over <code>--atmo-settle</code> (60s) and comes to rest. No loops — <strong>0% GPU at idle</strong> is the hard floor.`
- **554:** table row — `<td>everything else — 0% GPU</td>`

Stated as live rules. This file carries **no** frozen-spec marker, so it reads as current
guidance — unlike the handoff bundle in §2.

**Do:** either add a superseded marker at the top in the same voice
`design_handoff_homeos_home/README.md:22` uses, **or** replace the two figures with the
§5.4 quiescent row. Prefer the marker if the document is understood to be a period study;
prefer the figures if it is live guidance. **This is a judgement call about what that
document is for — it is the owner's, not the next session's.** Ask before choosing.

⚠ Note the wording differs from every other instance: **"0% GPU at *idle*"**, not *at rest*.
A grep for `at rest` alone will miss it. That is how it survived the 2026-08-01 sweep.

---

## 4. Explicitly NOT a fix

`docs/design/homeos-ambient-clock.html:176` — a stat tile reading `0%` / `GPU · it only
ticks`. This is a **claim about that mock's measured cost**, not a statement of law. It was
reported as a third stale assertion during the trace; it is not one. Recorded here as a
decision so it is not re-litigated: **no action**.

---

## 5. Verification

Docs-only, so there is nothing to deploy and no flag to flip.

```bash
# 1. No live assertion of the old law survives outside the exempt bundle.
#    MUST match "at idle" as well as "at rest" — that is the one that got missed.
grep -rniE "0% ?gpu|gpu at (rest|idle)|0% ?(at )?(rest|idle)" docs/ \
  | grep -v "design_handoff_homeos_home"

#    Every remaining hit must be an explicitly-marked historical reference
#    (BRIEF "repealed", DESIGN_SYSTEM §0.1 "the old law read", HOST-BASELINES
#    "measurably false", or a "(Was ...; revised 2026-08-01)" annotation).

# 2. DESIGN_ROLLOUT no longer contradicts itself.
grep -n "0%\|§5.4\|quiescent" docs/design/DESIGN_ROLLOUT.md

# 3. Nothing else moved.
git diff --stat    # expect exactly 2 files
```

- **No `node scripts/mirror-agents.mjs` run needed.** The mirror covers `CLAUDE.md` and
  `.claude/skills/` only; `docs/design/**` is not mirrored.
- `npm test` is unaffected by a docs change, but `tests/insights.spec.js` is the related
  guard if anything in §2 gets touched by accident.
- No `verify:*` script checks doc consistency. **This class of drift has no automated
  catcher — a `grep` in the pre-push gate would be the cheap fix if it recurs.**

---

## 6. The shape worth remembering

The 2026-08-01 rewrite updated seven documents and missed two. Both misses share a cause:
**the sweep matched the phrase, not the concept.** `homeos-design-language.html` said
*"at idle"* instead of *"at rest"*, and `DESIGN_ROLLOUT.md` had already annotated its
*guardrail* at line 27 — which made the file look done — while a second copy of the same
rule sat 109 lines lower in a table cell.

Same shape as the literal-sweep blind spot the 2026-07-26 audit warned about and then fell
into itself: **a literal sweep cannot see a restatement.** When a law is repealed, grep the
*number* (`0%`) and the *concept*, not the phrase, and check whether a file that mentions
the rule mentions it **more than once**.

---

Related: `docs/design/DESIGN_SYSTEM.md` §0.1 §5.1 §5.4 · `docs/audit/HOST-BASELINES.md`
(Correction 3, the motion budget) · `docs/design/BRIEF-AMBIENT-2030.md` (decision 2) ·
`tests/insights.spec.js:677`
