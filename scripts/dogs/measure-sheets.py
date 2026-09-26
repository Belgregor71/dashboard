"""Measure dog sprite sheets: every frame's OWN-DOG window, per cell.

AI-drawn sheets do not respect their own grid (see src/v3/core/dog-occasion.js,
"Why each frame has a window"), so each frame is placed and clipped by the
bounding box of ITS OWN connected blob, not by the cell.

Method (the one the Christmas sheets were hand-verified with, 2026-09-25/26):
  * mask = alpha > 24; label 8-connected components over the WHOLE sheet
  * own blob of a cell = the label with the most pixels inside that cell
  * window = own blob's bbox in cell-local px (top, base = last row + 1,
    left, right = last col + 1)
  * foreign = mask px of any OTHER label inside the final window (AIR 2 on
    top/left/right, base exact) - must be ~0 (Christmas: <= 9)
  * merged = the own label also owns another cell (paws resting on the row
    below's hats). Such a sheet needs a hand cut; it is reported, never guessed.

Usage:
  python scripts/dogs/measure-sheets.py control
      positive control: re-measures christmas look 0 and diffs it against the
      hand-verified arrays in dog-occasion.js. Must print MATCH.
  python scripts/dogs/measure-sheets.py import <src_dir>
      RE-PACKS every sheet under <src_dir>: each frame is lifted out by its
      own pixels (own_masks - props kept, touching dogs split at their neck),
      scaled so the dog's full-up height matches its approved Christmas look 0,
      and laid base-down in a clean 460px-tall grid. Writes WebP (lossy RGB
      q90, LOSSLESS alpha - asserted) to static/assets/dogs/<occasion>/,
      measures the DECODED WebP (fails on any foreign px), and regenerates
      src/v3/core/dog-sheets.js. Always eyeball a contact sheet of any frame
      it reports as split.

The rectangle `measure()` above is kept for the positive control only: it is
how the hand-verified Christmas windows were made, and matching them proves the
edge conventions this file shares with dog-occasion.js.
"""
import io
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

REPO = Path(__file__).resolve().parents[2]
ALPHA = 24
AIR = 2
GRID = (4, 3)  # columns, rows - every peek sheet so far
FOREIGN_MAX = 9

# source folder name -> occasion id, published folder
FOLDERS = {
    "generic": ("generic", "generic"),
    "NYE": ("newYear", "new-year"),
    "australia day": ("australiaDay", "australia-day"),
    "Easter": ("easter", "easter"),
    "halloween": ("halloween", "halloween"),
    "Birthday": ("birthday", "birthday"),
}


def measure(rgba, grid=GRID):
    a = np.asarray(rgba)[..., 3]
    mask = a > ALPHA
    labels, _ = ndimage.label(mask, structure=np.ones((3, 3), int))
    H, W = mask.shape
    cols, rows = grid
    cw, ch = W / cols, H / rows
    owners = []
    for i in range(cols * rows):
        c, r = i % cols, i // cols
        x0, y0 = int(round(c * cw)), int(round(r * ch))
        x1, y1 = int(round((c + 1) * cw)), int(round((r + 1) * ch))
        cell = labels[y0:y1, x0:x1]
        ids, counts = np.unique(cell[cell > 0], return_counts=True)
        owners.append(int(ids[np.argmax(counts)]))
    out = {k: [] for k in ("top", "base", "left", "right", "foreign", "merged")}
    objs = ndimage.find_objects(labels)
    for i, own in enumerate(owners):
        c, r = i % cols, i // cols
        ox, oy = c * cw, r * ch
        sl = objs[own - 1]
        top, base = sl[0].start - oy, sl[0].stop - oy
        left, right = sl[1].start - ox, sl[1].stop - ox
        # the final window, AIR included, in sheet px
        wy0 = max(0, int(np.floor(oy + top - AIR)))
        wy1 = min(H, int(np.ceil(oy + base)))
        wx0 = max(0, int(np.floor(ox + left - AIR)))
        wx1 = min(W, int(np.ceil(ox + right + AIR)))
        win = labels[wy0:wy1, wx0:wx1]
        foreign = int(((win > 0) & (win != own)).sum())
        rnd = lambda v: int(v) if float(v).is_integer() else round(float(v), 1)
        out["top"].append(rnd(top))
        out["base"].append(rnd(base))
        out["left"].append(rnd(left))
        out["right"].append(rnd(right))
        out["foreign"].append(foreign)
        out["merged"].append(owners.count(own) > 1)
    return {"cell": {"w": cw, "h": ch}, **out}


