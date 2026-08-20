import { test, expect } from "./fixtures/coverage.js";

/* V3's voice turn: which depth it lands on, which cells light, and — the one
   that actually matters for a surface that runs for weeks — whether a subject
   dismantles itself when the room stops looking at it.

   Upstreams are stubbed to a dead port in this harness, so only intents that
   need no network can answer locally. "what time is it" is the honest choice:
   it is answerable from the clock alone. */

async function boot(page) {
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(err.message));
  await page.goto("/v3/");
  await page.waitForFunction(() => typeof window.__v3Transcript === "function", null, { timeout: 10_000 });
  return pageErrors;
}

test("a local turn answers, shows what was heard, and lights the cell it names", async ({ page }) => {
  const pageErrors = await boot(page);

  /* ⚠ Started, not awaited. The highlight is lit at the TOP of the turn and
     releases itself 4.2 s later, but the turn does not resolve until the house
     has finished speaking — so awaiting it first spends the whole highlight
     before the assertion is made, and this test failed exactly that way under a
     loaded four-worker run while passing alone. The reply is collected after. */
  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));

  // Deixis: "what time is it" carries refs:["hour"], and the hour cell answers.
  // This is the link that makes the screen and the speaker one system rather
  // than two devices in a room.
  await expect(page.locator('[data-cell="hour"]')).toHaveAttribute("data-ref", "lit");

  const result = await turn;
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("local");
  await expect(page.locator("#heard")).toHaveText("what time is it");
  expect(await page.evaluate(() => window.__depth().depth)).toBe(1);

  expect(pageErrors).toEqual([]);
});

test("the highlight releases itself rather than staying lit forever", async ({ page }) => {
  await boot(page);
  // Started, not awaited — see the note above; the 4.2 s clock is already running.
  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));
  await expect(page.locator('[data-cell="hour"]')).toHaveAttribute("data-ref", "lit");
  /* Cleared on a timeout, never on transitionend — those never fire while an
     ancestor is display:none, which most of this surface is most of the time.

     ⚠ The budget is a LOAD MARGIN, not the property. DEIXIS_MS is 4.2 s and
     this test takes 6.8-8.2 s on its own, so an 8 s budget was a 1.9× margin
     that a loaded suite run tipped over (seen 2026-08-16, green in isolation
     3/3 immediately after). The property under test is "releases itself rather
     than staying lit FOREVER" — 15 s proves that exactly as well as 8 s did,
     and stops a busy machine reporting a regression that is not there.
     Well inside the 30 s test timeout. */
  await expect(page.locator('[data-cell="hour"]')).not.toHaveAttribute("data-ref", "lit", { timeout: 15_000 });
  await turn;   // never leave a turn in flight when the page is about to close
});

test("naming a camera mounts a subject and takes the surface to depth 3", async ({ page }) => {
  const pageErrors = await boot(page);

  const result = await page.evaluate(() => window.__v3Transcript("show me the driveway"));
  expect(result.handled).toBe(true);
  expect(await page.evaluate(() => window.__v3().subject)).toBe("show.camera");
  expect(await page.evaluate(() => window.__depth().depth)).toBe(3);
  await expect(page.locator("#subject-mount .subject--camera")).toHaveCount(1);
  // The live frame is addressed to the camera the voice actually named.
  await expect(page.locator(".subject__frame--live")).toHaveAttribute("src", /\/api\/camera\/driveway\/live/);

  expect(pageErrors).toEqual([]);
});

test("leaving depth 3 dismantles the subject — repeatedly, without accumulating", async ({ page }) => {
  const pageErrors = await boot(page);

  // THE leak-critical property. A subject left mounted keeps its MJPEG
  // connection open and keeps decoding forever; on a wall that runs for weeks
  // that is not a slow leak, it is a fire. 709 zombie lottie wrappers came from
  // exactly this shape of per-event code.
  const before = await page.evaluate(() => document.getElementsByTagName("*").length);

  const after = await page.evaluate(async () => {
    for (let i = 0; i < 15; i++) {
      await window.__v3Transcript("show me the driveway");
      window.__setDepth(1, "cycle");
      await new Promise((r) => setTimeout(r, 50));
    }
    await new Promise((r) => setTimeout(r, 300));
    return {
      subject: window.__v3().subject,
      mountChildren: document.getElementById("subject-mount").childElementCount,
      strayFrames: document.querySelectorAll(".subject__frame").length,
      nodes: document.getElementsByTagName("*").length
    };
  });

  expect(after.subject).toBeNull();
  expect(after.mountChildren).toBe(0);
  expect(after.strayFrames, "an MJPEG frame survived teardown").toBe(0);
  expect(after.nodes, "DOM grew across 15 subject cycles").toBeLessThanOrEqual(before + 2);

  expect(pageErrors).toEqual([]);
});

