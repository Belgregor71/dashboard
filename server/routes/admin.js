import express from "express";
import multer from "multer";
import crypto from "crypto";
import { readdir, unlink, mkdir, open } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PHOTOS_DIR = path.resolve(__dirname, "..", "..", "static", "photos");
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);

const router = express.Router();

// Constant-time string compare. timingSafeEqual requires equal-length
// buffers, so an early length check is unavoidable (standard pattern).
function safeEqual(a, b) {
  const ab = Buffer.from(String(a), "utf8");
  const bb = Buffer.from(String(b), "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function basicAuth(req, res, next) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    res.status(403).send("Admin disabled. Set ADMIN_PASSWORD in .env to enable.");
    return;
  }
  const auth = req.headers.authorization;
  if (!auth?.startsWith("Basic ")) {
    res.set("WWW-Authenticate", 'Basic realm="Dashboard Admin"');
    res.status(401).send("Authentication required");
    return;
  }
  const decoded = Buffer.from(auth.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  const pass = colon >= 0 ? decoded.slice(colon + 1) : decoded;
  if (!safeEqual(pass, password)) {
    res.set("WWW-Authenticate", 'Basic realm="Dashboard Admin"');
    res.status(401).send("Wrong password");
    return;
  }
  next();
}

const storage = multer.diskStorage({
  destination: async (_req, _file, cb) => {
    await mkdir(PHOTOS_DIR, { recursive: true });
    cb(null, PHOTOS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_\-. ]/g, "_")
      .trim()
      .replace(/\s+/g, "_")
      .slice(0, 80);
    cb(null, `${base}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, IMAGE_EXTS.has(ext));
  }
});

// Validate real file content, not just the extension: read the leading bytes
// and match known image signatures. Rejects a renamed non-image upload.
function matchesImageSignature(b) {
  if (b.length < 12) return false;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return true;                 // JPEG
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return true; // PNG
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return true; // GIF
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return true; // WEBP
  if (b.toString("ascii", 4, 8) === "ftyp") {                                       // AVIF
    const brand = b.toString("ascii", 8, 12);
    if (brand === "avif" || brand === "avis") return true;
  }
  return false;
}

async function hasImageMagic(filepath) {
  let fh;
  try {
    fh = await open(filepath, "r");
    const { buffer, bytesRead } = await fh.read(Buffer.alloc(32), 0, 32, 0);
    return matchesImageSignature(buffer.subarray(0, bytesRead));
  } catch {
    return false;
  } finally {
    await fh?.close();
  }
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function listPhotos() {
  await mkdir(PHOTOS_DIR, { recursive: true });
  const entries = await readdir(PHOTOS_DIR, { withFileTypes: true });
  return entries
    .filter(e => e.isFile() && IMAGE_EXTS.has(path.extname(e.name).toLowerCase()))
    .map(e => e.name)
    .sort((a, b) => a.localeCompare(b));
}

function safePath(filename) {
  const base = path.basename(filename);
  const resolved = path.join(PHOTOS_DIR, base);
  if (!resolved.startsWith(PHOTOS_DIR + path.sep) && resolved !== PHOTOS_DIR) return null;
  return resolved;
}

router.get("/admin/photos", basicAuth, async (_req, res) => {
  let files;
  try { files = await listPhotos(); } catch { files = []; }

  const rows = files.map(name => `
    <li class="photo-row" id="row-${encodeURIComponent(name)}">
      <img src="/photos/${encodeURIComponent(name)}" alt="${escapeHtml(name)}" loading="lazy" />
      <span class="name">${escapeHtml(name)}</span>
      <button class="del-btn" data-name="${escapeHtml(name)}" title="Delete">&#x2715; Delete</button>
    </li>`).join("");

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dashboard Photos</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: system-ui, sans-serif; background: #111; color: #eee; padding: 24px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.4rem; margin-bottom: 20px; }
    .upload-area { background: #1e1e1e; border: 2px dashed #444; border-radius: 10px; padding: 24px; margin-bottom: 28px; }
    .upload-area label { display: block; margin-bottom: 10px; font-size: 0.9rem; color: #aaa; }
    input[type=file] { display: block; margin-bottom: 14px; color: #eee; }
    button.upload-btn { background: #2563eb; color: #fff; border: none; border-radius: 6px; padding: 9px 20px; font-size: 0.95rem; cursor: pointer; }
    button.upload-btn:disabled { opacity: 0.5; cursor: default; }
    #status { margin-top: 10px; font-size: 0.88rem; min-height: 20px; }
    #status.ok { color: #4ade80; }
    #status.err { color: #f87171; }
    ul { list-style: none; display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; }
    .photo-row { background: #1a1a1a; border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
    .photo-row img { width: 100%; aspect-ratio: 16/9; object-fit: cover; display: block; }
    .photo-row .name { font-size: 0.78rem; color: #aaa; padding: 8px 10px 4px; word-break: break-all; flex: 1; }
    .photo-row button { margin: 0 10px 10px; background: #7f1d1d; color: #fca5a5; border: none; border-radius: 6px; padding: 6px 12px; font-size: 0.82rem; cursor: pointer; }
    .photo-row button:hover { background: #991b1b; }
    .empty { color: #666; font-style: italic; padding: 20px 0; }
    #progress { background: #2563eb; height: 4px; border-radius: 2px; width: 0; transition: width 0.2s; margin-top: 8px; }
  </style>
</head>
<body>
  <h1>📷 Background Photos</h1>

  <div class="upload-area">
    <label>Add photos (JPG, PNG, WEBP, GIF, AVIF — max 25 MB each)</label>
    <input type="file" id="files" multiple accept="image/*">
    <button class="upload-btn" onclick="doUpload()">Upload</button>
    <div id="progress"></div>
    <div id="status"></div>
  </div>

  <ul id="list">${rows || '<li class="empty">No photos yet.</li>'}</ul>

  <script>
    async function doUpload() {
      const input = document.getElementById('files');
      const btn = document.querySelector('.upload-btn');
      const status = document.getElementById('status');
      const progress = document.getElementById('progress');
      if (!input.files.length) { setStatus('Choose at least one file.', 'err'); return; }
      btn.disabled = true;
      setStatus('Uploading…', '');
      const fd = new FormData();
      for (const f of input.files) fd.append('photos', f);
      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) progress.style.width = (e.loaded / e.total * 100) + '%';
      };
      xhr.onload = () => {
        progress.style.width = '100%';
        setTimeout(() => { progress.style.width = '0'; }, 600);
        btn.disabled = false;
        input.value = '';
        if (xhr.status === 200) {
          const { added, skipped } = JSON.parse(xhr.responseText);
          setStatus('Added ' + added.length + ' photo(s)' + (skipped.length ? ', skipped ' + skipped.length + ' (wrong type).' : '.'), 'ok');
          added.forEach(insertRow);
        } else {
          setStatus('Upload failed: ' + xhr.statusText, 'err');
        }
      };
      xhr.onerror = () => { btn.disabled = false; setStatus('Network error.', 'err'); };
      xhr.open('POST', '/admin/photos/upload');
      xhr.send(fd);
    }

    document.getElementById('list').addEventListener('click', e => {
      const btn = e.target.closest('.del-btn');
      if (btn) del(btn.dataset.name);
    });

    async function del(name) {
      if (!confirm('Delete ' + name + '?')) return;
      const enc = encodeURIComponent(name);
      const r = await fetch('/admin/photos/' + enc, { method: 'DELETE' });
      if (r.ok) {
        const row = document.getElementById('row-' + enc);
        if (row) row.remove();
        if (!document.querySelector('#list li:not(.empty)')) {
          const empty = document.createElement('li');
          empty.className = 'empty';
          empty.textContent = 'No photos yet.';
          document.getElementById('list').appendChild(empty);
        }
      } else {
        alert('Delete failed.');
      }
    }

    function insertRow(name) {
      const list = document.getElementById('list');
      const empty = list.querySelector('.empty');
      if (empty) empty.remove();
      const enc = encodeURIComponent(name);

      const li = document.createElement('li');
      li.className = 'photo-row';
      li.id = 'row-' + enc;

      const img = document.createElement('img');
      img.src = '/photos/' + enc;
      img.alt = name;
      img.loading = 'lazy';

      const span = document.createElement('span');
      span.className = 'name';
      span.textContent = name;

      const btn = document.createElement('button');
      btn.className = 'del-btn';
      btn.dataset.name = name;
      btn.title = 'Delete';
      btn.textContent = '\\u2715 Delete';

      li.append(img, span, btn);
      list.appendChild(li);
    }

    function setStatus(msg, cls) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = cls;
    }
  </script>
</body>
</html>`);
});

router.post("/admin/photos/upload", basicAuth, upload.array("photos", 50), async (req, res) => {
  const added = [];
  const skipped = [];
  for (const f of req.files || []) {
    if (await hasImageMagic(f.path)) {
      added.push(f.filename);
    } else {
      skipped.push(f.filename);
      try { await unlink(f.path); } catch { /* best-effort cleanup */ }
    }
  }
  res.json({ added, skipped });
});

router.delete("/admin/photos/:filename", basicAuth, async (req, res) => {
  const filepath = safePath(req.params.filename);
  if (!filepath) { res.status(400).json({ error: "Invalid filename" }); return; }
  try {
    await unlink(filepath);
    res.json({ ok: true });
  } catch (err) {
    if (err.code === "ENOENT") { res.status(404).json({ error: "Not found" }); return; }
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
