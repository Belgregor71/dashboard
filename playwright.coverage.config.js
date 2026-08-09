import base from "./playwright.config.js";

/**
 * The V3 runtime-coverage run (V3-CUTOVER.md §5). Same server, same stubbed
 * upstreams, same specs — one launch flag different.
 *
 * It exists to name the 13 specs that actually reach V3 at runtime, so the pass
 * measures the surface rather than the whole suite.
 *
 * NEGATIVE RESULT, recorded so nobody tries it twice: `--js-flags=--no-lazy` was
 * added here to force V8 to compile every function, on the theory that lazy
 * compilation hides never-called ones and silently shrinks the denominator. It
 * changed NOTHING — the per-capture function counts came back byte-identical
 * (the same 334–364 spread across the same 109 captures). The theory was also
 * wrong: V8 does report module-level functions nobody called (media.js's
 * `showMedia` and grammar.js's `validate` both appear with count 0). What it
 * genuinely does not report is functions nested INSIDE a function that was never
 * entered — media.js's inner arrow at :52 is absent because `showMedia` never
 * ran. That is a real blind spot, and it is why the report carries a dead-LINE
 * column beside the function one: a never-entered function's span covers the
 * children V8 never mentioned.
 */
export default {
  ...base,
  testMatch: [
    "v3-alerts.spec.js",
    "v3-attention.spec.js",
    "v3-boot.spec.js",
    "v3-composer.spec.js",
    "v3-display.spec.js",
    "v3-health.spec.js",
    "v3-now-playing.spec.js",
    "v3-presence-depth.spec.js",
    "v3-scrim.spec.js",
    "v3-sound-presence.spec.js",
    "v3-spread.spec.js",
    "v3-subjects.spec.js",
    "v3-voice.spec.js"
  ]
};
