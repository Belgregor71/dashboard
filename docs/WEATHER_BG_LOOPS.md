# Weather Background Loop Generation (Kling AI, free tier)

Replacement plan for the 7 cinematic background loops in `static/assets/weather_bg/`.
The crossfade engine (shipped 2026-07-05, commit `246f36e`) is asset-agnostic — new
clips just replace the same filenames.

**Why these loops:** target aesthetic is the Dribbble weather-dashboard reference —
one soft volumetric cloud mass centered against a blurred atmospheric sky, slow
drift, glassmorphic UI floating over it. The current set is mismatched stock
(aerial shots, letterboxed storm, rain.mp4 was an empty placeholder).

## Constraints the clips must respect

- **16:9**, minimum 1080p equivalent. No letterboxing — black bars are baked-in death.
- **Static camera.** Any push/pan/zoom fights the CSS `weather-pan` Ken Burns drift
  and breaks the loop illusion. Set Kling's camera control to *none/static* AND say
  it in the prompt.
- **No land, horizon, buildings, birds, people, text.** Sky and cloud only — the UI
  covers ~70% of the frame; the background reads through gaps and edges.
- **Not too dark, not too busy.** A tint gradient (`rgba(5,8,12,0.2→0.45)`) sits on
  top; murky clips go black. High-frequency detail behind the glass cards makes
  text shimmer.
- **Slow, even motion.** The clip loops every 5–10s; fast motion makes the loop
  period obvious.

## Workflow

### Phase 1 — Anchor stills (one per condition)

Generate a 16:9 still for each condition first (Kling's image tab, or any image
generator). Approve all 7 **as a set** before animating anything — they must look
like siblings (same lighting logic, same softness, same palette family).

Shared style suffix — append to every image prompt:

> …a single soft volumetric cloud formation centered in frame against a softly
> blurred atmospheric sky, cinematic volumetric lighting, photorealistic, dreamy
> soft focus background, no land, no horizon, no text, 16:9

| # | Condition | Image prompt (prepend to suffix) |
|---|-----------|----------------------------------|
| 1 | clear | A small fluffy white cloud in a bright serene blue sky, warm golden sunlight blooming from the upper left, gentle light rays |
| 2 | cloudy | A large soft grey-white cumulus cloud mass filling the middle of frame, diffuse overcast light, muted blue-grey palette |
| 3 | rain | A dark blue-grey nimbus cloud with soft rain streaks falling beneath it, cool desaturated palette, wet atmospheric haze |
| 4 | storm | A massive dark cumulonimbus storm cloud, deep charcoal and slate blue tones, faint warm glow of lightning inside the cloud |
| 5 | fog | Dense pale mist in soft horizontal layers, milky white-grey, very low contrast, heavy diffusion |
| 6 | golden_hour | Soft clouds lit from below by warm orange-gold sunset light, amber and rose tones fading to dusk blue above |
| 7 | heat_haze | A blazing bright sun bloom in a washed-out white-blue sky, shimmering heat distortion, minimal wispy cloud |

Negative prompt (all generations, images and video):

> text, watermark, logo, birds, airplane, land, horizon, mountains, buildings,
> people, lens flare streaks, letterbox, black bars

### Phase 2 — Image-to-video in Kling

For each approved still:

1. **Image to Video** mode.
2. Upload the still as the **start frame**.
3. Add the **same image as the end frame** (this is what makes it a seamless loop).
4. Camera movement: **none / static**.
5. Duration: 5s to iterate cheaply; regenerate the keeper at **10s** if credits
   allow (longer loop = less obvious repetition on the kiosk).
6. Motion prompt from the table below. Mode: Standard is fine; Professional only
   if a keeper needs more coherence.

| Condition | Motion prompt |
|-----------|---------------|
| clear | The cloud drifts very slowly to the right, sunlight glow gently pulses, static camera, subtle slow motion, seamless loop |
| cloudy | The cloud mass slowly billows and churns in place, soft internal movement, static camera, very slow, seamless loop |
| rain | Rain streaks fall steadily beneath the cloud, the cloud drifts slowly, static camera, seamless loop |
| storm | The storm cloud boils slowly, faint lightning flickers illuminate it from within two or three times, static camera, seamless loop |
| fog | The mist layers drift slowly sideways at slightly different speeds, static camera, very slow, seamless loop |
| golden_hour | The clouds drift slowly, the warm glow breathes gently, static camera, subtle slow motion, seamless loop |
| heat_haze | The air shimmers with heat distortion, the sun bloom pulses very gently, static camera, seamless loop |

### Rejection criteria (regenerate, don't settle)

- Camera moves (push-in is Kling's favourite failure) → reject.
- Cloud morphs into a different shape by mid-clip, or motion reverses direction → reject.
- Brightness pulses/flickers globally (except storm's deliberate lightning) → reject.
- Motion is fast or "timelapse-y" → reject; add "extremely slow, subtle" and retry.
- Storm lightning reading as strobe rather than ambient glow → retry (this one
  historically takes the most attempts).

### Phase 3 — Post-processing (Claude does this)

Drop raw downloads into `static/assets/weather_bg/incoming/` named
`<condition>_v<n>.mp4`. Then per clip:

1. Loop-seam check; if the start/end frames drifted, close the loop with an ffmpeg
   self-crossfade (tail blended into head).
2. Encode: 1920×1080, H.264 High, `yuv420p`, CRF 22, 25fps, no audio, `+faststart`.
3. Replace the file in `static/assets/weather_bg/`, verify locally, then `/deploy`
   and confirm on the Pi (decode load + loop seam on the glass).

Ship clips as they're approved — no need to wait for all 7. Priority order if
rationing daily credits: **rain** (currently has no video at all), **storm**
(letterboxed), **cloudy**, **fog** (both aerial mismatches), then clear /
golden_hour / heat_haze (current ones are passable).

## Free-tier pacing (as of 2026-07)

Kling free tier ≈ 66 credits/day. A 5s standard image-to-video ≈ 20 credits →
~3 video attempts/day, plus image generations are cheap/near-free. Expect the full
set to take 3–5 days including retries. One month of Luma (~US$10) is the shortcut
if patience runs out — same workflow, its keyframe UI also takes identical
start/end frames.
