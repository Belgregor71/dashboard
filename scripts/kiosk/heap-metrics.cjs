// Heap/DOM metrics probe for the kiosk Chromium via CDP (127.0.0.1:9222).
// Usage: node heap-metrics.cjs [label]
const http = require("http");
const WebSocket = require("ws");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

async function main() {
  const label = process.argv[2] || "sample";
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

  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });

  // Force GC first so we measure retained memory, not garbage.
  await send("HeapProfiler.enable");
  await send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 1500));
  await send("HeapProfiler.collectGarbage");
  await new Promise((r) => setTimeout(r, 500));

  const domCounters = await send("Memory.getDOMCounters");

  const evalResult = await send("Runtime.evaluate", {
    expression: `JSON.stringify({
      usedJSHeapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1),
      totalJSHeapMB: +(performance.memory.totalJSHeapSize / 1048576).toFixed(1),
      domNodes: document.querySelectorAll("*").length,
      lottieWrappers: document.querySelectorAll(".lottie-fade").length,
      lottieSvgs: document.querySelectorAll(".lottie-fade svg").length,
      view: document.body.dataset.view,
      uptimeMin: +(performance.now() / 60000).toFixed(1)
    })`,
    returnByValue: true
  });

  const inPage = JSON.parse(evalResult.result.value);
  console.log(JSON.stringify({
    label,
    ts: new Date().toISOString(),
    ...inPage,
    cdpDocuments: domCounters.documents,
    cdpNodes: domCounters.nodes,
    cdpJsEventListeners: domCounters.jsEventListeners
  }));

  ws.close();
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
