"""Camera presence: is a PERSON in the living room, from the webcam on the G11.

A third presence source beside the kitchen motion sensor and the mic
(src/v3/core/presence.js). Owner's rules, 2026-09-26:
  - people only: Benji and Teddy, the ceiling fan, the plants and the light
    moving across the hallway must never count;
  - the TV is masked: a person ON the TV is not a person in the room;
  - the camera streams 07:00-22:00 only. The Brio 100's light is lit whenever
    it streams and no software control turns it off (its UVC controls and
    vendor extension units were enumerated 2026-09-26: no LED control), so
    overnight the camera is simply closed and presence stays with the mic.

PRIVACY. Frames exist only in this process's memory, one at a time, and are
dropped as soon as they are scored. Nothing is written to disk, nothing is
served, and what leaves the process is a boolean, a score and a count, POSTed
over loopback. There is no "save a frame" option, on purpose.

HOW. ffmpeg decodes the camera's MJPEG, drops to DETECT_FPS and scales the
640x360 frame into the top of a 416x416 canvas padded grey (YOLOX's own
letterbox), handing raw BGR bytes over a pipe. YOLOX-Nano (Apache-2.0,
~3.6 MB, CPU) scores COCO class 0, person. A detection counts when its score
clears MIN_SCORE, its box is at least MIN_HEIGHT of the frame tall (the
framed photos on the shelf hold people too), and its centre is outside every
MASK rectangle.

  .venv/bin/python camera_presence.py            # the service
  .venv/bin/python camera_presence.py --probe 30 # 30 s: print each frame's
                                                 # people + timing, post nothing
"""
import datetime
import json
import os
import subprocess
import sys
import time
import urllib.request

import numpy as np
import onnxruntime as ort

HERE = os.path.expanduser("~/camera-presence")
MODEL = os.environ.get("CAMERA_MODEL", os.path.join(HERE, "yolox_nano.onnx"))
DEVICE = os.environ.get("CAMERA_DEVICE", "/dev/video0")
POST_URL = os.environ.get("CAMERA_POST_URL", "http://127.0.0.1:3000/api/voice/camera")
DETECT_FPS = float(os.environ.get("CAMERA_DETECT_FPS", "1"))
HOURS = os.environ.get("CAMERA_HOURS", "07-22")        # streams from..to (local, to exclusive)
MIN_SCORE = float(os.environ.get("CAMERA_MIN_SCORE", "0.45"))
MIN_HEIGHT = float(os.environ.get("CAMERA_MIN_HEIGHT", "0.12"))
# Normalised [x0, y0, x1, y1] of the CAMERA frame. Default: the TV (measured on
# one frame, 2026-09-26: 750-955 x 425-570 of 1280x720, plus a margin).
MASKS = json.loads(os.environ.get("CAMERA_MASKS", "[[0.57, 0.56, 0.76, 0.81]]"))

SIZE = 416
SRC_W, SRC_H = 640, 360
CONTENT_H = round(SRC_H * SIZE / SRC_W)                  # 234: the frame's rows in the canvas
FRAME_BYTES = SIZE * SIZE * 3


def in_hours(now=None):
    now = now or datetime.datetime.now()
    a, b = (int(x) for x in HOURS.split("-"))
    return a <= now.hour < b if a < b else (now.hour >= a or now.hour < b)


def grids():
    """YOLOX decodes each output row against its cell on one of three strides."""
    g, s = [], []
    for stride in (8, 16, 32):
        n = SIZE // stride
        yv, xv = np.meshgrid(np.arange(n), np.arange(n), indexing="ij")
        g.append(np.stack((xv, yv), 2).reshape(-1, 2))
        s.append(np.full((n * n, 1), stride))
    return np.concatenate(g, 0).astype(np.float32), np.concatenate(s, 0).astype(np.float32)


GRID, STRIDES = grids()


def people(session, frame):
    """Person boxes in CAMERA-normalised coordinates: [(score, x0, y0, x1, y1)]."""
    img = np.frombuffer(frame, np.uint8).reshape(SIZE, SIZE, 3)
    blob = img.transpose(2, 0, 1)[None].astype(np.float32)          # BGR, 0-255, as YOLOX trains
    out = session.run(None, {"images": blob})[0][0]
    xy = (out[:, :2] + GRID) * STRIDES
    wh = np.exp(out[:, 2:4]) * STRIDES
    score = out[:, 4] * out[:, 5]                                    # objectness x P(person)
    keep = score >= MIN_SCORE
    found = []
    for (cx, cy), (w, h), sc in zip(xy[keep], wh[keep], score[keep]):
        x0, x1 = (cx - w / 2) / SIZE, (cx + w / 2) / SIZE
        y0, y1 = (cy - h / 2) / CONTENT_H, (cy + h / 2) / CONTENT_H
        found.append((float(sc), x0, y0, x1, y1))
    return nms(found)


def nms(boxes, iou=0.45):
    boxes = sorted(boxes, reverse=True)
    kept = []
    for b in boxes:
        if all(overlap(b, k) < iou for k in kept):
            kept.append(b)
    return kept


def overlap(a, b):
    ix = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    iy = max(0, min(a[4], b[4]) - max(a[2], b[2]))
    inter = ix * iy
    union = (a[3] - a[1]) * (a[4] - a[2]) + (b[3] - b[1]) * (b[4] - b[2]) - inter
    return inter / union if union > 0 else 0


def counts(box):
    """A detection that means someone is in the room."""
    sc, x0, y0, x1, y1 = box
    if y1 - y0 < MIN_HEIGHT:
        return False
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    return not any(m[0] <= cx <= m[2] and m[1] <= cy <= m[3] for m in MASKS)


