/* ═══════════════════════════════════════════════════════════════════════════
   V3 VOICE — the turn, and the two-way link between what is said and what is
   shown.

   The lanes themselves are not re-implemented here. Matching, answering and
   the snapshot are pure shared modules (services/localIntents, localAnswers,
   voiceSnapshot) already carrying the live surface. This file is only the V3
   half: which depth a turn lands on, which cells light, and what the light
   does while the house listens, thinks and speaks.

   ORDER OF LANES, and why the first one matters most:
     1. local  — pure, in-memory, ~0.015ms. No network.
     2. assist — HA's conversation agent, for anything that changes the house.
     3. converse — the Claude house-voice, for everything else.

   Lane 1 exists because the cascaded pipeline costs 2-4s and natural turn
   taking sits at 200-500ms. Every utterance answered locally is the difference
   between a house that answers and a device you wait on.
   ═══════════════════════════════════════════════════════════════════════════ */

import { matchIntent } from "../../js/services/localIntents.js";
import { answer } from "../../js/services/localAnswers.js";
import { prepareGoodnight } from "../../js/services/goodnight.js";
import { voiceSnapshot, houseDigest, couldBeAssist, rememberReply } from "../../js/services/voiceSnapshot.js";
import { learnedTimes } from "../../js/core/routineRuntime.js";
import { speak, silence, createSpeech, setSpeakingObserver } from "../../js/core/tts.js";
import { setPhase, setFailure, trackSpeech } from "./presence-light.js";
import { deepen, sustain, setDepth, getDepth, DEPTH } from "./depth.js";
import { showSubject } from "../subjects/index.js";
import { renderVocabularyCard } from "./vocabulary-card.js";
import { setSaidText } from "./spread.js";
import { vetoCurrent, restoreLastVeto } from "./ground.js";

const LINGER_MS = 8_000;
const DEIXIS_MS = 4_200;
/* ⚠ THE READOUT AND THE REPLY ARE TWO DIFFERENT LIFETIMES, and until now only
   the first of them had a timer. clearLinger's callback calls hideHeard(),
   which hides `el.heard` — the recogniser's readout — and nothing else. The
   house's own answer goes into `el.glanceSaid` through setSaidText(), which
   nothing here ever cleared, so the reply survived until the DEPTH receded to
   FIELD and attention.js's clearGlance() fired: HOLD_MS[GLANCE], 90 seconds,
   for a sentence that took four to say.

   That also fed back into recession. depthInhabited(GLANCE) in v3/main.js is
   literally "does #glance-said have text in it", so a stale reply kept depth 1
   looking occupied and stopped SPREAD and SUBJECT receding past it to the
   field.

   Twenty seconds is the owner's call and roughly a re-read: long enough to
   look up from the bench and take the sentence in a second time, short enough
   that the wall is a photograph again before you have wondered why it isn't. */
const REPLY_MS = 20_000;
/* ⚠ THE THREAD IS NOT THE READOUT, AND CONFLATING THEM COST THE HOUSE ITS
   MEMORY. LINGER_MS is a decision about the GLASS — how long "what I heard"
   stays legible after a reply, which is a couple of breaths. It was also, until
   now, the lifetime of the conversation itself: at eight seconds `history` was
   set to [] and the Assist conversation id dropped.

   Eight seconds of quiet is a pause, not the end of a conversation. Walking to
   the fridge, reading the reply, or thinking before the follow-up all erased
   the thread, so "and what about tomorrow?" arrived as a cold start against a
   server built to receive context.

   Five minutes is the boundary a person would recognise as the conversation
   being over. The wire is bounded independently by MAX_TURNS and again by the
   server's buildConverseMessages(), so a longer window costs no more tokens
   per turn — only the chance that the next thing said still belongs to the
   last thing said. */
const THREAD_MS = 5 * 60_000;
/* Matches voiceSession.js — 3 exchanges. The server bounds it again in
   buildConverseMessages(), so this is a courtesy to the wire, not the guard. */