def measure_packed(rgba, grid=GRID):
    """Windows on a RE-PACKED sheet: everything in a cell is that frame's
    (props included), so the window is the bbox of the cell's whole mask, and
    foreign = mask px of ANY other cell inside the final window (AIR included)."""
    mask = np.asarray(rgba)[..., 3] > ALPHA
    H, W = mask.shape
    cols, rows = grid
    cw, ch = W / cols, H / rows
    out = {k: [] for k in ("top", "base", "left", "right", "foreign", "merged")}
    for i in range(cols * rows):
        c, r = i % cols, i // cols
        x0, y0, x1, y1 = int(c * cw), int(r * ch), int((c + 1) * cw), int((r + 1) * ch)
        ys, xs = np.nonzero(mask[y0:y1, x0:x1])
        top, base, left, right = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        wy0, wx0 = max(0, y0 + top - AIR), max(0, x0 + left - AIR)
        wy1, wx1 = min(H, y0 + base), min(W, x0 + right + AIR)
        win = mask[wy0:wy1, wx0:wx1].copy()
        # blank this cell's own area; whatever is left is someone else's
        oy0, ox0 = max(y0, wy0) - wy0, max(x0, wx0) - wx0
        win[oy0:min(y1, wy1) - wy0, ox0:min(x1, wx1) - wx0] = False
        for k, v in (("top", top), ("base", base), ("left", left), ("right", right)):
            out[k].append(int(v))
        out["foreign"].append(int(win.sum()))
        out["merged"].append(False)
    return {"cell": {"w": cw, "h": ch}, **out}


def control():
    """Christmas look 0 - hand-verified arrays from dog-occasion.js."""
    want = {
        "benji": dict(top=[133, 97, 17, 28, -4, -7, -13, -10, -25, -20, -18, -24],
                      base=[331, 335, 337, 338, 327, 324, 332, 333, 334, 334, 334, 335],
                      left=[9, 11, 6, 21, 15, 13, 18, 17, 13, 10, 9, 16],
                      right=[358, 346, 346, 359, 358, 354, 346, 353, 354, 352, 353, 351]),
        "teddy": dict(top=[194, 114, 35, 45, 11, 14, 10, 4, -14, -14, -26, -28],
                      base=[346, 356, 357, 356, 326, 326, 326, 326, 304, 307, 304, 306],
                      left=[32, 25, 21, 20, 32, 30, 24, 20, 30, 27, 16, 19],
                      right=[367, 352, 352, 346, 390, 373, 360, 345, 376, 375, 358, 348]),
    }
    ok = True
    for dog, w in want.items():
        src = REPO / f"static/assets/dogs/christmas/{dog}_christmas_santa.png"
        got = measure(Image.open(src).convert("RGBA"))
        for k, v in w.items():
            if got[k] != v:
                ok = False
                print(f"DIFF {dog}.{k}\n  want {v}\n  got  {got[k]}")
        print(f"{dog}: foreign {got['foreign']} merged {sum(got['merged'])}")
    print("MATCH" if ok else "MISMATCH")
    return 0 if ok else 1


def to_webp(img):
    buf = io.BytesIO()
    img.save(buf, "WEBP", quality=90, alpha_quality=100, method=6)
    data = buf.getvalue()
    back = Image.open(io.BytesIO(data)).convert("RGBA")
    a0 = np.asarray(img)[..., 3]
    a1 = np.asarray(back)[..., 3]
    if not np.array_equal(a0, a1):
        raise SystemExit(f"alpha NOT lossless: {int((a0 != a1).sum())} px differ")
    return data, back


def look_name(stem, dog):
    # benji_easter_bunny_alt -> bunny ; teddy_halloween_popup_basic -> basic
    parts = stem.split("_")[2:]
    parts = [p for p in parts if p not in ("alt", "popup", "sprite")]
    return "-".join(parts) or "basic"


