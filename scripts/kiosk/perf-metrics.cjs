// Rendering-cost probe for the kiosk Chromium via CDP.
// Samples Performance.getMetrics twice over a window and reports per-second
// deltas: script time, layout ops, style recalcs, total task time.
// Usage: node scripts/kiosk/perf-metrics.cjs <label> [windowSeconds=30]
const http = require("http");
const WebSocket = require("ws");

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
  const label = process.argv[2] || "sample";
  const windowS = Number(process.argv[3]) || 30;

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

  await send("Performance.enable");
  const read = async () => {
    const { metrics } = await send("Performance.getMetrics");
    return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
  };

  /* ── The substrate frame counter ─────────────────────────────────────────
     Bracketed here rather than in a script of its own, because this is already
     the probe that owns a two-point window — and because THIS is the file that
     reports `framesPerSec` and `animations`, both of which are blind to V3's
     substrate. `AnimationsCount` counts Web Animations; the substrate is a rAF
     loop on a canvas. A sample reading `animations: 0` while the field draws 15
     frames a second is not a contradiction, it is the instrument looking in the
     wrong place — and it filed a healthy live-ambient reading under the
     quiescent row once already.

     `frames` is monotonic since page load, so the DELTA over this window is the
     only honest fps. Absent on the incumbent surface (no __substrate) → null,
     never 0: "no counter" and "no frames" are different answers and the dark
     panel makes the second one meaningful.
  ──────────────────────────────────────────────────────────────────────── */
  const substrate = async () => {
    const r = await send("Runtime.evaluate", {
      expression: `JSON.stringify(window.__substrate ? window.__substrate() : null)`,
      returnByValue: true
    });
    try { return JSON.parse(r.result.value); } catch { return null; }
  };

  const a = await read();
  const sa = await substrate();
  await new Promise((r) => setTimeout(r, windowS * 1000));
  const b = await read();
  const sb = await substrate();

  const dt = b.Timestamp - a.Timestamp;
  const rate = (name) => +(((b[name] ?? 0) - (a[name] ?? 0)) / dt).toFixed(2);
  const pct = (name) => +((((b[name] ?? 0) - (a[name] ?? 0)) / dt) * 100).toFixed(1);

  console.log(JSON.stringify({
    label,
    windowS: +dt.toFixed(1),
    scriptPct: pct("ScriptDuration"),       // % of wall time running JS
    layoutPct: pct("LayoutDuration"),
    stylePct: pct("RecalcStyleDuration"),
    taskPct: pct("TaskDuration"),           // total main-thread busy %
    layoutsPerSec: rate("LayoutCount"),
    styleRecalcsPerSec: rate("RecalcStyleCount"),
    framesPerSec: rate("FramesPerSecond") || undefined,
    jsHeapMB: +((b.JSHeapUsedSize ?? 0) / 1048576).toFixed(1),
    nodes: b.Nodes,
    // ⚠ Blind to the substrate — read `substrateFps` below, not this, when
    // judging whether V3's field was moving. Kept because it is still the right
    // number for the incumbent's CSS/lottie animations.
    animations: b.AnimationsCount ?? null,
    substrateBackend: sb?.backend ?? null,
    substrateAnimating: sb?.animating ?? null,
    substratePaused: sb?.paused ?? null,
    substrateFrames: sa && sb ? sb.frames - sa.frames : null,
    substrateFps: sa && sb && sb.seconds > sa.seconds
      ? +((sb.frames - sa.frames) / (sb.seconds - sa.seconds)).toFixed(1)
      : null
  }));

  ws.close();
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
