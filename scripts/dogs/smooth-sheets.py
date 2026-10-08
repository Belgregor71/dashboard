"""Smooth dog sheets: in-between frames for every look, by frame interpolation.

A look is 12 drawn frames (a run cycle 16), held 100-420 ms each - 3 to 8
frames a second, which reads as jerky. This writes a second sheet per look with
two interpolated frames in every gap that survives it, and
src/v3/core/dog-sheets-smooth.js, which dog-occasion.js plays instead of the
drawn sheet when features.v3DogSmooth is on. The drawn sheets, dog-sheets.js
and the windows in dog-occasion.js are never touched: this is additive.

Usage:
  python scripts/dogs/smooth-sheets.py <rife_dir>
      <rife_dir> holds rife-ncnn-vulkan.exe and its rife-v4.6 model folder
      (github.com/nihui/rife-ncnn-vulkan, release 20221029; Vulkan, so it runs
      on an AMD card). About 15 s a sheet. Regenerates EVERY look.

Method:
  * Frames are cut the way the wall places them. Re-packed sheets (everything
    but Christmas) are cut on their clean grid. Christmas's are lifted by the
    measured windows in dog-occasion.js - peek frames base-down with the cell
    centre kept, run frames on their centroid - because on the raw grid each
    frame sits at a different height with a neighbour's paws in it, and the
    model interpolates both.
  * Transparency is two passes. COLOUR: straight RGB with every transparent
    pixel filled from its nearest solid one, so there is fur colour wherever
    the shape ends up. ALPHA: the alpha plane as a grey image, which alone
    decides the shape. (Colour premultiplied on black left an opaque black cap
    where black fur met the black backdrop; two coloured backdrops with their
    channels mixed misregistered the whole face, because two passes do not
    find the same motion.)
  * HARD CUTS. A gap whose in-betweens smear - a head turning to profile, a
    paw or a prop appearing from nowhere, a hat changing shape - keeps no
    in-betweens at all and plays exactly as drawn. Which gaps is a judgement
    made BY EYE from contact sheets (owner approved the result 2026-10-08) and
    recorded in smooth-cuts.json, 1-based. Two automatic scores were tried
    (detail lost against the drawn frames; likeness to a plain blend) and
    neither separated a smeared gap from a clean one. Re-judge when art changes.
  * Each written sheet is measured from the DECODED WebP: every frame's own
    bounding box (alpha > 24), base and right exclusive - the convention
    dog-sheets.js uses. An empty frame is an error, never a zero-size window.
"""
import io
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image
from scipy.ndimage import distance_transform_edt

REPO = Path(__file__).resolve().parents[2]
ALPHA = 24
BETWEEN = 2          # in-betweens per surviving gap
COLUMNS = 6          # of the written sheet; rows follow from the frame count
MODEL = "rife-v4.6"
OUT_DIR = REPO / "static/assets/dogs/smooth"
OUT_JS = REPO / "src/v3/core/dog-sheets-smooth.js"
CUTS = json.loads((Path(__file__).parent / "smooth-cuts.json").read_text(encoding="utf-8"))

occasion_js = (REPO / "src/v3/core/dog-occasion.js").read_text(encoding="utf-8")
AIR = int(re.search(r"const AIR = (\d+)", occasion_js).group(1))

# Christmas's hand-measured windows, read from the module that owns them.
WINDOWS = {}
for m in re.finditer(r'src:\s*"/assets/dogs/christmas/([\w.-]+)"(.*?)windows\(\{(.*?)\}', occasion_js, re.S):
    WINDOWS[m.group(1)] = {
        k: [float(n) for n in re.findall(r"-?\d+(?:\.\d+)?", re.sub(r"//[^\n]*", "", v))]
        for k, v in re.findall(r"(\w+):\s*\[(.*?)\]", m.group(3), re.S)
    }
if len(WINDOWS) != 8:
    raise SystemExit(f"expected 8 Christmas windows in dog-occasion.js, found {sorted(WINDOWS)}")


def as_float(img):
    return np.asarray(img, dtype=np.float32) / 255.0


def cut_grid(sheet, cols, rows):
    w, h = sheet.width // cols, sheet.height // rows
    if (w * cols, h * rows) != sheet.size:
        raise SystemExit(f"sheet {sheet.size} is not a whole {cols}x{rows} grid and has no windows")
    return [as_float(sheet.crop((c * w, r * h, (c + 1) * w, (r + 1) * h))) for r in range(rows) for c in range(cols)], w, h, None