SPECK = 30          # components smaller than this (alpha > 24) are matte noise
CORE = 40           # px in from a cell's edges: a merged blob is split between cores
FEATHER = 2         # own mask grown by this to keep the soft alpha edge
CELL_H = 460        # every re-packed cell is this tall (1 px = 1 Christmas px;
                    # the runtime scales the box by CELL_H / 362 - `cellScale`)
CHRISTMAS_CELL = 362
FULL_UP_PCT = 75    # "full up" height = this percentile of a sheet's frame heights


def geodesic_split(comp, seeds):
    """Grow every seed one px at a time THROUGH the component only, so a pixel
    goes to the dog it is attached to, not the nearest one as the crow flies
    (a straight nearest-core split handed an ear tip to the neighbour).
    Returns seeds with every component px labelled; ties go to the lower id."""
    ys, xs = np.nonzero(comp)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = comp[y0:y1, x0:x1]
    lab = seeds[y0:y1, x0:x1].copy()
    ring = np.ones((3, 3), bool)
    while True:
        free = c & (lab == 0)
        if not free.any():
            break
        grown = lab.copy()
        for s in np.unique(lab[lab > 0])[::-1]:
            reach = ndimage.binary_dilation(lab == s, structure=ring) & free
            grown[reach] = s
        if np.array_equal(grown, lab):
            break  # px unreachable from any seed (cannot happen: comp is connected)
        lab = grown
    out = seeds.copy()
    out[y0:y1, x0:x1] = lab
    return out


def neck_seeds(comp, claim, cell_of, max_k=40):
    """Erode a merged blob until it falls apart into one big body per claiming
    cell; those bodies are the seeds. Grown back through the blob, the cut then
    lands at the narrowest NECK between the dogs - where they actually touch -
    not on the grid line (cell-core seeds met at the line, handing the
    neighbour's fur to the wrong frame). None if no erosion separates them."""
    ys, xs = np.nonzero(comp)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    c = comp[y0:y1, x0:x1]
    cells = cell_of[y0:y1, x0:x1]
    eroded = c
    for k in range(1, max_k + 1):
        eroded = ndimage.binary_erosion(eroded, structure=np.ones((3, 3), bool))
        lab, n = ndimage.label(eroded, structure=np.ones((3, 3), int))
        if n < len(claim):
            continue
        sizes = ndimage.sum(eroded, lab, range(1, n + 1))
        bodies = {}
        for l in np.argsort(-sizes):
            part = lab == l + 1
            if sizes[l] < 2000:
                break
            cs, counts = np.unique(cells[part], return_counts=True)
            home = int(cs[np.argmax(counts)])
            if home in claim and home not in bodies:
                bodies[home] = part
        if len(bodies) == len(claim):
            seeds = np.zeros(comp.shape, int)
            sub = np.zeros(c.shape, int)
            for i, part in bodies.items():
                sub[part] = i + 1
            seeds[y0:y1, x0:x1] = sub
            return seeds
    return None


