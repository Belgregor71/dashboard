#!/usr/bin/env node
/**
 * Live worst-case contrast on the kiosk — the half the local gate cannot do.
 *
 * tests/verify/contrast.spec.js measures ~13 text nodes over a dark gradient,
 * because a dev machine has no Immich photo, no calendar, no weather. The kiosk
 * composites its text over a REAL PHOTOGRAPH, and a bright patch of sky is the
 * backdrop that actually breaks legibility.
 *
 * Runs ON THE KIOSK (CDP is bound to 127.0.0.1:9222, localhost only):
 *   node scripts/verify/live-contrast.cjs [dwell|glance|ambient]
 *
 * ⚠ RETARGETED AT V3 2026-10-03. Until then this drove the INCUMBENT's hooks
 * (`__wakeScreensaver`, `__presence`), so from the V3 cutover on, /verify-push's
 * contrast row measured a surface that was not on the wall (audit
 * INCUMBENT-RETIREMENT-2026-10-03 §7.1). The modes now map onto V3 depths —
 * ambient → 0 (the field), glance → 1, dwell → 2 (the spread) — via
 * `__setDepth`, and the run refuses a page that is not V3 rather than
 * measuring whatever is there. The local V3 lane is
 * tests/verify/v3-contrast.spec.js; this is its half over the real photo.
 *
 * Same algorithm as the spec, and the same two traps it documents:
 *   - running CSS transitions outrank !important, so kill transitions BEFORE
 *     stripping text, and strip via -webkit-text-fill-color
 *   - fold ancestor opacity into the text colour and drop anything effectively
 *     invisible, or hidden popups dominate with meaningless 1:1 readings
 */

const http = require("http");
const WebSocket = require("ws");

const MODE = process.argv[2] || "dwell";
const DEPTH_FOR = { ambient: 0, glance: 1, dwell: 2 };
if (!(MODE in DEPTH_FOR)) {
  console.error(`live-contrast: unknown mode "${MODE}" — use ${Object.keys(DEPTH_FOR).join(" | ")}`);
  process.exit(2);
}
const AA_NORMAL = 4.5;
const AA_LARGE = 3.0;

const get = (path) =>
  new Promise((res, rej) => {
    http
      .get({ host: "127.0.0.1", port: 9222, path }, (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej);
  });

(async () => {
  const targets = await get("/json/list");
  const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  if (!page) throw new Error("no kiosk page on CDP 9222");

  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 512 * 1024 * 1024 });
  let id = 0;
  const pending = new Map();
  ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const i = ++id;
      pending.set(i, { resolve, reject });
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const evaluate = async (expr) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
    return r.result.value;
  };

  await new Promise((r) => ws.on("open", r));
  await send("Runtime.enable");

  // Refuse anything but V3: a sample of the wrong page is a plausible number
  // for a surface nobody is looking at — the failure this header records.
  const isV3 = await evaluate(`typeof window.__v3 === "function" && typeof window.__setDepth === "function"`);
  if (!isV3) throw new Error("the kiosk page does not expose __v3/__setDepth — not a booted V3 wall");

  // Drive to the requested depth and let it settle (cross-fades, scrim).
  await evaluate(`window.__setDepth(${DEPTH_FOR[MODE]}, "live-contrast")`);
  await new Promise((r) => setTimeout(r, 4000));

  const state = await evaluate(
    `JSON.stringify({depth: window.__depth().depth, reason: window.__depth().reason})`
  );
  if (JSON.parse(state).depth !== DEPTH_FOR[MODE]) {
    throw new Error(`asked for depth ${DEPTH_FOR[MODE]} (${MODE}) but the wall reads ${state} — not measuring the wrong state`);
  }

  const items = await evaluate(`(${collect.toString()})()`);
  if (!items.length) throw new Error("no visible text collected");
  // Pin the colour resolution before trusting any ratio: the hour is painted in
  // --ink, the brightest ink on the wall. If it does not resolve bright, every
  // number below is built on a broken resolve (see collect()).
  const hour = items.find((i) => i.selector === "#hour");
  if (hour) {
    const [r, g, b] = hour.color.match(/[\d.]+/g).map(Number);
    if (Math.min(r, g, b) <= 150) throw new Error(`#hour ink resolved to ${hour.color} — colour resolution is broken, not the wall`);
  }

  await evaluate(`(${strip.toString()})()`);
  await new Promise((r) => setTimeout(r, 400));

  const shot = await send("Page.captureScreenshot", { format: "png" });
  const measured = await evaluate(
    `(${measure.toString()})(${JSON.stringify("data:image/png;base64," + shot.data)}, ${JSON.stringify(items)})`
  );

  // Undo the strip so the kiosk is left readable, not blanked.
  await evaluate(`location.reload()`);

  const failures = measured.filter((m) => m.contrast < (m.isLarge ? AA_LARGE : AA_NORMAL));
  const worst = measured.reduce((a, b) => (a.contrast < b.contrast ? a : b));

  console.log(`mode=${MODE} ${state}`);
  console.log(`measured ${measured.length} text nodes over the live photo`);
  console.log(`worst: ${worst.contrast}:1  ${worst.selector} @${Math.round(worst.fontSize)}px over ${worst.worstBg}`);
  for (const f of failures) {
    console.log(
      `FAIL ${f.contrast}:1 (needs ${f.isLarge ? AA_LARGE : AA_NORMAL}) ${f.selector} @${Math.round(f.fontSize)}px\n` +
        `     text ${f.color} a=${f.alpha.toFixed(2)} over ${f.worstBg}\n     "${f.sample}"`
    );
  }
  console.log(failures.length ? `\n${failures.length} BELOW AA` : "\nall clear");
  ws.close();
  process.exit(failures.length ? 1 : 0);
})().catch((e) => {
  console.error("live-contrast failed:", e.message);
  process.exit(2);
});

