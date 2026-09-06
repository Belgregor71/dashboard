# Evaluation plan — Qwen3.8-27B on Mandragon, and DeepSeek Harness

Written 2026-09-06. **Nothing here has been run.** This is the plan, not a result.
Every number below marked *measured* was measured somewhere else, on other
hardware, by someone else; every number marked *estimate* is a guess. The whole
point of the plan is to replace both with numbers from this box.

## What this decides

One question only: **does Qwen3.8-27B replace `devstral-small-2505` on the review
lane, `gpt-oss-20b` on the bulk lane, both, or neither?**

It is worth answering because the model's advertised strength is the exact
failure that killed the review lane. `/xreview` was retired on 2026-08-30 after
**7 consecutive runs returned 0 tool calls** — the model never opened a file, so
every "finding" was speculation over diff text. That is a tool-calling-adherence
failure. Qwen3.8-27B is sold on tool-calling reliability: testers report zero
failed tool calls across a multi-hour agentic session, and an
artificial-analysis agentic index of 51 for a 27B dense model.

It is cheap to answer because **the bench already exists**.
`scripts/xreview-bench.mjs` plants two defects with known answers, runs the real
reviewer unmodified, and scores recall and precision. It takes `--model`. This
plan is mostly "use the thing that is already here".

## The box, measured 2026-09-06

| | |
|---|---|
| Host | `MANDRAGON`, Windows |
| GPU | AMD Radeon RX 9070 XT, **16 GB**, RDNA4 (`Win32_VideoController` reports 4 GB — that is the 32-bit `AdapterRAM` overflow bug, ignore it) |
| RAM | 32 GB |
| Free disk (C:) | **69 GB** |
| LM Studio, on disk | `devstral-small-2505` 14.33 GB · `gpt-oss-20b` 12.11 GB · nomic embed |
| Loaded right now | nothing |

No CUDA. LM Studio runs the **Vulkan** backend here.

## ⚠ The one fact that shapes every step: the good quant does not fit

Qwen3.8-27B is dense — all 27B parameters activate on every token, so there is no
MoE escape hatch. Published sizes and scores:

| build | size | GPQA Diamond | Terminal-Bench 2.1 (agentic) |
|---|---|---|---|
| BF16 | ~55.6 GB | ~95% | ~75% |
| Q8_0 | ~29 GB | ~94% | — |
| **Q4_K_M** | **~17.1 GB** | ~94% | **~75% — matches full weights** |
| UD-IQ3_XXS | ~11–12 GB *(estimate)* | **not published** | **not published** |
| UD-Q2_K_XL | 10.7 GB | ~93% | "noticeably lower", not useless |
| UD-IQ1_S/M | 6.2 GB | ~random chance | collapse |

**Q4_K_M is 17.1 GB against 16 GB of VRAM. Every headline agentic number belongs
to a quant this box cannot hold.** The quant that fits is 3-bit, and the
published sweep skips 3-bit entirely — it jumps Q4 → 2-bit. So the honest
position is: quality at IQ3_XXS is **unknown**, and it sits above the point where
the agentic score has already started to sag.

This is the same trap as OmniVoice's advertised RTF 0.025 — a CUDA number
available on neither host here. Do not let a Q4 benchmark stand in for a 3-bit
run.

Two further penalties, both measured elsewhere, both against us:

- **Speed:** ~20–30 tok/s at IQ3_XXS — *on a CUDA RTX 3080*. On RDNA4, a dense
  27B measured **ROCm 42.8 vs Vulkan 29.1 tok/s**. We are on Vulkan. ROCm is a
  separate project and is explicitly **out of scope here**.
- **Residency:** ~12 GB resident cannot co-exist with devstral or gpt-oss on a
  16 GB card, and a resident model **turns the Playwright suite red** —
  `v3-archive.spec.js:420` allows 500 ms for a GPU-composited transition and
  failed twice, reproducibly, with gpt-oss loaded.

---

## Phase 0 — the cheap gate (~20 min, mostly download)

**Purpose: find out whether it calls tools at all, before spending an afternoon
scoring it.** The bench's own summary does *not* print the tool-call count; only
a direct `xreview-local` run does. Run the direct one first.

```
lms server start
lms get --gguf unsloth/Qwen3.8-27B-GGUF@UD-IQ3_XXS
```

⚠ **Confirm the quant tag exists in the listing rather than assuming it.** If
`UD-IQ3_XXS` is not offered, take the largest build **at or under ~12 GB** and
write down what you actually took — the rest of this document assumes 3-bit and
its conclusions do not transfer to a different quant.
`lmstudio-community/Qwen3.8-27B-GGUF` is the fallback source; its Vulkan build
was prepared by LM Studio against llama.cpp b10430.

```
lms unload --all
lms load <model-id> --context-length 32768 --gpu max --ttl 1800 -y
lms ps
```

If 32768 will not fit alongside ~12 GB of weights, either enable **K/V cache
quantization** in LM Studio's load panel (the `q4_0` cache is what makes long
context fit on 16 GB) or drop to **16384**, which is the floor `ensureLmStudio`
enforces via `minContext`. Below that the lane refuses to start.

