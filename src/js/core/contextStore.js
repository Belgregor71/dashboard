// A tiny observable state store — the single seam future phases migrate the
// ~45 independent module pollers into. Grown per phase (see the vision docs):
// Phase 1 seeded the presence slice; Phase 5 adds `condition` for the ambient
// atmosphere so it reads real weather from one store instead of re-fetching;
// Phase 6 adds `intent`, the House Model's posture (docs/vision/phase-6-intent.md).

const state = {
  presence: "glance",   // current presence mode slug (see presence.js MODES)
  lastMotionAt: 0,      // epoch ms of the last kitchen motion signal
  isNight: false,       // sunset→sunrise (mirrors screensaver's suncalc view)
  condition: null,      // base weather category (clear|cloudy|rain|storm|fog)
  // Phase 6 House Model posture — a neutral resting value until intentEngine
  // (flag-gated) writes a derived one; flag off, it stays neutral and no reader
  // acts on it, so behaviour is byte-identical to Phase 5.
  intent: { activity: "unknown", tempo: "neutral", timeBudget: null, company: "unknown", dayCharacter: "weekday", season: "summer" }
};

const subscribers = new Set();

export function get() {
  return state;
}

export function set(patch) {
  let changed = false;
  for (const key of Object.keys(patch)) {
    if (state[key] !== patch[key]) {
      state[key] = patch[key];
      changed = true;
    }
  }
  if (changed) subscribers.forEach(fn => fn(state));
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