def own_masks(rgba, grid=GRID):
    """Pixel-exact own-dog masks, one per cell - no rectangles.

    Each component (alpha > 24) belongs to the cell holding most of its pixels,
    so a detached prop (tennis ball, confetti, kangaroo) stays with its dog and
    a neighbour's ear intruding over the line does not. A component that is
    the LARGEST in more than one cell is two dogs touching (paws resting on the
    row below's hats): its pixels are split to the nearest cell core. Returns
    (masks, merged_frames)."""
    a = np.asarray(rgba)[..., 3]
    mask = a > ALPHA
    labels, n = ndimage.label(mask, structure=np.ones((3, 3), int))
    H, W = mask.shape
    cols, rows = grid
    cw, ch = W / cols, H / rows
    cell_of = np.zeros((H, W), int)
    yy, xx = np.indices((H, W))
    cell_of = np.minimum((yy // ch).astype(int), rows - 1) * cols + np.minimum((xx // cw).astype(int), cols - 1)
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    # majority cell of every component
    home = {}
    for l in range(1, n + 1):
        if sizes[l - 1] < SPECK:
            continue
        cells, counts = np.unique(cell_of[labels == l], return_counts=True)
        home[l] = int(cells[np.argmax(counts)])
    # largest component per cell
    largest = []
    for i in range(cols * rows):
        ls, counts = np.unique(labels[(cell_of == i) & mask], return_counts=True)
        largest.append(int(ls[np.argmax(counts)]))
    owner = np.zeros((H, W), int) - 1
    for l, i in home.items():
        owner[labels == l] = i
    merged = set()
    for l in set(largest):
        claim = [i for i, x in enumerate(largest) if x == l]
        if len(claim) < 2:
            continue
        merged.update(claim)
        comp = labels == l
        seeds = neck_seeds(comp, claim, cell_of)
        if seeds is not None:
            owner[comp] = geodesic_split(comp, seeds)[comp] - 1
            continue
        # no neck found: fall back to cell cores (the split lands near the line)
        print(f"    no neck in a merged blob of cells {claim} - split at the cores")
        seeds = np.zeros((H, W), int)
        for i in claim:
            c, r = i % cols, i // cols
            y0, y1 = int(r * ch + CORE), int((r + 1) * ch - CORE)
            x0, x1 = int(c * cw + CORE), int((c + 1) * cw - CORE)
            core = np.zeros((H, W), bool)
            core[y0:y1, x0:x1] = True
            seeds[core & comp] = i + 1
        owner[comp] = geodesic_split(comp, seeds)[comp] - 1
    masks = []
    for i in range(cols * rows):
        own = owner == i
        others = (owner >= 0) & ~own
        grown = ndimage.binary_dilation(own, iterations=FEATHER) & ~others
        masks.append(grown)
    return masks, sorted(merged), (cw, ch)


def full_up_height(masks):
    hs = []
    for m in masks:
        ys = np.nonzero(m.any(axis=1))[0]
        hs.append(ys[-1] + 1 - ys[0])
    return float(np.percentile(hs, FULL_UP_PCT))


def christmas_targets():
    """Each dog's full-up height on its approved Christmas look 0, in px.
    Re-packed px ARE Christmas px - only the cell is taller."""
    out = {}
    for dog in ("benji", "teddy"):
        img = Image.open(REPO / f"static/assets/dogs/christmas/{dog}_christmas_santa.png").convert("RGBA")
        masks, _, _ = own_masks(img)
        out[dog] = full_up_height(masks)
    return out


def repack(img, masks, cell, scale, grid=GRID):
    """Lift each frame out by its own mask, scale it, and lay it in a clean
    grid: own base on the cell floor, horizontal offset from its old cell's
    centre kept (so the dog does not jump between frames)."""
    cols, rows = grid
    cw, ch = cell
    src = np.asarray(img).copy()
    crops = []
    reach = 0.0
    for i, m in enumerate(masks):
        c = i % cols
        ys, xs = np.nonzero(m)
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        piece = src[y0:y1, x0:x1].copy()
        piece[..., 3] = np.where(m[y0:y1, x0:x1], piece[..., 3], 0)
        centre = (c + 0.5) * cw
        crops.append((piece, (x0 - centre) * scale, (x1 - centre) * scale))
        reach = max(reach, abs((x0 - centre) * scale), abs((x1 - centre) * scale))
    W1 = int(np.ceil(2 * reach + 2 * (AIR + FEATHER)))
    W1 += W1 % 2
    tallest = max(p.shape[0] for p, _, _ in crops) * scale
    if tallest > CELL_H - AIR:
        raise SystemExit(f"a frame is {tallest:.0f}px tall after scaling - over the {CELL_H}px cell")
    out = Image.new("RGBA", (W1 * cols, CELL_H * rows), (0, 0, 0, 0))
    for i, (piece, left, _) in enumerate(crops):
        c, r = i % cols, i // cols
        p = Image.fromarray(piece, "RGBA")
        w = max(1, round(p.width * scale))
        h = max(1, round(p.height * scale))
        p = p.resize((w, h), Image.LANCZOS)
        x = round(c * W1 + W1 / 2 + left)
        y = (r + 1) * CELL_H - h
        out.alpha_composite(p, (x, y))
    return out


def do_import(src_dir):
    src_dir = Path(src_dir)
    targets = christmas_targets()
    print("full-up targets (px of a %d cell): %s" % (CELL_H, {k: round(v, 1) for k, v in targets.items()}))
    sheets = {}
    report = []
    for folder, (occ, pub) in FOLDERS.items():
        files = sorted((src_dir / folder).glob("*.png"))
        if not files:
            raise SystemExit(f"no sheets in {src_dir / folder}")
        dest = REPO / "static/assets/dogs" / pub
        dest.mkdir(parents=True, exist_ok=True)
        for old in dest.glob("*.webp"):
            old.unlink()
        for f in files:
            dog = f.stem.split("_")[0]
            name = look_name(f.stem, dog)
            raw = Image.open(f).convert("RGBA")
            masks, merged, cell = own_masks(raw)
            scale = targets[dog] / full_up_height(masks)
            img = repack(raw, masks, cell, scale)
            data, back = to_webp(img)
            out_name = f"{dog}_{pub}_{name}.webp"
            (dest / out_name).write_bytes(data)
            m = measure_packed(back)
            sheets.setdefault(occ, {}).setdefault(dog, []).append({
                "name": name,
                "src": f"/assets/dogs/{pub}/{out_name}",
                "size": [img.width, img.height],
                "split": merged,
                **m,
            })
            worst = max(m["foreign"])
            if worst > FOREIGN_MAX or any(m["merged"]):
                raise SystemExit(f"{out_name}: re-packed sheet still dirty - foreign {m['foreign']}")
            note = f"  split frames {merged} - LOOK AT THE CONTACT SHEET" if merged else ""
            report.append(f"{occ:13} {dog:6} {name:18} {raw.width}x{raw.height} -> {img.width}x{img.height} "
                          f"x{scale:.3f} {len(data)/1e6:4.2f}MB foreign max {worst}{note}")
    print("\n".join(report))
    emit(sheets)


def emit(sheets):
    lines = [
        "/* GENERATED by scripts/dogs/measure-sheets.py - do not edit by hand.",
        "   Re-run `python scripts/dogs/measure-sheets.py import <src_dir>` when",
        "   the art changes. Raw own-blob windows in cell-local px (base and right",
        "   exclusive) on RE-PACKED sheets - each frame lifted out by its own",
        "   pixels, so no window ever holds a neighbour and none needs a hand trim.",
        "   dog-occasion.js turns them into frame windows. */",
        "",
        "/* Re-packed cells are taller than Christmas's 362px but drawn at the same",
        "   px size, so a cell is this many Christmas cells tall on the glass. */",
        f"export const CELL_SCALE = {CELL_H} / {CHRISTMAS_CELL};",
        "",
        "export const SHEETS = {",
    ]
    for occ, dogs in sheets.items():
        lines.append(f"  {occ}: {{")
        for dog, looks in dogs.items():
            lines.append(f"    {dog}: [")
            for lk in looks:
                cw, ch = lk["cell"]["w"], lk["cell"]["h"]
                fmt = lambda v: json.dumps(v)
                lines.append(f"      {{ name: {json.dumps(lk['name'])}, src: {json.dumps(lk['src'])}, "
                             f"cell: {{ w: {cw:g}, h: {ch:g} }},")
                for k in ("top", "base", "left", "right"):
                    lines.append(f"        {k}: {fmt(lk[k])},")
                lines[-1] = lines[-1].rstrip(",")
                lines.append("      },")
            lines[-1] = lines[-1].rstrip(",")
            lines.append("    ],")
        lines[-1] = lines[-1].rstrip(",")
        lines.append("  },")
    lines[-1] = lines[-1].rstrip(",")
    lines.append("};")
    text = "\r\n".join(lines) + "\r\n"
    (REPO / "src/v3/core/dog-sheets.js").write_bytes(text.encode("utf-8"))


if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "control":
        sys.exit(control())
    if len(sys.argv) >= 3 and sys.argv[1] == "import":
        do_import(sys.argv[2])
        sys.exit(0)
    print(__doc__)
    sys.exit(2)