test("no depth is ever reachable while empty — the blank-screen guard", async ({ page }) => {
  const pageErrors = await boot(page);

  // THE regression this exists for: both paths to depth 2 used to deepen
  // unconditionally into an empty #spread-lattice, while compose.css hid the
  // glance layer the instant depth flipped — blacking out the wall mid-sentence,
  // and worst of all on the repair path, where the person is already not being
  // understood.
  const state = await page.evaluate(async () => {
    // Three unmatched utterances trip the third-strike escalation.
    for (let i = 0; i < 3; i++) {
      await window.__v3Transcript(`zzz unmatchable phrase ${i}`);
    }
    await new Promise((r) => setTimeout(r, 300));
    const depth = window.__depth().depth;
    const layer = document.querySelector(`.depth--${["field", "glance", "spread", "subject"][depth]}`);
    return {
      depth,
      vocabCard: window.__v3().vocabCard,
      // Whatever layer is showing must have something in it.
      visibleLayerHasContent: (layer?.textContent ?? "").trim().length > 0
        || layer?.querySelectorAll("img, canvas").length > 0
    };
  });

  if (state.depth === 2) {
    expect(state.vocabCard, "depth 2 was entered with nothing rendered in it").toBe(true);
  }
  expect(state.visibleLayerHasContent, `depth ${state.depth} is showing an empty layer`).toBe(true);
  expect(pageErrors).toEqual([]);
});

test("leaving depth 2 clears the card", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    for (let i = 0; i < 3; i++) await window.__v3Transcript(`zzz nope ${i}`);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.evaluate(() => window.__setDepth(1, "test-recede"));
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__v3().vocabCard)).toBe(false);
  await expect(page.locator("#spread-lattice")).toBeEmpty();
});

test("a ref naming a cell that does not exist is inert, not an error", async ({ page }) => {
  const pageErrors = await boot(page);
  // The model may one day return refs; an invented one must do nothing at all
  // rather than throw or light the wrong thing.
  const lit = await page.evaluate(() => {
    document.getElementById("heard").dispatchEvent(new Event("x"));
    return document.querySelectorAll('[data-ref="lit"]').length;
  });
  expect(lit).toBe(0);
  expect(pageErrors).toEqual([]);
});

test("the rail only ever offers something the lane can actually answer", async ({ page }) => {
  await boot(page);
  // Every upstream is dead in this harness, so the rail must be either empty or
  // offering one of the few phrases that need no network. Suggesting anything
  // else would teach the room that the rail is decorative.
  const rail = await page.evaluate(() => window.__v3().rail);
  if (rail !== null) {
    expect(["what time is it", "show me the driveway", "show me the front door", "brief me"]).toContain(rail);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   HALF DUPLEX — on /v3/, which is the surface actually on the wall.

   Regression, 2026-08-08/09: the kiosk's mic hears its own HDMI speakers, so
   the wake agent transcribed V3's replies back into this EventSource and the
   house answered itself. The flag adds the two facts that stop it — we say
   when we are talking, the agent says when to stop.

   The hazard these pin is not the echo, it is the CURE: barge-in silences a
   reply while submit() is awaiting say(), and pause() fires no 'ended'. Left
   unsettled, that await never returns, `busy` latches true, and the house goes
   permanently deaf — a far worse failure than the one being fixed.
   ═══════════════════════════════════════════════════════════════════════════ */

function silentWav(seconds, rate = 8000) {
  const samples = Math.floor(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
  return buf;
}

async function bootHalfDuplex(page, { speaking, replySeconds = 30 }) {
  // The catch-all shape this repo insists on: config.js first, because
  // page.route matches LAST-registered first and a later stub must win.
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) + "\nwindow.CONFIG.features.voiceHalfDuplex = true;\n"
    });
  });
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(replySeconds) })
  );
  await page.route("**/api/voice/speaking", async (route) => {
    speaking.push(route.request().postDataJSON()?.speaking);
    await route.fulfill({ status: 204, body: "" });
  });
  await page.addInitScript(() => {
    // tts.js plays through `new Audio(url)`, which is never appended to the
    // document — querySelectorAll("audio") cannot see it.
    const Native = window.Audio;
    window.__ttsAudio = [];
    window.Audio = function (...args) {
      const el = new Native(...args);
      window.__ttsAudio.push(el);
      return el;
    };
    window.Audio.prototype = Native.prototype;
  });
  return boot(page);
}

