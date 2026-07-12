# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## Project: Raspberry Pi Kiosk Dashboard

### Verification & Deployment

- This dashboard runs on a Raspberry Pi 4 kiosk (32" landscape display). A fix is not complete until verified on the actual Pi display / live environment — dev-session rendering is often unreliable (lottie icons, camera snapshots, TTS timing). Don't declare a fix done while it's still "pending Pi retest".
- Deploys are pull-based: pushing to `origin/main` triggers the Pi's `dashboard-deploy.timer` (polls every 5 min; pulls, `npm run build`, restarts `dashboard.service`). Trigger immediately with `ssh pi-dashboard 'sudo systemctl start dashboard-deploy.service'` (oneshot — blocks until done). Use the `/deploy` skill for the full ship-and-verify loop.
- Pi access: `ssh pi-dashboard` (192.168.0.183, user `dashboard`, repo at `/home/dashboard/dashboard`). Dashboard serves on port 3000 on the Pi (systemd sets `PORT=3000`; the 3001 in `.env.example` is not what runs). Kiosk Chromium exposes CDP on 127.0.0.1:9222 (localhost only — run a node script on the Pi to reach it).
- During long sessions, commit working progress locally in small checkpoints — but don't push until verified, because pushing to main deploys to the Pi.

### Testing & Pre-Push Gate

- `npm test` runs the Playwright suite: API contract tests (`tests/api.spec.js`) and a
  headless browser smoke test (`tests/ui.spec.js`). The smoke test needs `npm run build`
  first. Test server runs on port 3210 with AI upstreams stubbed off (no API spend).
- A pre-push hook (`.githooks/pre-push`) runs build + tests before any push — because
  pushing to main deploys the Pi. Wire it per clone: `git config core.hooksPath .githooks`.
  Never bypass with `--no-verify` unless the user explicitly asks.
- Contract-test philosophy: upstreams (HA, Sonarr, calendars) may be down on any machine,
  so tests assert known status sets + JSON shapes, never live data. When adding a server
  route, add its contract test in the same change.
- New-bug pattern the suite exists to catch: uncaught page errors on the kiosk. Note
  `.finally()` re-throws rejections on a fresh unhandled chain — use a two-handler
  `.then(fn, fn)` for cleanup on promises whose rejection is handled elsewhere.

### 24/7 Kiosk Memory Discipline

The page runs for weeks without a reload; slow leaks are the primary failure mode
(2026-07 audit: 709 zombie lottie wrappers, 230k detached DOM nodes, every TTS WAV
pinned in blob storage). Rules derived from the confirmed root causes:

- Never rely on `transitionend`/`animationend` for cleanup — they never fire while the
  element (or an ancestor) is `display:none`, which most views are most of the time.
  Always pair with a `setTimeout` fallback longer than the transition.
- Every `URL.createObjectURL` needs a revoke on **all** terminal paths (loaded, errored,
  interrupted, overwritten-before-consumed). Blob memory does not show in the JS heap.
- Per-event code paths (popups, view onEnter, refresh cycles) need symmetric teardown;
  init-once `setInterval`s at startup are fine. On-disk caches keyed by dynamic text
  (TTS, AI output) need pruning — briefing text is unique daily.
- Verify with measurements, not reasoning: use the `/kiosk-metrics` skill (CDP probes on
  the Pi, known-healthy baselines, trend method). After deploys, the kiosk still runs
  the old bundle until a CDP `Page.reload`.

### Camera / Motion Pipeline

When debugging camera/doorbell staleness, check config sources (preferredSnapshot, cameraProxy vs eventImage source) BEFORE guessing at trigger/registry code — the fresh-image source has been the root cause repeatedly.

### Environment & Deployment Gotchas

- Environment config is a frequent failure point: confirm `.env` vars (HA_HOST vs HA_URL, correct port, location coordinates) match the target Pi environment before deploying. The HA token in the Pi's `.env` is double-quoted — strip quotes when extracting.
- Never use broad `pkill -f` patterns over SSH — a past pattern matched the SSH shell's own process and killed the session.

### UI / CSS Workflow

For CSS/UI work against a reference image: pin down the target spec first (exact colors, sizes, icon list), then use Playwright to screenshot and measure (getBoundingClientRect, computed styles) before claiming alignment is correct. Match daypart icons, dial shapes, theme colors, and font sizes explicitly.

### Root-Cause Discipline

In debugging sessions, state the root-cause hypothesis and the specific evidence (logs, config, live captures) that supports it before changing any code. Only patch once the cause is confirmed — first fixes aimed at guesses have repeatedly been reverted.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Every new behaviour should pass a simple test: Does this make the next glance more useful, calmer, or more delightful?

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
