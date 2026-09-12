// The /admin/photos page's script. Served by server/routes/admin.js at
// /admin/photos.js, behind the same Basic auth as the page itself.
//
// ⚠ It lives in its own file because an enforcing CSP (`script-src 'self'`)
// blocks inline <script> blocks and onclick="" attributes, and until 2026-09-13
// this page had both. That was the audit's S1 blocker. Keep every handler bound
// with addEventListener; an on*="" attribute in the page HTML fails
// tests/csp-report.spec.js.

const input = document.getElementById("files");
const uploadBtn = document.getElementById("upload-btn");
const statusEl = document.getElementById("status");
const progress = document.getElementById("progress");
const list = document.getElementById("list");

function setStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = cls;
}

function insertRow(name) {
  const empty = list.querySelector(".empty");
  if (empty) empty.remove();
  const enc = encodeURIComponent(name);

  const li = document.createElement("li");
  li.className = "photo-row";
  li.id = "row-" + enc;

  const img = document.createElement("img");
  img.src = "/photos/" + enc;
  img.alt = name;
  img.loading = "lazy";

  const span = document.createElement("span");
  span.className = "name";
  span.textContent = name;

  const btn = document.createElement("button");
  btn.className = "del-btn";
  btn.dataset.name = name;
  btn.title = "Delete";
  btn.textContent = "✕ Delete";

  li.append(img, span, btn);
  list.appendChild(li);
}

function doUpload() {
  if (!input.files.length) { setStatus("Choose at least one file.", "err"); return; }
  uploadBtn.disabled = true;
  setStatus("Uploading…", "");
  const fd = new FormData();
  for (const f of input.files) fd.append("photos", f);
  const xhr = new XMLHttpRequest();
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) progress.style.width = (e.loaded / e.total * 100) + "%";
  };
  xhr.onload = () => {
    progress.style.width = "100%";
    setTimeout(() => { progress.style.width = "0"; }, 600);
    uploadBtn.disabled = false;
    input.value = "";
    if (xhr.status === 200) {
      const { added, skipped } = JSON.parse(xhr.responseText);
      setStatus("Added " + added.length + " photo(s)" + (skipped.length ? ", skipped " + skipped.length + " (wrong type)." : "."), "ok");
      added.forEach(insertRow);
    } else {
      setStatus("Upload failed: " + xhr.statusText, "err");
    }
  };
  xhr.onerror = () => { uploadBtn.disabled = false; setStatus("Network error.", "err"); };
  xhr.open("POST", "/admin/photos/upload");
  xhr.send(fd);
}

async function del(name) {
  if (!confirm("Delete " + name + "?")) return;
  const enc = encodeURIComponent(name);
  const r = await fetch("/admin/photos/" + enc, { method: "DELETE" });
  if (r.ok) {
    const row = document.getElementById("row-" + enc);
    if (row) row.remove();
    if (!document.querySelector("#list li:not(.empty)")) {
      const empty = document.createElement("li");
      empty.className = "empty";
      empty.textContent = "No photos yet.";
      list.appendChild(empty);
    }
  } else {
    alert("Delete failed.");
  }
}

uploadBtn.addEventListener("click", doUpload);
list.addEventListener("click", (e) => {
  const btn = e.target.closest(".del-btn");
  if (btn) del(btn.dataset.name);
});
