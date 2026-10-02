# Incumbent retirement — parity audit (2026-10-03)

**Phase 1 of 3. Read-only: no code was changed to produce this.** Decision owed by the owner: port each LOST row first, or let it go (§5).

## Verdict

**YES-BUT.** Nothing V3, the server or the build depends on reaches the 98 incumbent-only files, so retiring the incumbent is mechanically safe. **But** some household capabilities would cease to exist anywhere:

- 6 confirmed and 2 HYPOTHESIS LOST rows;
- 4 minor or option-only rows;
- 27 specs, plus the `/verify-push` contrast lane, go with the incumbent, because both measure only the incumbent.

The `V3_DEFAULT=0` rollback goes too, as the owner has already accepted.

## 1. Method

- **Delete list.** The same static walker as `tests/v3-closure.spec.js` (`importClosure`), run from `src/v3/main.js`:
  - It reaches **107 files, 54 under `js/`**. That equals the manifest's `SHARED_BOTH` + `V3_ONLY` exactly.
  - Tracked files in `src/js`, `src/css` and `src/index.html` total **153**. **55 are kept**: the 54, plus `js/config.js`, which V3 loads by `<script>` tag (`src/v3/index.html:237`). **98 are deletable.**
- **What the walker cannot see.** Each check was confirmed by reading code:
  - **Dynamic loading.** There is no `import(`, `new Worker`, `importScripts`, `import.meta.glob` or `new URL(` in `src/`. The only `import(` text is prose in a comment at `src/v3/main.js:1109`. There are no template-literal or concatenated module paths, and no `fetch("/js…"|"/css…")`.
  - **What V3's HTML and CSS load.** `src/v3/index.html` links only `./css/*.css`, `/env.js`, `/js/config.js` and `./main.js`. There is no CSS `@import` or `url()` into `src/css/` from `src/v3/css/`; the only `url()` is a data-URI at `archive.css:665`.
  - **Server.** None of the 98 is imported, required or read. The server imports exactly three `src/js` files, all on the keep list:
    - `photoMemory.js`, from `server/services/dailyMemories.js:6` and `photoNames.js:3`;
    - `displayWindow.js`, from `server/routes/display.js:4`;
    - `alertLines.js`, from `server/services/ttsWarmer.js:1` and `scripts/pregenerate-tts-cache.js:12`.
  - **Static mounts.** Nothing serves `src/`. The mounts are `dist`, `static`, `/assets`, `/photos` and `/icons` (`server.js:208-219`). `/` is `sendFile(dist/SURFACE_ENTRY[resolveRootSurface(env)])` (`server.js:199-203`). `/index.html` reaches `dist/index.html` through the static mount.
  - **Built chunk names** (`entityFeed-*`, `index-*`, `v3-*`). No code matches on a name. Every mention is prose: `flag-surface.spec.js:47`, `feature-census.spec.js:423,429`, `camera-popup-trigger.spec.js:12`, `censusFeatures.js:55` and `v3-coverage.mjs:10,47`. The readers of `dist/assets` are name-agnostic: `feature-census.spec.js:431`, `fixtures/coverage.js:56`, `kiosk-drive.cjs:338` and `api.spec.js:410`.
    - HYPOTHESIS (no build was run): with one entry left, the `entityFeed-*` shared chunk folds into `v3-*.js`. Phase 2 will measure it.
  - **`static/js/`.** It holds only `config.js`, a gitignored copy of `src/js/config.js` made by `scripts/copy-static-config.js`. V3 needs it, so it stays.

## 2. The lists

**Keep (55):** the 54 `src/js` files in `tests/v3-closure.spec.js` `SHARED_BOTH` + `V3_ONLY`, plus `src/js/config.js`.

**Delete (98):**

