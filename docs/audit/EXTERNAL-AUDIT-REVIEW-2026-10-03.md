# External audit — review and disposition (2026-10-03)

An outside, static-only audit of the repository was reviewed against the tree. This records what was acted on, what was declined, and what is still the owner's call. The audit itself is not reproduced here.

## Verdict

**YES-BUT.** Every citation that was opened checked out, so the audit is factually sound. Most of its plan is hardening for an internet-facing, multi-user application, which this is not. Four items were worth acting on; three are done in this change and one is reported for a decision.

The audit ran 4 of its 2,203 counted tests (no Chromium) and never saw the live box. Its functional and performance sections are therefore reading, not measurement.

## 1. Acted on

| # | Finding | Change |
|---|---|---|
| 1 | `/env.js` published `HA_HOST`, `GO2RTC_HOST` and `HOME_BASE` (a home address) to every LAN client. Nothing in `src/`, `static/`, `tools/` or `scripts/` read them. This was S9 in `AUDIT-2026-07-26.md`, still open. | The three keys are removed from `publicEnv` (`server/routes/system.js`). `HOME_BASE` then had no reader at all, so it also left `.env.example` (`env-example.spec.js` went red until it did). The line still in the G11's `.env` is inert. |
| 2 | Five writes whose only caller is the wall page were open to any LAN client that is not a browser. | `loopbackOnly` on `PUT /api/routines`, `PUT /api/delight`, `POST /api/presentations`, `POST /api/immich/hidden` and `POST /api/immich/hidden/undo`. |
| 3 | Four handlers returned raw `error.message`. | `routines.js`, `delight.js` and `presentations.js` (twice) log the error and return a fixed string. |

Rollback for item 2 without a deploy: `ALLOW_LAN_COST_ROUTES=1` in the box `.env`, then restart `dashboard.service`. Otherwise revert and deploy.

### Tests

`tests/api.spec.js` gained a two-leg block for the five writes, in the shape of the census block (audit S2): the routers are mounted on an ephemeral server bound to every interface, the LAN leg dials this machine's own IPv4, and the loopback leg is the positive control. Each body is one the handler refuses, so nothing is written to `data/`. The undo route has no body to refuse, so its guard is called directly with a LAN socket address. The `/env.js` test now asserts the three keys are absent.

Seven defects were injected, one at a time, and each turned its test red for the reason the test names:

| Injection | Result |
|---|---|
| Guard removed from `PUT /api/routines` | RED: expected 403, received 400 |
| Guard removed from `PUT /api/delight` | RED: expected 403, received 400 |
| Guard removed from `POST /api/presentations` | RED: expected 403, received 400 |
| Guard removed from `POST /api/immich/hidden` | RED: expected 403, received 400 |
| Guard removed from `POST /api/immich/hidden/undo` | RED: "a LAN request reached the undo handler" |
| `HA_HOST` put back in `/env.js` | RED: "/env.js publishes HA_HOST again" |
| Guard on `PUT /api/routines` replaced by one that refuses everyone | RED: loopback leg expected 400, received 403 |

## 2. Reported, not changed: `GET /api/immich/map`

Read from the code, not probed on the box:

- **Disk growth: refuted.** `getMapTile` (`server/services/dailyMemories.js`) keys tiles at three decimal places and `pruneDaily` caps the directory at 300 files.
- **Billed calls: confirmed by reading.** Every distinct three-decimal coordinate is a cache miss and one Mapbox Static Images request on the private `MAP_API_KEY`. The only ceiling is the global limiter, 600 requests a minute per LAN address.
- **No page calls the route.** A grep of `src/`, `static/` and `tests/` finds it only in `tests/api.spec.js`. The server warms tiles itself through `warmSet`, which calls `getMapTile` directly.

`MAP_API_KEY` is set in the G11's `.env` (key name counted over SSH, 2026-10-03), so the route is live there. The route itself was not exercised from the LAN, to avoid spending the key.

Options for the owner: `loopbackOnly` on the route (one line, same pattern as above), or delete it with the other orphan routes already awaiting a decision.

## 3. Declined, with the reason

| Audit item | Disposition |
|---|---|
| `loopbackOnly` on recipe and memory writes | No. `static/recipes/app.js` and `static/memories/app.js` are the phone portals; LAN writes are their purpose. |
| Bind the server to loopback | No. Same reason, and it removes `/admin/photos`. |
| CSP enforced by default | Already enforced on the G11 since 2026-09-13. The committed report-only default is deliberate. |
| Three events with no subscriber | Already documented with a reason in `tests/fixtures/event-registry.js`. |
| "Lower-powered rollback hardware" | Stale. The Pi 4 was retired 2026-10-03. |
| "Critical: public exposure" | Hypothetical. Nothing suggests port 3000 is forwarded; the advice is "do not", and needs no code. |
| Host-header trust in the write guard | Not an issue: a client forging both headers is not a browser, and non-browser clients pass by design. |
| Basic auth over plain HTTP for `/admin` | True. Accepted in July; the fix is TLS on the LAN. |
| Bundle size and code splitting | Served over loopback to an 8-core box. |
| Seven `setInterval`s into one scheduler | They are init-once and guarded, which is the house rule. |
| Default-deny policy registry, sessions, roles, central config, TypeScript, structured logging, module splits | Multi-day rewrites with no defect behind them. |
| Redundant `/photos` and `/icons` static mounts | Plausibly redundant and harmless. Not touched: mount order in `server.js` is measured. |

## 4. Still the owner's call

- **Camera routes and `GET /api/ha/states` are readable by any LAN device.** This is the audit's most substantive remaining point. Making them loopback-only is about ten lines, and it ends viewing the dashboard from a PC or phone browser; `scripts/fault-injection.mjs` also reads `/api/ha/state/…` from off the box.
- **`/api/ha/shopping_list` writes.** S7 in July, closed then as covered by the origin guard. Their callers were not traced in this review.
- **Self-hosted fonts.** The one optional item with a kiosk benefit: the wall boots with the internet down and two CSP origins go away. A separate, wall-visible change.
- **A route-policy spec.** A contract test that goes red when a mutating route is neither `loopbackOnly` nor on an explicit LAN-writable list. Not built.
