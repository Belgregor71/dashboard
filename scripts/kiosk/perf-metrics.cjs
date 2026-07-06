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

  const a = await read();
  await new Promise((r) => setTimeout(r, windowS * 1000));
  const b = await read();

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
    animations: b.AnimationsCount ?? null
  }));

  ws.close();
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
