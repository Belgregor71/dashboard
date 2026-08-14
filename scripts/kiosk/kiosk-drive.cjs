// Drive the kiosk page via CDP: reload, cycle the surface, or hold it at peak.
// Usage: node kiosk-drive.cjs reload | cycle | peak [seconds] | restore
//
// ⚠ 2026-08-15: `cycle` is surface-aware. Since the V3 cutover, `/` serves a
// page with no views, no `data-view` and no `__switchView` — so the incumbent
// cycle below was `undefined()` six times in a row. It threw inside the page
// rather than printing a wrong number, but `kiosk-sweep.sh` swallowed it and
// sampled anyway. Same disarmed tripwire as the 2026-07-30 no-op documented
// below, caused the same way: the drive step never checked that its seams
// existed. surface.cjs is where that check lives now.
//
// ⚠ 2026-07-30 bugfix: `cycle` alternated __switchView("weather") / ("home") with
// no options, and had been a TOTAL NO-OP since Phase 7 "Dissolve" shipped.
// viewManager.js:97 drops passive navigation into RETIRED_VIEWS
// (weather/cameras/briefing) whenever `ambientSubstrate` is on — it is — and :93
// drops a switch to the view that is already current. So every one of the old
// calls returned immediately while the script still printed "cycled 6x, back on
// home", which is literally true and completely uninformative.
//
// The cost was not the wrong number, it was a disarmed tripwire: /kiosk-metrics
// drives this specifically to churn lotties and catch the zombie-wrapper
// regression (709 of them, 2026-07 leak audit). The lottie-heavy surface is the
// `weather` view, so the churn stopped happening and the heap delta has been
// measuring nothing.
//
// Two rules encoded here as a result:
//   1. Force through every registered view. All six land with { force: true }
//      (probed on the live kiosk); event/voice callers already reach them this
//      way, so this is a real state, not a synthetic one.
//   2. VERIFY every transition and exit non-zero if one does not land. A gate
//      must never be able to read as success again.
const http = require("http");
const fs = require("fs");
const path = require("path");
const WebSocket = require("ws");
const { detectExpr, verdict } = require("./surface.cjs");

// Ends on `home`, and every step is a genuine change of view. `weather` first
// because it carries the heaviest lottie set (services/weather/renderer.js);
// `timeline` also bears them via calendar.js.
const CYCLE_VIEWS = ["weather", "cameras", "timeline", "briefing", "status", "home"];
const DWELL_MS = 1800;

/* ── V3's equivalent of the view cycle ───────────────────────────────────────
   V3 has no views. What it has is nine subjects, each mounted into
   `#subject-mount` with its own `teardown()`, and `showSubject()` tears the
   previous one down before building the next. Cycling them is therefore the
   same test the view cycle was: a churn that exercises every teardown path in
   sequence and leaves the surface where it started.

   ⚠ The leak signature is DIFFERENT here and the old one does not apply. V3
   renders zero lotties (`lottieWrappers: 0` on the live wall), so
   wrappers-vs-svgs measures nothing. The V3 shapes worth catching:
     · a subject node surviving its own teardown → `#subject-mount` not empty
     · an MJPEG <img> left with a src → showCamera's own comment calls this
       "not a leak, a fire": the connection stays open and decoding forever
     · listeners/nodes ratcheting across the cycle

   ⚠ `false` from a subject is a LEGITIMATE answer, not a failure. show.media
   with nothing playing and show.sky with no radar meta both decline by design —
   `showSubject` returns false and the caller falls through rather than leaving
   the screen empty and confident. So a decline is REPORTED, never fatal. What
   IS fatal is a subject claiming it mounted while `activeSubject()` disagrees.
─────────────────────────────────────────────────────────────────────────── */
const CYCLE_SUBJECTS = [
  // camera first: the heaviest, and the only one holding an open connection.
  { id: "show.camera", slots: { camera: "driveway" } },
  { id: "show.sky", slots: {} },
  { id: "show.day", slots: {} },
  { id: "show.tonight", slots: {} },
  { id: "show.list", slots: { list: "shopping" } },
  { id: "show.recipe", slots: {} },
  { id: "show.year", slots: {} },
  { id: "show.media", slots: {} },
  { id: "show.briefing", slots: {} },
  { id: "show.status", slots: {} }
];

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

