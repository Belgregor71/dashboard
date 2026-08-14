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

// ── The V3 half (added 2026-08-15) ──────────────────────────────────────────
// The block above was written for the incumbent screensaver and asks about Live
// Photo motion. **That surface does not exist on the wall any more, and this is
// not a flag being off.** `src/v3/` contains no ambient archive at all — one
// grep across the whole tree returns a single CSS comment — so `__archive()` is
// permanently absent and the verdict was permanently "not assessable: the
// archive probe is absent — flag off, or not the kiosk page".
//
// That wording is now actively misleading: it names two causes, and the true one
// is neither. Worse, the liveness half was added precisely BECAUSE a healthy-
// looking soak missed sixteen hours of dead motion — and since the cutover it
// has been watching a surface nobody can see, which is the same failure wearing
// the cutover's clothes.
//
// So V3 gets its own liveness question, and it is the right one for this
// surface: **the ground IS the screen.** It is held all day by design, it is the
// most-looked-at thing in the house, and if it fails to load, fails to reveal,
// or stops turning over at the day boundary, every counter above still reads
// perfectly flat.
const GROUND_SOURCES = ["/api/immich/on-this-day", "/api/immich/random?count=2"];

/** What the server believes is on offer for the ground today. Same principle as
 *  serverClips(): asked of the box, not of the page, because the failure worth
 *  catching lives in the gap between them. */
function serverGround() {
  const ask = (path) => new Promise((resolve) => {
    const req = http.get(`${ORIGIN}${path}`, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          const arr = Array.isArray(j) ? j : (j?.assets ?? j?.photos ?? []);
          resolve({ path, count: arr.length });
        } catch { resolve({ path, count: null }); }
      });
    });
    req.on("error", () => resolve({ path, count: null }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ path, count: null }); });
  });
  return Promise.all(GROUND_SOURCES.map(ask));
}

/**
 * The V3 verdict. Three outcomes like its sibling, and for the same reason —
 * "I could not look" must never read as "I looked and it was fine".
 */
