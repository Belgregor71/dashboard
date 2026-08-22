# Handover — the house does not know which of them is speaking

> **Status: not started, fully unblocked.** Nothing is waiting on the owner except two
> decisions in §6 and one enrolment sitting. Written 2026-08-22 at the end of the session
> that shipped Builds 1 and 2 of `VOICE-UPGRADES.md`; this is Build 3, the last and largest.

**One sentence:** `SPEAKER_UNKNOWN_LINE` tells the model outright that it *cannot tell which
of two people is speaking and must never guess*, and that single sentence is the reason three
designed-for behaviours are structurally unreachable — so the fix is a ~25 MB speaker
embedding on the WAV `stt_server.py` is already holding, not a new pipeline.

---

## 1. What is missing

`server/services/voiceShape.js:78` ships this in every converse prompt:

> "Two people live in this house, Greg and Brett, and you cannot tell which of them is
> speaking. Never guess. When describing how people are related, name them and anchor the
> relationship to Greg or to Brett — say *Victoria is Brett's sister*, not *your sister*…"

It is a correct instruction and it is expensively true. Three things the house is otherwise
built for cannot happen while it stands:

1. **The family-tease licence.** `VOICE.md` §3 grants an eyebrow only to "known household
   members identified by name". Nobody is ever identified, so the licence is dead letter and
   every tease line in `alertLines.js` and `delight.js` is reachable only through the
   *arrival* path, never through the voice.
2. **"Am I free next Tuesday."** `cal.free` resolves against *the* calendar. With two people
   and two calendars, "am I" has no referent — and F7 already records this lane answering a
   confident sentence about the wrong day, which is the same failure one rung down.
3. **Memory per person.** `conversationLog.js` distils exchanges into vault notes with no
   idea who said them, so "you mentioned" can only ever mean "someone in this house did".

⚠ **This is the only item in `VOICE-UPGRADES.md` that touches biometrics.** Read §5 before
writing code.

---

## 2. Why it is cheap here, and would not be elsewhere

**Two classes.** Not "who is this", but "is this Greg, or Brett, or neither" — a decision
between two enrolled centroids with a reject band. Everyone else in the household is a dog.
The open-set problem that makes speaker ID hard in general is nearly absent at n=2.

**The audio is already in the right place.** `tools/voice-pc/stt_server.py` receives the
whole utterance as WAV bytes and holds them in memory for the length of the transcription.
A speaker embedding is a second read of *those same bytes*:

- no new audio path, and no new privacy surface beyond the one that already exists
- no new hop, no new latency in the room (it can ride the same response)
- the guardrail is untouched — audio still only arrives after an on-device wake

**The response already has a widening precedent.** `/api/voice/ambient` gained an optional
`speech` field and treats its absence as "the agent is older than the dashboard". Do the same
here: `{text, speaker, confidence}` where `speaker` may be absent, and every reader must cope.

---

## 3. The trace, end to end — all five points confirmed by reading in this session

```
tools/voice-agent/voice_agent.py  transcribe()   ← the WAV is POSTed here
        │                          forward()     ← currently posts {text} ONLY
        ▼
server/routes/voice.js            POST /api/voice/transcript   (loopback-gated)
        │                          voiceBus.emit("transcript", {text, source:"mic"})
        ▼
server/routes/voice.js            GET /api/voice/stream → event: voice_transcript
        ▼
src/v3/core/voice.js:817          stream.addEventListener("voice_transcript", …)
        │                          → submit(text, {source:"mic"})
        ▼
src/v3/core/voice.js  submit()    → body {text, history, house} → /api/voice/converse
        ▼
server/routes/voice.js            converseSystem(text, tools, digest)
                                   → swap SPEAKER_UNKNOWN_LINE for a speaker-known line
```

