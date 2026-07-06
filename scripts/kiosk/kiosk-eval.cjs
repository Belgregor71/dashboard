// Evaluate an arbitrary JS expression in the live kiosk page via CDP.
// Usage: node scripts/kiosk/kiosk-eval.cjs "document.title"
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
  const expression = process.argv[2];
  if (!expression) throw new Error("usage: kiosk-eval.cjs <expression>");

  const targets = await getJson("http://127.0.0.1:9222/json");
  const page = targets.find((t) => t.type === "page" && !t.url.startsWith("devtools"));
  if (!page) throw new Error("No page target found");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.on("open", resolve); ws.on("error", reject); });

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("eval timeout")), 30_000);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result.result);
      }
    });
    ws.send(JSON.stringify({
      id: 1,
      method: "Runtime.evaluate",
      params: { expression, returnByValue: true, awaitPromise: true }
    }));
  });

  console.log(typeof result.value === "string" ? result.value : JSON.stringify(result.value));
  ws.close();
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