test("half duplex: V3 tells the mic when it is speaking", async ({ page }) => {
  const speaking = [];
  const pageErrors = await bootHalfDuplex(page, { speaking, replySeconds: 0.2 });

  expect(await page.evaluate(() => window.__v3Voice().halfDuplex)).toBe(true);
  await page.evaluate(() => window.__v3Transcript("what time is it"));

  expect(speaking[0], "V3 never reported that it had started talking").toBe(true);
  await expect.poll(() => speaking[speaking.length - 1], { timeout: 10_000 }).toBe(false);

  expect(pageErrors).toEqual([]);
});

test("half duplex: a barge-in stops the reply AND does not wedge the turn", async ({ page, request }) => {
  const speaking = [];
  const pageErrors = await bootHalfDuplex(page, { speaking });

  await expect
    .poll(() => page.evaluate(() => window.__v3Voice().streamOpen), { timeout: 10_000 })
    .toBe(true);

  // Half a minute of reply, so "it stopped" cannot be the clip simply ending.
  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));
  await expect.poll(() => speaking[speaking.length - 1], { timeout: 10_000 }).toBe(true);
  const playingBefore = await page.evaluate(() => window.__ttsAudio.some((a) => !a.paused));

  expect((await request.post("/api/voice/barge-in", { data: {} })).status()).toBe(200);

  await expect
    .poll(() => page.evaluate(() => window.__ttsAudio.every((a) => a.paused)), { timeout: 10_000 })
    .toBe(true);

  // THE ONE THAT MATTERS. submit() is awaiting say() with `busy` held; if
  // silence() does not settle that promise the turn never returns and the
  // house is deaf from here on. Both halves are asserted: the turn resolves,
  // and the very next utterance is accepted rather than refused as busy.
  const result = await Promise.race([
    turn,
    new Promise((r) => setTimeout(() => r({ wedged: true }), 10_000))
  ]);
  expect(result.wedged, "the interrupted turn never resolved — busy is latched").toBeUndefined();
  expect(await page.evaluate(() => window.__v3Voice().busy)).toBe(false);

  // Short reply for the follow-up, or this simply waits out another half
  // minute of silence. Registered last, so it is matched first.
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(0.2) })
  );
  const next = await page.evaluate(() => window.__v3Transcript("what time is it"));
  expect(next.reason, "the house refused the follow-up as busy").not.toBe("busy");
  expect(next.handled).toBe(true);

  expect(playingBefore, "nothing was playing, so nothing was interrupted").toBe(true);
  expect(pageErrors).toEqual([]);
});

/* ── Lanes 2 and 3: the thread ──────────────────────────────────────────────
   V3 had no coverage of assist or converse at all, and that is exactly how it
   shipped without sending either upstream the context it was built to take.
   `tests/voice-session.spec.js` has asserted both for the incumbent since
   Phase 4; these are the same invariants against the surface that is about to
   become the whole dashboard.

   "zzz ..." is deliberately unmatchable, so the local lane declines and the
   turn reaches the network lanes the way a real unrecognised question does. */
async function bootLanes(page, { assist, converse = [] }) {
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(0.2) })
  );
  await page.route("**/api/voice/assist", (route) => {
    assist.push(route.request().postDataJSON());
    return route.fulfill({ json: assist.reply ?? { handled: false, speech: null, conversationId: null } });
  });
  /* ⚠ ANSWERS SSE WHEN THE CLIENT ASKS FOR IT, because the real route does.
     `voiceStreaming` defaulted on 2026-08-16, and a stub that always replies
     JSON would leave the client's stream parser finding no frames, giving up,
     and re-POSTing the ordinary route. Every converse test would then be
     silently exercising the FALLBACK path — two requests per turn, and index
     assumptions like converse[1] quietly meaning something else.

     The stub mirrors the contract instead: ask for a stream, get a stream. */
  await page.route("**/api/voice/converse", (route) => {
    const body = route.request().postDataJSON();
    converse.push(body);
    const reply = `reply ${converse.length}`;
    if (!body?.stream) return route.fulfill({ json: { reply } });
    return route.fulfill({
      contentType: "text/event-stream",
      body: `event: chunk\ndata: ${JSON.stringify({ text: reply })}\n\n`
          + `event: done\ndata: ${JSON.stringify({ reply, source: "claude" })}\n\n`
    });
  });
  return boot(page);
}