- `src/index.html`
- **`src/css/` — all 35 files.** They are `base/` (2), `components/` (17), `layout/` (3), `main.css`, `utils/` (6) and `views/` (6).
- **`src/js/` — 62 files:**
  - `config/config.js`
  - `core/`: `app.js` `escapeHtml.js` `lifecycle.js` `motionTrigger.js` `presence.js` `viewManager.js` `voiceCommands.js` `voiceOverlay.js` `voiceSession.js`
  - `helpers/`: `dates.js` `media.js`
  - `modules/`: `ambientArchive` `arrActivity` `arrivalGreeting` `background` `binReminder` `calendar` `cameraPopupOverlay` `cameraTiles` `cameras/cameraDiscovery` `cameras/cameraOverrides` `clock` `commute` `daySources` `doorbellAlert` `energySaver` `focusHero` `fuelPrices` `goodnightRoutine` `healthIndicator` `mediaPanels` `mediaStatus` `middleSlot` `morningBriefing` `nextEventPanel` `plexStatus` `recipePanel` `screensaver` `systemStatus` `temporalSpine` `timeContext` `todo` `tonightsMenu` `voiceRail` (all `.js`)
  - `services/`: `atmoFx/runtime` `calendar/commands` `calendar/detailsPopover` `calendar/holidays` `dayModel` `focusEngine` `homeAssistant/events` `insightEngine` `weather/airQuality` `weather/api` `weather/fxOverlay` `weather/mapper` `weather/radar` `weather/renderer` (all `.js`)
  - `views/`: `briefingView.js` `weatherView.js`
  - `weatherMotion.js`

## 3. Table A — the 37 INERT-ON-V3 flags

`grep -c INERT-ON-V3 src/js/config.js` returns 39: 37 flag lines, the explainer at `:31`, and a prose mention at `:1758`. No other flag carries the mark.

"app.js" means `src/js/core/app.js`.

| flag | for the household | incumbent reader | V3 equivalent | verdict |
|---|---|---|---|---|
| background | Rotating background photo with a tint | app.js | `src/v3/core/ground.js` + `#substrate` | SUPERSEDED |
| clock | The clock | app.js | `#hour` (`v3/index.html:172`), painted in `main.js` | PORTED (updates per minute) |
| weather | Weather panel and radar | app.js | `v3/subjects/forecast.js`; radar is `show.sky` in `v3/subjects/index.js` | PORTED |
| calendar | Calendar and next-event panel | app.js | `v3/subjects/calendar.js`; next event through the attention queue | SUPERSEDED (no always-visible panel) |
| homeAssistant | HA connection | app.js | `main.js:37-39` (shared HA client, ungated) | PORTED (no off switch) |
| plex | Now-playing panel | app.js | `v3/core/now-playing.js:255` (`v3NowPlaying`) | PORTED |
| presenceRuntime | Screen mode follows presence | app.js | `v3/core/presence.js`, `depth.js` | SUPERSEDED |
| attentionEngine | One scored queue decides what shows | app.js | `v3/core/attention.js` (shared engine) | PORTED |
| ambientAtmospherics | Weather/light tint on the screensaver | app.js | `v3/substrate/index.js`, `gl.js` | SUPERSEDED |
| ambientSubstrate | Mood tint across all modes | app.js | `#substrate` canvas, always on | SUPERSEDED |
| dailyMemories | Fixed "on this day" set per day, with a map tile | app.js → `screensaver.js` | `ground.js:189` (`groundMemories`) | SUPERSEDED; the **map tile is LOST** (§4) |
| heroType | Hero text steps down with length | app.js | none: V3 has no hero by design | SUPERSEDED |
| ambientClock | Clock brightness follows the sun | app.js | `v3/core/sun-clock.js` (`v3SunClock`) | PORTED |
| leanInStack | Glass cards under the hero | app.js | `spread.js`/`composer.js` cells | SUPERSEDED |
| stackCards | Warning stripe, "+N more" | app.js → `focusHero.js` | `composer.js`/`spread.js` | SUPERSEDED (no stripe, no +N) |
| arrivalCard | Warm welcome-home card | app.js | `v3/core/arrival.js`: spoken line, no card by design (`:11`) | SUPERSEDED |
| arrivalBottom | Moves that card to bottom-centre | app.js → `arrivalGreeting.js` | none (no card) | SUPERSEDED |
| **ambientMemory** | Tender memory (e.g. a lost pet) as a wordless photo | app.js | **none.** `main.js:677-684`: "on a tender day V3 shows no memory at all" | **LOST** |
| bareTopRow | Bare time + temp top row | app.js, `weather/renderer.js:433` | V3 has no top row | SUPERSEDED |
| bareHero | Removes the hero box | app.js | V3 has no hero | SUPERSEDED |
| awakeGround | Family photo behind the awake screen | app.js, `background.js:246` | `ground.js` | PORTED |
| livingAccent | Accent warms at golden hour, cools in rain | app.js | `v3/core/atmosphere-fx.js:97,180` (`v3AtmoAccent`): rain-cool only | **PARTIAL**: the golden-hour warm half is LOST, partly covered by the warmth wash |
| awakePhotoDissolve | Daily photo cross-fades at the day boundary | `background.js:240` | `ground.js` (`DISSOLVE_MS`, `:57`) | PORTED |
| memoryWhisper | "On this day" caption | app.js | `#ground-caption` in `ground.js` (`groundMemories`) | SUPERSEDED |
| weatherFxRain | Rain on the glass | app.js | `atmosphere-fx.js` + `v3/atmo/overlay.js` (`v3AtmoOverlay`, `v3AtmoRainEpisodes`); field rain in `substrate/gl.js` (`v3FieldWeather`) | PORTED (mark names no lever) |
| weatherFxLightning | Lightning in thunder | app.js | overlay flash (`css/atmosphere.css:98`, `v3AtmoLightning`) + GPU cloud flash (`gl.js:533`) | PORTED (mark names no lever) |
| reactiveGlass | Glass tint follows the weather | app.js | none. "V3 has no glass" (`HANDOVER-LIVING-WINDOW-V3.md:24`) | SUPERSEDED (dropped on purpose) |
| skyRamp | Sunrise/sunset warm the room | app.js | `atmosphere-fx.js:203` `--atmo-warmth` (`v3AtmoOverlay`) | PORTED (mark names no lever) |
| nightSky | Stars on clear nights | app.js | `atmosphere-fx.js:183` (`v3AtmoNightSky`) + field stars in `gl.js` | PORTED (mark names no lever) |
| atmoTextures | Fog, heat, frost, plus seasonal colour | app.js | `atmosphere-fx.js:182` (`v3AtmoTextures`) | PORTED. Seasonal colour was dropped on purpose (handover `:24`) |
| recipePanel | Recipe before a `Meal:` dinner | app.js | `v3/core/dinner.js` (`v3DinnerPanel`) | PORTED |
| voiceRail | "You can say…" hint line | app.js | `#rail` in `main.js:382-392` (`voiceSession`) | PORTED |
| **temporalSpine** | The day drawn as a line of light | app.js | none. `show.day` answers on request only. `V3-MIGRATION.md` §5.3 ("decide the spine's fate") is still open. The owner's 2026-09-04 "spine looks haphazard" verdict (`v3/core/archive.js:54`) was about the **archive's year rail**, a different thing | **LOST** |
| ambientArchive | Screensaver becomes the memory archive | app.js → `screensaver.js` | `v3/core/archive.js:78` (`v3Archive`) | PORTED |
| ambientArchiveMotion | Live Photo plays as a memory arrives | `ambientArchive.js` | `archive.js:118,274` (`v3ArchiveMotion`) | PORTED |
| archiveMotionLoop (default **off**) | Live Photo loops for the whole dwell | `ambientArchive.js:705` | none: V3 never loops | LOST **as an option only**; the wall is unchanged |
| archiveFitToPrint | Archive card follows each photo's shape | `ambientArchive.js`, `archiveModel.js` | `archive.js:1159` via shared `cardRectFor` | PORTED |