⚠ Load **explicitly**. A JIT auto-load uses 4096 even for a 262K-capable model
and fails mid-run with an opaque 400.

Then, against a real recent commit:

```
node scripts/xreview-local.mjs --range HEAD~1..HEAD --model <model-id>
```

**Read the last line before you read the findings:**

```
xreview-local: 456s, 0 tool call(s), 0 Claude tokens, 0 cost
```

| result | verdict |
|---|---|
| **0 tool calls** | ⛔ **STOP — but do not blame the model yet.** See the control below. |
| **>0 tool calls, coherent findings** | ✅ proceed to Phase 1 |
| **tool calls, but garbled** (`<\|start\|>assistant<\|channel\|>…` leaking into content) | ⚠ a chat-template/tool-format mismatch, not a capability verdict — check the LM Studio template before drawing any conclusion |

### ⚠⚠ The control that stops a misattribution

**A 3-bit quantization failure and a bad model look identical from here.** If
Phase 0 gives 0 tool calls, run the control **once** before concluding anything:
load **Q4_K_M with partial CPU offload** (32 GB of system RAM will hold the
spill) and repeat the same command. It will be slow — that is fine, this run is
not timed.

- Q4 also does 0 tool calls → the model is not the answer. Stop; the lane stays
  retired. Delete the weights.
- Q4 calls tools and IQ3_XXS did not → **the finding is that this box cannot
  hold a quant good enough to do the job.** That is a real and useful answer, and
  it is a different answer from "the model is bad". Record it as such.

## Phase 1 — the review bench (~1–2 h, mostly waiting)

```
node scripts/xreview-bench.mjs --model <model-id>
```

Three scored cases, run in a throwaway git worktree under the scratchpad — the
shared working tree is never touched:

- **D1** — an exported function made `async`, so every `if (fn())` caller is
  now always-truthy. **Invisible in the diff**; only found by opening a caller.
  This is the case that matters.
- **D2** — a home address added to `config.js`, which is tracked *and* shipped in
  the public bundle. In-diff and easy. It exists to catch a model that finds D1,
  feels finished, and never opens the second file.
- **FP** — a real unmodified commit. Must produce `NO FINDINGS`.

### The bar it has to clear

Both incumbents already score 2/2 recall with no false positives. **Accuracy is
not the differentiator and never was** — the whole reason devstral won the lane
is *convergence*:

| | gpt-oss-20b | devstral-small-2505 |
|---|---|---|
| D1 / D2 / FP | PASS / PASS / PASS | PASS / PASS / PASS |
| defect case | 94 s | 163 s, 154 s |
| **clean case** | **1700 s** | **135 s, 133 s** |

**The clean case is the common case, so the clean case decides it.** gpt-oss
scored identically and still lost the lane, because it never decides it is
finished — 28 minutes to say "nothing here". Same logic as the ~60 s pre-push
gate: slow enough to annoy means it stops getting used.

**PASS = 2/2 recall, no false positives, and a clean case under ~200 s.**
Anything slower is not an improvement over devstral no matter what it finds.

⚠ Run it **twice**. Devstral reproduced within 6%; a single run is an anecdote.

⚠ If both D1 and D2 miss, the bench prints a warning that says the right thing:
re-run with `--keep` and read the transcript. **A reviewer that never converged
reports nothing, which looks identical to one that found nothing.**

## Phase 2 — the extraction lane (~15 min)

Separate lane, separate verdict. **The ranking is not global.** Measured:

| | review (recall / clean case) | extract (exact match) |
|---|---|---|
| `devstral-small-2505` | 2/2 · 135 s | **13/19** |
| `gpt-oss-20b` | 2/2 · 1700 s | **19/19** |

The better reviewer is the worse grepper. Devstral was made the default for
everything once and immediately dropped a commit from an exact-match sweep.

So test it as a distiller too, and phrase every task as **"which lines say X"**,
never **"what counts as X"** — that is the measured boundary, and it is not
big-vs-small input. Give it a log with a known answer:

```
node scripts/xbulk.mjs --file <a log with a countable, known answer> \
  --task "list every line matching <literal>, verbatim"
```

**PASS = exact match, no invention, no dropped tail.** Anything under 19/19 on a
matching task means gpt-oss keeps the bulk lane.

⚠ `xbulk` map-reduces oversized input rather than truncating it — a silently
dropped tail produces a clean report that never saw the failures. Confirm the
chunk count in the output looks sane for the input size.

## Phase 3 — the vision probe (~30 min) · **HYPOTHESIS**

Unlike both incumbents, Qwen3.8-27B has **native image understanding**. This
house verifies by screenshot — `/verify-live`, `/verify-push`, the contrast
sweep, kiosk CDP captures. A free, private, unlimited local VLM that can read a
wall capture is a capability that exists in no lane here today.

**⚠ Labelled a HYPOTHESIS in those words, because it sits exactly on the
matching-vs-judging boundary where every local model here has failed.**

- *"Is there text overlapping the photo in this capture, yes or no"* — matching.
  Testable.
