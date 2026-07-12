# Phase 9.5 — "The Photo Source": Immich Integration

_Plan drafted 2026-07-12. Finishes the photo half of [Phase 9](./phase-9-remember.md) (the memory engine) and feeds the deferred ambient photo-frame. Independent of [Phase 10](./phase-10-temperament.md) — it adds a data source, not a voice, so it can land before or after without entangling._

**✅ Shipped & enabled on the Pi (`features.immichPhotos:true`). A scoped, read-only first cut, not a full Immich feature port.** _(Original plan document; live status in the [roadmap](./home-os-vision.md).)_

## Key insight that de-risks this phase

**Immich supplies the pixels and the dates; `data/memories/` supplies the meaning.** Phase 9 shipped a memory engine whose `photos: […]` field is carried but never rendered — the memory rides the *text* focus-hero only, and tender memories are withheld because there is no photo surface. The blocker was never the selector; it was the absence of a real, dated photo source. Immich is exactly that source: `POST /api/search/metadata` filters by `takenAfter`/`takenBefore` (so "five years ago today" and "last winter's trip" become *queries*, not hand-typed file paths), `POST /api/search/random` feeds the ambient rotation, and Immich already serves **server-side-downscaled** per-asset renditions — so the Pi never decodes a full-res photo (the exact cost the Phase 7 Ken Burns work fought).

The division of labour keeps authoring near-zero: Immich answers *"what photos exist for this date/album"*; the small authored `data/memories/` entries add only what a photo library can't know — a **tag** ("wistful"), a **sensitivity** ("tender"), a **title**. Most days need no authored entry at all: on-this-day flows straight from Immich dates.

The through-line: _a slideshow shuffles a folder; this lets the house reach into the whole library and choose the right photo for the day — and finally gives a tender memory somewhere gentle to land._

## Why this phase (the reward)

Phase 9's reward — *bring Brodie back on a grey afternoon* — does not exist yet, because there is nowhere for his photo to appear. This phase builds that surface and points it at the household's real library. After it: the memory hero can carry a photo, the tender ambient-only path has a home, the screensaver draws from the whole library instead of a flat `static/photos/` folder, and "on this day" pulls actual images from years past instead of a calendar keyword.

## Goal & success criteria

A read-only, server-proxied, cached Immich adapter that (a) resolves a memory entry's photos from Immich, (b) supplies on-this-day and random assets, and (c) renders a gentle photo surface behind the memory hero — all behind `features.immichPhotos` (default off → reversible), with the API key held **server-side only** and every path degrading to the existing `static/photos/` behaviour when the Synology is unreachable.

Done when:
1. Flag **on**: a memory with photos (or an on-this-day match) shows one Immich image via the ambient photo-frame; the tender path finally surfaces (ambient-only, no caption, longer hold). Flag **off**: byte-identical to Phase 9 (text hero only, `static/photos/` screensaver).
2. The Pi **never** fetches a full-res original or blocks on the Synology: it requests Immich's downscaled `preview`/`thumbnail` rendition through our proxy, disk-cached with a **bounded** prune (the 24/7 kiosk failure mode).
3. The API key is **never** exposed to the browser — it lives in the Pi's `.env` and is injected only by the server proxy (the `HA_TOKEN` precedent).
4. Source-down is a **non-event**: Immich unreachable → on-this-day/random return empty, the screensaver falls back to `static/photos/`, the memory still surfaces as text. No error on the glass.
5. Photo resolution + on-this-day date-matching are **pure and unit-tested** (date-range math, Southern-Hemisphere month/day match, dedupe, empty-source handling).

## The adapter model (read-only, proxied, cached)

```
Browser  ──/api/immich/*──▶  our server (holds x-api-key)  ──▶  Immich @ 192.168.0.179:2283
             (no key)          disk cache (bounded)              (LAN, on-device only)
```

