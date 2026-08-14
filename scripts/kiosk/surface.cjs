// Which surface is on the wall, and does it still have the seams the
// measurement instrument drives?
//
// ── Why this file exists ─────────────────────────────────────────────────────
// The V3 cutover (`77f5fb1`) changed what `/` serves. Every probe in this
// directory was written against the incumbent's hooks, and none of them
// noticed: on 2026-08-14 a live probe found `__wakeScreensaver`,
// `__engageScreensaver`, `__forceAtmoEpisode`, `__switchView`, `__archive` and
// `__atmosphere` ALL `undefined` on the wall. `kiosk-sweep.sh` was therefore
// logging ambient three times and labelling the second one a peak.
//
// That is the SECOND time this exact thing has happened — `kiosk-drive.cjs
// cycle` was a total no-op for weeks after Phase 7 "Dissolve" shipped, and it
// printed "cycled 6x" the whole time. Both times the failure was silent because
// the drive step and the check step were the same step: a hook that does not
// exist evaluates to `undefined` and the sample is taken anyway.
//
// So the rule this module encodes is: **the instrument declares the seams it
// needs, up front, and refuses to sample when they are missing.** A reading
// nobody can trust is worse than no reading, because it goes in the log next to
// the real ones and gets compared against them.
//
// `tests/kiosk-instrument.spec.js` asserts the V3 manifest against the real
// page, so the next cutover-shaped change breaks a test instead of quietly
// disarming the sweep.

/* ── The manifests ───────────────────────────────────────────────────────────
   `required` — the sweep cannot produce an honest number without these; a
   missing one is a hard stop.
   `optional` — feature- or flag-gated seams. Absent is a legitimate state, so
   these are REPORTED (with the reason) rather than fatal. The distinction
   matters: `__v3Wake` only exists when `v3EnergySaver` is on, and reverting
   that flag is the documented rollback path — it must not break the sweep.
─────────────────────────────────────────────────────────────────────────── */
const MANIFESTS = {
  v3: {
    required: [
      "__v3",          // the twenty-subsystem state read
      "__substrate",   // THE discriminator — see the note below
      "__depth",
      "__setDepth",
      "__ground",
      "__v3Subject"    // the subject cycle, i.e. the teardown tripwire
    ],
    optional: {
      __v3Wake: "features.v3EnergySaver is off — initDisplay() returns before registering it",
      __v3Display: "features.v3EnergySaver is off",
      __v3PanelDark: "features.v3EnergySaver is off",
      __groundDissolve: "ground.js has not initialised — no photographic ground on this page"
    }
  },
  incumbent: {
    // Kept whole for the rollback host. `V3_DEFAULT=0` restores this surface
    // (V3-CUTOVER.md:504) and `pi4-rollback` stays code-current, so the
    // incumbent instrument is cold standby, not dead code.
    required: ["__switchView", "__wakeScreensaver", "__engageScreensaver"],
    optional: {
      __forceAtmoEpisode: "atmoFx not initialised",
      __archive: "features.ambientArchive is off",
      __atmosphere: "atmosphere runtime not initialised"
    }
  }
};