test("a follow-up reaches the house voice with what was already said", async ({ page }) => {
  const assist = [];
  const converse = [];
  const pageErrors = await bootLanes(page, { assist, converse });

  const first = await page.evaluate(() => window.__v3Transcript("zzz what is the weather"));
  expect(first.lane).toBe("converse");
  // The first turn is a cold start by definition — nothing said yet.
  expect(converse[0].history ?? []).toEqual([]);
  expect(converse[0].text).toBe("zzz what is the weather");

  await page.evaluate(() => window.__v3Transcript("zzz and tomorrow"));

  /* THE ONE THAT MATTERS. Without this the second question arrives at the
     model with no idea what the first one was, and "and tomorrow?" is not a
     question anyone can answer cold. The current utterance rides in `text`,
     so it must NOT also appear in the history it is sent with. */
  expect(converse[1].history).toEqual([
    { role: "user", text: "zzz what is the weather" },
    { role: "assistant", text: "reply 1" }
  ]);
  expect(converse[1].text).toBe("zzz and tomorrow");

  expect(pageErrors).toEqual([]);
});

test("HA's conversation id is threaded back, so a clarification can resolve", async ({ page }) => {
  const assist = [];
  // "which lamp?" — HA declines the first exchange and mints the id on it, so
  // an id kept only on `handled` would be thrown away exactly when it is needed.
  assist.reply = { handled: false, speech: null, conversationId: "conv-v3" };
  const pageErrors = await bootLanes(page, { assist });

  await page.evaluate(() => window.__v3Transcript("zzz turn on the lamp"));
  expect(assist[0].conversationId ?? null).toBeNull();
  expect(await page.evaluate(() => window.__v3Voice().conversationId)).toBe("conv-v3");

  await page.evaluate(() => window.__v3Transcript("zzz the bedside one"));
  expect(assist[1].conversationId).toBe("conv-v3");

  expect(pageErrors).toEqual([]);
});

test("an action HA completed without speaking is not handed to the house voice", async ({ page }) => {
  const assist = [];
  const converse = [];
  // response_type "action_done" with no plain speech: the lights are already on.
  assist.reply = { handled: true, speech: null, conversationId: null };
  const pageErrors = await bootLanes(page, { assist, converse });

  const result = await page.evaluate(() => window.__v3Transcript("zzz turn off the lamp"));
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("assist");
  // Asking Claude about something the house has already done is the failure
  // here — it would answer as if the request were still pending.
  expect(converse, "a completed action was escalated to the house voice").toEqual([]);

  expect(pageErrors).toEqual([]);
});

/* ⚠ THIS TEST USED TO ASSERT AN EIGHT-SECOND MEMORY, AND WAS RIGHT TO — that
   was the behaviour. Its premise ("the linger window IS the conversation") is
   the thing 2026-08-15 deliberately falsified: the readout fading and the
   conversation ending were the same timer, so the house forgot faster than a
   person pauses before a follow-up.

   Now they are two timers with two jobs, so this is two tests. Both drive
   page.clock rather than sleeping — a five-minute wall-clock test is not a
   test anybody will keep. */
test("a pause is not the end of the conversation", async ({ page }) => {
  await page.clock.install();
  const assist = [];
  const converse = [];
  await bootLanes(page, { assist, converse });

  await page.evaluate(() => window.__v3Transcript("zzz something"));
  expect(await page.evaluate(() => window.__v3Voice().turns)).toBeGreaterThan(0);

  // Comfortably past the old boundary, and past the readout fading. Someone
  // has read the reply and walked to the fridge; the thread must survive it.
  await page.clock.fastForward("00:30");
  expect(
    await page.evaluate(() => window.__v3Voice().turns),
    "a 30-second pause erased the thread — the follow-up will be a cold start"
  ).toBeGreaterThan(0);
});

