/* Make a page unreachable from the suite's shared voice bus.

   ── ⚠⚠ THIS IS A CROSS-TEST CHANNEL, NOT A FLAG PREFERENCE ──────────────────

   `features.voiceSession` is default-ON, so any page that boots the incumbent
   opens `new EventSource("/api/voice/stream")` (src/js/core/voiceSession.js).
   That stream is fed by `voiceBus`, which is PROCESS-WIDE: one POST to
   /api/voice/transcript (server/routes/voice.js) is fanned out to EVERY
   connected page.

   The suite shares ONE server across workers, and both tests/api.spec.js and
   tests/voice-session.spec.js post transcripts. So a voice spec running in
   another worker reaches into an unrelated page and calls submitTranscripts(),
   which does setMode(MODES.VOICE).

   For anything asserting the attention surface that is fatal. updateAttention()
   (src/js/modules/focusHero.js) takes its non-glance/dwell branch: hideHero(),
   and `items = mode === "dwell" ? sel.stack : []` empties the stack. The hero's
   box goes to 0 AND NEVER COMES BACK — so the failure looks like a slow layout
   and is not one, and no amount of extra polling escapes it.

   ⚠ THE TELL IS `document.body.dataset.presence === "voice"`. When an attention
   spec fails with a zero-height hero, sample presence before believing the page
   was merely slow. The artifact for the original 2026-08-20 failure showed an
   empty <main> with the voice chip lit, which is that state exactly.

   🔑 REPRODUCE IT DETERMINISTICALLY rather than re-running until it flakes:
   drive the scenario, then post a transcript from the test itself —
   `request.post("/api/voice/transcript", { data: { text: "what time is it" } })`.
   Measured on bare-hero's scenario, both arms:

       voice on   → { h: 0,   pres: "voice", items: 0 }   hero AND stack gone
       voice off  → { h: 200, pres: "dwell", items: 2 }   survives

   Flag-off opens NO CONNECTION AT ALL (initTranscriptStream returns before
   constructing the EventSource), so this makes the page unreachable from the bus
   rather than merely ignoring what arrives on it. That is why it is the right
   cut: an "ignore the event" fix would still leave the page subscribed and the
   next handler someone adds exposed again.

   Appended to the same glob-matched `js/config.js` route these specs already use
   to pin their other competing lanes (temporalSpine, memoryEngine, BOM warnings).
─────────────────────────────────────────────────────────────────────────── */

export const PIN_VOICE_OFF = "\nwindow.CONFIG.features.voiceSession = false;";