/* ── The state expression ────────────────────────────────────────────────────
   🔑 `anims` CANNOT SEE THE SUBSTRATE, and this is the single most misleading
   number the old sweep printed. `document.getAnimations()` counts Web
   Animations; V3's substrate is a rAF loop on a canvas. The live-ambient sample
   that closed the baseline read `anims: 0` with an empty `atmo-*` token and was
   nonetheless drawing 15 frames a second — the table's own "record `anims` and
   match the row to the state" rule would have filed it under the QUIESCENT row
   (ceiling 8), making a perfectly healthy 5.9% look like a near-miss against a
   ceiling it was never measured against.

   On V3 the discriminator is `__substrate().animating` / `.paused`. `anims` is
   still carried, but only so the log records that it is uninformative here.
─────────────────────────────────────────────────────────────────────────── */
const STATE_EXPR = {
  v3: `JSON.stringify((() => {
    const s = window.__substrate ? window.__substrate() : null;
    const d = window.__depth ? window.__depth() : null;
    const g = window.__ground ? window.__ground() : null;
    const disp = window.__v3Display ? window.__v3Display() : null;
    return {
      depth: d?.depth ?? null,
      reason: d?.reason ?? null,
      subject: window.__v3 ? window.__v3().subject : null,
      substrate: s && {
        backend: s.backend, animating: s.animating, paused: s.paused,
        frames: s.frames, seconds: +s.seconds.toFixed(1)
      },
      panelDark: disp?.dark ?? (document.documentElement.dataset.panelDark === "1" ? true : null),
      monitor: disp?.monitor ?? null,
      /* ⚠ inFlight is carried because without it "layers: 2" is ambiguous, and
         the first live run hit exactly that: the 06:44 ambient sample read two
         photographic layers at rest, which is the SETTLE STUCK signature — and
         was in fact a perfectly normal cross-fade caught mid-flight. One field
         separates "a photograph arriving" from "a fade that never cleaned up".
         (No backticks in here — this comment lives inside a template literal.) */
      ground: g && { assetId: g.assetId, layers: g.layers, imgs: g.imgs, pair: g.pair, shown: g.shown, inFlight: g.inFlight },
      // Carried to record that it is BLIND to the substrate, not to be read as
      // the activity level. See the block comment above.
      anims: document.getAnimations().filter(a => a.playState === "running").length
    };
  })())`,
  incumbent: `JSON.stringify({
    view: document.body.dataset.view || null,
    screensaver: document.body.className.includes("screensaver-active"),
    anims: document.getAnimations().filter(a => a.playState === "running").length,
    atmo: [...document.body.classList].find(c => c.startsWith("atmo-")) || null,
    fx: (window.__atmoFx && window.__atmoFx().running) || null
  })`
};

/**
 * One expression, evaluated in the page, that answers all three questions the
 * instrument has to ask before it samples anything: which surface is this,
 * which declared seams are present, and which are missing.
 *
 * Returns a JSON string so every caller (bash via kiosk-eval, node via CDP) can
 * consume it the same way.
 */
function detectExpr() {
  return `JSON.stringify((() => {
    const manifests = ${JSON.stringify(MANIFESTS)};
    const surface = typeof window.__v3 === "function" ? "v3"
      : typeof window.__switchView === "function" ? "incumbent"
      : "unknown";
    if (surface === "unknown") {
      return { surface, missing: [], absent: [], url: location.pathname };
    }
    const m = manifests[surface];
    const has = (n) => typeof window[n] === "function";
    return {
      surface,
      url: location.pathname,
      missing: m.required.filter(n => !has(n)),
      absent: Object.keys(m.optional).filter(n => !has(n)).map(n => n + " (" + m.optional[n] + ")")
    };
  })())`;
}

/**
 * Turn a detection result into a go/no-go, with the refusal spelled out.
 *
 * ⚠ `unknown` is fatal too. A page that is neither surface is a page that has
 * not finished booting or has thrown on the way up — sampling it produces a
 * number for a dashboard that is not running, which is exactly the kind of
 * plausible-looking row that poisons a baseline table.
 */
function verdict(detected) {
  if (!detected || detected.surface === "unknown") {
    return {
      ok: false,
      why: `the page at ${detected?.url ?? "?"} exposes neither __v3 nor __switchView — ` +
        `it is not a booted dashboard. Check window.__v3Boot() for a failed stage before sampling.`
    };
  }
  if (detected.missing.length) {
    return {
      ok: false,
      why: `the ${detected.surface} surface is missing required seams: ${detected.missing.join(", ")}. ` +
        `The instrument would sample anyway and log a number that means nothing — this is the ` +
        `disarmed-tripwire failure from 2026-07-30 and again from the V3 cutover. Fix the seams first.`
    };
  }
  return { ok: true, why: null };
}

module.exports = { MANIFESTS, STATE_EXPR, detectExpr, verdict };
