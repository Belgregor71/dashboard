# CLAUDE.md

## Project: Kiosk Dashboard (GMKtec G11, migrated off a Raspberry Pi 4 on 2026-08-01)

### Architecture

- **Two frontends coexist.** `src/js/` is the incumbent; `src/v3/` is the current surface.
  Vite builds both entries. `/` serves V3 (`server/config.js:45`, `DEFAULT_ROOT_SURFACE`);
  `/index.html` and `/v3/` stay reachable whichever way it points. **Check which surface a
  change targets before editing** — the same feature often exists in both.
- **V3 is not standalone**: it imports ~26 modules from `src/js/`. The incumbent tree is a
  live dependency, not dead code — don't delete from it on an audit's say-so.
- `server.js` mounts `server/routes/*.js` (26 route modules) under `/api`. Route order
  matters — see the measured comments in `server.js` around the static mounts.
- Scripts: `npm run dev` (vite) · `npm run build` (vite + copy-static-config) ·
  `npm start` (node server.js, port 3000) · `npm test` (Playwright) ·
  `verify:contrast` `verify:flags` `verify:patterns` `verify:contracts` `verify:v3-coverage`
- **`CLAUDE.md` and `.claude/skills/` have a gitignored agent-facing mirror** (`AGENTS.md`,
  `.agents/skills/` — the skills there cite the house rules by section name). Regenerate
  after editing either: `node scripts/mirror-agents.mjs` (`--check` verifies without
  writing). It is deliberately **not** a blanket find/replace — vendored skills and
  `$HOME`/URL paths are guarded; read the script header before widening the rule.

### Verification & Deployment

- This dashboard runs on a **GMKtec G11 mini PC** (AMD Ryzen Embedded R2514, Vega 8, 16 GB, Debian 13 + X11) driving a 32" landscape display. It ran on a Raspberry Pi 4 until 2026-08-01; that Pi is retained as the warm rollback host. A fix is not complete until verified on the actual kiosk display / live environment — dev-session rendering is often unreliable (lottie icons, camera snapshots, TTS timing). Don't declare a fix done while it's still "pending kiosk retest".
- Deploys are pull-based: pushing to `origin/main` triggers the kiosk's `dashboard-deploy.timer` (polls every 5 min; pulls, `npm run build`, restarts `dashboard.service`). Trigger immediately with `ssh pi-dashboard 'sudo systemctl start dashboard-deploy.service'` (oneshot — blocks until done). Use the `/deploy` skill for the full ship-and-verify loop.
- Access: **`ssh pi-dashboard` → the G11** (192.168.0.183, user `dashboard`, repo at `/home/dashboard/dashboard`). The alias name is **historical and deliberately unchanged** — keeping it means the deploy chain, all 7 skills and the pre-approved permissions need zero edits. The Pi 4 rollback host is **`ssh pi4-rollback`** (192.168.0.186); its kiosk is disabled but `dashboard.service` + `dashboard-deploy.timer` stay running so it remains code-current. Dashboard serves on port 3000 (systemd sets `PORT=3000`, and `.env.example:1` now agrees). Kiosk Chromium exposes CDP on 127.0.0.1:9222 (localhost only — run a node script on the kiosk host to reach it).
- **Host-specific gotchas on the G11:** `vcgencmd` does not exist — read `tempC` from `/api/system/metrics` (autodetects `k10temp`; `/sys/class/thermal/` is absent entirely). `nproc` is **8**, not 4, so every "% of the box" derived from `gpucpu.sh` changes denominator. `sudo` is narrowed to three passwordless systemctl commands; anything else needs a password. Baselines for both hosts live in `docs/audit/HOST-BASELINES.md`.
- During long sessions, commit working progress locally in small checkpoints — but don't push until verified, because pushing to main deploys to the live kiosk.
- **Surface rollback needs no deploy:** `V3_DEFAULT=0` in the kiosk's `.env` + a
  `dashboard.service` restart forces the incumbent back in place; `=1` forces V3.
  Unset falls through to the committed default. `root-surface.spec.js` pins that default.

### Feature Flags

- Ship new dashboard features flag-gated and default-off; the flag-off build should be
  byte-identical (or behaviorally identical) to before. Flip the default to on only after
  live Pi verification.
- Every flag must be cleanly reversible — flipping it off is the rollback path, so verify
  the off state still passes tests after the flip (flag flips have broken tests that
  assumed the old default).
- Flags live in `src/js/config.js` under `features:` (~78 flags), copied to
  `static/js/config.js` on every build. That file is **tracked and shipped in the
  public bundle** — never put a secret or an address in it.

### Testing & Pre-Push Gate

- `npm test` runs the Playwright suite — ~100 spec files in `tests/`, spanning API
  contracts (`api.spec.js`), a browser smoke test (`ui.spec.js`), and per-feature specs.
  Browser specs need `npm run build` first. Test server runs on port 3210 with AI
  upstreams stubbed off (no API spend). Target one file when iterating:
  `npx playwright test tests/<name>.spec.js`.
- `.githooks/pre-push` runs 6 gates (~60s): a `TEMPORARILY FLIPPED` config abort,
  contract scan, build, `npm test`, known-defect pattern scan, contrast sweep.
  Flag reversibility is deliberately NOT here (too slow) — it runs in `/flag-flip`.
  Wire per clone: `git config core.hooksPath .githooks`. Never `--no-verify` unless asked.
- Contract-test philosophy: upstreams (HA, Sonarr, calendars) may be down on any machine,
  so tests assert known status sets + JSON shapes, never live data. When adding a server
  route, add its contract test in the same change.
- Root-cause test flakes rather than retrying them. Recurring causes: hooks registered
  after an async load completes (register before `await`), and time-of-day dependence
  (screensaver auto-engages after sunset; sunrise/briefing windows) — pin the clock
  (e.g. MIDDAY) in specs that assume the awake view.
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
- **Any process-matching over SSH is SELF-matching — this is broader than `pkill -f` and has
  now killed a session twice, the second time while deliberately avoiding `pkill`.** The
  pattern you are matching on is *in the command line of the very shell running the match*:
  `ssh host 'for p in $(ps -eo pid=); do grep -q myprofile /proc/$p/cmdline && kill $p; done'`
  finds its own `bash -c` and kills it (SSH exits 255). Moving the loop into a script file is
  **not** enough — the pattern is still `argv[1]`.
  - Safe recipe: exclude `$$` **and the whole ancestor chain** (walk field 4 of `/proc/$p/stat`
    up to PID 1), then match. Prefer targeting by port, PID file, or `pgrep -x <exact-binary>`
    over matching a command-line substring at all.
  - **Same trap in measurement form:** a "how many are left?" check that greps for the pattern
    counts *itself* and its subshell. A detector that matches itself reported 2 survivors when
    the true answer was 0 — verify with something the probe cannot be (a dead port, an absent
    profile dir), never with a count that includes the counter.

### UI / CSS Workflow

For CSS/UI work against a reference image: pin down the target spec first (exact colors, sizes, icon list), then use Playwright to screenshot and measure (getBoundingClientRect, computed styles) before claiming alignment is correct. Match daypart icons, dial shapes, theme colors, and font sizes explicitly.

### Root-Cause Discipline

In debugging sessions, state the root-cause hypothesis and the specific evidence (logs, config, live captures) that supports it before changing any code. Only patch once the cause is confirmed — first fixes aimed at guesses have repeatedly been reverted.

Every new behaviour should pass a simple test: Does this make the next glance more useful, calmer, or more delightful?