function collect() {
  /* ⚠ COLOURS ARE RESOLVED BY PAINTING THEM, NEVER BY PARSING THEM — the same
     method as tests/verify/v3-contrast.spec.js COLLECT. V3's palette is OKLCH and
     getComputedStyle().color keeps the colour space, so the regex parse below read
     "oklch(0.93 0.01 85)" as r=0.93 g=0.01 b=85 (near-black). Its first live run on
     V3 (2026-10-03) reported every node at ~1:1, the 168px hour included. Painting
     over black and white and solving gives the renderer's own rgb + alpha. */
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const pctx = probe.getContext("2d", { willReadFrequently: true });
  const paintOver = (css, under) => {
    pctx.fillStyle = under;
    pctx.fillRect(0, 0, 1, 1);
    pctx.fillStyle = css;
    pctx.fillRect(0, 0, 1, 1);
    return pctx.getImageData(0, 0, 1, 1).data;
  };
  const resolve = (css) => {
    const b = paintOver(css, "#000");
    const w = paintOver(css, "#fff");
    if (b[0] + b[1] + b[2] === 0 && w[0] + w[1] + w[2] === 765) return null; // unparsed
    const a = Math.max(0, Math.min(1, 1 - (w[0] - b[0]) / 255));
    if (a < 0.004) return null;
    const [r, g, bl] = [b[0] / a, b[1] / a, b[2] / a].map((c) => Math.min(255, Math.round(c)));
    return `rgba(${r}, ${g}, ${bl}, ${a.toFixed(3)})`;
  };

  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
  for (let el = walk.nextNode(); el; el = walk.nextNode()) {
    if (!Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    // The archive's 400px ghost year is a watermark at 5.5% ink, built never to be
    // read — excluded BY NAME exactly as tests/verify/v3-contrast.spec.js does (not
    // by [aria-hidden], which would also drop the plate line the room does read).
    if (el.classList.contains("archive__year")) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
    if (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    if (!el.offsetParent && cs.position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight) continue;
    let alpha = 1;
    for (let a = el; a && a !== document.documentElement; a = a.parentElement) alpha *= parseFloat(getComputedStyle(a).opacity);
    if (alpha < 0.05) continue;
    const px = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const color = resolve(cs.color);
    if (!color) continue; // the renderer could not paint it — no number beats a wrong one
    out.push({
      selector: el.id ? "#" + el.id : el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).join(".") : ""),
      sample: el.textContent.trim().slice(0, 40),
      color,
      alpha,
      fontSize: px,
      isLarge: px >= 24 || (px >= 18.66 && weight >= 700),
      rect: { x: r.x, y: r.y, w: r.width, h: r.height }
    });
  }
  return out;
}

function strip() {
  const kill = document.createElement("style");
  kill.textContent = "*,*::before,*::after{transition:none !important;animation:none !important;}";
  document.head.appendChild(kill);
  document.querySelectorAll("*").forEach((el) => {
    el.style.setProperty("-webkit-text-fill-color", "transparent", "important");
    el.style.setProperty("color", "transparent", "important");
    el.style.setProperty("text-shadow", "none", "important");
  });
}

async function measure(dataUrl, items) {
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = dataUrl;
  });
  const cv = document.createElement("canvas");
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const scale = img.width / window.innerWidth;
  const srgb = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const lum = (r, g, b) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const parse = (css) => {
    const m = css.match(/[\d.]+/g).map(Number);
    return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
  };
  return items.map((it) => {
    const t = parse(it.color);
    const ta = t.a * it.alpha;
    const x0 = Math.max(0, Math.floor(it.rect.x * scale));
    const y0 = Math.max(0, Math.floor(it.rect.y * scale));
    const x1 = Math.min(cv.width - 1, Math.ceil((it.rect.x + it.rect.w) * scale));
    const y1 = Math.min(cv.height - 1, Math.ceil((it.rect.y + it.rect.h) * scale));
    const sx = Math.max(1, Math.floor((x1 - x0) / 12));
    const sy = Math.max(1, Math.floor((y1 - y0) / 12));
    let worst = Infinity;
    let bg = null;
    for (let y = y0; y <= y1; y += sy) {
      for (let x = x0; x <= x1; x += sx) {
        const d = ctx.getImageData(x, y, 1, 1).data;
        const c = ratio(lum(t.r * ta + d[0] * (1 - ta), t.g * ta + d[1] * (1 - ta), t.b * ta + d[2] * (1 - ta)), lum(d[0], d[1], d[2]));
        if (c < worst) {
          worst = c;
          bg = `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
        }
      }
    }
    return { ...it, contrast: Math.round(worst * 100) / 100, worstBg: bg };
  });
}
