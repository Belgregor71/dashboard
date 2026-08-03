// Heap/DOM metrics probe for the kiosk Chromium via CDP (127.0.0.1:9222).
// Usage: node heap-metrics.cjs [label]
//
// ── The liveness block (added 2026-08-03) ────────────────────────────────────
// Everything above the `live` key answers "is the page HEALTHY". None of it
// answers "is the page WORKING", and the difference is not academic: on
// 2026-08-03 Live Photo motion was dead for sixteen hours — the day's clip set
// was published to a pool that had already stopped asking — while every counter
// here stayed perfectly flat. A human eye caught it. The soak did not, because
// the soak was not looking.
//
// So the sample now also reads what the surface itself says it is doing, and
// cross-checks it against what the SERVER says is available. That pairing is the
// whole idea: the failure mode this missed was precisely a disagreement between
// the two — ten clips on disk, zero of them reachable by the page.
//
// ⚠ It reports NOT-ASSESSABLE loudly rather than passing quietly. After sunset,
// outside Mode 0, or with the feature off, "no bursts" is correct behaviour, and
// a check that returns OK in those conditions is worse than no check at all —
// this repo has been bitten three times by a probe that read healthy for the
// wrong reason (`powerEfficient` reporting true while the renderer paid +41.8;
// `video.currentSrc` lingering after load(); a `.none` marker beside a valid
// clip). The soak samples are taken at bedtime by design, so expect
// `assessable: false` on them and take the motion reading in daylight, exactly
// as the GPU half already has to be.
const http = require("http");
const WebSocket = require("ws");

// The dashboard's own origin, from the box the kiosk runs on. systemd sets
// PORT=3000; override for a test server.
const ORIGIN = process.env.DASHBOARD_ORIGIN || "http://127.0.0.1:3000";

// No burst for this long, in daylight Mode 0 with clips on disk, is decisive.
// The rotation is 30 s and most of a day's memories carry a motion part, so a
// healthy afternoon bursts roughly every exchange — 15 minutes of silence is
// thirty missed opportunities, not a quiet patch.
const BURST_SILENCE_MS = 15 * 60 * 1000;

