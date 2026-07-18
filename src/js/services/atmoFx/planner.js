// Living-window episode planner — Phase 1 (rain on glass + storm lightning).
// Pure function over { weather, mode, now, rng } → the next effect episode, or
// null when the sky earns none. Same contract as atmosphere.js: no imports, no
// DOM, no IO, so the whole module unit-tests in plain node (tests/atmo-fx.spec.js).
//
// The design law is "moments, not loops" (docs/design idle-freeze finding: any
// continuous animation re-composites the whole 1080p page at ~1 GPU core). An
// episode is a bounded flourish: droplets appear, slide, settle, and the frame
// goes fully static again. Every budget the runtime must honour is exported
// from here as data, so tests can assert no plan can ever exceed them.

// Hard budgets per mode. `maxActiveMs` bounds the rAF-driven part of an episode
// (the hold that follows is a static canvas — zero per-frame cost). Lightning
// is pure CSS one-shots (zero rAF), bounded by sequence length instead.
export const BUDGETS = {
  ambient: { maxActiveMs: 8000, maxDroplets: 20, maxStreaks: 60, maxHoldMs: 40000 },
  awake: { maxActiveMs: 12000, maxDroplets: 24, maxStreaks: 120, maxHoldMs: 40000 },
  lightning: { maxSequenceMs: 4000, maxAftershocks: 2 },
  // Phase 3 nightSky: a twinkle moment is 2–4 stars breathing once over ~2.5s
  // on the otherwise-static starfield. Ambient-only (the field is a Mode-0
  // scene) and the rarest lane by far.
  twinkle: { maxActiveMs: 3000, maxStars: 4 },
  // Phase 4 atmoTextures: a fog drift is ≤30 soft blobs crossing for ≤10s,
  // awake-only (ambient fog is the static vignette alone); a heat pulse is a
  // one-shot warm veil (zero rAF, like lightning) capped well under a strike.
  fog: { maxActiveMs: 10000, maxBlobs: 30 },
  heatPulse: { maxSequenceMs: 4000, maxPeak: 0.3 }
};

// Randomized gap bands (ms) between rain episodes — never metronomic. Ambient
// keeps the wall mostly still; awake densities read as continuous rain at a
// fraction of the duty cycle.
export const RAIN_GAP_MS = {
  ambient: { light: [120000, 240000], moderate: [90000, 150000], heavy: [45000, 90000] },
  awake: { light: [14000, 25000], moderate: [12000, 20000], heavy: [10000, 16000] }
};

// Gap band between lightning sequences during a thunderstorm.
export const LIGHTNING_GAP_MS = [40000, 160000];

// Gap band between twinkle moments on a clear night (3–6 min — rare enough
// that the wall reads as a still sky that occasionally breathes).
export const TWINKLE_GAP_MS = [180000, 360000];

// Phase 4 texture pacing: fog drifts are an awake flourish (the room is being
// looked at); heat pulses are rare — a warm breath every few minutes at most.
export const FOG_GAP_MS = [40000, 80000];
export const HEAT_PULSE_GAP_MS = [180000, 420000];

// Phase 4 static-texture thresholds (°C) — the single authority the runtime's
// body-class sync reads. Brisbane numbers: 32° is a hot day, 8° a cold night.
export const HEAT_TEMP_C = 32;
export const COLD_TEMP_C = 8;

/**
 * Map the weather slice to the static texture classes the body should carry.
 * Pure — the runtime just diffs the result onto document.body when the
 * atmoTextures flag is on. Fog and cold can coexist (a winter fog morning);
 * heat and cold are exclusive by threshold.
 *
 * @param {object} [weather] contextStore weather slice.
 * @returns {string[]} zero or more of "fx-fog" | "fx-heat" | "fx-cold".
 */
export function texturesFor(weather) {
  if (!weather || typeof weather !== "object") return [];
  const out = [];
  if (weather.category === "fog") out.push("fx-fog");
  const t = weather.tempC;
  // Strict type check — Number(null) is 0, which would read as freezing.
  if (typeof t === "number" && Number.isFinite(t)) {
    if (t >= HEAT_TEMP_C) out.push("fx-heat");
    else if (t <= COLD_TEMP_C) out.push("fx-cold");
  }
  return out;
}