The census in `docs/audit/F1-FLAG-CENSUS-2026-09-11.md` predates 9 of these V3 builds. Where it disagrees, this table wins.

## 4. Table B — incumbent capabilities by module group

| capability | incumbent file(s) | for the household | V3 equivalent | verdict |
|---|---|---|---|---|
| Doorbell / gate ring popup | `doorbellAlert`, `cameraPopupOverlay` | A ring puts the door camera on screen and speaks | `v3/core/alerts.js:114,124,143`; image via `v3/subjects/index.js:96,111`; shared `alertRouter.js` | PORTED |
| Motion camera popup | `cameraPopupOverlay` | Motion snapshot | `cameraTriggerCandidate` (`candidateSources.js:469`) → `v3/core/attention.js` | PORTED |
| **Camera grid view** | `cameraTiles`, `cameras/*` | Grid of every camera, pinnable | none. One camera on request; `v3/core/commands.js:96-98` says "V3 has no cameras grid" | **LOST** (declined on purpose) |
| Bin reminder | `binReminder` | Bin-night tile | voice `house.bins` (`localAnswers.js:252`); bins-eve prompt (`insightRules.js:63`); briefing | SUPERSEDED (tile gone) |
| Fuel prices | `fuelPrices` | Cheapest fuel tile | voice `self.fuel` (`localAnswers.js:355`); prompt (`insightRules.js:100`); briefing | SUPERSEDED (tile gone) |
| **Sonarr/Radarr downloads panel** | `arrActivity` (`/api/arr/summary`) | What is downloading | Voice only: "what's downloading" (`localIntents.js:118`) reads qBittorrent HA sensors, not arr | **LOST** as a display |
| **Media-server disk warnings** | `mediaStatus`, `helpers/media` | Disk/qBittorrent stats and warnings | Download count by voice only | **LOST** (HYPOTHESIS for the disk part) |
| Plex / media players | `plexStatus`, `mediaPanels` | What is playing | `v3/core/media-rooms.js`, `now-playing.js`, `subjects/media.js` | PORTED |
| Recipe / tonight's menu | `recipePanel`, `tonightsMenu` | Tonight's dinner + recipe | `v3/core/dinner.js:172`, `subjects/recipe.js`, `tonightsMenuCandidate` | PORTED |
| Commute | `commute`, `middleSlot`, `config/config.js` | Travel times, departure prompt | commute/departure candidates (`candidateSources.js:240,275`) + voice | PORTED |
| Next event | `nextEventPanel` | Event within 30 min | `nextEventCandidate` (`candidateSources.js:127`) | PORTED |
| **Air quality** | `weather/airQuality` (Open-Meteo, direct) | AQI bar in the weather view | none in `src/v3` or the shared closure | **LOST** |
| Rain radar | `weather/radar` | BOM radar loop | `show.sky` in `v3/subjects/index.js` | PORTED |
| Weather view / 7-day | `weatherView`, `weather/api,mapper,renderer`, `weatherMotion` | Full weather page | `v3/subjects/forecast.js` (`v3ForecastWeek`) | PORTED |
| Weather FX | `atmoFx/runtime`, `fxOverlay` | Rain, lightning, stars | `v3/core/atmosphere-fx.js`, `v3/atmo/overlay.js` (shared `planner.js`) | PORTED |
| Calendar month / agenda / popover | `calendar`, `calendar/commands`, `detailsPopover` | Browsable month, event details | `v3/subjects/calendar.js`, `ahead.js`, week/month subjects. Month navigation and the popover were declined (`commands.js:28-33`) | SUPERSEDED |
| **Public holidays** | `calendar/holidays` (`/api/calendar/holidays`), `background.js` (`is-holiday` tint) | QLD public holidays on the calendar; holiday tint | none. `/api/calendar/all` does not merge holidays (`server/routes/calendar.js:254-272`). `occasions.js` covers fixed occasions only. HYPOTHESIS, unverified: `attn:holidays` in the census roster (`main.js:564`) is an attention source and not this | **LOST** |
| Todo / shopping | `todo` | Always-visible open items | `v3/subjects/lists.js` (`show.list`) + voice add/complete | SUPERSEDED (on request only) |
| System status | `systemStatus` | Status page | `v3/subjects/status.js` | PORTED |
| Health chip | `healthIndicator` | Feed-degraded chip | `v3/core/health.js` | PORTED |
| Energy saver | `energySaver` | Dims overnight (its HA switch entity is empty) | crontab DPMS + `v3/core/display.js` wake | SUPERSEDED |
| Screensaver / photo / archive / clock | `screensaver`, `background`, `ambientArchive`, `clock` | Photo slideshow, clock, memories | `ground.js`, `archive.js`, `sun-clock.js` | SUPERSEDED |
| **Daily-memories map frame** | `screensaver` (`/api/immich/daily-set`, `/api/immich/map`) | A map of where the day's photo was taken | No V3 fetch of either endpoint | **LOST** (HYPOTHESIS that `groundMemories` has no map) |
| Motion wake | `motionTrigger` | Kitchen motion wakes the screen | `v3/core/presence.js:11-31` (same sensor) | PORTED |
| Presence modes | `presence` | Ambient / glance / dwell | `v3/core/presence.js`, `depth.js` | SUPERSEDED |
| Arrival greeting | `arrivalGreeting` | Welcome home | `v3/core/arrival.js` (spoken) | PORTED |
| Goodnight | `goodnightRoutine` | Spoken goodnight, then a minimal screen | `v3/core/voice.js:24,491` + shared `goodnight.js` | PORTED |
| Morning briefing | `morningBriefing`, `briefingView`, `focusHero` | Scheduled briefing | `v3/core/briefing-window.js`, `subjects/briefing.js` | PORTED |
| Voice overlay / rail / commands | `voiceOverlay`, `voiceRail`, `voiceCommands`, `voiceSession` | Listening light, hints, intents | `v3/core/voice.js` (shared `localIntents.js`), `presence-light.js`, `vocabulary-card.js` | PORTED |
| **HA `dashboard_command` remote** | `homeAssistant/events` | HA scripts switch views and pin cameras | `v3/core/commands.js` honours status/briefing/timeline/weather/home and refuses the rest aloud | SUPERSEDED; the **camera and agenda commands are LOST** |
| Focus hero / insight | `focusHero`, `focusEngine`, `insightEngine` | One-line headline | `v3/core/attention.js`, `spread.js` (shared `insightRules`) | SUPERSEDED |
| Time context | `timeContext` | `body[data-time-context]` CSS hook | none | LOST, cosmetic (HYPOTHESIS: a CSS hook only, nothing a person sees by itself) |
| Temporal spine | `temporalSpine`, `daySources`, `dayModel` | See Table A | none | **LOST** (as in Table A) |