const MAX_TURNS = 6;

let enabled = false;
let busy = false;
let stream = null;
let lingerTimer = null;
let replyTimer = null;
let threadTimer = null;
let deixisTimer = null;
let consecutiveFailures = 0;
let coords = { lat: null, lon: null };
/* ── What was already said ──────────────────────────────────────────────────
   A turn is not the unit of conversation; the linger window is. "What's the
   weather" → "and tomorrow?" only works if the second utterance arrives with
   the first still attached, and BOTH upstreams take context — the converse
   lane as a rolling transcript, HA Assist as a conversation id it minted.
   V3 sent neither until now, so every follow-up was a cold start against a
   server that was already built to receive one.

   Both are cleared when the THREAD expires (THREAD_MS), not when the readout
   fades. Those were the same eight-second timer until 2026-08-15, which made
   the house's whole memory shorter than the pause before a follow-up.
─────────────────────────────────────────────────────────────────────────── */
let history = [];
let assistConversationId = null;

const el = {
  heard: null,
  glanceSaid: null,
  glanceMeasured: null
};

/* ── Deixis ─────────────────────────────────────────────────────────────────
   When the voice names something on screen, that thing answers. This is the
   cheapest idea in V3 and the one that most changes how it feels: it is the
   difference between a screen and a speaker in the same room, and one system.

   refs arrive from the answerers (or, later, from the model constrained to a
   closed vocabulary) and are matched against cells actually present. Unknown
   refs are dropped silently — a wrong highlight is worse than none.
─────────────────────────────────────────────────────────────────────────── */
function clearDeixis() {
  if (deixisTimer) {
    clearTimeout(deixisTimer);
    deixisTimer = null;
  }
  for (const cell of document.querySelectorAll('[data-ref="lit"]')) {
    delete cell.dataset.ref;
  }
}

function lightRefs(refs) {
  clearDeixis();
  if (!Array.isArray(refs) || refs.length === 0) return;
  let lit = 0;
  for (const ref of refs) {
    for (const cell of document.querySelectorAll(`[data-cell="${CSS.escape(String(ref))}"]`)) {
      cell.dataset.ref = "lit";
      lit++;
    }
  }
  if (lit === 0) return;
  // Always a timeout, never transitionend — those never fire while an ancestor
  // is display:none, which most of this surface is most of the time.
  deixisTimer = setTimeout(clearDeixis, DEIXIS_MS);
}

/* ── What the house heard ───────────────────────────────────────────────────
   Shown as MEASURED, not said: it is a readout of the recogniser, and
   attributing it to the house's own voice would misrepresent who is speaking.
─────────────────────────────────────────────────────────────────────────── */
function showHeard(text, failed = null) {
  if (!el.heard) return;
  el.heard.textContent = text;
  el.heard.hidden = false;
  if (failed) el.heard.dataset.failed = failed;
  else delete el.heard.dataset.failed;
}

function hideHeard() {
  if (!el.heard) return;
  el.heard.hidden = true;
  delete el.heard.dataset.failed;
}

/* ⚠ THIS WROTE `textContent` DIRECTLY UNTIL 2026-08-10, which meant the one
   line on the wall that matters most — what the house just SAID to someone
   standing in front of it — was the only said line in V3 exempt from the said
   rules. No `data-len`, so a 60-character answer tried to hold 132px; and no
   `data-wrapped`, so the veil that the wrapped-line contrast finding was fixed
   with did not come up under it. The contrast sweep caught the second half:
   after the veil landed, the glance measured 13.59:1 and the voice's own line
   on the very next surface still measured 1.97:1.

   🔑 A rule enforced by a helper is only enforced on the callers that use it.
   `renderGlance()` in attention.js is the other writer of this node and it goes
   through setSaidText; these two must not disagree about the same element. */