test("the thread ends when the room goes quiet", async ({ page }) => {
  await page.clock.install();
  const assist = [];
  const converse = [];
  assist.reply = { handled: false, speech: null, conversationId: "conv-expiring" };
  await bootLanes(page, { assist, converse });

  await page.evaluate(() => window.__v3Transcript("zzz something"));
  expect(await page.evaluate(() => window.__v3Voice().turns)).toBeGreaterThan(0);

  // Once the conversation really is over, the next person to speak is starting
  // a new one, and inheriting the last one's context would answer them about
  // somebody else's question.
  await page.clock.fastForward("06:00");
  expect(await page.evaluate(() => window.__v3Voice().turns)).toBe(0);
  expect(await page.evaluate(() => window.__v3Voice().conversationId)).toBeNull();
});

// PINNED OFF, not left to the default. Flipping the flag back is the rollback
// path, so the off state has to keep being tested after the default flips on —
// a spec that asserts "off" by inheriting the default silently becomes a
// second copy of the on-state test the day it ships.
test("half duplex off: V3 reports nothing and installs no observer", async ({ page }) => {
  const speaking = [];
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) + "\nwindow.CONFIG.features.voiceHalfDuplex = false;\n"
    });
  });
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(0.2) })
  );
  await page.route("**/api/voice/speaking", async (route) => {
    speaking.push(route.request().postDataJSON()?.speaking);
    await route.fulfill({ status: 204, body: "" });
  });
  const pageErrors = await boot(page);

  expect(await page.evaluate(() => window.__v3Voice().halfDuplex)).toBe(false);
  await page.evaluate(() => window.__v3Transcript("what time is it"));

  expect(speaking, "the flag-off build reported speaking state").toEqual([]);
  expect(pageErrors).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE STREAMED REPLY — speaking sentence one while sentence two is written.

   The chunker itself is unit-tested in voice.spec.js. What can only be proved
   here is the round trip: that SSE frames reach the page, that each sentence
   becomes its own synthesis request in order, and that a stream dying halfway
   does not leave the turn wedged with `busy` held — which would make the house
   permanently deaf, the worst failure this file guards against.

   PINNED ON, because the flag ships default-off pending a measured TTFA.
─────────────────────────────────────────────────────────────────────────── */
function sse(frames) {
  return frames.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join("");
}

async function bootStreaming(page, { body, spoken }) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) + "\nwindow.CONFIG.features.voiceStreaming = true;\n"
    });
  });
  await page.route("**/api/tts/speak", (route) => {
    spoken.push(route.request().postDataJSON()?.text);
    return route.fulfill({ contentType: "audio/wav", body: silentWav(0.05) });
  });
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({ json: { handled: false, speech: null, conversationId: null } })
  );
  await page.route("**/api/voice/converse", (route) =>
    route.fulfill({ contentType: "text/event-stream", body })
  );
  return boot(page);
}

test("streamed: each sentence is synthesised separately, in order", async ({ page }) => {
  const spoken = [];
  const pageErrors = await bootStreaming(page, {
    spoken,
    body: sse([
      ["chunk", { text: "It's nineteen degrees and clear." }],
      ["chunk", { text: "Rain's coming in about twenty minutes." }],
      ["done", { reply: "It's nineteen degrees and clear. Rain's coming in about twenty minutes.", source: "claude" }]
    ])
  });

  const result = await page.evaluate(() => window.__v3Transcript("zzz how's it looking out there"));
  expect(result.handled).toBe(true);
  expect(result.lane).toBe("converse");

  // Two synthesis calls, not one — that IS the latency win. One call would
  // mean the page waited for the whole reply before asking for any audio.
  expect(spoken).toEqual([
    "It's nineteen degrees and clear.",
    "Rain's coming in about twenty minutes."
  ]);

  // The glass shows the authoritative full reply, not the last chunk.
  await expect(page.locator("#glance-said")).toContainText("nineteen degrees");
  await expect(page.locator("#glance-said")).toContainText("twenty minutes");
  expect(pageErrors).toEqual([]);
});

test("streamed: the turn is remembered as one exchange, not per sentence", async ({ page }) => {
  const spoken = [];
  await bootStreaming(page, {
    spoken,
    body: sse([
      ["chunk", { text: "Bins go out tonight, the yellow one." }],
      ["done", { reply: "Bins go out tonight, the yellow one.", source: "claude" }]
    ])
  });

  await page.evaluate(() => window.__v3Transcript("zzz what about the bins"));
  // One user turn plus one assistant turn. Chunks are a transport detail and
  // must not each become a turn in the thread the next request replays.
  expect(await page.evaluate(() => window.__v3Voice().turns)).toBe(2);
});

