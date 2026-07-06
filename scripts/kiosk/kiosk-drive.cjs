// Drive the kiosk page via CDP: reload, or cycle views to exercise lottie churn.
// Usage: node kiosk-drive.cjs reload | cycle
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
  } else {
    const result = await send("Runtime.evaluate", {
      expression: `(async () => {
        for (let i = 0; i < 6; i++) {
          window.__switchView(i % 2 === 0 ? "weather" : "home");
          await new Promise(r => setTimeout(r, 1800));
        }
        window.__switchView("home");
        await new Promise(r => setTimeout(r, 1800));
        return "cycled 6x, back on " + document.body.dataset.view;
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    console.log(result.result.value);
  }
  ws.close();
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