⚠ `src/js/core/voiceSession.js:165` is the **incumbent's** copy of the same listener. It is
the `V3_DEFAULT=0` rollback surface, so it must not be broken — but it does not need the
feature. Leave it reading `{text}` and ignoring the rest.

---

## 4. The model — and what NOT to use

**Use a wespeaker ONNX export** (ECAPA-TDNN or CAM++, ~25 MB, CPU). `onnxruntime` is already
a hard dependency of the installed openWakeWord *on the agent*, and it is trivially
installable in the `voice-stt` venv.

⛔ **Not SpeechBrain.** It pulls torch. `voice-stt.service` is capped at `MemoryMax=2G` and
already holds two whisper models when the shadow is on (measured **859 MB RSS**). Torch alone
would blow it, and the failure mode of that cap is a restart loop, i.e. a deaf house.

⛔ **Not pyannote for diarisation.** There is one speaker per utterance by construction — the
capture is wake-gated and endpointed. Diarisation solves a problem this pipeline does not
have.

⛔ **Not the openWakeWord custom-verifier route** as the primary mechanism. It is mentioned in
`VOICE-UPGRADES.md` §2.1 as a *wake-word* false-accept fix that happens to discriminate
voices; it only sees the wake word, not the utterance, and it degrades for unenrolled
speakers. Worth revisiting for barge-in, not for this.

### ⚠⚠ Introspect the export before writing a line of the binding

**This session lost an hour to exactly that mistake and the file is the record of it.**
Smart Turn's published docs gave the wrong input shape *and* an inference cost 10× too low.
`tools/voice-agent/voice_agent.py`'s `_init_turn` now verifies the shape at load and refuses
a model whose geometry disagrees, because *a model with the wrong frontend returns confident
nonsense rather than failing.*

```python
import onnxruntime as ort
s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
for i in s.get_inputs():  print("IN ", i.name, i.shape, i.type)
for o in s.get_outputs(): print("OUT", o.name, o.shape, o.type)
```

Run that on the G11 *first*. Most wespeaker exports take raw 16 kHz float audio and emit a
192- or 256-dim embedding, but check rather than assume — and if it wants fbank features,
`tools/voice-agent/st_verify.py` is the pattern for proving a numpy frontend against a
reference implementation to float precision.

---

## 5. ⚠⚠ The two hard constraints

### It must fail toward UNKNOWN

A reject band, never a best guess. Cosine similarity to each centroid; identify only when the
best score clears an absolute floor **and** beats the runner-up by a margin. Anything else is
`speaker: null`, and `null` must reproduce today's prompt **byte for byte** — that is the
rollback path and it should have a test.

This is not fastidiousness. `project-house-character-and-memory` records this character
**inventing a named family member in a photograph that never existed**, caught live and
rolled back within a minute. A house that confidently addresses Brett as Greg is the same
failure wearing a different hat, and it is worse, because the person it is wrong about is
standing there.

### Voiceprints are biometrics

- Enrolment centroids live in **untracked `data/`** (or beside `hotwords.txt` on the box).
  They go nowhere near `src/js/config.js`, which is tracked *and shipped in the public
  bundle*. This repo has already put a street address in that bundle once.
- Store **embeddings only, never the enrolment audio.** The vectors are not invertible to
  speech; the WAVs are.
- `/health` may report the *number* of enrolled speakers. Never the names — that endpoint
  answers anything that can reach the port. `stt_server.py` already applies exactly this rule
  to the hotword list (count, never contents); copy it.
- A `DELETE` path to forget a voice, matching `DELETE /api/vault/memories/:id`'s
  `{"forgotten": true}`. Retention promises this house has already made should extend here.

---

## 6. Decisions for the owner — ask before building

1. **What changes when the house knows.** Enabling the tease licence is the obvious win and
   also the riskiest: a mistimed rib at the wrong person is exactly the failure `VOICE.md` §2
   ("never at a person's expense") exists to prevent. Options: identify-but-stay-neutral
   (calendar and memory only), or the full licence.