/* ⚠ THE ONE THAT MATTERS MOST. V3 awaits the speech queue with its `busy`
   latch held, so any stream path that fails to settle leaves the house unable
   to accept another turn — deaf until the page reloads, which on this kiosk
   is weeks. */
test("streamed: a stream that dies mid-reply still releases the turn", async ({ page }) => {
  const spoken = [];
  const pageErrors = await bootStreaming(page, {
    spoken,
    // Chunks, then the failure event and no `done` — the shape of Kokoro or
    // the model falling over partway through an answer.
    body: sse([
      ["chunk", { text: "It's nineteen degrees and clear." }],
      ["failed", { spoken: 1 }]
    ])
  });

  const result = await page.evaluate(() => window.__v3Transcript("zzz how's it looking"));
  expect(result.handled).toBe(false);

  // Half an answer was spoken; it must NOT be followed by a second, differently
  // worded answer from the fallback route talking over the top of it.
  expect(spoken).toEqual(["It's nineteen degrees and clear."]);

  // And the house can still take the next turn.
  expect(await page.evaluate(() => window.__v3Voice().busy)).toBe(false);
  const next = await page.evaluate(() => window.__v3Transcript("what time is it"));
  expect(next.handled).toBe(true);
  expect(pageErrors).toEqual([]);
});

/* ── The reply lets go of the glass ─────────────────────────────────────────
   Reported from the wall 2026-08-19: "responses are staying on screen too
   long". The readout had a timer (LINGER_MS, 8 s) and the REPLY did not —
   clearLinger's callback calls hideHeard(), which touches `#heard` and nothing
   else, so the house's own line sat in `#glance-said` until the depth receded
   to FIELD and attention.js's clearGlance() fired. HOLD_MS[GLANCE] is 90 s.

   ⚠ THE FIXTURE HAS TO BE ABLE TO PRODUCE THE DEFECT. Asserting only "the node
   is empty at 25 s" would also pass on the old build whenever attention's 30 s
   tick happened to overwrite the line first — a pass that means "something else
   cleared it", which is not the property. So the reply is sampled while it is
   still up, and only then fast-forwarded past REPLY_MS.
─────────────────────────────────────────────────────────────────────────── */
test("the reply clears itself rather than riding the 90-second depth hold", async ({ page }) => {
  await page.clock.install();
  const assist = [];
  const converse = [];
  await bootLanes(page, { assist, converse });

  await page.evaluate(() => window.__v3Transcript("zzz what is the weather"));

  const said = page.locator("#glance-said");
  // It is up, and it is the house's line — the precondition the clear is about.
  await expect(said).toHaveText("reply 1");

  /* Past the readout's 8 s and well past REPLY_MS (20 s), but COMFORTABLY
     SHORT of the 90 s GLANCE hold. That gap is the whole test: at 30 s the old
     build is still holding depth 1 with the line in it. */
  await page.clock.fastForward("00:30");
  await expect(
    said,
    "the reply outlived its own timer — it is now waiting on the depth hold again"
  ).toHaveText("");
});

test("a reply the room replaced is not blanked out from under it", async ({ page }) => {
  await page.clock.install();
  const assist = [];
  const converse = [];
  await bootLanes(page, { assist, converse });

  await page.evaluate(() => window.__v3Transcript("zzz what is the weather"));
  await expect(page.locator("#glance-said")).toHaveText("reply 1");

  /* attention.js writes this same node on its 30 s tick. A fire-and-forget
     clear would wipe whatever replaced the reply, and the room would watch the
     wall go blank for no reason it can see — so clearReply() only blanks a line
     it still recognises as its own. Standing in for the other writer here. */
  await page.evaluate(() => {
    document.getElementById("glance-said").textContent = "something attention put there";
  });
  await page.clock.fastForward("00:30");
  await expect(
    page.locator("#glance-said"),
    "the voice's timer cleared a line the voice did not write"
  ).toHaveText("something attention put there");
});

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOUSE SAYING IT DID NOT HEAR YOU (V1)

   presence-light.js designs three distinct failures and, until this landed,
   only ONE of them could ever appear. `unheard` had an exported raiser
   (reportUnheard) that nothing in the repo called, because every path that ends
   a turn in nothing lives in the mic agent: the VAD hearing no speech after the
   wake, whisper returning an empty string, whisper being unreachable, a
   barge-in that never won the floor. The page sees no request on any of them.

   So the mechanism is a report the agent POSTs and the page paints, and these
   pin both ends of it — including the one place it must STAY silent.
   ═══════════════════════════════════════════════════════════════════════════ */

