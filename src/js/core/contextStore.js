// A tiny observable state store — the single seam future phases migrate the
// ~45 independent module pollers into. Grown per phase (see the vision docs):
// Phase 1 seeded the presence slice; Phase 5 adds `condition` for the ambient
// atmosphere so it reads real weather from one store instead of re-fetching.

const state = {
  presence: "glance",   // current presence mode slug (see presence.js MODES)
  lastMotionAt: 0,      // epoch ms of the last kitchen motion signal
  isNight: false,       // sunset→sunrise (mirrors screensaver's suncalc view)
  condition: null       // base weather category (clear|cloudy|rain|storm|fog)
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
