/* ═══════════════════════════════════════════════════════════════════════════
   SUBJECT DOM — the small shared vocabulary every depth-3 module builds from.

   Six subjects landed at once in Phase 4 and they all build the same three
   things: a titled frame, a column of lines, and a grid of photographs. Six
   hand-rolled copies of that would have been six chances to forget the part
   that matters, which is not the markup.

   ── The part that matters ───────────────────────────────────────────────────

   `frame()` returns a node and a teardown, and the teardown CLEARS EVERY IMAGE
   SRC BEFORE DETACHING. That is not tidiness. An <img> whose src is still set
   keeps its connection and its decoded bitmap alive on a detached node, which
   on a surface that runs for weeks is the exact shape of the leak this house
   has already paid for twice — 709 zombie lottie wrappers and 230k detached
   nodes both came from per-event code that dropped the node and thought it was
   done. Depth 3 is the only genuinely per-event path in V3.

   No innerHTML anywhere. Every string here is data — calendar titles, recipe
   steps, a language model's briefing — and textContent is the only way to be
   sure of that without an escaping ceremony at each call site.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The outer node of a subject, plus the teardown that dismantles it.
 *
 * @param {string} kind  the subject's name, used for the modifier class and as
 *                       the deixis address so a spoken reference can light it
 * @returns {{node: HTMLElement, teardown: Function}}
 */
export function frame(kind) {
  const node = document.createElement("div");
  node.className = `subject subject--${kind}`;
  node.dataset.cell = kind;

  const teardown = () => {
    // Order matters: drop every src BEFORE detaching, or Chromium can keep a
    // stream alive on a node nobody can reach any more.
    for (const img of node.querySelectorAll("img")) img.src = "";
    node.remove();
  };

  return { node, teardown };
}

/** The subject's own name for itself. Measured, not said: it is a label on a
 *  thing being shown, not the house speaking. */
export function title(text) {
  const el = document.createElement("p");
  el.className = "subject__title measured measured--2";
  el.textContent = text;
  return el;
}

/**
 * A column of rows. Each row is `{ lead, text }` — the lead is the measured
 * half (a time, a quantity, a year) and the text is the said half.
 *
 * Capped by the caller, never here: what fits is a question about the panel and
 * the type size, and the subject is the one that knows both.
 */
export function column(rows) {
  const list = document.createElement("ul");
  list.className = "subject__list";
  for (const row of rows) {
    const li = document.createElement("li");
    li.className = "subject__row";
    if (row.lead) {
      const lead = document.createElement("span");
      lead.className = "subject__lead measured measured--2";
      lead.textContent = row.lead;
      li.appendChild(lead);
    }
    const text = document.createElement("span");
    text.className = "subject__text said said--2";
    text.textContent = row.text;
    li.appendChild(text);
    list.appendChild(li);
  }
  return list;
}

/** One line of prose at reading scale — the briefing's shape, and the only
 *  place in V3 where the house says more than a sentence. */
export function prose(text) {
  const el = document.createElement("p");
  el.className = "subject__prose said said--2";
  el.textContent = text;
  return el;
}

/** A photograph with an optional caption beneath it. */
export function plate(src, caption) {
  const fig = document.createElement("figure");
  fig.className = "subject__plate";
  const img = document.createElement("img");
  img.alt = "";
  img.loading = "eager";
  img.src = src;
  fig.appendChild(img);
  if (caption) {
    const cap = document.createElement("figcaption");
    cap.className = "subject__caption-sm measured measured--2";
    cap.textContent = caption;
    fig.appendChild(cap);
  }
  return fig;
}

/** GET json, or null. Subjects are allowed to be unable to show something; they
 *  are never allowed to throw into the depth machinery. */
export async function getJson(url, { timeoutMs = 6000 } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
