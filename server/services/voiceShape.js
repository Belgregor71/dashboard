// Pure shaping helpers for the Phase 4 voice lanes (docs/vision/phase-4-voice.md).
// No imports, no I/O — unit-tested directly in tests/voice.spec.js.

// Home Assistant's /api/conversation/process reply → the dashboard's contract.
// handled=false means Assist couldn't act on it (the client falls through to
// the Claude converse lane); a malformed payload is treated the same way.
export function shapeAssistResponse(payload) {
  const response = payload?.response;
  const speech = response?.speech?.plain?.speech;
  const handled =
    typeof response?.response_type === "string" &&
    response.response_type !== "error";
  return {
    handled,
    speech: typeof speech === "string" && speech.trim() ? speech.trim() : null,
    conversationId:
      typeof payload?.conversation_id === "string" ? payload.conversation_id : null
  };
}

// The converse lane keeps a short rolling transcript for follow-up questions.
// History is bounded HERE (not trusted from the client): last MAX_TURNS turns,
// each clamped, roles forced to the two the Messages API accepts.
export const MAX_TURNS = 6;
export const MAX_TURN_CHARS = 500;

export function buildConverseMessages(text, history) {
  const turns = Array.isArray(history) ? history.slice(-MAX_TURNS) : [];
  const messages = [];
  for (const turn of turns) {
    const content = typeof turn?.text === "string" ? turn.text.trim().slice(0, MAX_TURN_CHARS) : "";
    if (!content) continue;
    const role = turn.role === "assistant" ? "assistant" : "user";
    // The Messages API requires alternating roles starting with "user".
    if (messages.length === 0 && role === "assistant") continue;
    if (messages.length > 0 && messages[messages.length - 1].role === role) {
      messages[messages.length - 1].content += `\n${content}`;
      continue;
    }
    messages.push({ role, content });
  }
  const current = String(text).trim().slice(0, MAX_TURN_CHARS);
  if (messages.length > 0 && messages[messages.length - 1].role === "user") {
    messages[messages.length - 1].content += `\n${current}`;
  } else {
    messages.push({ role: "user", content: current });
  }
  return messages;
}

// The converse system prompt, with or without house-knowledge context
// (docs/design/VAULT.md). Lives here rather than in the route so the property
// that matters is directly testable: with no context this is BYTE-IDENTICAL to
// the pre-vault prompt, which is what makes the vault lane genuinely inert when
// it is switched off rather than merely quiet.
export const NO_KNOWLEDGE_LINE =
  "If you don't know something about this specific house (device states, schedules), say so plainly rather than guessing.";

export function buildConverseSystem(baseLines, context) {
  const base = (Array.isArray(baseLines) ? baseLines : []).join(" ");
  if (!context) return `${base} ${NO_KNOWLEDGE_LINE}`;

  return [
    base,
    "",
    "Here is what the household has written down that may be relevant:",
    context,
    "",
    `Answer from these notes when they cover the question. ${NO_KNOWLEDGE_LINE}`
  ].join("\n");
}
