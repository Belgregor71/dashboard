/* ═══════════════════════════════════════════════════════════════════════════
   SUBSTRATE — WebGL backend.

   Rendered to a 480x270 backing store and upscaled by the compositor to the
   full 1920x1080 panel. That is 6% of the pixels of a full-viewport CSS paint
   animation, which is the entire performance argument: this house has already
   measured a full-viewport background-color transition at ~5.6 GPU points, and
   the shader touches a sixteenth of the area.

   Verified on the kiosk before any of this was written:
     ANGLE (AMD, AMD Radeon Graphics (radeonsi raven ACO), OpenGL 4.6)
   Real hardware, not SwiftShader. The missing dma-buf/EGL-image export that
   makes hardware VIDEO decode impossible on this X11+ANGLE stack does not
   affect WebGL — different path entirely.

   ⚠ A READING NAMES THE SHADER IT MEASURED. This used to say the shader was
   byte-for-byte what was measured and that any change voided the measurement —
   true, and unmaintainable across a design arc that has to change it. Instead
   SHADER_VERSION goes up with every edit to VERT or FRAG, and the ceiling probe
   records it beside every number (docs/audit/G11-GPU-CEILING-2026-09-22.md). A
   measurement that does not name a version is the one to distrust.

   v2 (2026-09-22): the ink guard, for v3FieldMat. Costs nothing at strength 0.
   v3 (2026-09-22): the render lift, for v3FieldRender — a real horizon with
       altitude-dependent scattering and two cloud decks in perspective. Behind
       uLift; at 0 the v2 program runs unchanged, on the 480x270 store.
   v4 (2026-09-22): the weather in the field, for v3FieldWeather — rain at
       depth with the wind's lean, stars behind the cloud decks, lightning that
       lights the cloud it is in. Behind uWeather, inside the lifted program
       only; at 0 the v3 program runs unchanged.
   v5 (2026-09-22): three more causes, for v3FieldCauses (Stage 3, owner-scoped
       to exactly these) — gusts surge the drift and the rain's lean, the moon
       at its real place and phase with moonlight on the rims, humidity's haze
       on the low sky. Behind uCauses; each is skipped when its reading is
       unknown. At 0 the v4 program runs unchanged.

   ⚠ THE 480x270 ARGUMENT ABOVE WAS RIGHT ON A PI AND IS WRONG ON THE G11.
   Stage 0 measured it: 480x270 -> 1920x1080 at the same frame cap costs +0.4
   gpu points, because the box charges per FRAME, not per pixel. The lift takes
   the full panel for that reason — and only with the lift, because the v2
   program has almost no detail for the extra pixels to resolve.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SHADER_VERSION = 5;

/* The backing store per render tier. Base is the store that was measured and
   shipped; lifted is the panel. Exported so the fallback path can put a cloned
   canvas BACK to the base store — canvas 2D at 1920x1080 is a CPU fill. */
export const BASE_RES = [480, 270];
export const LIFT_RES = [1920, 1080];

/* The frame cap, and why 66 is not quite 15.

   `now - last >= 66` against a 60 Hz vsync: four vsyncs are 66.67 ms, a margin
   of 0.67 ms, and rAF timestamps jitter by about that much — so some gaps
   miss and wait for the fifth vsync. Measured on the wall: 14.2 and 14.8 fps,
   asked 15. (The "asked 15, got 12" in G11-GPU-CEILING-2026-09-22.md was the
   ceiling PROBE's own loop, not this one — see tests/v3-field-render.spec.js.)

   Pure so a spec can drive it with synthetic vsyncs instead of a real clock.
   The base tier keeps 66 exactly — flag off is the measured behaviour. The
   lift aims BETWEEN the third and fourth vsync (50 and 66.7 ms), so jitter in
   either direction still lands on the fourth: 15, steadily. */
export const FRAME_MS = 66;
export const LIFT_FRAME_MS = 60;

/* ── Per-cause frame caps (features.v3FieldWeather) ─────────────────────────
   15 fps is right for a drifting sky and wrong for rain and lightning — but a
   frame is the one thing this box charges for (≈0.13-0.21 gpu points per fps,
   G11-GPU-CEILING-2026-09-22.md), so each cause earns its own rate and only
   while it is live. Same placement rule as the lift's 60: aim BETWEEN two
   vsyncs so jitter either way lands on the same one.

     rain    25 ms — between the 1st and 2nd vsync, a steady 30. Rain can last
             all afternoon, so this is a SUSTAINED row. Measured on the wall
             2026-09-22, A/B/A/B: +2.85 gpu over the lift's 15, landing 24.9-25.4
             against the ≤25 ceiling. The owner kept 30 at the ceiling over 20
             fps at roughly half the cost — so a rainy depth 0 has no headroom.
     strike   8 ms — every vsync, 60, for the 1.6 s decay only. A peak episode
             (§5.4 ≤35, 32.7 measured at 60 fps full-panel) that must decay, and
             does: the cap falls back the frame the envelope reaches 0.

   Only on the lifted program with the weather drawn: without uWeather nothing
   in the field is drawn at rain rate, and a frame nobody asked for is cost. */