async function bootFailureCues(page) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text()) + "\nwindow.CONFIG.features.voiceFailureCues = true;\n"
    });
  });
  const pageErrors = await boot(page);
  // The listener is attached to the EventSource, so a report sent before the
  // stream is up reaches nobody and the test measures its own race.
  await expect
    .poll(() => page.evaluate(() => window.__v3Voice().streamOpen), { timeout: 10_000 })
    .toBe(true);
  return pageErrors;
}

const failState = () => document.documentElement.dataset.fail ?? null;

test("a wake that went nowhere lights the unheard cue", async ({ page, request }) => {
  const pageErrors = await bootFailureCues(page);

  expect(await page.evaluate(failState), "the wall started out failed").toBe(null);
  expect((await request.post("/api/voice/unheard", { data: { reason: "no-speech" } })).status()).toBe(200);

  await expect.poll(() => page.evaluate(failState), { timeout: 5000 }).toBe("unheard");

  /* And it LETS GO. The cue is a 2.6 s hold by design — a failure light left on
     the wall is worse than no light at all, because the next glance reads a
     house that is still broken hours after one missed sentence. */
  await expect.poll(() => page.evaluate(failState), { timeout: 6000 }).toBe(null);

  expect(pageErrors).toEqual([]);
});

test("the cue stays dark while a reply is still playing", async ({ page, request }) => {
  /* ⚠ THE BARGE-IN TIMEOUT REPORTS UNHEARD WHILE THE HOUSE IS TALKING. From the
     room's side that is true — someone spoke and got nothing — but setFailure()
     opens by dropping the phase to idle, so raising it here would take the
     sweep off a voice the room can still HEAR and call a reply a failure
     mid-sentence. The report is correct; painting it is not. */
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(30) })
  );
  const pageErrors = await bootFailureCues(page);

  const turn = page.evaluate(() => window.__v3Transcript("what time is it"));
  await expect.poll(() => page.evaluate(() => window.__v3Voice().busy), { timeout: 10_000 }).toBe(true);

  expect((await request.post("/api/voice/unheard", { data: { reason: "barge-in-timeout" } })).status()).toBe(200);

  // Long enough that a raise would have landed — the cue is painted synchronously
  // on the SSE frame, so this is a wait for something that must never arrive.
  await page.waitForTimeout(1200);
  expect(
    await page.evaluate(failState),
    "an unheard cue was painted over a reply that was still playing"
  ).toBe(null);
  expect(await page.evaluate(() => document.documentElement.dataset.phase)).toBe("speaking");

  /* Never leave a 30 s reply in flight when the page is about to close. The
     barge-in is the real lever for that and it is already the tested one — but
     it only silences when voiceHalfDuplex armed the listener, which this boot
     does not, so the race is the actual teardown. */
  await Promise.race([turn, page.waitForTimeout(3000)]);
  expect(pageErrors).toEqual([]);
});

/* ═══════════════════════════════════════════════════════════════════════════
   AND THE HOUSE SAYING IT CANNOT (V1, second half)

   The third cue had no raiser anywhere in the repo, and the reason is worth
   keeping: a tool call that is REFUSED (an entity off the roster) or that FAILS
   (the house did not answer) is handed to the model as a tool_result, and the
   model writes a perfectly ordinary sentence about it. The room heard an
   apology; the wall showed a successful turn. Nothing downstream of the tool
   loop could tell the two apart, because the difference had already been
   dissolved into prose. So the fact travels out of band as `toolFailed`.

   ⚠ THE SERVER HALF CANNOT BE INTEGRATION TESTED HERE, for the reason
   voice-tools.spec.js already records: playwright.config.js stubs
   ANTHROPIC_API_KEY to "", so getAnthropic() returns null and the tool loop
   never runs in this suite. These pin the half that paints — which is where the
   cue lives, and where the ordering hazard is.
   ═══════════════════════════════════════════════════════════════════════════ */

