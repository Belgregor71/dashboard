// Capture a short Chromium trace via CDP and summarize which events dominate,
// so we can attribute the GPU-process load instead of guessing by hiding DOM.
// Usage: node scripts/kiosk/gpu-trace.cjs [seconds=3]
const http = require("http");
const WebSocket = require("ws");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let b = "";
      res.on("data", (c) => (b += c));
      res.on("end", () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

async function main() {
  const secs = Number(process.argv[2]) || 3;
  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
  if (!page) throw new Error("no page target");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  ws.on("message", (data) => {
    const m = JSON.parse(data.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
    if (m.method === "Tracing.dataCollected") events.push(...m.params.value);
  });
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise((r) => ws.on("open", r));

  await send("Tracing.start", {
    categories: "gpu,cc,viz,blink,benchmark,toplevel,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame",
    transferMode: "ReportEvents",
    bufferUsageReportingInterval: 0
  });
  await new Promise((r) => setTimeout(r, secs * 1000));
  const done = new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: "Tracing.end" })); });
  // Tracing.tracingComplete arrives as an event; wait a beat for dataCollected flush
  await new Promise((r) => setTimeout(r, 1500));
  await done.catch(() => {});

  // Aggregate complete events (ph:'X') by name: total duration + count
  const byName = new Map();
  let frameCount = 0;
  for (const e of events) {
    if (e.name === "DrawFrame" || e.name === "BeginFrame" || e.name === "Graphics.Pipeline") frameCount++;
    if (e.ph !== "X" || typeof e.dur !== "number") continue;
    const k = e.name;
    const v = byName.get(k) || { dur: 0, n: 0 };
    v.dur += e.dur; v.n++; byName.set(k, v);
  }
  const top = [...byName.entries()]
    .sort((a, b) => b[1].dur - a[1].dur)
    .slice(0, 20)
    .map(([name, v]) => ({ name, ms: +(v.dur / 1000).toFixed(1), n: v.n }));
  console.log(JSON.stringify({ secs, totalEvents: events.length, frameishEvents: frameCount, top }, null, 1));
  ws.close();
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
