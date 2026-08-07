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
import { voiceSnapshot, rememberReply } from "../../js/services/voiceSnapshot.js";
import { speak, silence } from "../../js/core/tts.js";
import { setPhase, setFailure, trackSpeech } from "./presence-light.js";
import { deepen, sustain, DEPTH } from "./depth.js";
import { showSubject } from "../subjects/index.js";

const LINGER_MS = 8_000;
const DEIXIS_MS = 4_200;

let enabled = false;
let busy = false;
let stream = null;
let lingerTimer = null;
let deixisTimer = null;
let consecutiveFailures = 0;
let coords = { lat: null, lon: null };

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

function say(text, refs) {
  el.glanceSaid && (el.glanceSaid.textContent = text);
  lightRefs(refs);
  // The sweep is driven by real playback position, so it arrives at the last
  // word rather than at a guess about it.
  return speak(text, { onAudio: (audio) => trackSpeech(audio) })
    .then(() => setPhase("idle"), () => setPhase("idle"));
}

function clearLinger() {
  if (lingerTimer) {
    clearTimeout(lingerTimer);
    lingerTimer = null;
  }
}

function endTurn() {
  clearLinger();
  lingerTimer = setTimeout(() => {
    lingerTimer = null;
    hideHeard();
    clearDeixis();
  }, LINGER_MS);
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

/**
 * One turn. Returns { handled, lane }.
 */
export async function submit(text, { source = "unknown" } = {}) {
  const clean = String(text ?? "").trim();
  if (!enabled || !clean) return { handled: false };
  if (busy) return { handled: false, reason: "busy" };

  busy = true;
  clearLinger();
  silence();                       // barge-in: a new turn cancels the old reply
  showHeard(clean);
  sustain("voice");

  try {
    // ── Lane 1: local ───────────────────────────────────────────────────────
    const intent = matchIntent(clean);
    if (intent) {
      const snap = voiceSnapshot(coords);

      if (intent.id.startsWith("show.")) {
        setPhase("idle");
        const shown = await showSubject(intent, snap);
        if (shown) {
          deepen(DEPTH.SUBJECT, `voice-${intent.id}`);
          consecutiveFailures = 0;
          endTurn();
          return { handled: true, lane: "local" };
        }
        // Nothing to show — fall through rather than pretend.
      } else {
        const reply = answer(intent, snap);
        if (reply) {
          setPhase("speaking");
          deepen(DEPTH.GLANCE, `voice-${intent.id}`);
          if (reply.showVocabulary) deepen(DEPTH.SPREAD, "voice-vocabulary");
          await say(reply.speech, reply.refs);
          rememberReply(reply.speech);
          consecutiveFailures = 0;
          endTurn();
          return { handled: true, lane: "local" };
        }
      }
    }

    // ── Lane 2: HA Assist ───────────────────────────────────────────────────
    setPhase("thinking");
    const assist = await postJson("/api/voice/assist", { text: clean });
    if (assist?.handled && assist.speech) {
      setPhase("speaking");
      deepen(DEPTH.GLANCE, "voice-assist");
      await say(assist.speech, []);
      rememberReply(assist.speech);
      consecutiveFailures = 0;
      endTurn();
      return { handled: true, lane: "assist" };
    }

    // ── Lane 3: the house voice ─────────────────────────────────────────────
    const converse = await postJson("/api/voice/converse", { text: clean });
    if (converse?.reply) {
      setPhase("speaking");
      deepen(DEPTH.GLANCE, "voice-converse");
      // refs may arrive from the model; they are matched against cells that
      // actually exist and dropped otherwise, so a hallucinated one is inert.
      await say(converse.reply, converse.refs);
      rememberReply(converse.reply);
      consecutiveFailures = 0;
      endTurn();
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
      deepen(DEPTH.SPREAD, "voice-repair-escalation");
      const vocab = answer({ id: "meta.vocabulary", slots: {} }, voiceSnapshot(coords));
      if (vocab) await say(vocab.speech, []);
    }
    endTurn();
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

export function initVoice({ enabled: on = false, lat = null, lon = null } = {}) {
  enabled = on === true;
  coords = { lat, lon };

  el.heard = document.getElementById("heard");
  el.glanceSaid = document.getElementById("glance-said");
  el.glanceMeasured = document.getElementById("glance-measured");

  // Debug hooks, matching the house convention so CDP can drive a turn with no
  // microphone and no person in the room.
  window.__v3Voice = () => ({ enabled, busy, failures: consecutiveFailures, streamOpen: stream?.readyState === 1 });
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
}