function say(text, refs, opts = {}) {
  setSaidText(el.glanceSaid, text);
  lightRefs(refs);
  // The sweep is driven by real playback position, so it arrives at the last
  // word rather than at a guess about it.
  return speak(text, { ...opts, onAudio: (audio) => trackSpeech(audio) })
    .then(() => setPhase("idle"), () => setPhase("idle"));
}

function clearLinger() {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
}

function clearReplyTimer() {
  if (replyTimer) {
    clearTimeout(replyTimer);
    replyTimer = null;
  }
}

/* Blank the house's own line, but ONLY if it is still the one we wrote.
   attention.js's renderGlance() writes this same node on its 30s tick, so a
   fire-and-forget clear would wipe an attention line that had already replaced
   the reply — the wall going blank for no reason the room can see. Comparing
   the text is what keeps the two writers of #glance-said from disagreeing. */
function clearReply(expected) {
  clearReplyTimer();
  if (!el.glanceSaid) return;
  if (typeof expected === "string" && el.glanceSaid.textContent !== expected) return;
  setSaidText(el.glanceSaid, "");
}

function clearThread() {
  if (threadTimer) {
    clearTimeout(threadTimer);
    threadTimer = null;
  }
}

function pushTurn(role, text) {
  if (typeof text !== "string" || !text.trim()) return;
  history.push({ role, text: text.trim() });
  if (history.length > MAX_TURNS) history = history.slice(-MAX_TURNS);
}

/* Called at EVERY exit from submit(), including the ones that answered
   nothing — an utterance the house could not act on is still something the
   person said, and dropping it makes the repair turn read as the first.

   The turns are recorded HERE rather than at the top of submit() for one
   load-bearing reason: the converse lane passes the current utterance as
   `text` alongside `history`, so pushing it early would send it twice. */
function endTurn(said, replied) {
  pushTurn("user", said);
  pushTurn("assistant", replied);

  // The glass settles on its own short timer: the readout and the highlight
  // are finished with once they have been read.
  clearLinger();
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    hideHeard();
    clearDeixis();
  }, LINGER_MS);

  /* The reply outlives the readout — you stop needing to see what you SAID
     well before you stop needing what you were TOLD — so it gets its own,
     longer timer rather than riding on the one above. Armed only when there
     was actually a reply: a turn that answered nothing left no line to clear,
     and blanking the node would take away whatever attention.js had put there.

     `replied` is captured so the clear can confirm the line is still ours. */
  clearReplyTimer();
  if (typeof replied === "string" && replied.trim()) {
    replyTimer = setTimeout(() => clearReply(replied), REPLY_MS);
  }

  // The conversation ends on its own, much later. Separate timer, separate
  // question — see THREAD_MS.
  clearThread();
  threadTimer = setTimeout(() => {
    threadTimer = null;
    history = [];
    assistConversationId = null;
  }, THREAD_MS);
}

/* ── The streamed reply ─────────────────────────────────────────────────────
   POSTs the turn and reads back sentences as the model writes them, handing
   each to the speech queue so the first is synthesised while the rest is
   still being generated.

   Not EventSource: that is GET-only and this turn carries a body. A POST plus
   a manual SSE parse is the whole difference.

   Returns the full reply, or null — and null means "fall back to the ordinary
   JSON route", which still has the Ollama leg behind it. A stream that dies
   halfway has already spoken part of an answer, so the caller must not simply
   retry it; see the guard at the call site.
─────────────────────────────────────────────────────────────────────────── */
async function converseStreamed(body, speech) {
  let res;
  try {
    res = await fetch("/api/voice/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, stream: true })
    });
  } catch {
    return { reply: null, spoke: false };
  }
  if (!res.ok || !res.body) return { reply: null, spoke: false };

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = null;
  let spoke = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. A partial frame stays in the
      // buffer until the rest of it arrives.
      let split;
      while ((split = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, split);
        buffer = buffer.slice(split + 2);

        const event = frame.match(/^event: (.+)$/m)?.[1];
        const data = frame.match(/^data: (.+)$/m)?.[1];
        if (!event || !data) continue;              // a heartbeat comment

        let payload;
        try { payload = JSON.parse(data); } catch { continue; }

        if (event === "chunk" && payload.text) {
          speech.push(payload.text);
          spoke = true;
        } else if (event === "done") {
          reply = payload.reply ?? null;
        } else if (event === "failed") {
          return { reply: null, spoke };
        }
      }
    }
  } catch {
    // The socket died mid-reply. Whatever was already spoken has been spoken.
    return { reply: null, spoke };
  }

  return { reply, spoke };
}