/* ── V3: the subject cycle, the peak, and the way back ───────────────────────
   Returns a process exit code (0 = fine) rather than calling process.exit, so
   the websocket is always closed by the caller.
─────────────────────────────────────────────────────────────────────────── */
async function driveV3(send, mode, seconds) {
  const evalPage = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "page threw");
    return typeof r.result.value === "string" ? JSON.parse(r.result.value) : r.result.value;
  };

  if (mode === "cycle") {
    const report = await evalPage(`(async () => {
      const subjects = ${JSON.stringify(CYCLE_SUBJECTS)};
      const dwell = ${DWELL_MS};
      const sample = () => ({
        mounted: window.__v3().subject,
        mountChildren: (document.getElementById("subject-mount")?.children.length) ?? null,
        // The MJPEG check. An <img> still pointed at a /live endpoint after its
        // subject was torn down is an open connection decoding forever.
        liveImgs: [...document.querySelectorAll("img")].filter(i => (i.getAttribute("src") || "").includes("/live")).length,
        nodes: document.querySelectorAll("*").length
      });

      // Start from nothing mounted so every step below is a real mount. An
      // unknown id is the documented way to clear: showSubject() tears the
      // previous subject down BEFORE it looks the new id up, then returns false.
      await window.__v3Subject("__sweep.none__");
      await new Promise(r => setTimeout(r, dwell));
      const base = sample();

      const steps = [];
      for (const s of subjects) {
        const claimed = await window.__v3Subject(s.id, s.slots);
        await new Promise(r => setTimeout(r, dwell));
        const after = sample();
        steps.push({
          id: s.id,
          // What the subject SAID it did, and what the surface says is true.
          // Disagreement between these two is the only hard failure here.
          claimed: Boolean(claimed),
          mounted: after.mounted === s.id,
          declined: claimed === false,
          liveImgs: after.liveImgs,
          nodes: after.nodes
        });
      }

      await window.__v3Subject("__sweep.none__");
      await new Promise(r => setTimeout(r, dwell));
      const final = sample();
      return JSON.stringify({ steps, base, final });
    })()`);

    for (const s of report.steps) {
      const verdictWord = s.declined ? "decl" : s.mounted ? "ok  " : "FAIL";
      console.log(
        `${verdictWord} ${s.id}${s.declined ? "  (no data to show — legitimate)" : ""}` +
        `${!s.declined && !s.mounted ? "  claimed a mount that did not land" : ""}` +
        `  nodes ${s.nodes}${s.liveImgs ? `  live-img ${s.liveImgs}` : ""}`
      );
    }

    const mountedCount = report.steps.filter((s) => s.mounted).length;
    const declined = report.steps.filter((s) => s.declined).map((s) => s.id);
    const inconsistent = report.steps.filter((s) => s.claimed && !s.mounted);
    console.log(
      `cycled ${mountedCount}/${report.steps.length} subjects` +
      `, nodes ${report.base.nodes} -> ${report.final.nodes}` +
      `, mount ${report.final.mountChildren} child(ren), ${report.final.liveImgs} live img(s)` +
      (declined.length ? `, declined: ${declined.join(" ")}` : "")
    );

    let code = 0;
    // A subject that declines every time is F2's territory, not a leak — but it
    // is also exactly the shape of the show.status defect (shadowed in the
    // dispatch table, nobody noticed), so it is said loudly rather than logged.
    if (declined.length) {
      console.error(
        `NOTE: ${declined.length} subject(s) showed nothing: ${declined.join(", ")}. ` +
        `Legitimate when the house has no data for them — but an entry that NEVER mounts is ` +
        `an unexercised dispatch row, which this table has already shipped one real defect from.`
      );
    }
    if (inconsistent.length) {
      console.error(
        `ERROR: ${inconsistent.map((s) => s.id).join(", ")} returned a successful mount but ` +
        `activeSubject() disagrees. The teardown/mount bookkeeping is inconsistent — heap deltas ` +
        `across this cycle mean nothing until it is fixed.`
      );
      code = 1;
    }
    if (report.final.mountChildren) {
      console.error(
        `ERROR: #subject-mount still holds ${report.final.mountChildren} node(s) after the cycle ` +
        `was cleared — a teardown did not remove its own node. This is V3's zombie-wrapper.`
      );
      code = 1;
    }
    if (report.final.liveImgs) {
      console.error(
        `ERROR: ${report.final.liveImgs} <img> still pointed at a /live endpoint after teardown. ` +
        `showCamera's own comment calls this a fire, not a leak: the MJPEG connection stays open ` +
        `and keeps decoding forever on a surface that runs for weeks.`
      );
      code = 1;
    }
    return code;
  }

  if (mode === "peak") {
    /* The heaviest state V3 can actually be in, held for the whole window.
       Deliberately NOT a synthetic effect: there is no atmoFx in V3 and no
       `rain-heavy` to force, so the peak is defined as the heaviest REAL
       composite the surface has — the live MJPEG camera subject at depth 3 over
       an animating substrate, with the photographic ground crossfading under it.

       ⚠⚠ It REFUSES on a dark panel instead of sampling. The incumbent sweep
       merely warned about this ("inside the DISPLAY_OFF window the wake is
       refused... so a night run measures ambient twice"), and a warning inside a
       log nobody re-reads is how ambient got labelled a peak. With v3EnergySaver
       on it is worse than a tie: the substrate is PAUSED, so a night "peak"
       would read lower than a daytime ambient. */
    const state = await evalPage(`JSON.stringify({
      dark: window.__v3Display ? window.__v3Display().dark : null,
      hasWake: typeof window.__v3Wake === "function"
    })`);
    if (state.dark) {
      if (!state.hasWake) {
        console.error("REFUSING: the panel is dark and __v3Wake is absent — cannot reach a peak state.");
        return 1;
      }
      await evalPage(`JSON.stringify({ woke: window.__v3Wake("sweep") ?? null })`);
      await new Promise((r) => setTimeout(r, 1500));
      const after = await evalPage(`JSON.stringify({ dark: window.__v3Display().dark })`);
      if (after.dark) {
        console.error(
          "REFUSING: the panel stayed dark through a wake request, so this window would measure a " +
          "PAUSED substrate and log it as a peak. Take the peak row in daylight."
        );
        return 1;
      }
    }

    const held = await evalPage(`(async () => {
      const until = Date.now() + ${seconds * 1000};
      await window.__v3Subject("show.camera", { camera: "driveway" });
      // Re-assert on a 5s beat for the same reason the incumbent re-fired its
      // atmoFx episode: depth 3 recedes after HOLD_MS, and a peak that expires
      // mid-window under-reports itself.
      while (Date.now() < until) {
        window.__setDepth(3, "sweep-peak", { holdMs: 15000 });
        if (window.__v3().subject !== "show.camera") await window.__v3Subject("show.camera", { camera: "driveway" });
        await new Promise(r => setTimeout(r, 5000));
      }
      const s = window.__substrate();
      return JSON.stringify({
        depth: window.__depth().depth,
        subject: window.__v3().subject,
        substrateAnimating: s.animating,
        substratePaused: s.paused
      });
    })()`);

    console.log(`peak held ${seconds}s — ${JSON.stringify(held)}`);
    // The peak must BE a peak. Each of these silently turns the sample back into
    // an ambient reading, which is the failure this whole repair is about.
    if (held.depth !== 3 || held.subject !== "show.camera" || held.substratePaused) {
      console.error(
        `ERROR: the peak did not hold (depth ${held.depth}, subject ${held.subject}, ` +
        `substrate ${held.substratePaused ? "paused" : "running"}). This window is NOT a peak — ` +
        `discard the row rather than filing it next to the real ones.`
      );
      return 1;
    }
    return 0;
  }

  if (mode === "restore") {
    const back = await evalPage(`(async () => {
      await window.__v3Subject("__sweep.none__");
      window.__setDepth(0, "sweep-restore");
      // Let the display window decide for itself whether the panel should be
      // dark now — the sweep's wake must not outlive the sweep.
      if (window.__v3DisplayTick) await window.__v3DisplayTick();
      return JSON.stringify({ depth: window.__depth().depth, subject: window.__v3().subject });
    })()`);
    console.log(`restored — ${JSON.stringify(back)}`);
    return back.depth === 0 && back.subject === null ? 0 : 1;
  }

  console.error(`ERROR: unknown mode "${mode}" (expected cycle | peak | restore | reload)`);
  return 1;
}

