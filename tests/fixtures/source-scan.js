import { readFileSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, sep, extname } from "node:path";

/* The static source scan shared by the specs that DERIVE a fact from the tree
   rather than trust a hand-kept list: tests/flag-surface.spec.js (which flags
   are a lever on V3) and tests/event-registry.spec.js (which bus events are
   heard on each surface). Moved here from flag-surface.spec.js unchanged, so
   the two cannot drift into two strippers that disagree about what is code. */

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SRC = join(root, "src");

export const rel = (f) => relative(root, f).split(sep).join("/");

/* ── comment stripping ─────────────────────────────────────────────────────
   Strings, template literals (with nested `${}`) and regex literals are kept
   verbatim, so a name inside them still counts; comments go. The regex rule is
   the standard heuristic — a `/` opens a literal only where a value cannot end
   — which is sufficient for this tree and checked by each caller's assertion 1:
   the import closure computed from stripped source must equal the one from raw
   source, so a stripper that swallowed code would lose edges and go red there. */
export function stripComments(src) {
  let out = "";
  let i = 0;
  let braces = 0;
  let lastSig = "";
  const templateReturns = [];
  const n = src.length;

  const regexAllowed = () =>
    lastSig === "" ||
    /[(,=:[!&|?{};+\-*%<>~^]/.test(lastSig) ||
    /\b(return|typeof|case|do|else|in|of|void|yield|await)$/.test(out.trimEnd());

  const readTemplate = () => {
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { out += c; i++; lastSig = "`"; return; }
      if (c === "$" && src[i + 1] === "{") {
        out += "${"; i += 2; templateReturns.push(braces); braces++; lastSig = "{";
        return;
      }
      out += c; i++;
    }
  };

  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? n : end + 2;
      out += " ";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && src[j] !== c && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1; lastSig = c;
      continue;
    }
    if (c === "`") { out += c; i++; readTemplate(); continue; }
    if (c === "/" && regexAllowed()) {
      let j = i + 1;
      let inClass = false;
      while (j < n && src[j] !== "\n") {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      out += src.slice(i, j); i = j; lastSig = "/";
      continue;
    }
    if (c === "{") braces++;
    if (c === "}") {
      braces--;
      if (templateReturns.length && templateReturns[templateReturns.length - 1] === braces) {
        templateReturns.pop(); out += c; i++; readTemplate();
        continue;
      }
    }
    out += c; i++;
    if (!/\s/.test(c)) lastSig = c;
  }
  return out;
}

/* ── the closure walk ──────────────────────────────────────────────────────
   Same walk as tests/v3-closure.spec.js, entered from each surface's own
   `<script type="module">` rather than a hardcoded file, so a moved entry is
   followed rather than silently left behind. config.js itself arrives by a
   plain `<script>` on both surfaces. */
const source = new Map();
const stripped = new Map();
export const rawOf = (f) => {
  if (!source.has(f)) source.set(f, readFileSync(f, "utf8"));
  return source.get(f);
};
export const codeOf = (f) => {
  if (!stripped.has(f)) stripped.set(f, stripComments(rawOf(f)));
  return stripped.get(f);
};

export function moduleEntry(html) {
  const text = readFileSync(join(SRC, html), "utf8");
  const m = text.match(/<script\s+type="module"\s+src="([^"]+)"/);
  if (!m) return null;
  return m[1].startsWith("/") ? join(SRC, m[1]) : resolve(dirname(join(SRC, html)), m[1]);
}

export function importClosure(entry, read) {
  const seen = new Set();
  const stack = [resolve(entry)];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const specifiers = /(?:from|import)\s*["'](\.[^"']+)["']/g;
    let match;
    while ((match = specifiers.exec(read(file)))) {
      let target = resolve(dirname(file), match[1]);
      if (!existsSync(target) && existsSync(`${target}.js`)) target = `${target}.js`;
      if (existsSync(target) && statSync(target).isDirectory()) target = join(target, "index.js");
      if (existsSync(target) && [".js", ".mjs", ".cjs"].includes(extname(target))) stack.push(target);
    }
  }
  return seen;
}