## 5. LOST — owner's decision, one per row

| # | capability | port first, or let go? |
|---|---|---|
| L1 | Tender-memory frame (`ambientMemory`): on a tender day V3 shows no memory | ☐ port ☐ let go |
| L2 | Temporal spine: the day as a line of light (`V3-MIGRATION` §5.3 still open) | ☐ port ☐ let go |
| L3 | Public holidays on the calendar, plus the holiday tint | ☐ port ☐ let go |
| L4 | Air quality (AQI) | ☐ port ☐ let go |
| L5 | Camera grid view (already declined in `commands.js:96`) | ☐ port ☐ let go |
| L6 | Sonarr/Radarr downloads panel (voice covers qBittorrent) | ☐ port ☐ let go |
| L7 | Media-server disk warnings (HYPOTHESIS) | ☐ port ☐ let go |
| L8 | Daily-memories map frame (HYPOTHESIS) | ☐ port ☐ let go |
| L9 | HA `dashboard_command` camera/agenda commands | ☐ port ☐ let go |
| m1 | `archiveMotionLoop` option (default off, so no wall change) | ☐ let go |
| m2 | Golden-hour warm half of `livingAccent` | ☐ port ☐ let go |
| m3 | `timeContext` CSS hook (cosmetic) | ☐ let go |

