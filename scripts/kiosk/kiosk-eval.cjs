// Evaluate an arbitrary JS expression in the live kiosk page via CDP.
// Usage: node scripts/kiosk/kiosk-eval.cjs "document.title"
//        node scripts/kiosk/kiosk-eval.cjs --detect        which surface + seam check
//        node scripts/kiosk/kiosk-eval.cjs --state         the surface's own state line
//
// The two named modes exist so callers in bash never have to embed a page
// expression. `kiosk-sweep.sh` used to carry its STATE_EXPR inline, which is how
// it kept reading `document.body.dataset.view` — a field V3 does not set — for
// weeks after the cutover. One definition, in surface.cjs, read by everything.
//
// ⚠ `--detect` EXITS NON-ZERO when a required seam is missing. That is the
// whole point of it: the caller must be unable to proceed to a sample.
const http = require("http");
const WebSocket = require("ws");
const { STATE_EXPR, detectExpr, verdict } = require("./surface.cjs");

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    }).on("error", reject);
  });
}

/** One CDP round trip, returning the raw string the page produced. */
async function evaluate(expression) {
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

  ws.close();
  return typeof result.value === "string" ? result.value : JSON.stringify(result.value);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) throw new Error("usage: kiosk-eval.cjs <expression> | --detect | --state");

  if (arg === "--detect") {
    const detected = JSON.parse(await evaluate(detectExpr()));
    const v = verdict(detected);
    console.log(JSON.stringify({ ...detected, ok: v.ok }));
    if (!v.ok) {
      console.error(`REFUSING TO SAMPLE: ${v.why}`);
      process.exit(1);
    }
    // Absent optional seams are not a failure, but they ARE a caveat on every
    // row that follows, so they are said out loud rather than left to inference.
    for (const a of detected.absent) console.error(`note: ${a} is absent`);
    return;
  }

  if (arg === "--state") {
    // Detect rather than trusting an argument: a caller that passes the wrong
    // surface name gets the wrong reader, and the wrong reader returns nulls
    // that look exactly like a quiet dashboard.
    const detected = JSON.parse(await evaluate(detectExpr()));
    const expr = STATE_EXPR[detected.surface];
    if (!expr) throw new Error(`no state reader for surface "${detected.surface}"`);
    console.log(await evaluate(expr));
    return;
  }

  console.log(await evaluate(arg));
}

main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