async function postJson(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return await res.json();      // 502 bodies carry the same shape
  } catch {
    return null;
  }
}

const vetoEnabled = () => Boolean(globalThis.window?.CONFIG?.features?.photoVeto);

/**
 * The one local intent that changes something, and the copy that reports it.
 *
 * Returns the line to speak, or null to fall through to the next lane — which
 * is the honest answer when the flag is off, when no photograph is on the
 * ground, or when there is nothing left to undo. A veto that hid nothing must
 * never SOUND like it hid something.
 *
 * ⚠ Register: this is memory-adjacent, so it keeps one light beat and no more.
 * The room is throwing away a photograph of its own life; a joke about it would
 * be the house being pleased with itself at the wrong moment (VOICE.md §8).
 *
 * @param {"photo.veto"|"photo.restore"} id
 * @returns {Promise<string|null>}
 */
async function handlePhotoVeto(id) {
  if (!vetoEnabled()) return null;

  if (id === "photo.restore") {
    const { restored } = await restoreLastVeto();
    if (!restored.length) return null;
    return restored.length > 1
      ? "Both of those are back — you'll see them again."
      : "Back it comes.";
  }

  const { hidden, pair } = await vetoCurrent();
  if (!hidden.length) return null;
  return pair
    ? "Righto — both of those, gone for good."
    : "Righto — you won't see that one again.";
}

/* ── Goodnight ──────────────────────────────────────────────────────────────
   The second `action.*` the house can be told to DO, and the one the cutover
   dropped. `localIntents.js` has matched "goodnight" since long before V3, and
   services/vocabulary.js lists it in ALWAYS_TRUE — so the wall's own "what can
   I say" card has been advertising it all along. What it reached was `answer()`,
   which has no `action.*` case by design (the coverage test in local-voice.spec
   exempts them precisely because they are the SURFACE's job), so every "night
   night" fell through to Assist and then to the model, and the house had a
   pleasant chat about bedtime instead of turning the lights off.

   Third instance of the same cutover defect as initMemoryRuntime /
   initRoutineRuntime / initRecipePanel: the behaviour was never broken, it was
   never wired. Here the only caller was voiceCommands.js's dispatch table.

   ⚠ SLOWER THAN AN ORDINARY REPLY, on purpose. 0.88 is the incumbent's rate and
   it is the whole register of the moment — a goodnight delivered at the pace of
   a commute readout is the house failing to notice what time it is. Note it
   changes the TTS cache key (sha256(text::rate)), which is correct: this line
   is a different utterance from the same words said briskly.
─────────────────────────────────────────────────────────────────────────── */
const GOODNIGHT_RATE = 0.88;

/**
 * Returns the line to speak, or null to fall through to the next lane — which
 * is only the flag being off. Everything downstream of that is non-fatal by
 * construction: the scene swallows its own failure, and a calendar that could
 * not be read produces a goodnight that says nothing about tomorrow rather than
 * one that claims tomorrow is empty.
 *
 * @returns {Promise<string|null>}
 */
async function handleGoodnight() {
  if (!flag("v3Goodnight")) return null;
  return prepareGoodnight();
}

/**
 * One turn. Returns { handled, lane }.
 */
