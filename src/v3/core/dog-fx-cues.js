/* ═══════════════════════════════════════════════════════════════════════════
   DOG FX CUES — features.v3DogFx, Phase 2: marks left on the glass.

   occasion → dog → look → [{ frame, effect, x, y, size, angle? }], peeks only.
   `frame` is the DRAWN frame, 0-based (with v3DogSmooth on, dog-occasion.js
   fires it on that frame's key, never on an in-between). x, y and size are
   fractions of the drawn cell, measured from its top-left; angle is radians.
   Read off gridded contact sheets of the drawn art, 2026-11-13; the comment
   says what is on that frame (beat numbers are CHOREOGRAPHY's, 1-based).
   A look with no entry leaves no mark.

   Only Benji has these looks today. A new sheet needs its cues read again.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CUES = {
  generic: {
    benji: {
      lickscreen: [
        { frame: 3, effect: "smear", x: 0.47, y: 0.62, size: 0.28, angle: 0.2 },  // 4  first lick, tongue curled up
        { frame: 4, effect: "smear", x: 0.50, y: 0.74, size: 0.42 },              // 5  tongue full out, square on
        { frame: 5, effect: "smear", x: 0.47, y: 0.64, size: 0.36, angle: -0.6 }, // 6  licking the glass, sideways
        { frame: 6, effect: "smear", x: 0.44, y: 0.56, size: 0.44, angle: 0.35 }  // 7  the big lick across the nose
      ],
      noseboop: [
        { frame: 5, effect: "fog", x: 0.43, y: 0.61, size: 0.42 },                // 6  nose on the glass
        { frame: 6, effect: "fog", x: 0.50, y: 0.59, size: 0.55 }                 // 7  boop
      ],
      pawsup: [
        { frame: 5, effect: "paw", x: 0.30, y: 0.86, size: 0.20, angle: 0.15 },   // 6  both paws, low
        { frame: 5, effect: "paw", x: 0.66, y: 0.85, size: 0.20, angle: -0.15 },
        { frame: 8, effect: "paw", x: 0.22, y: 0.75, size: 0.21, angle: 0.25 },   // 9  paws up, pads on the glass
        { frame: 8, effect: "paw", x: 0.79, y: 0.74, size: 0.21, angle: -0.25 },
        { frame: 9, effect: "paw", x: 0.84, y: 0.64, size: 0.20, angle: -0.35 }   // 10 the wave, right paw high
      ]
    }
  }
};

/** The cues for one show, { dog → [cue] }, or null when no dog's look has any. */
export function cuesFor(occasionId, looks) {
  const byDog = CUES[occasionId];
  if (!byDog) return null;
  const out = {};
  for (const [dog, look] of Object.entries(looks ?? {})) {
    if (byDog[dog]?.[look]?.length) out[dog] = byDog[dog][look];
  }
  return Object.keys(out).length ? out : null;
}