/**
 * Wind bias for the rain streak pass: 0–50 kph maps the fall angle from a
 * near-vertical −0.35 rad to a driven −0.9 rad, clamped at both ends. The
 * slice carries speed only (no bearing), so the lean direction is fixed and
 * every wind-biased motion (streaks, droplet slide, fog drift) agrees with it.
 *
 * @param {number} [windKph]
 * @returns {number} streak angle in radians.
 */
export function streakAngleFor(windKph) {
  // Strict type check — Number(null) is 0, which would read as dead calm.
  const t = typeof windKph === "number" && Number.isFinite(windKph)
    ? Math.max(0, Math.min(1, windKph / 50))
    : 0.5; // no data → the Phase-1 middle lean
  return -(0.35 + t * 0.55);
}

// CSS decay time of one strike (matches the fx-lightning keyframes' tail) —
// used to size the sequence duration for the runtime's cleanup timeout.
export const STRIKE_DECAY_MS = 1600;

function pick(rng, [min, max]) {
  return min + rng() * (max - min);
}

function pickInt(rng, band) {
  return Math.round(pick(rng, band));
}

function normalizeIntensity(intensity) {
  return intensity === "light" || intensity === "heavy" ? intensity : "moderate";
}

function planRain(weather, mode, now, rng) {
  const budget = BUDGETS[mode];
  const intensity = normalizeIntensity(weather.intensity);
  const gapMs = pick(rng, RAIN_GAP_MS[mode][intensity]);

  // Phase 4 wind: the slice's windKph leans the whole episode — streak pass
  // and droplet slide agree on one angle.
  const streakAngle = streakAngleFor(weather.windKph);

  if (intensity === "heavy") {
    // Heavy variant: more droplets plus one diagonal streak pass before settle.
    const fadeInMs = 1500;
    const streakMs = 3000;
    const slideMs = 3500;
    return {
      type: "rain-heavy",
      startAt: now + gapMs,
      durationMs: fadeInMs + streakMs + slideMs, // = maxActiveMs ambient, under awake
      params: {
        droplets: pickInt(rng, [14, budget.maxDroplets]),
        sliders: 3,
        streaks: pickInt(rng, [Math.round(budget.maxStreaks * 0.6), budget.maxStreaks]),
        fadeInMs,
        streakMs,
        slideMs,
        streakAngle,
        holdMs: Math.min(pickInt(rng, [15000, 30000]), budget.maxHoldMs)
      }
    };
  }

  // Light/moderate moment: a few droplets fade in, two or three slide and
  // merge, everything settles, the frame holds static, then fades away.
  const fadeInMs = 2000;
  const slideMs = 4000;
  return {
    type: "rain-moment",
    startAt: now + gapMs,
    durationMs: fadeInMs + slideMs,
    params: {
      droplets: pickInt(rng, intensity === "light" ? [6, 8] : [8, 10]),
      sliders: pickInt(rng, [2, 3]),
      streaks: 0,
      fadeInMs,
      streakMs: 0,
      slideMs,
      streakAngle,
      holdMs: Math.min(pickInt(rng, [20000, 40000]), budget.maxHoldMs)
    }
  };
}

function planLightning(now, rng) {
  // One big strike, then 0–2 weaker flickers offset inside the decay window —
  // real lightning's shape, never a repeated white flash. Zero rAF frames: the
  // runtime plays these as one-shot CSS keyframes on the veil.
  const aftershockCount = Math.floor(rng() * (BUDGETS.lightning.maxAftershocks + 1));
  const aftershocks = [];
  for (let i = 0; i < aftershockCount; i++) {
    aftershocks.push({
      offsetMs: pickInt(rng, [300, 1800]),
      peak: pick(rng, [0.25, 0.5])
    });
  }
  aftershocks.sort((a, b) => a.offsetMs - b.offsetMs);
  const lastOffset = aftershocks.length ? aftershocks[aftershocks.length - 1].offsetMs : 0;

  return {
    type: "lightning",
    startAt: now + pick(rng, LIGHTNING_GAP_MS),
    durationMs: Math.min(lastOffset + STRIKE_DECAY_MS, BUDGETS.lightning.maxSequenceMs),
    params: {
      peak: pick(rng, [0.8, 1.0]),
      // Horizon position of the glow, as a viewport-width fraction.
      x: pick(rng, [0.1, 0.9]),
      aftershocks
    }
  };
}