- *"Does this wall look right"* — judging. Do not ask it, and do not act on the
  answer if it volunteers one.

Take a CDP capture with a **known** answer — ideally one from a past incident
where the defect is visible and documented — and ask the matching form. There is
no scripted lane for this yet; a one-off call against the OpenAI-compatible
endpoint is enough to decide whether building one is worth it.

**PASS = it answers the known-answer question correctly twice, including once
where the correct answer is "no".** A model that says yes to everything passes a
one-directional probe and is useless. Inject both directions, same as any test
here.

## Phase 4 — DeepSeek Harness · **DEFERRED, with a gate**

`dsh` — DeepSeek's agent runtime, open-sourced 2026-08-13, MIT, "Model +
Harness = Agent", everything-is-a-plugin, points at any OpenAI-compatible
endpoint. It is real and it is competent. **It is not what is broken here.**

- **It replaces the half that worked.** `scripts/xreview-local.mjs` is already an
  agent loop with three read-only tools, path confinement inside the repo, and no
  write or shell tool. It scored 2/2 on planted defects with *both* models. It
  degenerated only when the model stopped calling tools. A new harness does not
  touch that.
- **Windows is second-class.** Web UI everywhere, but PTY/terminals need POSIX;
  Windows is partially supported. Mandragon is the Windows box.
- **v0.1.0-rc.5, developer preview**, explicit warning of compatibility-breaking
  changes, no stability guarantee for session formats, no terminal UI, young
  plugin ecosystem. Needs Node ≥22.19.
- **Its job description is Claude Code's.** Read/write files, run shell,
  sub-agents, session context. The delta is "free and unlimited" — which `xbulk`
  already provides for the tasks a local model is actually reliable at.

**The gate: adopt nothing until Phase 1 passes.** If Qwen3.8 gets
`xreview-local` to >0 tool calls *and* converges on the clean case, then the
question "would a fuller harness get more out of this model" becomes real and
worth its own plan. If Phase 0 or 1 fails, `dsh` would have been a week spent on
the wrong component.

---

## Verdict rules — written down before the runs, so they cannot drift

**A model replaces a lane only if it beats that lane's own incumbent on that
lane's own bench.** Not on a published benchmark table. SWE-Bench scores how well
a model *writes* a fix, not whether it finds a defect hidden outside the diff.

| outcome | action |
|---|---|
| Phase 1 PASS + Phase 2 PASS | it takes both lanes; update `preferred` in `scripts/lib/lmstudio.mjs` and re-measure the pre-push suite with it resident |
| Phase 1 PASS only | `xreview-local` un-retires **on this model only**; `/xreview` stays disabled until a second clean bench run |
| Phase 2 PASS only | gpt-oss is replaced on the bulk lane; review lane stays retired |
| Phase 3 PASS | new capability — worth its own plan, independent of 1 and 2 |
| all fail | delete the weights. 69 GB free is not lavish, and an unused 12 GB model is a trap for the next session |

**Nothing here changes a flag, a default or anything that ships to the kiosk.**
This is tooling. No deploy, no push, no flag flip.

## Hazards to respect during the runs

- ⚠⚠ **`lms unload --all` before `npm test`, every time.** A resident 12 GB model
  starves the browser's GPU compositing; `v3-archive.spec.js:420` failed twice
  reproducibly with gpt-oss loaded and passed 36/36 in isolation. With the GPU
  free the suite went 1559/1559. **A red suite is not always the diff's fault.**
- ⚠ **`lms ps` before `lms load`, always.** Loading against a resident model asks
  for a *second* copy, trips the memory guardrail ("requires approximately
  22.29 GB"), and reads like a box too small for the lane. It is not; following
  the wrong instruction caused it.
- ⚠ A load that worked has been reported as a failure before — LM Studio does not
  register a model as fast as `lms load` returns. `lms ps` showing the model
  means a **race, not a failure**. Re-run.
- ⚠ **Two sessions share this working tree.** The bench runs in a scratchpad
  worktree and sweeps stale `xrbench-*` worktrees and `xreview-bench-*` branches
  at startup — but `process.on('exit')` does not fire on a hard kill. If you kill
  a bench, check `git worktree list` and `git branch --list 'xreview-bench-*'`
  before walking away.
- ⚠ Disk: ~12 GB down from 69 GB free. Two failed quant attempts and the margin
  gets thin. Delete as you go.

## What this plan does NOT prove

- Nothing about **ROCm**. Out of scope; would be a separate project and would
  change the speed numbers by ~47% on a dense 27B, which could turn a Phase 1
  timing failure into a pass. If Phase 1 fails **on time alone** with recall
  intact, that is the trigger to consider it — and only then.
- Nothing about **long-horizon agentic work**. Every published quant benchmark is
  single-turn. A 1% accuracy loss compounds across successive tool calls, and
  nobody has measured that for any GGUF of this model, at any bit depth.
- Nothing about **Qwen3.8 Flash-Next (180B-A6B) or Max (2.4T)**. Both are far
  outside 16 GB. The 27B dense is the only member of this family that is a
  candidate here — there is no 4B, 8B or 14B in this generation.