2. **Enrolment sitting.** Needs each of Greg and Brett to say ~5 utterances at the wall, at
   the wall's distance, through the actual mic. ⚠ **Not read from a phone, not synthesised** —
   the centroid must carry this room's acoustics or it will not match live turns.

---

## 7. ⚠ Three things that WILL break

1. **`tests/voice.spec.js` pins the flag-off prompt.** It asserts the character-off build is
   byte-identical to the pre-character prompt. Anything that touches `converseSystem()` must
   keep the `speaker: null` path passing it unchanged.
2. **`tests/env-example.spec.js`** fails on any new `process.env.*` in `server/` or
   `scripts/` without a line in `.env.example`. It does **not** scan Python, so
   `stt_server.py`'s own knobs are exempt — they are documented in the module docstring and
   `deploy/voice-stt.service`, which is the established pattern.
3. **`reference-voice-bus-cross-test-channel`** — `voiceBus` is process-wide and one
   transcript POST reaches every page in the suite. A speaker field on that bus will land in
   unrelated specs. The tell is `body.dataset.presence == "voice"`.

---

## 8. How to verify

- **Offline first.** Extend `tools/voice-pc/stt_selftest.py`. It already proves the
  flag-off response shape is unchanged (case 1) — add: an unenrolled voice returns
  `speaker: null`; a below-threshold match returns `null` rather than the nearest name; the
  `/health` count leaks no names.
- ⚠ **Prove the reject band by injection.** Feed voice A against a store enrolled only on
  voice B and assert `null`. A test that only ever sees a correct match cannot fail — this
  session shipped a stub that quietly enforced the very rule the code was missing and passed
  19/19 against a live defect. **A stub kinder than reality is a stub that cannot fail.**
- **Then the room.** Both people, several turns each, at the wall. Read the confidences out
  of the journal before choosing the threshold — the same way `SPEECH_ON` was set, and the
  same way `SMART_TURN_ON` still needs to be.
- ⛔ **Never with synthesised speech.** Standing rule (`project-voice-compute-on-g11`), and it
  bites harder here: a TTS voice has no speaker identity to recognise.

---

## 9. Rollback

Unset the env knob, `daemon-reload`, restart `voice-stt`. The response loses its `speaker`
field, every reader already treats it as optional, and `converseSystem()` falls back to
`SPEAKER_UNKNOWN_LINE`. No deploy, no code change, ~10 s.

---

## 10. State at handover

**On the G11** (`/home/dashboard/voice-stt/`): `stt_server.py` md5 `34fb0911…`, matching
`tools/voice-pc/stt_server.py` in the repo. `hotwords.txt` (27 phrases, mode 600, untracked).
`base.en` + `small.en` cached. Backup at `stt_server.py.bak-preshadow`.

**Live and working:** Build 2, `CAPTURE_VAD=smart` — Smart Turn v3 endpointing, measured
saving 320 ms of dead air on a real turn (`ended=smart turn=0.98 asks=1`).

**⚠ Owed from Build 1:** the `voice-stt` restart that arms the shadow measurement. Until it
runs, `journalctl -u voice-stt | grep shadow` is empty and the base.en-vs-small.en question
is still open. **`voice-stt` is NOT in the NOPASSWD list** (only `dashboard`,
`dashboard-deploy`, `dashboard-kiosk`, `voice-agent` are), and `ssh host 'sudo …'` fails
without **`-t`** — allocate a TTY or it cannot prompt.

**⚠ Neither `voice_agent.py` nor `stt_server.py` is deployed by `git pull`.** `scp` plus a
restart, and keep the repo copies byte-identical — `md5sum` both before assuming the code you
are reading is the code that is running.

**Read first:** `VOICE-UPGRADES.md` §2.4 (the field survey this implements) and §5 (the two
ideas taken from the reviewed repos, one of which — the spoken permission gate — is the
natural companion to this work).
