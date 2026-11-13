/* ═══════════════════════════════════════════════════════════════════════════
   DOG FX — features.v3DogFx. Effects on the glass around a dog peek.

   The dogs are untouched: dog-occasion.js calls begin() once its dogs are on
   the glass and end() from its teardown. This module only decides WHETHER and
   WHICH, and holds the one dynamic import() of the stage — so flag off, three
   is never fetched and nothing here runs beyond a property read.

   Phase 1: occasion particles. Easter, Australia Day and generic get none.
   Reduced motion gets none: the dogs' still portrait is that form.
   ═══════════════════════════════════════════════════════════════════════════ */

export const EFFECT_FOR = { christmas: "snow", birthday: "confetti", newYear: "fireworks", halloween: "bats" };

/* A backstop only: dog-occasion ends every show through end(). A peek is
   about 10-15 s; 30 s means a lost end() costs one quiet stage, not a loop. */
export const DEADLINE_MS = 30000;

const on = () => Boolean(globalThis.window?.CONFIG?.features?.v3DogFx);
const reducedMotion = () => Boolean(globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);

let stage = null;
let loading = null;
let generation = 0;
let failed = 0;

/** Put the occasion's effect on the glass. Never throws, never rejects. */
export function begin(occasionId) {
  const effect = EFFECT_FOR[occasionId];
  if (!effect || !on() || reducedMotion()) return false;
  const gen = ++generation;
  loading ??= import("../stage3d/stage.js").then(
    (m) => (stage = m),
    () => { loading = null; failed += 1; return null; }
  );
  // An end() before the chunk arrives bumps the generation, so a late load plays nothing.
  loading.then((m) => { if (m && gen === generation) m.play(effect, DEADLINE_MS); });
  return true;
}

/** The dogs have gone: fade the effect out. Safe when nothing began. */
export function end() {
  generation += 1;
  stage?.stop();
}

/** Readout for __v3().stage. */
export function state() {
  return stage ? { ...stage.state(), failed } : { loaded: false, loading: Boolean(loading), failed };
}

export const dogFx = { begin, end, state };