function judgeGround(ground, pool, todayKey) {
  if (!ground) {
    return { assessable: false, why: "__ground is absent — this page has no photographic ground (not the V3 kiosk, or ground.js failed to init)", faults: [] };
  }
  // A dark panel is drawing nothing on purpose. v3EnergySaver makes this the
  // expected state for eight hours a night, and the soak samples are taken at
  // bedtime — so this is the normal answer, not a degraded one.
  if (ground.__dark) {
    return { assessable: false, why: "the panel is dark (v3EnergySaver) — nothing is drawn by design; take this reading in daylight", faults: [] };
  }

  const faults = [];
  const reachable = pool?.filter((p) => p.count != null) ?? [];
  const anyOffered = reachable.some((p) => p.count > 0);

  if (!ground.assetId) {
    if (reachable.length === 0) {
      return { assessable: false, why: `could not reach ${ORIGIN} to ask what the ground can show`, faults: [] };
    }
    if (!anyOffered) {
      // Not a page fault: an empty pool is an Immich story, and a page showing
      // no photograph because none was offered is behaving correctly.
      return {
        assessable: false,
        why: `the server offers no ground asset today (${reachable.map((p) => `${p.path}=${p.count}`).join(", ")}) — look at Immich, not the page`,
        faults: []
      };
    }
    faults.push(
      `NO GROUND: the wall is showing no photograph while the server offers ` +
      `${reachable.map((p) => `${p.path}=${p.count}`).join(", ")}. On V3 the ground IS the screen — ` +
      `this is a blank wall, uptime ${ground.__uptimeMin} min.`
    );
    return { assessable: true, why: null, faults };
  }

  // Loaded but never revealed. This is the paint/reveal failure class, and it is
  // invisible to every counter above: the <img> is in the DOM, the heap is flat,
  // and the room sees nothing.
  if (!ground.shown && !ground.inFlight) {
    faults.push(`LOADED BUT NOT SHOWN: asset ${ground.assetId} is mounted with inFlight=false but has never been revealed.`);
  }

  // The day boundary. `awakePhotoDissolve`'s equivalent question was unprovable
  // for weeks because nothing persisted the asset id — here the page states its
  // own dayKey, so the check is one comparison.
  if (todayKey && ground.dayKey && ground.dayKey !== todayKey) {
    faults.push(
      `STALE DAY: the ground is still on dayKey ${ground.dayKey} but today is ${todayKey}. ` +
      `The day-boundary dissolve did not fire — the wall is showing yesterday's memories.`
    );
  }

  // `layers` counts photographic frames, ignoring a diptych's right half: 1 at
  // rest, 2 mid-settle. Two at rest with nothing in flight is a settle that
  // never finished, which is exactly the transitionend-never-fires shape this
  // house has paid for before.
  if (ground.layers > 1 && !ground.inFlight) {
    faults.push(`SETTLE STUCK: ${ground.layers} photographic layers at rest with inFlight=false — a cross-fade did not complete its cleanup.`);
  }

  return { assessable: true, why: null, faults };
}

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
      // ⚠ V3 sets neither of the incumbent's two positional fields. It reports
      // depth and (maybe) a subject instead — recorded side by side so one log
      // can hold rows from both surfaces and a null is never mistaken for a
      // reading. The V3 heap/DOM band is ~20x SMALLER than the incumbent's
      // (42 nodes vs 926), so comparing a V3 row against the old healthy band
      // means a leak could grow twentyfold before it looked abnormal.
      view: document.body.dataset.view ?? null,
      depth: window.__depth ? window.__depth().depth : null,
      subject: window.__v3 ? window.__v3().subject : null,
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

  // The same read for V3's ground. `__todayKey` is taken from the PAGE's clock,
  // not this process's: the dayKey it is compared against is `toDateString()` on
  // the kiosk, and a probe run from another box in another hour would otherwise
  // manufacture a "stale day" fault out of a timezone.
  const groundResult = await send("Runtime.evaluate", {
    expression: `JSON.stringify(typeof window.__ground === "function"
      ? { ...window.__ground(),
          __dark: window.__v3Display ? window.__v3Display().dark : (document.documentElement.dataset.panelDark === "1"),
          __todayKey: new Date().toDateString(),
          __uptimeMin: +(performance.now() / 60000).toFixed(1) }
      : null)`,
    returnByValue: true
  });
  let ground = null;
  try { ground = JSON.parse(groundResult.result.value); } catch { /* absent → null */ }

  /* Route by which probe actually answered, never by an assumption about what
     `/` serves. Both branches stay live: the incumbent is the documented
     rollback (`V3_DEFAULT=0`) and pi4-rollback is kept code-current, so a sweep
     there must still get its archive verdict. */
  const onV3 = ground !== null;
  const clips = onV3 ? null : await serverClips();
  const pool = onV3 ? await serverGround() : null;
  const verdict = onV3
    ? judgeGround(ground, pool, ground?.__todayKey ?? null)
    : judge(archive, clips);

  console.log(JSON.stringify({
    label,
    ts: new Date().toISOString(),
    ...inPage,
    cdpDocuments: domCounters.documents,
    cdpNodes: domCounters.nodes,
    cdpJsEventListeners: domCounters.jsEventListeners,
    live: {
      ...verdict,
      surface: onV3 ? "v3" : "incumbent",
      // Carried on every sample so the DIFF is the assertion, the same way the
      // leak counters work: `bursts` is monotonic, so a 24 h row whose bursts
      // match t0's says nothing played all day even if the instant of sampling
      // was legitimately quiet. `photo` differing between samples is the cheapest
      // possible proof the rotation itself is still turning.
      //
      // On V3 `assetId` plays that role: two samples a day apart showing the
      // same asset means the day boundary never turned over. There is no
      // `bursts` equivalent because there is no Live Photo motion on this
      // surface at all — stated as its own key rather than left as a null that
      // reads like a feature which failed.
      active: archive?.active ?? null,
      photo: archive?.photo ?? null,
      bursts: archive?.motion?.bursts ?? null,
      lastBurstAt: archive?.motion?.lastBurstAt ?? null,
      night: archive?.motion?.night ?? null,
      clips,
      assetId: ground?.assetId ?? null,
      assetIds: ground?.assetIds ?? null,
      dayKey: ground?.dayKey ?? null,
      layers: ground?.layers ?? null,
      pair: ground?.pair ?? null,
      dark: ground?.__dark ?? null,
      motion: onV3 ? "not on this surface — V3 has no ambient archive" : undefined,
      pool
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
module.exports = { judge, judgeGround, BURST_SILENCE_MS };

if (require.main === module) {
  main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
}