async function main() {
  const mode = process.argv[2] || "cycle";
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
  if (!page) throw new Error("No page target found");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let msgId = 0;
  const pending = new Map();
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    }
  });
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

  if (mode === "reload") {
    await send("Page.enable");
    // `Page.reload {ignoreCache}` alone is NOT enough, and this has now cost a
    // wasted deploy cycle three times. It revalidates the main document but the
    // page still comes back on the cached index.html, which references the OLD
    // content-hashed bundle — so a CSS/JS deploy is correct on disk, correct in
    // the deploy log, and absent on the panel. It reads exactly like "my
    // selector is wrong". `Network.setCacheDisabled` is the part that actually
    // bypasses it.
    await send("Network.enable");
    await send("Network.setCacheDisabled", { cacheDisabled: true });
    await send("Page.reload", { ignoreCache: true });
    // Let the new document fetch its subresources before caching is re-enabled,
    // or the bundle is served from cache again on the way in.
    await new Promise((r) => setTimeout(r, 8000));
    await send("Network.setCacheDisabled", { cacheDisabled: false });

    // Prove it landed rather than claiming it: compare the stylesheet the page
    // actually loaded against what is on disk. This is the documented
    // first-check for "the deploy did not appear", so do it automatically.
    const sheets = await send("Runtime.evaluate", {
      expression: `[...document.styleSheets].map(s => (s.href || "inline").split("/").pop()).filter(n => n.endsWith(".css"))`,
      returnByValue: true
    });
    const loaded = sheets?.result?.value ?? [];
    let onDisk = [];
    try {
      onDisk = fs.readdirSync(path.join(__dirname, "..", "..", "dist", "assets")).filter((f) => f.endsWith(".css"));
    } catch { /* not deployed from this tree — skip the check rather than fail */ }
    const stale = onDisk.length > 0 && !onDisk.some((f) => loaded.includes(f));
    console.log(`reloaded — stylesheet ${loaded.join(", ") || "?"}${onDisk.length ? ` · disk ${onDisk.join(", ")}` : ""}`);
    if (stale) {
      console.error("STALE: the page is running a different bundle than dist/. The reload did not take.");
      ws.close();
      process.exit(1);
    }
    ws.close();
    return;
  }

  /* Every mode below DRIVES the page, so the seam check happens once, here,
     before any of them. An `undefined()` in the page throws where nobody looks;
     a refusal here is visible in the sweep log and stops the sample. */
  const detected = JSON.parse((await send("Runtime.evaluate", {
    expression: detectExpr(),
    returnByValue: true
  })).result.value);
  const v = verdict(detected);
  if (!v.ok) {
    console.error(`REFUSING TO DRIVE: ${v.why}`);
    ws.close();
    process.exit(1);
  }

  if (detected.surface === "v3") {
    const code = await driveV3(send, mode, Number(process.argv[3]) || 30);
    ws.close();
    if (code) process.exit(code);
    return;
  }

  if (mode !== "cycle") {
    console.error(`ERROR: "${mode}" is a V3 mode; on the incumbent surface the sweep drives the peak inline with kiosk-eval.`);
    ws.close();
    process.exit(1);
  }

  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const views = ${JSON.stringify(CYCLE_VIEWS)};
      const dwell = ${DWELL_MS};
      const sample = () => ({
        view: document.body.dataset.view,
        lottieWrappers: document.querySelectorAll(".lottie-fade").length,
        lottieSvgs: document.querySelectorAll(".lottie-fade svg").length
      });

      // Start from a known view so every step below is a real transition —
      // switchView() drops a switch to the current view, which would otherwise
      // silently shorten the cycle depending on where the kiosk happened to be.
      window.__switchView("home", { force: true });
      await new Promise(r => setTimeout(r, dwell));

      const steps = [];
      for (const target of views) {
        const before = sample();
        window.__switchView(target, { force: true });
        await new Promise(r => setTimeout(r, dwell));
        const after = sample();
        steps.push({
          target,
          from: before.view,
          to: after.view,
          landed: after.view === target,
          lottieWrappers: after.lottieWrappers,
          lottieSvgs: after.lottieSvgs
        });
      }

      // Settle before the zombie check. wrappers > svgs is the leak signature,
      // but it is ALSO the normal state for a few hundred ms while a view's
      // lotties mount — the first step of a real run reported 5w/1svg and every
      // later step 5w/5svg. Judging per-step cries wolf, and a warning that
      // cries wolf gets ignored, so only the settled steady state counts.
      await new Promise(r => setTimeout(r, 1500));
      const final = sample();
      return JSON.stringify({
        steps,
        landed: steps.filter(s => s.landed).length,
        attempted: steps.length,
        maxLottieWrappers: Math.max(...steps.map(s => s.lottieWrappers)),
        finalWrappers: final.lottieWrappers,
        finalSvgs: final.lottieSvgs,
        orphanedWrappers: final.lottieWrappers > final.lottieSvgs,
        transientImbalance: steps.some(s => s.lottieWrappers > s.lottieSvgs),
        finalView: final.view
      });
    })()`,
    awaitPromise: true,
    returnByValue: true
  });

  ws.close();

  const report = JSON.parse(result.result.value);
  for (const s of report.steps) {
    console.log(
      `${s.landed ? "ok  " : "FAIL"} ${s.from} -> ${s.target}` +
      `${s.landed ? "" : ` (stayed on ${s.to})`}` +
      `  lottie ${s.lottieWrappers}w/${s.lottieSvgs}svg`
    );
  }
  console.log(
    `cycled ${report.landed}/${report.attempted} views, back on ${report.finalView}` +
    `, peak lottie wrappers ${report.maxLottieWrappers}` +
    `, settled ${report.finalWrappers}w/${report.finalSvgs}svg` +
    (report.transientImbalance ? " (transient mount gap seen mid-cycle — expected)" : "")
  );

  if (report.orphanedWrappers) {
    console.error(
      `WARN: settled state has ${report.finalWrappers} .lottie-fade wrappers but only ` +
      `${report.finalSvgs} svgs — orphaned wrappers persist after the cycle, which is the ` +
      `zombie-wrapper signature from the 2026-07 leak audit.`
    );
  }
  if (report.landed !== report.attempted) {
    console.error(
      `ERROR: ${report.attempted - report.landed} view(s) did not land. A silently gated ` +
      `switch makes the lottie-churn leak test measure nothing — fix before trusting heap deltas.`
    );
    process.exit(1);
  }
  if (report.finalView !== "home") {
    console.error(`ERROR: cycle ended on "${report.finalView}", expected "home"`);
    process.exit(1);
  }
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