def cut_windows(sheet, cols, rows, win, mode):
    cell_w, cell_h = sheet.width / cols, sheet.height / rows
    n = cols * rows
    left = [win["left"][i] - AIR for i in range(n)]
    right = [win["right"][i] + AIR for i in range(n)]
    top = [win["top"][i] - AIR for i in range(n)]
    base = [win["base"][i] + (AIR if mode == "run" else 0) for i in range(n)]
    if mode == "run":
        cx, cy = win["cx"], win["cy"]
        ax = math.ceil(max(cx[i] - left[i] for i in range(n)))
        ay = math.ceil(max(cy[i] - top[i] for i in range(n)))
        w = ax + math.ceil(max(right[i] - cx[i] for i in range(n)))
        h = ay + math.ceil(max(base[i] - cy[i] for i in range(n)))
        at = [(round(ax - (cx[i] - left[i])), round(ay - (cy[i] - top[i]))) for i in range(n)]
        centroid = (ax, ay)
    else:
        # The drawn cell stays centred, so the dog stands where it always has;
        # and one cell tall when every frame fits, so it is drawn the same size.
        pad = math.ceil(max(0, -min(left), max(right) - cell_w))
        w = round(cell_w) + 2 * pad
        h = max(round(cell_h), math.ceil(max(base[i] - top[i] for i in range(n))))
        at = [(pad + round(left[i]), h - round(base[i] - top[i])) for i in range(n)]
        centroid = None
    cells = []
    for i in range(n):
        ox, oy = (i % cols) * cell_w, (i // cols) * cell_h
        piece = sheet.crop((round(ox + left[i]), round(oy + top[i]), round(ox + right[i]), round(oy + base[i])))
        cell = Image.new("RGBA", (w, h))
        cell.paste(piece, at[i])
        cells.append(as_float(cell))
    return cells, w, h, centroid


def bled(f):
    solid = f[..., 3] > 0.5
    idx = distance_transform_edt(~solid, return_distances=False, return_indices=True)
    return np.where(f[..., 3:4] > 0.5, f[..., :3], f[..., :3][idx[0], idx[1]])


def grey(f):
    return np.repeat(f[..., 3:4], 3, axis=2)


def save_rgb(arr, path):
    Image.fromarray((np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)).save(path)


def interpolate(seq, exe, model, work):
    """Every frame of `seq` plus BETWEEN in-betweens per gap, in one process.
    The tool's frame -> time mapping is CHECKED against the drawn frames: a
    build that maps them differently would hand back shifted in-betweens."""
    step = BETWEEN + 1
    src, dst = work / "in", work / "out"
    for d in (src, dst):
        shutil.rmtree(d, ignore_errors=True)
        d.mkdir(parents=True)
    for i, f in enumerate(seq):
        save_rgb(f, src / f"{i:08d}.png")
    r = subprocess.run([str(exe), "-i", str(src), "-o", str(dst), "-n", str(len(seq) * step), "-m", str(model),
                        "-f", "%08d.png"], capture_output=True, text=True)
    outs = sorted(dst.glob("*.png"))
    if r.returncode != 0 or len(outs) != len(seq) * step:
        raise SystemExit(f"rife failed ({r.returncode}, {len(outs)} frames): {r.stderr[-300:]}")
    frames = [as_float(Image.open(p).convert("RGB")) for p in outs[: (len(seq) - 1) * step + 1]]
    for k, key in enumerate(seq):
        if np.abs(frames[k * step] - key).mean() > 0.02:
            raise SystemExit(f"rife output {k * step} is not drawn frame {k}: unexpected frame timing")
    if np.abs(frames[1] - seq[0]).mean() < 1e-4:
        raise SystemExit("rife returned a drawn frame where an in-between was asked for")
    return frames


def to_webp(img):
    """The format measure-sheets.py ships: lossy RGB q90, LOSSLESS alpha - asserted."""
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=90, alpha_quality=100, method=6)
    back = Image.open(io.BytesIO(buf.getvalue())).convert("RGBA")
    a0, a1 = np.asarray(img)[..., 3], np.asarray(back)[..., 3]
    if (a0 != a1).any():
        raise SystemExit(f"alpha NOT lossless: {int((a0 != a1).sum())} px differ")
    return buf.getvalue(), back


