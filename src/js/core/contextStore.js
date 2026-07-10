// A tiny observable state store — the single seam future phases migrate the
// ~45 independent module pollers into. Phase 1 deliberately holds only the
// presence slice; do NOT grow this until Phase 2 (see docs/vision/phase-1).

const state = {
  presence: "glance",   // current presence mode slug (see presence.js MODES)
  lastMotionAt: 0,      // epoch ms of the last kitchen motion signal
  isNight: false        // sunset→sunrise (mirrors screensaver's suncalc view)
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