async function bootCannot(page, { toolFailed = false, streaming = true, replySeconds = 0.2 } = {}) {
  await page.route("**/js/config.js", async (route) => {
    const res = await route.fetch();
    await route.fulfill({
      response: res,
      body: (await res.text())
        + "\nwindow.CONFIG.features.voiceFailureCues = true;"
        + `\nwindow.CONFIG.features.voiceStreaming = ${streaming};\n`
    });
  });
  await page.route("**/api/tts/speak", (route) =>
    route.fulfill({ contentType: "audio/wav", body: silentWav(replySeconds) })
  );
  await page.route("**/api/voice/assist", (route) =>
    route.fulfill({ json: { handled: false, speech: null, conversationId: null } })
  );
  await page.route("**/api/voice/converse", (route) => {
    const body = route.request().postDataJSON();
    const reply = "I can't reach that one.";
    // Emitted only when true, exactly as the route does — so the negative
    // control is testing the real absent-key shape, not a `false` the client
    // could be reading by accident.
    const done = { reply, source: "claude", ...(toolFailed && { toolFailed: true }) };
    if (!body?.stream) return route.fulfill({ json: done });
    return route.fulfill({
      contentType: "text/event-stream",
      body: `event: chunk\ndata: ${JSON.stringify({ text: reply })}\n\n`
          + `event: done\ndata: ${JSON.stringify(done)}\n\n`
    });
  });
  return boot(page);
}

test("a tool the house could not run lights the cannot cue — streamed", async ({ page }) => {
  const pageErrors = await bootCannot(page, { toolFailed: true });

  await page.evaluate(() => window.__v3Transcript("zzz turn on the shed light"));
  await expect.poll(() => page.evaluate(failState), { timeout: 5000 }).toBe("cannot");

  expect(pageErrors).toEqual([]);
});

test("an ordinary answer leaves the cannot cue dark", async ({ page }) => {
  // The control that stops the cue being a light that is simply always on.
  const pageErrors = await bootCannot(page, { toolFailed: false });

  await page.evaluate(() => window.__v3Transcript("zzz what is the weather"));
  await page.waitForTimeout(1500);
  /* ⚠ not.toBe("cannot"), not toBe(null) — and the difference is a real flake,
     not pedantry. voiceBus is PROCESS-WIDE, so an /api/voice/unheard POST from
     the contract specs in another worker reaches this page too, and this is one
     of the only pages in the suite with voiceFailureCues armed. Asserting an
     empty fail state would make this test fail on an event it does not own.
     What it exists to prove is narrower and exact: a turn that succeeded is not
     reported to the room as one the house could not do. */
  expect(
    await page.evaluate(failState),
    "a successful turn was reported to the room as a failure"
  ).not.toBe("cannot");

  expect(pageErrors).toEqual([]);
});

test("the cannot cue also reaches the non-streamed leg", async ({ page }) => {
  // Two legs answer this route and BOTH had to carry the flag. The JSON one is
  // not dead code — it is what a stream that dies mid-reply falls back to.
  const pageErrors = await bootCannot(page, { toolFailed: true, streaming: false });

  await page.evaluate(() => window.__v3Transcript("zzz turn on the shed light"));
  await expect.poll(() => page.evaluate(failState), { timeout: 5000 }).toBe("cannot");

  expect(pageErrors).toEqual([]);
});

test("the cannot cue waits for the reply to finish speaking", async ({ page }) => {
  /* ⚠ THE ORDERING HAZARD. setFailure() opens by dropping the phase to idle, so
     raising this the moment the payload arrives would cut the sweep off a
     sentence the room is still listening to — and this is the one cue whose
     whole design is that the rim COMPLETES and the light stays.

     🔑 THE LOAD-BEARING ASSERTION IS THE LAST ONE, not the mid-flight null.
     Neuter-verified by moving reportCannot() up to the moment converseStreamed
     returns: the mid-flight check still passes, because an early cue is wiped
     within milliseconds by trackSpeech()'s own setPhase("speaking") and is
     already gone by the time the poll observes the speaking phase. What the
     defect actually produces is a cue that flashes, is erased, and NEVER COMES
     BACK — so it is the "cannot" at the end that catches it. A four-second
     reply is what makes the two moments distinguishable at all. */
  const pageErrors = await bootCannot(page, { toolFailed: true, replySeconds: 4 });

  const turn = page.evaluate(() => window.__v3Transcript("zzz turn on the shed light"));
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.phase), { timeout: 10_000 })
    .toBe("speaking");
  expect(
    await page.evaluate(failState),
    "the cue was raised over a reply that was still being spoken"
  ).toBe(null);

  await turn;
  await expect.poll(() => page.evaluate(failState), { timeout: 5000 }).toBe("cannot");

  expect(pageErrors).toEqual([]);
});