The bin and fuel tiles and the always-visible todo list are **SUPERSEDED, not LOST**: each capability survives as a voice answer, a prompt or an on-request subject. If the owner wants any of those *always on screen*, that is a port too.

## 6. Incumbent-only tooling

### Server routes whose only frontend caller is on the delete list

| route | defined at | sole caller | other callers |
|---|---|---|---|
| `GET /api/arr/summary` | `server/routes/arr.js:40` | `arrActivity` | none (the route file is orphaned) |
| `GET /api/cameras` | `camera.js:258` | `cameraTiles` | none |
| `GET /api/camera/:id/status` | `camera.js:335` | `cameraTiles:721` | none |
| `GET /api/camera/:id/stream` | `camera.js:341` | none on either surface | none |
| `GET /api/ha/health` | `server/ha/haRoutes.js` | `cameraTiles` | none found |
| `/api/camera_proxy/*` | `haRoutes` | `cameraDiscovery` | the `streamPath` strings in shared `core/config.js:74,241-266` are data, with no V3 fetch (HYPOTHESIS) |
| `GET /api/calendar/holidays` | `calendar.js:238` | `calendar/holidays` | none |
| `GET /api/calendar/(google\|apple\|tripit)` | `calendar.js:281` | `config/config.js` | none |
| `GET /api/immich/daily-set` | `immich.js:236` | `screensaver` | `scripts/kiosk/heap-metrics.cjs:272` (probe only) |
| `GET /api/immich/map` | `immich.js:282` | `screensaver` | none |
| `GET /api/photos` | `photos.js:11` | `screensaver` | none |
| `GET /api/system/ping` | `system.js:178` | `systemStatus` | none |

These stay alive through the shared closure, so do not drop them:
- `/api/bins`, `/api/fuel`, `/api/news` and `/api/commute`;
- `/api/plex/*` and `/api/image_proxy`;
- `/api/system/metrics`.

Some routes already had no frontend caller on *either* surface before this audit, so they are out of scope here: `/api/nrl/broncos`, `/api/ha/snapshot`, `/api/house/lately`, `/api/weather/lately`, `/api/recipes`, `/api/commute/legs`, `/api/vault/*` and `/api/config`.

### Scripts