function planFog(weather, now, rng) {
  // A slow bank of soft blobs drifts across once, then the frame clears —
  // awake-only (planNextEpisode gates it): ambient fog is the static vignette.
  const activeMs = pickInt(rng, [7000, BUDGETS.fog.maxActiveMs]);
  const angle = streakAngleFor(weather.windKph);
  return {
    type: "fog-drift",
    startAt: now + pick(rng, FOG_GAP_MS),
    durationMs: activeMs,
    params: {
      blobs: pickInt(rng, [18, BUDGETS.fog.maxBlobs]),
      // Wind carries the bank: drift speed grows with the same lean the rain
      // streaks use, so all weather motion reads as one sky.
      driftSpeed: 0.4 + Math.abs(angle + 0.35) * 1.6,
      holdMs: 0
    }
  };
}

function planHeatPulse(now, rng) {
  // One slow warm breath on the veil — reuses the lightning layer with a
  // gentler one-shot keyframe. Zero rAF frames, capped low and rare.
  return {
    type: "heat-pulse",
    startAt: now + pick(rng, HEAT_PULSE_GAP_MS),
    durationMs: BUDGETS.heatPulse.maxSequenceMs,
    params: {
      peak: pick(rng, [0.15, BUDGETS.heatPulse.maxPeak]),
      x: pick(rng, [0.3, 0.7])
    }
  };
}

function planTwinkle(now, rng) {
  // 2–4 stars brighten and dim once over ~2.5s — the runtime modulates stars it
  // picks from the painted field; the planner only sizes the moment.
  return {
    type: "twinkle",
    startAt: now + pick(rng, TWINKLE_GAP_MS),
    durationMs: 2500, // < BUDGETS.twinkle.maxActiveMs
    params: {
      count: pickInt(rng, [2, BUDGETS.twinkle.maxStars])
    }
  };
}

/**
 * Plan the single next effect episode, or null when current weather earns none.
 * Stateless: the runtime executes the returned episode, then calls again — the
 * gap baked into `startAt` is what paces the lane.
 *
 * @param {object} input
 * @param {object} [input.weather] contextStore weather slice —
 *   { category, intensity, thunder, windKph, tempC } (null before first render).
 * @param {string} [input.mode] "ambient" (screensaver up) | "awake".
 * @param {number} [input.now] epoch ms.
 * @param {boolean} [input.night] Phase 3 nightSky: true when the clear-night
 *   starfield is live (flag on + isNight). The twinkle lane only exists then,
 *   and only ambient — the field is a Mode-0 scene.
 * @param {boolean} [input.textures] Phase 4 atmoTextures: opens the fog-drift
 *   (awake fog) and heat-pulse (≥ HEAT_TEMP_C) episode lanes.
 * @param {() => number} [input.rng] uniform [0,1) source, injectable for tests.
 * @returns {{type:string,startAt:number,durationMs:number,params:object}|null}
 */
export function planNextEpisode({ weather, mode = "ambient", now = 0, night = false, textures = false, rng = Math.random } = {}) {
  if (!weather || typeof weather !== "object") return null;
  const m = mode === "awake" ? "awake" : "ambient";

  const rains = weather.category === "rain" || weather.category === "storm"
    ? planRain(weather, m, now, rng)
    : null;
  const lightning = weather.thunder === true ? planLightning(now, rng) : null;
  const twinkle = night === true && m === "ambient" && weather.category === "clear"
    ? planTwinkle(now, rng)
    : null;
  const fog = textures === true && m === "awake" && weather.category === "fog"
    ? planFog(weather, now, rng)
    : null;
  const heat = textures === true && texturesFor(weather).includes("fx-heat")
    ? planHeatPulse(now, rng)
    : null;

  // All live lanes race: whichever is due sooner goes next; the others get
  // their turn on the following plan. One episode in flight, ever.
  const lanes = [rains, lightning, twinkle, fog, heat].filter(Boolean);
  if (!lanes.length) return null;
  lanes.sort((a, b) => a.startAt - b.startAt);
  return lanes[0];
}
