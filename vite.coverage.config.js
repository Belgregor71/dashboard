import base from "./vite.config.js";

/**
 * Build used ONLY by the V3 runtime-coverage pass (`scripts/verify/v3-coverage.mjs`).
 * Never shipped — `npm run build` is unchanged and the kiosk never sees this output.
 *
 * Three deliberate differences from the production build, each because the
 * default would make the measurement lie:
 *
 *   sourcemap   V8 reports byte offsets into the BUNDLE. Without a map, every
 *               range attributes to `assets/v3-*.js` and the per-file question
 *               (§5) is unanswerable.
 *   minify:false esbuild's minifier renames identifiers and merges statements,
 *               so a mapped range lands on a plausible-looking but wrong source
 *               line. Unminified output maps 1:1 with the original statements.
 *   treeshake:false  THIS IS THE ONE THAT CHANGES THE ANSWER. Rollup drops
 *               exports nobody imports. Dropped code is not "uncovered" in a V8
 *               report — it is ABSENT, so it silently raises the percentage.
 *               Tree-shaking off keeps dead code in the bundle where the pass
 *               can see it was never executed.
 */
export default {
  ...base,
  build: {
    // Inherit outDir from the base config and do NOT restate it: `build.outDir`
    // is resolved relative to `root` ("src"), so a literal "dist" here writes to
    // src/dist and the server keeps serving the previous, unmapped bundle — a
    // coverage run that measures a build it did not produce.
    ...base.build,
    sourcemap: true,
    minify: false,
    rollupOptions: {
      ...base.build.rollupOptions,
      treeshake: false
    }
  }
};
