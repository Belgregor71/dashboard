/* ═══════════════════════════════════════════════════════════════════════════
   DOG FX — features.v3DogFx. Effects on the glass around a dog peek.

   The dogs are untouched: dog-occasion.js calls begin() once its dogs are on
   the glass and end() from its teardown. This module only decides WHETHER and
   WHICH, and holds the one dynamic import() of the stage — so flag off, three
   is never fetched and nothing here runs beyond a property read.

   Phase 1: occasion particles. Easter, Australia Day and generic get none.
   Phase 2: marks on the glass (lick smear, nose fog, paw prints) on the
   frames dog-fx-cues.js names; dog-occasion.js reports each painted frame
   through frame(). Reduced motion gets none: the still portrait is that form.
   ═══════════════════════════════════════════════════════════════════════════ */

import { cuesFor } from "./dog-fx-cues.js";

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
let cues = null; // this show's { dog → [cue] } while its moment may be live
let begunAt = 0;
let fired = [];  // this show's landed marks, for the spec: { dog, frame, effect, ms since begin }

/** Put the occasion's effect on the glass, and arm the marks cued for the
    looks being worn ({ dog → look name }; peeks only). Never throws, never
    rejects. */
export function begin(occasionId, { mode = "peek", looks } = {}) {
  const effect = EFFECT_FOR[occasionId] ?? null;
  const armed = mode === "peek" ? cuesFor(occasionId, looks) : null;
  if ((!effect && !armed) || !on() || reducedMotion()) return false;
  const gen = ++generation;
  cues = armed;
  begunAt = performance.now();
  fired = [];
  loading ??= import("../stage3d/stage.js").then(
    (m) => (stage = m),
    () => { loading = null; failed += 1; return null; }
  );
  // An end() before the chunk arrives bumps the generation, so a late load plays nothing.
  loading.then((m) => { if (m && gen === generation) m.play(effect, DEADLINE_MS, { glass: Boolean(armed) }); });
  return true;
}

/** A dog painted drawn frame `i` (-1: an in-between). `at(x, y)` maps a point
    in that frame's cell (fractions) to { x, y, cell } in page px. A cue that
    fires before the stage is up is simply missed. */
export function frame(dogId, i, at) {
  const list = cues?.[dogId];
  if (!list || !stage) return;
  for (const c of list) {
    if (c.frame !== i) continue;
    const p = at(c.x, c.y);
    if (stage.mark(c.effect, p.x, p.y, c.size * p.cell, c.angle ?? 0)) {
      fired.push({ dog: dogId, frame: i, effect: c.effect, ms: Math.round(performance.now() - begunAt) });
    }
  }
}

/** The dogs have gone: fade the effect out. Safe when nothing began. */
export function end() {
  generation += 1;
  cues = null;
  stage?.stop();
}

/** Readout for __v3().stage. */
export function state() {
  return stage ? { ...stage.state(), failed, fired } : { loaded: false, loading: Boolean(loading), failed, fired };
}

export const dogFx = { begin, frame, end, state };
