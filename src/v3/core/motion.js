/* The motion tokens, for code that animates with the Web Animations API and so
   cannot read a CSS custom property per keyframe.

   ⚠ MIRRORS css/tokens.css (--m-quick, --m-base, --m-calm, --m-scene and the
   three curves). tests/v3-motion-tokens.spec.js reads both and fails if they
   drift — the same arrangement as SCRIM_STOPS in core/scrim.js.

   Named, not retimed (owner, 2026-11-12): a constant moves here only when its
   value already equals a token. Everything tuned by eye on the glass keeps its
   own number where it lives. */
export const MOTION = { quick: 150, base: 250, calm: 350, scene: 700 };
export const EASE = {
  arrive: "cubic-bezier(0.22, 1, 0.36, 1)",
  leave: "cubic-bezier(0.55, 0, 0.8, 0.3)",
  drift: "cubic-bezier(0.4, 0, 0.2, 1)"
};