export async function submit(text, { source = "unknown" } = {}) {
  const clean = String(text ?? "").trim();
  if (!enabled || !clean) return { handled: false };
  if (busy) return { handled: false, reason: "busy" };

  busy = true;
  clearLinger();
  /* The previous turn's reply clear, too. clearReply() would refuse to blank a
     line it did not write, so this is belt-and-braces rather than the guard —
     but leaving a stale timer armed across a turn is how the linger bugs above
     started, and this one is cheap to disarm. */
  clearReplyTimer();
  // Both timers, or a thread reset armed by the PREVIOUS turn fires partway
  // through this one and empties `history` while the follow-up is in flight —
  // which is the exact failure this separation exists to fix, arriving by a
  // different door. endTurn() re-arms both.
  clearThread();
  silence();                       // barge-in: a new turn cancels the old reply
  showHeard(clean);
  sustain("voice");

  try {
    // ── Lane 1: local ───────────────────────────────────────────────────────
    const intent = matchIntent(clean);
    if (intent) {
      const snap = voiceSnapshot(coords);

      /* The photograph veto. Handled before the answerers because it ACTS: the
         other local intents all read state and describe it, and this one is the
         only place a spoken sentence changes what the wall will show tomorrow.

         ⚠ Falls through rather than replying when there is nothing to hide —
         the flag is off, or no photograph is on the ground. "Not this one" said
         to a wall with no picture on it is far more likely to be about
         something else, and pretending otherwise would answer the wrong
         question with a confident sentence. */
      if (intent.id === "photo.veto" || intent.id === "photo.restore") {
        const spoken = await handlePhotoVeto(intent.id);
        if (spoken) {
          setPhase("speaking");
          await say(spoken);
          rememberReply(spoken);
          consecutiveFailures = 0;
          endTurn(clean, spoken);
          return { handled: true, lane: "local" };
        }
      } else if (intent.id === "action.goodnight") {
        const spoken = await handleGoodnight();
        if (spoken) {
          setPhase("speaking");
          // Visible while it is said. The line names tomorrow, and hearing a
          // time without seeing it written is the one thing this surface is
          // for.
          deepen(DEPTH.GLANCE, "voice-action.goodnight");
          await say(spoken, [], { rate: GOODNIGHT_RATE });
          rememberReply(spoken);
          consecutiveFailures = 0;
          endTurn(clean, spoken);

          /* ⚠ THE ONE PLACE THE VOICE PULLS THE SURFACE SHALLOWER, and it has
             to be `setDepth`, not `deepen` — deepen() falls through to
             sustain() for a shallower target, which would RE-ARM the hold on
             whatever was up instead of letting it go. (Phase 1 recorded that
             trap; the "depth 3, held, with nothing in it" finding above is the
             same one arriving by another door.)

             This is V3's whole answer to the incumbent's
             `engageScreensaver({startMode:"minimal"})`. There is no screensaver
             to engage: depth 0 IS the resting wall, the hour and the
             photograph. Recession is normally automatic and downhill — this
             just says the downhill part is due now rather than in 90 seconds,
             because someone announced they were leaving the room. */
          setDepth(DEPTH.FIELD, "voice-goodnight");
          return { handled: true, lane: "local" };
        }
      } else if (intent.id.startsWith("show.")) {
        setPhase("idle");
        const shown = await showSubject(intent, snap);
        if (shown) {
          deepen(DEPTH.SUBJECT, `voice-${intent.id}`);

          /* The screen has the answer; the voice points at it. Two sources,
             in this order: a subject that generated its own words (only the
             briefing, whose text does not exist until it is fetched), then the
             ordinary answerer — which the INCUMBENT also reaches for these
             ids, since it has no depth 3 to show them on.

             Silence is a legitimate result. "Show me the year" is answered by
             the photographs, and a sentence introducing them would be the
             house talking over its own reply. */
          const reply = shown.speech
            ? { speech: shown.speech, refs: shown.refs }
            : answer(intent, snap);

          if (reply?.speech) {
            setPhase("speaking");
            await say(reply.speech, reply.refs);
            rememberReply(reply.speech);
          }

          consecutiveFailures = 0;
          endTurn(clean, reply?.speech);
          return { handled: true, lane: "local" };
        }

        /* ⚠⚠ SEEN ON THE WALL, 2026-08-15: DEPTH 3, HELD, WITH NOTHING IN IT.
           `showSubject()` tears the previous subject down BEFORE it looks the
           new one up, so a decline while the surface was already at SUBJECT
           leaves the stage empty — and `deepen()` falls through to `sustain()`
           for a shallower target, which is the trap Phase 1 recorded and did
           not close. So every lane below this point, local or Assist or the
           model, would re-arm a 30-second hold on a blank screen; asking again
           re-arms it again. Measured: `{depth: 3, held: true, subject: null,
           mount: 0}` after "show me the radar" then "show me what's playing"
           with nothing playing.

           Stepped DOWN explicitly, and only from deeper than a glance. The
           reason is left to whichever lane answers — `sustain()` rewrites it —
           so this changes where the surface is, never what it says it is. */
        if (getDepth() > DEPTH.GLANCE) setDepth(DEPTH.GLANCE, `voice-${intent.id}`);

        /* ── The subject declined ────────────────────────────────────────────
           Nothing to SHOW is not nothing to SAY, and until 2026-08-15 this
           path treated them as the same thing: `showSubject` returned false and
           the turn fell all the way to Assist, throwing away an answer the fast
           lane already held. Measured on the wall (HOST-BASELINES, 06:44):
           `show.media` declined because nothing was playing — and the local
           answerer's reply to exactly that state is "Nothing's playing.", in
           0.015 ms. Instead the room got a 2-4 s round trip to an agent that
           does not own this question.

           ⚠ The answerers are ALREADY the absent-is-not-empty authority — each
           one returns null for a cache that has never resolved and a sentence
           only for a state it can vouch for. So this cannot resurrect the
           "nothing on today" claim a cold cache must never make: with no
           answer, the fall-through below is unchanged. */
        const spoken = answer(intent, snap);
        if (spoken?.speech) {
          setPhase("speaking");
          deepen(DEPTH.GLANCE, `voice-${intent.id}`);
          await say(spoken.speech, spoken.refs);
          rememberReply(spoken.speech);
          consecutiveFailures = 0;
          endTurn(clean, spoken.speech);
          return { handled: true, lane: "local" };
        }
        // Nothing to show and nothing to say — fall through rather than pretend.
      } else {
        const reply = answer(intent, snap);
        if (reply) {
          setPhase("speaking");
          deepen(DEPTH.GLANCE, `voice-${intent.id}`);
          // Only deepen once the card has something to show. Depth 2 has no
          // composer yet, so an unpopulated SPREAD is a black screen — and this
          // path fires while the house is mid-sentence.
          if (reply.showVocabulary && renderVocabularyCard(snap)) {
            deepen(DEPTH.SPREAD, "voice-vocabulary");
          }
          await say(reply.speech, reply.refs);
          rememberReply(reply.speech);
          consecutiveFailures = 0;
          endTurn(clean, reply.speech);
          return { handled: true, lane: "local" };
        }
      }
    }

    // ── Lane 2: HA Assist ───────────────────────────────────────────────────
    setPhase("thinking");
    /* Skipped when the utterance cannot be Assist's business — see
       couldBeAssist(). Conversational turns used to pay a full round trip
       here purely to be declined, and they paid it BEFORE the house voice was
       asked, so the slowest lane was gated behind a hop that could never
       answer it. The predicate fails toward the round trip whenever it cannot
       tell, so this only ever removes a hop that was certain to decline. */
    const assist = couldBeAssist(clean)
      ? await postJson("/api/voice/assist", { text: clean, conversationId: assistConversationId })
      : null;
    // Kept even when the lane declines, because HA mints the id on the FIRST
    // exchange of a clarification ("turn on the lamp" → "which one?") and that
    // first exchange is exactly the one it reports as unhandled.
    if (assist?.conversationId) assistConversationId = assist.conversationId;

    /* `handled` alone, not `handled && speech`. HA answers a completed action
       with response_type "action_done" and sometimes no plain speech at all —
       the lights are already on. Requiring speech sent that turn down to the
       house voice, which would then answer a question about something that had
       already happened. Silence after acting is a legitimate reply; asking
       Claude about it is not. */
    if (assist?.handled) {
      deepen(DEPTH.GLANCE, "voice-assist");
      if (assist.speech) {
        setPhase("speaking");
        await say(assist.speech, []);
        rememberReply(assist.speech);
      } else {
        setPhase("idle");
      }
      consecutiveFailures = 0;
      endTurn(clean, assist.speech);
      return { handled: true, lane: "assist" };
    }

    /* ── Lane 3: the house voice ────────────────────────────────────────────
       The digest rides along. Until now this lane knew the date and nothing
       else — it was the voice of a house with no knowledge of the house, so
       every question the regexes above did not catch was answered blind.

       voiceSnapshot() is synchronous and reads caches already in memory
       (~0.015 ms), so building it here costs no network and no wait. It is
       built fresh rather than reusing the `snap` from lane 1, because lane 1
       only builds one when an intent matched — and the turns that reach here
       are mostly the ones where none did. */
    /* `learned` is passed IN rather than read inside voiceSnapshot, so that
       module keeps importing nothing from core/ — it is imported directly by
       node-side specs, and pulling routineRuntime's dependency chain in behind
       it would make those specs depend on a browser environment. */
    const body = {
      text: clean,
      history,
      house: houseDigest({ ...voiceSnapshot(coords), learned: learnedTimes() })
    };

    /* The streamed path speaks each sentence as it is written, so the room
       hears the first one while the model is still on the second. */
    if (flag("voiceStreaming")) {
      setPhase("speaking");
      deepen(DEPTH.GLANCE, "voice-converse");
      const speech = createSpeech({ onAudio: (audio) => trackSpeech(audio) });
      const { reply, spoke } = await converseStreamed(body, speech);
      speech.close();
      await speech.done;             // let the queue finish what it is saying
      setPhase("idle");

      if (reply) {
        setSaidText(el.glanceSaid, reply);
        rememberReply(reply);
        consecutiveFailures = 0;
        endTurn(clean, reply);
        return { handled: true, lane: "converse" };
      }
      /* ⚠ ONLY FALL BACK IF NOTHING WAS SAID. A stream that died after
         speaking two sentences has already put half an answer in the room;
         retrying the JSON route would speak a second, differently-worded
         answer straight over the top of it. Half an answer is bad, two
         overlapping answers is worse — so a partial failure ends the turn and
         lets the repair path below handle it. */
      if (spoke) {
        endTurn(clean);
        return { handled: false, reason: "stream-cut" };
      }
      // Nothing was spoken, so the JSON route (which still has the Ollama
      // fallback behind it) is free to try the whole turn again.
    }

    const converse = await postJson("/api/voice/converse", body);
    if (converse?.reply) {
      setPhase("speaking");
      deepen(DEPTH.GLANCE, "voice-converse");
      // refs may arrive from the model; they are matched against cells that
      // actually exist and dropped otherwise, so a hallucinated one is inert.
      await say(converse.reply, converse.refs);
      rememberReply(converse.reply);
      consecutiveFailures = 0;
      endTurn(clean, converse.reply);
      return { handled: true, lane: "converse" };
    }

    // ── Repair ──────────────────────────────────────────────────────────────
    // Heard, understood as words, and nothing could act on it.
    consecutiveFailures += 1;
    showHeard(clean, "misheard");
    setFailure("misheard");

    // Third strike escalates to the vocabulary instead of a third apology.
    // Never a third "sorry, I didn't catch that" — that is where a person
    // stops talking to the wall for good.
    if (consecutiveFailures >= 3) {
      consecutiveFailures = 0;
      const snap = voiceSnapshot(coords);
      // Same guard, and it matters more here: the person has already not been
      // understood three times. A screen that goes black at that exact moment
      // is where someone stops talking to the wall for good.
      if (renderVocabularyCard(snap)) deepen(DEPTH.SPREAD, "voice-repair-escalation");
      const vocab = answer({ id: "meta.vocabulary", slots: {} }, snap);
      if (vocab) await say(vocab.speech, []);
    }
    endTurn(clean);
    return { handled: false };
  } finally {
    busy = false;
  }
}