def open_camera():
    return subprocess.Popen([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin",
        "-f", "v4l2", "-input_format", "mjpeg", "-video_size", f"{SRC_W}x{SRC_H}", "-framerate", "5",
        "-i", DEVICE,
        "-vf", f"fps={DETECT_FPS},scale={SIZE}:{CONTENT_H},pad={SIZE}:{SIZE}:0:0:color=0x727272",
        "-pix_fmt", "bgr24", "-f", "rawvideo", "-"
    ], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=FRAME_BYTES)


def close_camera(proc):
    """Release the camera — and with it the light. Close OUR end of the pipe
    first: a terminated ffmpeg flushes to stdout, and with nobody reading, a full
    pipe blocked it for ever (found by --probe, 2026-09-26). Here that path is
    22:00, so a hang would have left the camera open and lit all night."""
    try:
        proc.stdout.close()
    except Exception:
        pass
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()


def read_frame(proc):
    buf = bytearray()
    while len(buf) < FRAME_BYTES:
        chunk = proc.stdout.read(FRAME_BYTES - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def post(payload):
    req = urllib.request.Request(POST_URL, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        urllib.request.urlopen(req, timeout=2).read()
        return True
    except Exception:
        return False


def score_image(session, path):
    """Positive control: one still through the SAME scale-and-pad path as the
    camera (fit inside 416, top-left, grey pad). Proves the decode — an empty
    room finds nobody whether the grid maths is right or wrong."""
    frame = subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
        "-vf", f"scale={SIZE}:{SIZE}:force_original_aspect_ratio=decrease,pad={SIZE}:{SIZE}:0:0:color=0x727272",
        "-frames:v", "1", "-pix_fmt", "bgr24", "-f", "rawvideo", "-"
    ], capture_output=True, check=True).stdout
    found = people(session, frame)
    print(json.dumps({"people": len(found), "scores": [round(b[0], 2) for b in found]}))


def selftest():
    """The rules that decide what counts, without the model or the camera.
    Each case names the wrong answer it would catch."""
    tv = MASKS[0]
    cx, cy = (tv[0] + tv[2]) / 2, (tv[1] + tv[3]) / 2
    cases = [
        ("a person on the TV is not in the room", counts((0.9, cx - 0.05, cy - 0.15, cx + 0.05, cy + 0.15)), False),
        ("a person beside the TV is", counts((0.9, 0.2, 0.3, 0.3, 0.7)), True),
        ("a face in a shelf photo is too small", counts((0.9, 0.52, 0.50, 0.54, 0.55)), False),
        ("just tall enough counts", counts((0.9, 0.2, 0.3, 0.3, 0.3 + MIN_HEIGHT)), True),
        ("07:00 streams", in_hours(datetime.datetime(2026, 9, 26, 7, 0)), True),
        ("21:59 streams", in_hours(datetime.datetime(2026, 9, 26, 21, 59)), True),
        ("22:00 is closed (the light goes out)", in_hours(datetime.datetime(2026, 9, 26, 22, 0)), False),
        ("06:59 is closed", in_hours(datetime.datetime(2026, 9, 26, 6, 59)), False),
        ("the decode grid covers every output row", len(GRID) == 3549, True),
    ]
    bad = [name for name, got, want in cases if got != want]
    for name, got, want in cases:
        print(f"{'ok  ' if got == want else 'FAIL'} {name}")
    return 1 if bad else 0


def main():
    if len(sys.argv) >= 2 and sys.argv[1] == "--selftest":
        sys.exit(selftest())
    if len(sys.argv) >= 3 and sys.argv[1] == "--image":
        score_image(ort.InferenceSession(MODEL, providers=["CPUExecutionProvider"]), sys.argv[2])
        return
    probe = None
    if len(sys.argv) >= 3 and sys.argv[1] == "--probe":
        probe = float(sys.argv[2])
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1                       # one core, never the box
    opts.inter_op_num_threads = 1
    session = ort.InferenceSession(MODEL, opts, providers=["CPUExecutionProvider"])
    print(f"[camera-presence] model {os.path.basename(MODEL)}, {DETECT_FPS} fps, hours {HOURS}, masks {MASKS}", flush=True)

    proc = None
    warned_post = False
    t_start = time.time()
    while True:
        if probe is not None and time.time() - t_start > probe:
            break
        if probe is None and not in_hours():
            if proc:
                close_camera(proc); proc = None
                print("[camera-presence] outside hours - camera closed", flush=True)
            time.sleep(30)
            continue
        if proc is None:
            proc = open_camera()
        frame = read_frame(proc)
        if frame is None:
            # Unplugged, or held by something else: back off, never spin.
            close_camera(proc); proc = None
            print("[camera-presence] no frames from the camera - retrying in 30 s", flush=True)
            time.sleep(30)
            continue
        t0 = time.perf_counter()
        found = people(session, frame)
        ms = (time.perf_counter() - t0) * 1000
        frame = None                                    # the only copy; gone
        real = [b for b in found if counts(b)]
        best = max((b[0] for b in real), default=0.0)
        if probe is not None:
            desc = ", ".join(f"{b[0]:.2f}@({(b[1]+b[3])/2:.2f},{(b[2]+b[4])/2:.2f}) h{b[4]-b[2]:.2f}{'' if counts(b) else ' [ignored]'}" for b in found)
            print(f"{time.strftime('%H:%M:%S')} infer {ms:5.1f} ms  people {len(real)}  {desc}", flush=True)
            continue
        ok = post({"person": bool(real), "count": len(real), "score": round(best, 3)})
        if not ok and not warned_post:
            warned_post = True
            print(f"[camera-presence] cannot reach {POST_URL} - will keep trying quietly", flush=True)
        elif ok:
            warned_post = False
    if proc:
        close_camera(proc)


if __name__ == "__main__":
    main()