**Server-facing Immich calls** (all `x-api-key`, short timeout, fail-soft):
- `POST /api/search/metadata` — `{ takenAfter, takenBefore, size, … }` → on-this-day (today's month/day across prior years), trip/album windows, afterglow windows.
- `POST /api/search/random` — `{ size }` → screensaver / random-memory rotation.
- per-asset downscaled rendition — Immich's `thumbnail`/`preview` endpoint (exact path/params confirmed against the v3.0.2 instance in step 1); proxied + cached, never the `original`.

**Dashboard-facing API** (what the browser sees — no key, thin, cacheable):
- `GET /api/immich/on-this-day` → `[{ id, takenAt, year, thumbUrl }]` for today.
- `GET /api/immich/random?count=N` → `[{ id, thumbUrl }]`.
- `GET /api/immich/asset/:id/thumb` → proxies the cached downscaled rendition (this is the `<img src>` target; matches the screensaver's existing plain-`<img>` pattern, so no `createObjectURL`/revoke bookkeeping).

**Memory-model tie-in (small, additive):** a `data/memories/` entry may now carry `immichAlbumId` or lean on its existing `date`/`recurring` — the runtime resolves photos from Immich at surface time instead of requiring literal `photos: […]` paths. Authored entries stay about *meaning* (tags/sensitivity/title); Immich provides the image. Existing `photos: […]` paths still work unchanged.

## File-by-file changes

**New — `server/routes/immich.js` + `server/services/immichClient.js`**
- Client: reads `IMMICH_URL` + `IMMICH_API_KEY` from `.env` (strip the double-quote if present, per the `HA_TOKEN` gotcha); `searchMetadata`, `searchRandom`, `fetchRendition`; short timeouts; returns `[]`/null on any failure. Router: the three dashboard-facing endpoints above.

**New — disk cache (holiday-cache / tts-cache precedent)**
- Cache downscaled renditions under `data/immich-cache/` keyed by `assetId` (+ size), with a **bounded prune** (max entries or bytes) so it can't grow for weeks. Gitignored. Metadata responses cached in-memory with a short TTL.

**New — `src/js/services/photoMemory.js` (pure)**
- On-this-day date math (local-TZ month/day match across years), afterglow/trip windows → date-range params; dedupe; "null/empty when the source is dry". Unit-tested (`insights.spec.js` style), no DOM/IO.

**Edit — `src/js/core/memoryRuntime.js`**
- Resolve a surfacing memory's photos from Immich (by `date`/`recurring`/`immichAlbumId`) when the flag is on; merge Immich on-this-day assets into the anchor entries so on-this-day draws real images. Fail-soft to the existing behaviour.

**Edit — `src/js/modules/focusHero.js` (or a small `memoryPhotoFrame.js`)**
- The deferred **ambient photo-frame**: when a surfacing memory carries a photo, show one image with the Phase 5/7 Ken-Burns *settle-and-hold* (no loop — the GPU guardrail), opacity-fade with a `setTimeout` teardown (never `transitionend` on a hidden node — the leak-audit rule). This is the surface tender memories are routed to.

**Edit — `src/js/modules/screensaver.js`**
- When the flag is on, source the rotation from `/api/immich/random`; on any failure fall back to today's `/api/photos` (`static/photos/`) exactly as now.

**Config — `src/js/config.js`**
- `features.immichPhotos: false`. Default off; flip on the Pi after the cache prune + source-down fallback are verified.

**Env — `.env` (+ `.env.example`)**
- `IMMICH_URL=http://192.168.0.179:2283`, `IMMICH_API_KEY=…` (generated in Immich → Account Settings → API Keys, read-only scope if available). Documented, never committed.

**Debug** — `window.__immich()` (source reachable? cache size? last on-this-day count) and `window.__forcePhotoMemory()` (surface a photo memory on demand for CDP verification).

## Step sequence (each independently verifiable)

1. Generate a read-only API key; confirm the exact `search/metadata`, `search/random`, and rendition endpoint shapes against the live v3.0.2 instance (a throwaway curl with the key) → verify: expected JSON, downscaled bytes.
2. `immichClient` + `/api/immich/*` routes + disk cache + prune → verify: contract test (JSON shapes, empty when key absent/source down); cache stays bounded across N fetches.
3. `photoMemory.js` pure date math → verify: unit tests (on-this-day matches across years in local TZ; empty source → empty).
4. Wire memory photo resolution + on-this-day into `memoryRuntime` behind the flag → verify: flag-off byte-identical; flag-on, `__memoryState`/`__immich` show resolved photos.
5. Ambient photo-frame render (settle-and-hold) + screensaver source swap with fallback → verify: photo renders once and holds (no loop); Synology-down falls back to `static/photos/`; `/kiosk-metrics` flat (no full-res decode, no blob growth).
6. `tests/immich.spec.js` (pure + contract) → `npm test` green. Deploy flag OFF → flip ON on Pi → `__forcePhotoMemory` surfaces gently, tender path appears in the ambient frame, cache bounded, `/kiosk-metrics` flat → default on.

## Testing

- **Pure:** on-this-day/afterglow date-range math (Southern-Hemisphere month/day, year spread), dedupe, empty-source → empty.
- **Contract:** `/api/immich/*` answers JSON in known shapes; with no key / source down it degrades to empty (never 500-to-HTML), mirroring the routines/memories routes.
- **Kiosk:** `__forcePhotoMemory` shows a photo memory that holds (not loops); tender memory reaches the ambient frame with no caption; Synology-down falls back to `static/photos/`; `/kiosk-metrics` flat — Immich previews are pre-downscaled, and the `<img src>` path adds no blob to revoke.

## Rollout & risk

- **Kiosk memory / GPU (the top failure mode)** — never decode full-res: request Immich's `preview`/`thumbnail` rendition only; cache with a bounded prune; reuse the Ken-Burns settle-and-hold (no loop). Re-check `/kiosk-metrics` after enabling.
- **Source reliability** — the Synology can be down/asleep. Short timeouts, in-memory + disk cache, and a hard fallback to `static/photos/` mean a dark Synology is invisible on the glass.
- **Secrets** — API key server-side only (`.env`, quote-stripped); the browser only ever sees `/api/immich/asset/:id/thumb`. On-device/LAN only — no cloud, matching the memories/routines privacy guardrail.
- **Scope creep** — this is a **read-only** consumer: no upload, no albums UI, no face search, no write-back. Immich's own `/api/memories` (on-this-day) is an *alternative* to the metadata query, not a second feature to port. Resist growing it into an Immich client.
- **Naming** — Immich exposes its own `/api/memories`; ours is `/api/memories` (authored entries) on a different host. Our proxy namespace is `/api/immich/*` — no collision.
- **Reversibility** — `immichPhotos: false` = Phase 9 text hero + `static/photos/` screensaver; cache + `.env` are additive. One-line rollback.

## Footprint

One read-only Immich client + a three-endpoint proxy with a bounded disk cache + one pure date-matcher + a photo resolution hook in `memoryRuntime` + the deferred ambient photo-frame + a screensaver source swap with fallback + a flag + tests. No upload, no write, no new engine — it finishes Phase 9 by giving the memory a face, and does it without ever asking the Pi to decode a full-size photo.
