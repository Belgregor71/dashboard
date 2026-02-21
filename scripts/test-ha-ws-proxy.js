#!/usr/bin/env node

const port = process.env.PORT || 3000;
const token = process.env.HA_TOKEN;
const timeoutMs = Number(process.env.HA_WS_TEST_TIMEOUT_MS || 12000);
const keepAliveMs = 5000;

if (!token) {
  console.error("HA_TOKEN is required for websocket proxy test");
  process.exit(2);
}

const url = `ws://localhost:${port}/api/websocket`;
const startedAt = Date.now();
let authRequiredSeen = false;
let authOkSeen = false;
let settled = false;

const ws = new WebSocket(url);

const fail = (message) => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  try {
    ws.close();
  } catch {
    // no-op
  }
  console.error(`HA websocket proxy test failed: ${message}`);
  process.exit(1);
};

const pass = () => {
  if (settled) return;
  settled = true;
  clearTimeout(timer);
  ws.close();
  console.log("HA websocket proxy test passed");
  process.exit(0);
};

const timer = setTimeout(() => {
  fail(`timed out after ${timeoutMs}ms`);
}, timeoutMs);

ws.addEventListener("open", () => {
  console.log(`Connected to ${url}`);
});

ws.addEventListener("message", (event) => {
  let msg;
  try {
    msg = JSON.parse(String(event.data));
  } catch {
    fail(`received non-JSON message: ${String(event.data)}`);
    return;
  }

  if (msg.type === "auth_required") {
    authRequiredSeen = true;
    ws.send(JSON.stringify({ type: "auth", access_token: token }));
    return;
  }

  if (msg.type === "auth_ok") {
    authOkSeen = true;
    setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        fail("socket did not remain open for 5 seconds after auth_ok");
        return;
      }
      pass();
    }, keepAliveMs);
  }
});

ws.addEventListener("close", (event) => {
  if (settled) return;
  const elapsed = Date.now() - startedAt;
  fail(`socket closed prematurely (code=${event.code}, reason=${event.reason || ""}, elapsed=${elapsed}ms, auth_required=${authRequiredSeen}, auth_ok=${authOkSeen})`);
});

ws.addEventListener("error", () => {
  fail("socket error");
});