export const RAIN_FRAME_MS = 25;
export const STRIKE_FRAME_MS = 8;
export function frameMsFor({ lift = 0, weather = 0, rain = 0, striking = false } = {}) {
  if (!lift) return FRAME_MS;
  if (weather && striking) return STRIKE_FRAME_MS;
  if (weather && rain > 0.02) return RAIN_FRAME_MS;
  return LIFT_FRAME_MS;
}
export const frameDue = (now, last, lift) => now - last >= frameMsFor({ lift });

/* Where the gust pattern is at time t (seconds): 0 in the lulls, up to 1 at a
   gust's peak. Two incommensurate sines, thresholded, so gusts arrive
   irregularly — every ~10-25 s, a few seconds each — and never on a beat the
   eye can learn. The PATTERN is invented; its SIZE (uGust) is the reading, and
   with no reading the size is 0 and nothing surges. Pure, for the spec. */
export function surgeAt(t) {
  const s = Math.sin(t * 0.45) + Math.sin(t * 0.71 + 1.3);
  const u = Math.max(0, Math.min(1, (s - 0.9) / 0.9));
  return u * u * (3 - 2 * u);
}

/* The strike, as a brightness over time. The incumbent's curve, the same one
   css/atmosphere.css plays on the overlay's flash (attack at 5%, a flicker
   bump at 20%, decayed by 100%) — so the pane and the sky flash TOGETHER, on
   one curve, from one strike() call. Pure, so a spec can read the shape. */
export const STRIKE_MS = 1600;
const STRIKE_KEYS = [[0, 0], [0.05, 0.9], [0.12, 0.4], [0.2, 0.68], [1, 0]];
export function strikeEnvelope(ageMs, peak = 1) {
  if (!(ageMs >= 0) || ageMs >= STRIKE_MS) return 0;
  const t = ageMs / STRIKE_MS;
  for (let i = 1; i < STRIKE_KEYS.length; i++) {
    const [t1, v1] = STRIKE_KEYS[i];
    if (t <= t1) {
      const [t0, v0] = STRIKE_KEYS[i - 1];
      return (v0 + ((v1 - v0) * (t - t0)) / (t1 - t0)) * peak;
    }
  }
  return 0;
}

const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision mediump float;
out vec4 fragColor;
uniform vec2  uRes;
uniform float uTime;
uniform float uSunAlt;
uniform float uSunAz;
uniform vec2  uWind;
uniform float uCloud;
uniform float uRain;
uniform float uInkGuard;
uniform float uLift;
uniform float uWeather;
uniform float uStrike;
uniform vec2  uStrikePos;
uniform float uCauses;   // features.v3FieldCauses: gusts, moon, humidity
uniform float uGust;     // 0..1 gust ratio above the mean wind; 0 = unknown
uniform float uSurge;    // 0..1 where the gust pattern is right now (JS)
uniform float uDriftT;   // the drift's clock — uTime, stretched by gusts
uniform float uHumid;    // 0..1 relative humidity; < 0 = unknown
uniform vec3  uMoon;     // (altitude norm, azimuth rotated, lit fraction); z < 0 = unknown

