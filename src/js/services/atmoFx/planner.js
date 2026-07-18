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
  lightning: { maxSequenceMs: 4000, maxAftershocks: 2 }
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
 * @param {() => number} [input.rng] uniform [0,1) source, injectable for tests.
 * @returns {{type:string,startAt:number,durationMs:number,params:object}|null}
 */
export function planNextEpisode({ weather, mode = "ambient", now = 0, rng = Math.random } = {}) {
  if (!weather || typeof weather !== "object") return null;
  const m = mode === "awake" ? "awake" : "ambient";

  const rains = weather.category === "rain" || weather.category === "storm"
    ? planRain(weather, m, now, rng)
    : null;
  const lightning = weather.thunder === true ? planLightning(now, rng) : null;

  // Both lanes live: whichever is due sooner goes next; the other lane gets its
  // turn on the following plan. One episode in flight, ever.
  if (rains && lightning) return rains.startAt <= lightning.startAt ? rains : lightning;
  return rains || lightning;
}
