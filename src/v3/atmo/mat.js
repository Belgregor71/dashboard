/* ═══ Direction C — THE MAT AS A WINDOW (features.v3AtmoMat) ═════════════════
   V3 already has a weather field: the substrate, drawn from sun, wind, cloud
   and rain (substrate/gl.js — its shader frozen by its measurement). At depth 0
   nobody has seen it since the archive shipped, because the archive's mat is
   opaque. This direction opens the mat, so the field shows around the card —
   the weather is the room behind the picture.

   What it has to change, and why each is here:
     · the mat goes part-transparent (css/atmosphere.css)
     · the full-bleed photograph and its scrim hide at depth 0 — they sit under
       the mat too, and would show through it as a second copy of the card
     · main.js stops pausing the substrate as "covered" — it is not, now
     · the substrate takes forced probes as CAUSES (`takesCauses`), because a
       probe of rain here means the field darkening and drifting, not a layer
     · a strike brightens the field itself, one-shot (a filter on the canvas —
       the shader stays byte-for-byte what was measured)
   ⚠ The cost is the substrate becoming VISIBLE GPU: the Step 0 baseline put a
   visible animating field at ~5.6 gpu-process (HOST-BASELINES.md, row 5).
   ═══════════════════════════════════════════════════════════════════════════ */

export const mat = { name: "mat", takesCauses: true };