float hash(vec2 v){ return fract(sin(dot(v, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 v){
  vec2 i = floor(v), f = fract(v);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), u.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
}
float fbm(vec2 v){
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++){ s += a * noise(v); v *= 2.02; a *= 0.5; }
  return s;
}

/* ── THE LIFTED SKY (uLift = 1, features.v3FieldRender) ─────────────────────
   Everything here is still a function of the same five causes — the lift adds
   FORM, not causes (Stage 3 adds causes). Nothing new moves: uTime still only
   advances the wind's drift, and on a still day this is drawn once.

   Three things the v2 program faked with a two-colour mix:

   · A HORIZON, at HZ. The sky above it is an exponential falloff from a
     horizon colour to a zenith colour, and BOTH are picked by the sun's
     altitude — day, a gold band either side of zero, and night. Scattering is
     brightest along the horizon under the sun (forward scatter), so the
     sunward side of the wall is warmer than the other, as it is outside.
   · TWO CLOUD DECKS IN PERSPECTIVE. Sampled on a plane seen from below, so
     cells shrink and crowd toward the horizon — the depth cue the flat fbm
     never had. The low deck drifts at the wind's rate, the high one at under
     half of it: parallax at each deck's own height, from one wind reading.
     Coverage is uCloud's threshold on the noise, so a clear reading is a clear
     sky, not a thinner fog.
   · LIGHT ON THE CLOUD. One offset sample toward the sun: the edge facing it
     is lit (and gold near the horizon hours), the body is shaded.

   ⚠ THE LUMINANCE ENVELOPE IS THE v2 ONE, ON PURPOSE. The words sit on this
   field when it is the matting, and the ink guard was measured against the v2
   brightness (worst 4.05:1 day). The lift may redistribute light, not add it —
   the brightest thing on the wall is still the sun's glow, at 80% of v2's. */
const float HZ = 0.12;

vec3 liftedSky(vec2 uv, vec2 drift, vec2 sunPos){
  float alt = clamp(uSunAlt, -1.0, 1.0);
  float day = smoothstep(-0.05, 0.45, alt);
  float gold = smoothstep(-0.45, 0.0, alt) * (1.0 - smoothstep(0.05, 0.5, alt));

  vec3 zen = mix(vec3(0.020, 0.024, 0.046), vec3(0.060, 0.090, 0.150), day);
  vec3 hor = mix(vec3(0.052, 0.056, 0.082), vec3(0.245, 0.222, 0.198), day);
  hor = mix(hor, vec3(0.330, 0.180, 0.092), gold);

  float h = uv.y - HZ;
  float fall = exp(-max(h, 0.0) * 3.4);
  vec3 col = mix(zen, hor, fall);

  /* HUMIDITY (uCauses, uHumid). Wet air scatters the horizon's light higher up
     the sky and swallows what is far away: a muggy afternoon's milky low sky,
     distant cloud going soft. Pulled TOWARD the horizon's own colour, never
     past it — the haze redistributes light, it does not add any. Nothing below
     ~55% (a dry day has no haze to show); unknown is no haze at all. */
  float humid = (uCauses > 0.5 && uHumid >= 0.0) ? smoothstep(0.55, 0.95, uHumid) : 0.0;
  if (humid > 0.0) col = mix(col, hor, humid * 0.65 * exp(-max(h, 0.0) * 1.6));

  /* STARS (uWeather). Drawn HERE — after the sky, before the decks — so the
     cloud mixes below cover them with no extra work: a star behind a cloud is
     simply not there, which is the one thing the CSS field on the mat could
     never do (it painted 110 stars over an overcast night as readily as a
     clear one). One hashed candidate per 24 px cell of the panel, most of them
     empty and most of the rest faint, fading out into the horizon's haze.
     Fixed on the sky: nothing twinkles and nothing wheels — a star that moved
     would be motion with no cause the room can see. */
  if (uWeather > 0.5 && h > 0.0) {
    float night = 1.0 - smoothstep(-0.25, -0.05, alt);
    if (night > 0.0) {
      vec2 sp = vec2(uv.x, 1.0 - uv.y) * vec2(1920.0, 1080.0) / 24.0;
      vec2 cell = floor(sp);
      float r = hash(cell + 7.3);
      if (r > 0.90) {
        vec2 at = vec2(hash(cell + 1.7), hash(cell + 4.1));
        float dpx = length((fract(sp) - at) * 24.0);
        float mag = (r - 0.90) * 10.0;                  // 0..1, uniform
        float bright = 0.18 + 0.62 * mag * mag * mag;   // most stars faint
        col += vec3(0.92, 0.94, 1.0) * bright * (1.0 - smoothstep(0.4, 1.6, dpx))
             * night * smoothstep(0.02, 0.22, h) * (1.0 - humid * 0.6 * exp(-h * 3.0));
      }
    }
  }

  /* THE MOON (uCauses, uMoon). Placed by the same mapping as the sun (so it
     rises where the sun rises on this wall), lit to its real phase, with the
     lit limb turned TOWARD the sun's place on the wall — the one direction a
     real moon's light can come from. Drawn before the decks, so cloud covers
     it. Faint by day, as a daytime moon is; gone below the horizon. */
  float moonlight = 0.0;
  if (uCauses > 0.5 && uMoon.z >= 0.0 && uMoon.x > -0.02) {
    vec2 ma = vec2(1.7778, 1.0);
    /* Height on its OWN scale, 0-90° onto the sky between just above the
       horizon and just below the ink guard's top band. The sun's 35° scale
       pinned every moon above 35° INTO that band, where the guard dims it to 30%
       — tonight's 74° moon read as a grey smudge under the date. */
    vec2 mp = vec2(0.5 + cos(uMoon.y) * 0.42, 0.14 + clamp(uMoon.x, -0.05, 1.0) * 0.48);
    vec2 sunAt = vec2(0.5 + cos(uSunAz) * 0.42, uSunAlt * 0.7 + 0.12);
    vec2 ld = normalize((sunAt - mp) * ma + vec2(1e-4, 0.0));
    vec2 q = (uv - mp) * ma / 0.021;                          // disc of ~23 px radius
    float x = dot(q, ld), y = dot(q, vec2(-ld.y, ld.x));
    float disc = 1.0 - smoothstep(0.9, 1.05, length(q));
    float term = (1.0 - 2.0 * uMoon.z) * sqrt(max(0.0, 1.0 - y * y));
    float litPart = smoothstep(term - 0.10, term + 0.10, x);
    float up = smoothstep(-0.01, 0.01, uMoon.x);
    float vis = up * (1.0 - day * 0.8);
    col = mix(col, vec3(0.78, 0.78, 0.74), disc * litPart * vis * 0.85);
    float md = length((uv - mp) * ma);
    moonlight = uMoon.z * up * (1.0 - day);
    col += vec3(0.07, 0.075, 0.09) * exp(-md * md * 30.0) * moonlight * (1.0 - uCloud * 0.6);
  }

  // Forward scatter: the horizon under the sun, not the horizon everywhere.
  // Squared by hand: pow() of a negative base is undefined in GLSL.
  float ux = (uv.x - sunPos.x) * 1.8;
  float under = exp(-ux * ux);
  col += (vec3(0.22, 0.12, 0.05) * gold + vec3(0.08, 0.06, 0.04) * day)
       * under * fall * (1.0 - uCloud * 0.6);

  // The sun's glow, aspect-corrected so it is round on a 16:9 panel.
  vec2 a = vec2(1.7778, 1.0);
  float d = distance(uv * a, sunPos * a);
  float lit = smoothstep(-0.15, 0.35, uSunAlt);
  col += vec3(0.42, 0.28, 0.14) * 0.8 * (exp(-d * d * 5.0) * 0.8 + exp(-d * d * 60.0) * 0.2)
       * lit * (1.0 - uCloud * 0.7);

  if (h > 0.0) {
    // A plane seen from below: x spreads and depth grows toward the horizon.
    float z = 1.0 / (h + 0.10);
    vec2 plane = vec2((uv.x - 0.5) * 1.7778 * z, z);
    float cover = 0.78 - uCloud * 0.58;
    float haze = smoothstep(0.0, 0.10, h);

    vec2 lowP = plane * 1.25 + drift * 2.0;
    float warp = fbm(lowP * 0.5) * 0.7;
    float n = fbm(lowP + warp);
    float dens = smoothstep(cover, cover + 0.18, n) * haze;
    // Humid air swallows what is far away: distant (low) cloud goes soft.
    dens *= 1.0 - humid * 0.6 * (1.0 - smoothstep(0.0, 0.30, h));
    float toSun = fbm(lowP + vec2(sunPos.x - 0.5, 0.25) * 0.35 + warp);
    float edge = clamp((n - toSun) * 3.0 + 0.5, 0.0, 1.0);

    vec3 body = mix(vec3(0.075, 0.078, 0.092), vec3(0.235, 0.232, 0.236), day) * (1.0 - uCloud * 0.35);
    vec3 rim  = mix(body * 1.25, vec3(0.34, 0.20, 0.11), gold) + vec3(0.05) * day;
    // Moonlight silvers the cloud edges at night — how a full-moon sky has form.
    rim += vec3(0.055, 0.06, 0.075) * moonlight;
    col = mix(col, mix(body, rim, edge), dens * 0.92);

    /* LIGHTNING (uWeather, uStrike). The strike lights the cloud it is INSIDE:
       brightest where the low deck is dense near the strike point, a little
       through thin cloud, and a faint lift of the whole sky — not a glow div on
       the horizon. uStrike is the incumbent's curve × the strike's size, so it
       is 0 between strikes and this whole term is skipped. */
    if (uWeather > 0.5 && uStrike > 0.0) {
      vec2 a = vec2(1.7778, 1.0);
      float sd = distance(uv * a, uStrikePos * a);
      float glow = exp(-sd * sd * 5.0);
      col += vec3(0.50, 0.55, 0.70) * uStrike * glow * (0.20 + dens * 0.80);
      col += vec3(0.035, 0.040, 0.055) * uStrike;
    }

    // The high deck: thin, streaked, slower. Drawn under the low one's shadow.
    vec2 highP = plane * vec2(1.6, 4.5) + drift * 0.8;
    float c = smoothstep(cover + 0.05, cover + 0.40, fbm(highP)) * haze * (1.0 - dens);
    col = mix(col, hor * 1.05 + vec3(0.03) * day, c * 0.45);
  } else {
    /* Below the horizon: the land, lit only by what the sky above is doing.
       CONTINUOUS at the line — it darkens the sky's own horizon value rather
       than switching to a new colour, because a step here read on the first
       render as a letterbox bar across the bottom of the wall, not as land. */
    col *= mix(0.45, 1.0, smoothstep(-0.10, 0.0, h));
  }
  return col;
}

/* RAIN IN THE FIELD (uWeather, uRain). Three sheets at three distances: the
   far ones finer, denser and slower, which is the depth cue a single tiled PNG
   cannot give. Each sheet is sheared by the wind before it is gridded, so
   every streak leans the way the real wind is blowing and falls along its own
   lean — the drop's path is a straight line in the sheared space, so the lean
   costs one multiply and no per-frame work. Coverage follows the reading: a
   light shower is a few streaks, heavy rain is most cells.

   Brightness is small on purpose — the luminance envelope rule above holds,
   and the ink guard darkens this with everything else under the words. */
float rainSheet(vec2 uv, float fi){
  float scale = 1.0 + fi * 0.9;
  /* ⚠ The SIGN. The decks sample at uv + drift, so what the eye sees move goes
     toward -uWind (east is on the LEFT of this wall — see toCauses). The drop
     must travel the same way the cloud does as it falls: x - lean*y constant
     means x DEcreases as y falls when the wind's x is positive. */
  float lean = clamp(uWind.x, -1.0, 1.0) * 0.45;
  // A gust leans the rain harder while it lasts (uCauses) — the same surge
  // that is speeding the cloud up. uGust is 0 when gusts are unknown.
  if (uCauses > 0.5) lean *= 1.0 + 0.7 * uGust * uSurge;
  vec2 q = vec2(uv.x * 1.7778 - lean * uv.y, uv.y) * vec2(38.0, 6.0) * scale;
  float colm = floor(q.x);
  q.y += hash(vec2(colm, fi * 13.0)) * 9.0 + uTime * (7.0 - fi * 1.9);
  vec2 cell = vec2(colm, floor(q.y));
  vec2 f = fract(q);
  float present = step(1.0 - uRain * 0.55, hash(cell + fi * 17.0));
  float x0 = 0.2 + 0.6 * hash(cell.yx + 3.1 + fi);
  float sx = 1.0 - smoothstep(0.0, 0.07, abs(f.x - x0));
  float sy = smoothstep(0.0, 0.15, f.y) * (1.0 - smoothstep(0.35, 0.9, f.y));
  return present * sx * sy * (0.55 - fi * 0.14);
}

void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  // uDriftT is uTime with the gusts folded in (JS integrates it, so the cloud
  // speeds up in a gust and never runs backwards); exactly uTime without them.
  vec2 drift = uWind * (uCauses > 0.5 ? uDriftT : uTime) * 0.015;
  vec2 sunPos = vec2(0.5 + cos(uSunAz) * 0.42, clamp(uSunAlt, -0.2, 1.0) * 0.7 + 0.12);
  vec3 col;

  if (uLift > 0.5) {
    col = liftedSky(uv, drift, sunPos);
    if (uWeather > 0.5 && uRain > 0.02) {
      float streaks = rainSheet(uv, 0.0) + rainSheet(uv, 1.0) + rainSheet(uv, 2.0);
      float light = 0.10 + 0.08 * smoothstep(-0.05, 0.45, uSunAlt);
      col += vec3(0.62, 0.68, 0.78) * streaks * light;
    }
  } else {
    // v2, unchanged in every term.
    float f = fbm(uv * 3.0 + drift + fbm(uv * 1.7 - drift * 0.5) * 0.6);

    vec3 warm = vec3(0.29, 0.20, 0.13);
    vec3 cool = vec3(0.08, 0.09, 0.13);
    float horizon = smoothstep(0.0, 0.85, uv.y + (f - 0.5) * 0.22);
    col = mix(warm, cool, horizon);

    float d = distance(uv, sunPos);
    float glow = exp(-d * d * 9.0) * smoothstep(-0.15, 0.35, uSunAlt);
    col += vec3(0.42, 0.28, 0.14) * glow * (1.0 - uCloud * 0.7);

    col = mix(col, vec3(0.13, 0.13, 0.15), uCloud * (0.25 + f * 0.35));
  }

  col = mix(col, vec3(0.09, 0.10, 0.12), uRain * 0.5);
  col *= 1.0 - smoothstep(0.35, 1.15, distance(uv, vec2(0.5))) * 0.55;

  /* THE INK GUARD. When this field is the matting (features.v3FieldMat) the
     words sit ON it rather than on a flat --surface, and the sweep measured the
     168px hour at 1.61:1 over a lit midday field — a real failure, found by
     measuring rather than predicted.

     The field darkens itself under the words. It is done HERE, per pixel, and
     not as a veil over the top, because there is nothing behind the mat to mask
     back to: a veil would be a second full-screen layer to composite, and this
     is three cheap smoothsteps inside a shader that is already running.

     Geometry is lifted verbatim from css/atmosphere.css's texture mask, which
     is gate-proven at forced-worst weather on every ground and phase: a 170->400
     px top ramp, an ellipse 760x400 at (300,920) for the clock and caption, and
     an ellipse 820x400 at (1590,910) for the media corner. That file's hard-won
     lesson is why they are ellipses and ramps rather than boxes — the first
     masked build cut rectangles and they read on the wall as a banner line and
     a notch, as geometry rather than as weather.

     uInkGuard is a STRENGTH, and 0 is a real off: the guard costs nothing and
     changes nothing until the mat is live. */
  if (uInkGuard > 0.0) {
    // CSS space: y down, on the fixed 1920x1080 stage. uv is y-up.
    vec2 px = vec2(uv.x, 1.0 - uv.y) * vec2(1920.0, 1080.0);
    float g = 1.0 - smoothstep(170.0, 400.0, px.y);
    g = max(g, 1.0 - smoothstep(0.45, 1.0, length((px - vec2(300.0, 920.0)) / vec2(760.0, 400.0))));
    g = max(g, 1.0 - smoothstep(0.45, 1.0, length((px - vec2(1590.0, 910.0)) / vec2(820.0, 400.0))));
    col *= 1.0 - uInkGuard * g;
  }

  // Dither. Large near-black gradients band visibly on an 8-bit panel, and the
  // banding is far more noticeable than the effect it interrupts.
  float dq = (hash(gl_FragCoord.xy + fract(uTime)) - 0.5) / 255.0;
  fragColor = vec4(col + dq, 1.0);
}`;

/* Every uniform is an EXTERNAL CAUSE. There is no uniform here that exists to
   make the surface move on its own; uTime only advances the wind's drift, and
   wind is a thing the room can look out of a window and verify. That is the
   one clause of the calm law that survives V3 intact. */
const DEFAULTS = {
  sunAlt: 0, sunAz: 0, wind: [0, 0], cloud: 0.3, rain: 0, inkGuard: 0, lift: 0, weather: 0,
  // Stage 3 causes: unknown by default, and unknown means no effect.
  causes: 0, gust: 0, humid: -1, moon: [0, 0, -1]
};

export function createGlSubstrate(canvas) {
  const gl = canvas.getContext("webgl2", {
    antialias: false, depth: false, stencil: false,
    powerPreference: "low-power", preserveDrawingBuffer: false
  });
  if (!gl) return null;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("substrate: shader compile failed", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };

  const vs = compile(gl.VERTEX_SHADER, VERT);
  const fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn("substrate: link failed", gl.getProgramInfoLog(prog));
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = {};
  for (const n of ["uRes", "uTime", "uSunAlt", "uSunAz", "uWind", "uCloud", "uRain", "uInkGuard", "uLift",
    "uWeather", "uStrike", "uStrikePos", "uCauses", "uGust", "uSurge", "uDriftT", "uHumid", "uMoon"]) {
    U[n] = gl.getUniformLocation(prog, n);
  }

  /* The store follows the tier. Setting width/height clears the drawing
     buffer and keeps the context, so a live flag flip resizes in place — the
     caller draws immediately after, and nothing ever shows the cleared frame.
     Only a CHANGE touches the element: re-assigning the same width still
     clears the buffer, and update() arrives every minute. */
  function fitStore(lift) {
    const [w, h] = lift ? LIFT_RES : BASE_RES;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
  }
  fitStore(0);

  let causes = { ...DEFAULTS };
  let raf = null;
  let last = 0;
  let frames = 0;
  const t0 = performance.now();

  /* Cause-driven, not free-running. The loop runs ONLY while something is
     actually moving — wind or rain. On a still, clear day the substrate is
     drawn once and then costs literally nothing, which is what the <=8%
     quiescent budget is for. A 60fps loop that nobody asked for is the single
     most common way an ambient surface becomes expensive.

     ⚠ REDUCED MOTION IS HONOURED HERE, IN JS, BECAUSE IT CANNOT BE HONOURED IN
     CSS. §5.5 says `prefers-reduced-motion: reduce` is honoured in full, and
     every other surface does it in a @media block — but a media block cannot
     reach a rAF loop driving a canvas, so this field ignored the preference
     completely until 2026-09-22. It STILL PAINTS: the weather is information,
     and a still field showing rain is the reduced-motion answer, not a blank
     one. update() draws on every cause change exactly as before; only the loop
     is refused. Same shape as `paused` — the field holds its last frame.
     (canvas2d.js carries the same guard; the two backends already duplicate
     moving() and FRAME_MS, and one predicate in two places beats a new module
     in V3's import closure for two lines.) */
  const stillness = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
  const moving = () => !stillness?.matches
    && (causes.rain > 0.02 || Math.hypot(causes.wind[0], causes.wind[1]) > 0.05);

  /* The weather is drawn only by the lifted program, so both must be on. */
  const weatherOn = () => Boolean(causes.lift && causes.weather);
  /* Same rule for the Stage 3 causes (v3FieldCauses). */
  const causesOn = () => Boolean(causes.lift && causes.causes);
  let driftT = 0;
  let lastT = 0;

  /* A strike in flight (features.v3FieldWeather). `strikeAt` is null between
     strikes; while it is set the loop is held open at STRIKE_FRAME_MS even on a
     still day, and it is cleared — with one last, dark draw — the frame the
     envelope reaches 0. That settle draw is the whole point: without it a
     still field would hold the flash's last lit frame until the next minute. */
  let strikeAt = null;
  let strikePeak = 0;
  let strikePos = [0.5, 0.5];
  /* The flash in the frame that is ON THE GLASS — what the last draw() sent.
     sample() cannot answer "did the sky go dark again", because it draws a
     fresh frame first; this is the only read of the frame the room is seeing. */
  let lastStrike = 0;
  const striking = (now) => strikeAt !== null && now - strikeAt < STRIKE_MS;

  function draw() {
    const now = performance.now();
    gl.uniform1f(U.uTime, (now - t0) / 1000);
    gl.uniform1f(U.uWeather, weatherOn() ? 1 : 0);
    lastStrike = weatherOn() && strikeAt !== null ? strikeEnvelope(now - strikeAt, strikePeak) : 0;
    gl.uniform1f(U.uStrike, lastStrike);
    gl.uniform2f(U.uStrikePos, strikePos[0], strikePos[1]);
    gl.uniform1f(U.uSunAlt, causes.sunAlt);
    gl.uniform1f(U.uSunAz, causes.sunAz);
    gl.uniform2f(U.uWind, causes.wind[0], causes.wind[1]);
    gl.uniform1f(U.uCloud, causes.cloud);
    gl.uniform1f(U.uRain, causes.rain);
    gl.uniform1f(U.uInkGuard, causes.inkGuard);
    gl.uniform1f(U.uLift, causes.lift ? 1 : 0);
    /* Stage 3 causes (v3FieldCauses), on the lifted program only. The drift's
       clock is integrated HERE, one step per draw: the gust stretches time, so
       the cloud speeds up in a gust and eases after — and never runs backwards,
       which a gust term added straight onto uTime would do in the lull. With
       no gust reading, gust is 0 and driftT advances exactly as uTime does. */
    const on = causesOn();
    const t = (now - t0) / 1000;
    const surge = on ? surgeAt(t) : 0;
    driftT += Math.max(0, t - lastT) * (1 + (on ? causes.gust : 0) * 1.4 * surge);
    lastT = t;
    gl.uniform1f(U.uCauses, on ? 1 : 0);
    gl.uniform1f(U.uGust, on ? causes.gust : 0);
    gl.uniform1f(U.uSurge, surge);
    gl.uniform1f(U.uDriftT, driftT);
    gl.uniform1f(U.uHumid, on ? causes.humid : -1);
    gl.uniform3f(U.uMoon, causes.moon[0], causes.moon[1], on ? causes.moon[2] : -1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frames++;
  }

  // 15fps ceiling. The field is a slow atmosphere; above ~15 nothing in it is
  // perceptibly different and every extra frame is pure cost. FRAME_MS and
  // frameDue (top of file) say why the base tier actually delivered 12.

  /* Paused means the PANEL is off (core/display.js), not that the page is
     hidden — DPMS does not fire visibilitychange, so nothing else stops this
     loop overnight. Whether Chromium keeps servicing rAF with no display
     attached is driver-dependent; pausing makes the answer ours instead. */
  let paused = false;

  const capMs = (now) => frameMsFor({
    lift: causes.lift, weather: weatherOn(), rain: causes.rain, striking: striking(now)
  });

  function loop(now) {
    if (paused) { raf = null; return; }
    const lit = striking(now);
    if (strikeAt !== null && !lit) {
      // The strike just decayed: put the sky back dark before anything else.
      strikeAt = null;
      last = now;
      draw();
    }
    if (!moving() && !lit) { raf = null; return; }
    if (now - last >= capMs(now)) { last = now; draw(); }
    raf = requestAnimationFrame(loop);
  }

  /* Read the field back, for the specs and for CDP on the wall. The buffer is
     not preserved, so the only honest read is in the same task as a draw —
     this draws and reads before the compositor can clear it. Coordinates are
     fractions of the panel, y DOWN like the page, so a caller never needs to
     know which store the tier is using. */
  function sample(points) {
    draw();
    const px = new Uint8Array(4);
    return points.map(([fx, fy]) => {
      const x = Math.min(canvas.width - 1, Math.floor(fx * canvas.width));
      const y = Math.min(canvas.height - 1, Math.floor((1 - fy) * canvas.height));
      gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return [px[0], px[1], px[2]];
    });
  }

  return {
    backend: "webgl2",
    renderer: (() => {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })(),
    update(next) {
      const wasLift = Boolean(causes.lift);
      causes = { ...causes, ...next };
      // Resized even while paused: the store is state, not a frame, and the
      // wake draw must land on the right one.
      if (Boolean(causes.lift) !== wasLift) fitStore(causes.lift);
      // Causes keep accruing while dark — the sun still moves and the weather
      // still changes — but nothing is drawn for them until the panel is back.
      if (paused) return;
      draw();                                   // a cause changed: show it once
      if (moving() && raf === null) raf = requestAnimationFrame(loop);
    },
    setPaused(next) {
      if (next === paused) return;
      paused = Boolean(next);
      if (paused) {
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        strikeAt = null;   // a flash cannot outlive the panel it was on
        return;
      }
      // Waking: the field has to catch up in one frame, because the causes it
      // is holding are up to a night old.
      draw();
      if (moving() && raf === null) raf = requestAnimationFrame(loop);
    },
    /* One strike at `peak` (0..1), from the house's own lightning lane
       (core/atmosphere-fx.js strike) — the field never decides WHEN, it only
       lights up when the lane that also flashes the pane says so. Refused
       without the weather tier, while dark, and under reduced motion (the
       overlay's flash is `animation: none` there too). A strike landing inside
       an earlier one's decay is its aftershock and keeps that cloud; a new
       sequence picks a new one, somewhere in the low deck. */
    strike(peak = 1) {
      if (!weatherOn() || paused || stillness?.matches) return false;
      const now = performance.now();
      if (!striking(now)) strikePos = [0.2 + Math.random() * 0.6, 0.45 + Math.random() * 0.3];
      strikeAt = now;
      strikePeak = Math.max(0, Math.min(1, Number(peak) || 0));
      draw();
      if (raf === null) raf = requestAnimationFrame(loop);
      return true;
    },
    stats: () => ({
      frames, seconds: (performance.now() - t0) / 1000, animating: raf !== null, paused,
      inkGuard: causes.inkGuard, lift: causes.lift ? 1 : 0, store: [canvas.width, canvas.height],
      shader: SHADER_VERSION, weather: weatherOn() ? 1 : 0, causes: causesOn() ? 1 : 0,
      gust: causesOn() ? causes.gust : 0, humid: causesOn() ? causes.humid : -1, moon: causes.moon, driftT,
      /* When driftT was last advanced — the last DRAW, not now. `seconds` is
         read at call time, so comparing driftT to it measures how stale the
         frame is, which under load exceeded 0.5 s (2026-09-23). */
      drawT: lastT,
      striking: striking(performance.now()), capMs: capMs(performance.now()), lastStrike
    }),
    sample,
    /* A whole rectangle in ONE readPixels — for texture that single points
       cannot see (a star is two pixels wide). Fractions of the panel, y down;
       rows come back top-first, as luminance. Same draw-then-read rule. */
    sampleRect(fx, fy, fw, fh) {
      draw();
      const x = Math.floor(fx * canvas.width), w = Math.max(1, Math.floor(fw * canvas.width));
      const h = Math.max(1, Math.floor(fh * canvas.height));
      const y = Math.max(0, canvas.height - Math.floor(fy * canvas.height) - h);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const lum = new Array(w * h);
      for (let row = 0; row < h; row++) {
        const src = (h - 1 - row) * w;   // GL rows are bottom-first
        for (let i = 0; i < w; i++) {
          const o = (src + i) * 4;
          lum[row * w + i] = 0.2126 * px[o] + 0.7152 * px[o + 1] + 0.0722 * px[o + 2];
        }
      }
      return { w, h, lum };
    },
    destroy() {
      if (raf) cancelAnimationFrame(raf);
      raf = null;
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  };
}