/** The house heard nothing usable — distinct from misheard, and silent by
 *  design: if it did not hear you, saying "sorry?" out loud is just noise. */
export function reportUnheard() {
  setFailure("unheard");
}

/* Read per-call, never at module load: ES imports hoist above the point where
   /js/config.js has set window.CONFIG, so a module-level read is frozen to
   `undefined` and the flag silently reads false forever. */
function flag(name) {
  return Boolean(globalThis.window?.CONFIG?.features?.[name]);
}

/* ── Half duplex ────────────────────────────────────────────────────────────
   THIS is the surface on the wall — /v3/, not the incumbent — so the mic's
   half of the conversation has to be wired here or it is wired nowhere.

   The kiosk's microphone hears its own speakers. On 2026-08-08 the wake agent
   transcribed V3's replies back into this very EventSource and the house
   answered itself. Two facts cross the wire: we say when we are talking, and
   the agent says when someone wants us to stop.

   Note submit() already opens with silence() — a NEW TURN cancelling the old
   reply. That path cannot fire while we are speaking any more, because the
   agent no longer captures over us. Barge-in replaces it for that case, and it
   arrives while `busy` is still held, which is why tts.silence() has to settle
   the pending speak() promise rather than leave say() awaiting forever.
─────────────────────────────────────────────────────────────────────────── */
function reportSpeaking(on) {
  // Fire and forget: the reply is already playing and nothing here may await,
  // retry or throw. The agent fails open, so a dropped report costs one turn
  // of echo, never a deaf microphone.
  fetch("/api/voice/speaking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ speaking: on === true }),
    keepalive: true
  }).catch(() => {});
}

