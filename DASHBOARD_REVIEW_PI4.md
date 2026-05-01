# Dashboard Review for Raspberry Pi 4 + 32" Landscape TV

Date: 2026-05-01

## Scope reviewed
- Structure, data connections, update orchestration, and UI rendering in `static/js`.
- Main home layout and visual system in `static/index.html` + `static/css/styles.css`.

---

## Priority recommendations

### 1) Consolidate startup paths and remove legacy weather pipeline
There are two startup orchestrators (`/js/core/app.js` and legacy `/js/main.js`), but only `core/app.js` is loaded in `index.html`. Keep one startup pipeline and retire dead/legacy modules to reduce maintenance drift and accidental double polling.

Also, weather currently has two paths (`modules/weather.js` and `services/weather/renderer.js`); standardize on one path and remove duplicate DOM responsibilities.

**Why for Pi 4:** Less code + fewer intervals means lower idle CPU and less chance of memory churn over long uptimes.

### 2) Add a single connection-health model for all integrations
Home Assistant connection state already emits events, but weather/calendar/commute failures are mostly `console` only. Add a unified health state with per-connector status (HA, weather API, calendar API, commute API), last-success timestamp, and retry/backoff state.

Render this in a tiny top-right status chip (green/amber/red) and in the status view for debugging.

**Why for wallboard:** A family dashboard must fail visibly and recover predictably without keyboard access.

### 3) Implement adaptive performance tiers for Pi 4
Introduce `performanceMode: high|balanced|low` in config and dynamically tune:
- background zoom animation duration / disable when GPU pressure is detected,
- lottie frame rate / count of simultaneous animations,
- blur strength (`backdrop-filter`) and box-shadow density,
- refresh intervals for non-critical modules.

Default Pi 4 to `balanced` and auto-fallback to `low` after repeated long frames.

### 4) Optimize readability for 32" TV at distance
Current typography uses flexible clamps, but panel density is still high for ~2–4 m viewing. Improve glance readability:
- Increase minimum body size to at least 18 px equivalent.
- Reserve a stricter hierarchy: 1 dominant metric per panel, secondary lines de-emphasized.
- Add optional `tvMode` with larger spacing and simplified rows (especially Today, To-Do, Shopping).

### 5) Add stronger visual fallback states
For each panel, define explicit `loading`, `stale`, and `offline` sub-states with badges (e.g., “Updated 14m ago”). Avoid empty blocks that appear broken.

This is especially useful for camera, weather, and shopping list feeds.

---

## Connections: concrete improvements

1. **Backoff jitter + cap everywhere**
   - HA stream retries are linear-capped; use exponential with jitter to avoid synchronized retries after network blips.
2. **Circuit-breaker behavior**
   - After repeated connector failures, pause aggressive retries briefly and surface stale data age.
3. **Per-connector timeout budget**
   - Wrap fetches with explicit timeout (e.g., 5–8s) so stalled requests do not pile up.
4. **Structured telemetry payloads**
   - Emit standardized events `{source, ok, latencyMs, ageMs, errorCode}` for debugging panel + optional log endpoint.
5. **Cache last good payloads**
   - Persist small snapshots in `localStorage` (or backend cache) to render fast boot + offline continuity.

---

## Visual/UI recommendations

1. **Reduce glass cost in low mode**
   - `backdrop-filter: blur(16px)` across many panels is expensive on Pi GPU. Provide a class that swaps to flatter translucent backgrounds.
2. **Limit simultaneous motion**
   - Avoid concurrent background zoom + multiple lottie animations + animated overlays at once.
3. **Color/contrast guardrails**
   - Add contrast floor checks for text over photos (dynamic tint already helps; add stronger adaptive shadow/overlay at bright backgrounds).
4. **Consistent panel rhythm**
   - Align panel heading sizes, vertical paddings, and list row heights for cleaner scan lines on TV.
5. **Accessibility for remote viewing**
   - Bigger status badges, clearer icon+text pairing, and avoid meaning conveyed by color alone.

---

## Layout recommendations for 32" landscape

1. **Promote “Now + Next” strip**
   - Time, current weather, next event, and doorbell/camera alert should dominate top row.
2. **Demote low-value detail by default**
   - Hide tertiary metadata unless interaction occurs (or rotate detail focus every N seconds).
3. **Use fixed row heights**
   - Prevent reflow jumps when panels hide/show (`is-hidden`/`is-collapsed`) by reserving predictable space in TV mode.
4. **Create a “quiet night” scene**
   - Dims motion/brightness overnight for burn-in comfort and bedroom visibility.

---

## Suggested implementation order

1. Startup consolidation + weather pipeline unification.
2. Unified connection health model + visible status chip.
3. Performance tiers (`balanced` default for Pi 4).
4. TV readability pass (font minimums, row spacing, simplified cards).
5. Motion/blur optimization and stale/offline states.

