// Drive the kiosk page via CDP: reload, or cycle views to exercise lottie churn.
// Usage: node kiosk-drive.cjs reload | cycle
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
const WebSocket = require("ws");

// Ends on `home`, and every step is a genuine change of view. `weather` first
// because it carries the heaviest lottie set (services/weather/renderer.js);
// `timeline` also bears them via calendar.js.
const CYCLE_VIEWS = ["weather", "cameras", "timeline", "briefing", "status", "home"];
const DWELL_MS = 1800;

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
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
    await send("Page.reload", { ignoreCache: true });
    console.log("reloaded");
    ws.close();
    return;
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