// What the server believes is playable today. Read from the box rather than
// asserted from the page, because the bug being guarded against lives exactly in
// the gap between the two.
function serverClips() {
  return new Promise((resolve) => {
    const req = http.get(`${ORIGIN}/api/immich/daily-set`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const photos = JSON.parse(body)?.photos ?? [];
          resolve({
            date: JSON.parse(body)?.date ?? null,
            total: photos.length,
            withClip: photos.filter((p) => p.motion === true).length,
            // Absent until the motionPending fix ships — undefined, not 0, so a
            // reading taken before it can never be mistaken for "none pending".
            pending: photos.some((p) => "motionPending" in p)
              ? photos.filter((p) => p.motionPending === true).length
              : null
          });
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
  });
}

/**
 * Turn the two readings into a verdict. Three outcomes, never two: OK, a named
 * fault, or an explicit refusal to judge. See the ⚠ above for why the third one
 * has to exist.
 */
function judge(archive, clips) {
  if (!archive) return { assessable: false, why: "the archive probe is absent — flag off, or not the kiosk page", faults: [] };
  if (!archive.active) return { assessable: false, why: "not in Mode 0 — the dashboard is awake, so the archive is correctly stood down", faults: [] };

  const m = archive.motion;
  if (!m) return { assessable: false, why: "no motion element — features.ambientArchiveMotion is off", faults: [] };
  if (!m.enabled) return { assessable: false, why: "motion flag off", faults: [] };
  if (m.night) return { assessable: false, why: "after sunset — the night gate refuses bursts by design", faults: [] };
  if (m.reduced) return { assessable: false, why: "prefers-reduced-motion is set — the whole surface is off by design", faults: [] };
  if (!clips) return { assessable: false, why: `could not reach ${ORIGIN} to ask what is playable`, faults: [] };
  if (clips.withClip === 0) {
    return {
      assessable: false,
      // Not a page fault: nothing to play is a transcoder/NAS story, and the
      // page is behaving correctly by showing stills.
      why: `the server has no playable clip today (${clips.total} memories, 0 with a clip) — look at the warm pass, not the page`,
      faults: []
    };
  }

  const faults = [];
  const silentMs = m.lastBurstAt ? Date.now() - m.lastBurstAt : null;
  if (m.bursts === 0) {
    faults.push(`NO BURST EVER: daylight Mode 0, ${clips.withClip}/${clips.total} memories have a clip on disk, uptime ${archive.__uptimeMin} min, and the page has played none. This is the 2026-08-03 failure — check whether the pool's frames carry a clipSrc at all before looking at the burst code.`);
  } else if (silentMs != null && silentMs > BURST_SILENCE_MS) {
    faults.push(`STALE: last burst was ${Math.round(silentMs / 60000)} min ago in daylight Mode 0, with ${clips.withClip}/${clips.total} clips available.`);
  }
  return { assessable: true, why: null, faults };
}

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
  const args = process.argv.slice(2);
  // Opt-in, so the existing callers (kiosk-sweep.sh, the /kiosk-metrics and
  // /pi-health skills) keep their exit code. With it, a liveness fault fails the
  // process — for anything that wants to be a GATE rather than a reading.
  const gate = args.includes("--gate");
  const label = args.find((a) => !a.startsWith("--")) || "sample";
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

  // The liveness half. Read straight off the surface's own probe — no observers,
  // no DOM walking: a body-subtree MutationObserver froze the live renderer once
  // and the rule since is that a probe touches one element or none.
  const archiveResult = await send("Runtime.evaluate", {
    expression: `JSON.stringify(typeof window.__archive === "function"
      ? { ...window.__archive(), __uptimeMin: +(performance.now() / 60000).toFixed(1) }
      : null)`,
    returnByValue: true
  });
  let archive = null;
  try { archive = JSON.parse(archiveResult.result.value); } catch { /* absent → null */ }

  const clips = await serverClips();
  const verdict = judge(archive, clips);

  console.log(JSON.stringify({
    label,
    ts: new Date().toISOString(),
    ...inPage,
    cdpDocuments: domCounters.documents,
    cdpNodes: domCounters.nodes,
    cdpJsEventListeners: domCounters.jsEventListeners,
    live: {
      ...verdict,
      // Carried on every sample so the DIFF is the assertion, the same way the
      // leak counters work: `bursts` is monotonic, so a 24 h row whose bursts
      // match t0's says nothing played all day even if the instant of sampling
      // was legitimately quiet. `photo` differing between samples is the cheapest
      // possible proof the rotation itself is still turning.
      active: archive?.active ?? null,
      photo: archive?.photo ?? null,
      bursts: archive?.motion?.bursts ?? null,
      lastBurstAt: archive?.motion?.lastBurstAt ?? null,
      night: archive?.motion?.night ?? null,
      clips
    }
  }));

  // Loud on stderr as well as in the JSON — a sample is usually read by eye out
  // of a terminal, and a fault buried in one line of JSON is a fault missed.
  for (const f of verdict.faults) console.error(`LIVENESS FAULT: ${f}`);
  if (!verdict.assessable) console.error(`liveness not assessable: ${verdict.why}`);

  ws.close();
  // ⚠ A fault fails; NOT-assessable does not. "I could not look" must never read
  // as "I looked and it was broken" — the samples are taken at bedtime, when not
  // assessable is the expected and correct answer.
  if (gate && verdict.faults.length) process.exitCode = 1;
}

// Exported so the verdict can be exercised against synthetic states in
// tests/soak-liveness.spec.js. A tripwire nobody has watched fire is not a
// tripwire: `kiosk-drive.cjs cycle` printed "cycled 6x" while being a total
// no-op for weeks, and the leak regression it was meant to catch went unwatched
// the whole time. This one is only ever assessable in daylight Mode 0, so
// waiting for the real conditions to test it is how it would go the same way.
module.exports = { judge, BURST_SILENCE_MS };

if (require.main === module) {
  main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
}
