# scripts/ — the local-model lanes (history and gotchas)

Moved out of the root `CLAUDE.md` "Model Routing" section on 2026-10-09 so it loads
only when a session works under `scripts/`. The rules themselves (the routing table,
`/xreview` DISABLED, inject-the-defect, unload the model before `npm test`) stay in
the root file; this is the evidence and the lane mechanics behind them.

## Why the review lane is disabled

**⚠⚠⚠ Cross-model review is DISABLED. Do not run `/xreview`, and do not add it
back to a workflow without re-measuring.** Removed from step 2 of `/deploy` on
2026-08-30 after **seven consecutive runs returned 0 tool calls** — the model
never opened a single file, so nothing it produced was a read of the code. What
it emitted was plausible-sounding findings generated from the diff text alone:
once a list of the spec file's own `test()` names each rewritten as a defect,
twice a change's deliberate design decisions restated as bugs (it reported that
a function "does not distinguish between an empty result and a failure" when
that distinction was the entire commit), and once the same finding looped a
dozen times until it was cut off mid-word.

🔑 **The tell is the tool-call count in the header line, not the diff size.**
Two runs at 45.1 KiB and 17.7 KiB both did zero. If a run ever is revived, read
that number first and discard the output entirely when it is 0.

It cost 300-460s per deploy plus the time spent disproving each finding, against
a measured yield of nothing. The harness is kept — `scripts/xreview-local.mjs`,
the LM Studio lane and the read-only tool surface are sound — for when a better
local model lands.

## The local lanes

**The two local lanes pin DIFFERENT models, and swapping is automatic.** Measured
on identical tasks: `devstral-small-2505` reviews far better (same recall, clean
case 135s against 1,700s) and extracts far worse (13/19 against gpt-oss's 19/19).
The better reviewer is the worse grepper. Each script loads what it needs — a
reload costs about a minute, a quietly wrong answer costs more. LM Studio itself
is started on demand, so there is nothing to remember after a reboot.

**The bulk lane runs on your own machine.** `scripts/xbulk.mjs` talks to LM Studio's
OpenAI-compatible server on 127.0.0.1:1234 (`lms server start`) — no key, no quota,
no network, nothing leaves the box. Oversized input is **map-reduced, not truncated**:
a 101-spec test run is far bigger than a local model's context, and silently dropping
the tail would produce a clean report that never saw the failures. Give it extraction,
never judgement.

## Gemini and Codex

**⚠ The Gemini path is quota-dead** — and now moot, since the review lane it fed
is disabled. The free tier is **~20 requests/day per model**, not the 1,000–1,500
every source claims, and an agentic review is 10–30 requests. `scripts/xreview.mjs`
and `scripts/xreview-local.mjs` are both kept against a better model arriving;
neither is wired into anything.

**⚠ Gemini auth is an API key, not a Google sign-in.** Google retired Gemini Code
Assist for individuals on this client; OAuth now *succeeds* and then refuses the
tier (`IneligibleTierError`), which reads like a broken login and is not one.
Key from <https://aistudio.google.com/apikey> into `.gemini/.env` — which wins
over `.env` in the lookup order, so the reviewer never loads the HA token.

**Codex is not wired up.** It needs a ChatGPT Plus subscription or a metered API
key. `.codex/hooks.json` and the `AGENTS.md` mirror are already in place, so
adding it later is auth and a runner script, nothing structural — worth
reconsidering now that Gemini's free tier is Flash-class rather than Pro.