| script | change |
|---|---|
| `scripts/verify/live-contrast.cjs` | **Incumbent-only.** It drives `__wakeScreensaver`, `__presence` and `body.dataset.view`. `/verify-push` runs it, so **the post-push contrast check currently measures the incumbent, not the wall.** |
| `scripts/kiosk/surface.cjs`, `kiosk-drive.cjs`, `kiosk-sweep.sh`, `heap-metrics.cjs`, `perf-metrics.cjs` | Branch on both surfaces. Drop the incumbent branch. |
| `scripts/verify/flag-reversibility.mjs` | `--incumbent-only` and the INERT refusal become dead. |
| `scripts/copy-static-config.js` | **Keep.** V3 needs `/js/config.js`. Only the comment at `:3` goes stale. |
| `vite.config.js:19` | Drop the `index` input. |
| `server/config.js:15,28-29,57-62`, `server.js:185-206` | `SURFACE_ENTRY.incumbent` and the `0`/`false` arm of `resolveRootSurface` go. |

### Skills (`.claude/skills/`, plus the `.agents/` mirror)

| skill | reference |
|---|---|
| verify-push `:56-58` | `__engageScreensaver()`, `__presence(...)`, via `live-contrast.cjs` |
| kiosk-metrics `:21` | "cycles all views via `window.__switchView`" |
| camera-debug `:25` | points at `src/js/modules/cameraTiles.js` |
| flag-flip `:32-40,83` | `V3_DEFAULT=0` rollback and `--incumbent-only` |
| overnight-ship `:45` | "src/js/ is the incumbent" surface choice |

### Specs: 27 to delete

All of these load `/index.html` (the incumbent) or read or import only delete-list files, and none touches `/v3`:

- ambient-clock, ambient-memory, arrival-card, attention, awake-ground, awake-photo-dissolve
- bare-hero, bare-top-row, camera-popup-trigger, dissolve, escape-html, fold-home-tiles
- hero-type, lean-in-stack, living-accent, media-candidate, memory-whisper, night-sky
- photo-reload, presence, reactive-glass, stack-cards, temporal-spine, textures
- **ui** (it is the "browser smoke test" CLAUDE.md names, and it smokes the incumbent)
- voice-session
- `tests/verify/contrast.spec.js`

### Specs to split or edit

| spec | what is left |
|---|---|
| **ambient-archive** | **SPLIT, do not delete.** Its node-side tests cover shared `photoMemory.js` and `archiveModel.js` (`cardRectFor`, `CARD_*`), which V3 uses. Keep those; drop the `/index.html` half. |
| root-surface | Loops over `incumbent` and `v3` and expects `/index.html` to be the incumbent. |
| flag-surface (`:101,127,136`), event-registry (`:119,148,153`) | They walk the incumbent closure from `src/index.html`; `fixtures/event-registry.js` lists delete-list files. |
| flag-reversibility-gate | It exists to test the INERT refusal and `--incumbent-only`. |
| v3-closure | Manifest prose ("loaded by BOTH surfaces"). |
| feature-census (`:400`), local-voice (`:352,375`), media-tv-audio (`:75,116`) | Read delete-list sources (`holidays.js`, `voiceCommands.js`, `mediaPanels.js`). |
| insights (`:12`) | Imports `focusEngine.js`; the rest tests shared modules. |
| atmo-fx (`:310`) | Reads `src/css/utils/atmo-fx.css`. |
| `tests/verify/v3-contrast.spec.js` (`:62-66`) | **A V3 gate that checks for `dist/index.html`.** It would fail falsely; point it at `dist/v3/index.html`. |
| api (`:339,393`) | `/index.html` assertions. |

Some comments only go stale and need no code change: commute-privacy, lottie-icons, v3-commands, v3-context-feed, v3-curated-year, v3-routines, v3-spread, v3-week-and-month, `fixtures/pin-voice-off.js`, `server/routes/commute.js:4`, `radar.js:6`, `scripts/xreview-bench.mjs:115`.

## 7. Side findings, true whether or not the retirement goes ahead

1. **`/verify-push`'s contrast lane has measured the incumbent since the cutover**, not the wall (§6, Scripts). `v3-contrast.spec.js` is the V3 lane.
2. **Six marks name no working V3 lever:**
   - weatherFxRain and skyRamp → `v3AtmoOverlay`
   - weatherFxLightning → `v3AtmoLightning`
   - nightSky → `v3AtmoNightSky`
   - atmoTextures → `v3AtmoTextures`
   - livingAccent → `v3AtmoAccent`

   Moot if the flags are deleted.
3. **`config.js:495` is out of date.** The `voiceSession` comment says it "is inert for users", but it is V3's voice switch.