function initHalfDuplex() {
  setSpeakingObserver(reportSpeaking);
  stream.addEventListener("voice_barge_in", () => {
    silence();
    // Someone took the floor mid-sentence. The turn is over, but they are
    // still here — hold the readout for the follow-up rather than snapping
    // the screen back, and drop the light out of "speaking" now rather than
    // when a promise that was cut short gets round to it.
    setPhase("idle");
    endTurn();
  });
}

export function initVoice({ enabled: on = false, lat = null, lon = null } = {}) {
  enabled = on === true;
  coords = { lat, lon };

  el.heard = document.getElementById("heard");
  el.glanceSaid = document.getElementById("glance-said");
  el.glanceMeasured = document.getElementById("glance-measured");

  // Debug hooks, matching the house convention so CDP can drive a turn with no
  // microphone and no person in the room.
  window.__v3Voice = () => ({
    enabled,
    busy,
    failures: consecutiveFailures,
    streamOpen: stream?.readyState === 1,
    halfDuplex: flag("voiceHalfDuplex"),
    // The thread, readable from outside — the incumbent's __voiceSession has
    // reported exactly these two since Phase 4, and the only reason V3's
    // follow-ups could go missing unnoticed is that nothing could see them.
    turns: history.length,
    conversationId: assistConversationId
  });
  window.__v3Transcript = (t) => submit(t, { source: "debug" });

  if (!enabled) return;

  try {
    stream = new EventSource("/api/voice/stream");
  } catch {
    return;
  }
  stream.addEventListener("voice_transcript", (event) => {
    try {
      const { text } = JSON.parse(event.data);
      if (text) submit(String(text).toLowerCase(), { source: "mic" });
    } catch { /* malformed frame — never throw into the stream */ }
  });

  // After the stream exists — it is what the barge-in listener attaches to.
  if (flag("voiceHalfDuplex")) initHalfDuplex();
}