def smooth(path, exe, model, work):
    occasion, stem = path.parent.name, path.stem
    mode = "run" if "_run_" in stem else "peek"
    cols, rows = (4, 4) if mode == "run" else (4, 3)
    if stem not in CUTS:
        raise SystemExit(f"{stem}: not in smooth-cuts.json - judge its gaps before shipping it")
    sheet = Image.open(path).convert("RGBA")
    win = WINDOWS.get(path.name)
    keys, w, h, centroid = cut_windows(sheet, cols, rows, win, mode) if win else cut_grid(sheet, cols, rows)
    loop = mode == "run"
    seq = keys + [keys[0]] if loop else keys
    gaps = len(seq) - 1
    cuts = set(CUTS[stem])
    if not cuts <= set(range(1, gaps + 1)):
        raise SystemExit(f"{stem}: smooth-cuts.json names a gap it does not have: {sorted(cuts)}")

    colour = interpolate([bled(f) for f in seq], exe, model, work)
    alpha = interpolate([grey(f) for f in seq], exe, model, work)

    step = BETWEEN + 1
    frames, between = [], []
    for g in range(gaps):
        frames.append(keys[g])
        if g + 1 in cuts:
            between.append(0)
            continue
        between.append(BETWEEN)
        for j in range(1, step):
            a = alpha[g * step + j].mean(axis=-1, keepdims=True)
            a = np.clip((a - 0.02) / 0.96, 0, 1)     # the model leaves a little noise in flat areas
            frames.append(np.concatenate([np.clip(colour[g * step + j], 0, 1), a], axis=-1))
    if not loop:
        frames.append(keys[-1])

    grid_rows = math.ceil(len(frames) / COLUMNS)
    out = Image.new("RGBA", (COLUMNS * w, grid_rows * h))
    for i, f in enumerate(frames):
        px = (np.clip(f, 0, 1) * 255 + 0.5).astype(np.uint8)
        px[px[..., 3] == 0] = 0                      # nothing to compress under a clear pixel
        out.paste(Image.fromarray(px, "RGBA"), ((i % COLUMNS) * w, (i // COLUMNS) * h))
    data, decoded = to_webp(out)
    dst = OUT_DIR / occasion / f"{stem}.webp"
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(data)

    mask = np.asarray(decoded)[..., 3] > ALPHA
    box = {"top": [], "base": [], "left": [], "right": []}
    for i in range(len(frames)):
        x, y = (i % COLUMNS) * w, (i // COLUMNS) * h
        own = mask[y:y + h, x:x + w]
        ys, xs = np.where(own.any(axis=1))[0], np.where(own.any(axis=0))[0]
        if not len(ys):
            raise SystemExit(f"{stem}: frame {i} is empty")
        box["top"].append(int(ys[0]))
        box["base"].append(int(ys[-1]) + 1)
        box["left"].append(int(xs[0]))
        box["right"].append(int(xs[-1]) + 1)
    look = {
        "of": f"/assets/dogs/{occasion}/{path.name}",
        "src": f"/assets/dogs/smooth/{occasion}/{stem}.webp",
        "columns": COLUMNS, "rows": grid_rows, "w": w, "h": h,
        "scale": h / (sheet.height / rows),
        "between": between, **box,
    }
    if centroid:
        look["cx"] = [centroid[0]] * len(frames)
        look["cy"] = [centroid[1]] * len(frames)
    print(f"{occasion}/{stem}: {len(frames)} frames, {len(cuts)} of {gaps} gaps cut, {len(data) / 1e6:.2f} MB", flush=True)
    return look


def emit(looks):
    num = lambda v: f"{v:.6g}" if isinstance(v, float) else str(v)
    arr = lambda xs: "[" + ", ".join(num(x) for x in xs) + "]"
    out = [
        "/* GENERATED by scripts/dogs/smooth-sheets.py - do not edit by hand.",
        "   One entry per drawn sheet, keyed by that sheet's src: the same look with",
        "   interpolated frames between the drawn ones. `between` is how many",
        "   in-betweens follow each drawn frame (0 = a hard cut, played as drawn;",
        "   a run's last entry closes the loop). Windows are raw own-pixel boxes in",
        "   cell-local px, base and right exclusive, one per frame of THIS sheet.",
        "   `scale` is this sheet's cell height over the drawn sheet's, so the dog",
        "   is the same size on the glass. Played only when features.v3DogSmooth",
        "   is on - see dog-occasion.js. */",
        "",
        "export const SMOOTH = {",
    ]
    for look in looks:
        out.append(f'  "{look["of"]}": {{')
        out.append(f'    src: "{look["src"]}",')
        out.append(f'    grid: {{ columns: {look["columns"]}, rows: {look["rows"]} }}, cell: {{ w: {look["w"]}, h: {look["h"]} }}, scale: {num(float(look["scale"]))},')
        out.append(f'    between: {arr(look["between"])},')
        keys = ["top", "base", "left", "right"] + (["cx", "cy"] if "cx" in look else [])
        for k in keys:
            out.append(f'    {k}: {arr(look[k])}{"," if k != keys[-1] else ""}')
        out.append("  },")
    out[-1] = "  }"
    out += ["};", ""]
    OUT_JS.write_bytes("\r\n".join(out).encode("utf-8"))


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    rife = Path(sys.argv[1])
    exe, model = rife / "rife-ncnn-vulkan.exe", rife / MODEL
    if not exe.exists() or not model.is_dir():
        raise SystemExit(f"no rife-ncnn-vulkan.exe + {MODEL}/ under {rife}")
    sheets = sorted(p for p in (REPO / "static/assets/dogs").glob("*/*") if p.suffix in (".webp", ".png"))
    missing = sorted(set(CUTS) - {p.stem for p in sheets})
    if missing:
        raise SystemExit(f"smooth-cuts.json names sheets that are not shipped: {missing}")
    shutil.rmtree(OUT_DIR, ignore_errors=True)
    with tempfile.TemporaryDirectory() as tmp:
        looks = [smooth(p, exe, model, Path(tmp)) for p in sheets]
    emit(looks)
    total = sum(f.stat().st_size for f in OUT_DIR.rglob("*.webp"))
    print(f"{len(looks)} looks, {total / 1e6:.1f} MB -> {OUT_DIR.relative_to(REPO)}, {OUT_JS.relative_to(REPO)}")


if __name__ == "__main__":
    main()
