#!/usr/bin/env python3
"""
Clipforge moment scan: find the moments worth clipping in a long recording.

Reads the file once at low resolution with FFmpeg (argument arrays, no shell):
  * video at 2 frames/second, 64x36 grayscale -> motion, scene changes,
    brightness flashes and letterbox bars (black bands = likely cutscene)
  * audio as 8 kHz mono -> loudness per step (shouting, crashes, explosions)

Scores each step with z-scores, keeps the strongest peaks at least 30 s apart,
and writes a ranked JSON list. The same scoring runs in the studio for files
dropped in the browser, so both places agree on what a "moment" is.

    python3 services/media/detect.py capture.mp4 --out capture.moments.json
"""
import argparse, json, shutil, subprocess, sys

import numpy as np

FW, FH, FPS, SR = 64, 36, 2.0, 8000


def ffmpeg():
    return shutil.which("ffmpeg") or "ffmpeg"


def probe_duration(path):
    p = subprocess.run([shutil.which("ffprobe") or "ffprobe", "-v", "error", "-show_entries", "format=duration",
                        "-of", "default=nw=1:nk=1", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        return float(p.stdout.decode().strip())
    except ValueError:
        raise SystemExit(f"can't read the duration of {path}: {p.stderr.decode()[:200]}")


def read_video(path):
    cmd = [ffmpeg(), "-v", "error", "-i", path, "-an", "-vf", f"fps={FPS},scale={FW}:{FH}:flags=area,format=gray",
           "-f", "rawvideo", "-"]
    raw = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True).stdout
    n = len(raw) // (FW * FH)
    return np.frombuffer(raw[: n * FW * FH], dtype=np.uint8).reshape(n, FH, FW).astype(np.float32)


def read_audio(path):
    cmd = [ffmpeg(), "-v", "error", "-i", path, "-vn", "-ac", "1", "-ar", str(SR), "-f", "s16le", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0 or not p.stdout:
        return None  # no audio track
    return np.frombuffer(p.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def zscore(a):
    a = np.asarray(a, dtype=np.float64)
    sd = a.std() or 1.0
    return (a - a.mean()) / sd


def scan(path, max_moments=8, min_gap=30.0, min_score=1.2):
    dur = probe_duration(path)
    frames = read_video(path)
    n = len(frames)
    if n < 2:
        return {"source": path, "duration": dur, "moments": [], "letterbox": [], "scanned": {"audio": False, "step": 1 / FPS}}
    step = 1.0 / FPS
    t = np.arange(n) * step

    flat = frames.reshape(n, -1)
    motion = np.concatenate([[0.0], np.abs(np.diff(flat, axis=0)).mean(axis=1)])
    hists = np.stack([np.histogram(f, bins=16, range=(0, 256))[0] for f in flat]).astype(np.float64)
    cut = np.concatenate([[0.0], np.abs(np.diff(hists, axis=0)).sum(axis=1) / (2 * flat.shape[1])])
    mean = flat.mean(axis=1)
    flash = np.concatenate([[0.0], np.maximum(0, np.diff(mean))])
    top = frames[:, :4, :].mean(axis=(1, 2))
    bot = frames[:, -4:, :].mean(axis=(1, 2))
    mid = frames[:, 4:-4, :].mean(axis=(1, 2))
    letter = (top < 14) & (bot < 14) & (mid > 26)

    audio = read_audio(path)
    if audio is not None and len(audio):
        win = int(SR * step)
        loud = np.array([np.sqrt(np.mean(audio[i * win:(i + 1) * win] ** 2)) if i * win < len(audio) else 0.0 for i in range(n)])
    else:
        loud = np.zeros(n)

    zm, zc, zl, zf = zscore(motion), zscore(cut), zscore(loud), zscore(flash)
    score = zm * 1.0 + zc * 0.5 + zl * 1.3 + zf * 0.6

    ranges = []
    for i in np.flatnonzero(letter):
        ti = float(t[i])
        if ranges and ti - ranges[-1][1] <= step * 1.5:
            ranges[-1][1] = ti + step
        else:
            ranges.append([ti, ti + step])
    ranges = [[round(a, 2), round(b, 2)] for a, b in ranges if b - a >= step * 2]

    picks = []
    for i in np.argsort(-score):
        if len(picks) >= max_moments or score[i] < min_score:
            break
        if any(abs(t[i] - t[j]) < min_gap for j in picks):
            continue
        picks.append(int(i))
    picks.sort()
    top_score = max([score[i] for i in picks] or [1.0])

    def why(i):
        w = [name for name, z, th in (("Loud spike", zl[i], 1.6), ("Big motion", zm[i], 1.6),
                                       ("Scene change", zc[i], 2.0), ("Flash", zf[i], 2.0)) if z > th]
        return w or ["Stands out from the rest"]

    moments = [{"t": round(float(t[i]), 2), "score": int(round(55 + 40 * score[i] / top_score)), "why": why(i),
                "cutscene": any(a - 1 <= t[i] <= b + 1 for a, b in ranges)} for i in picks]
    return {"source": path, "duration": round(dur, 3), "moments": moments, "letterbox": ranges,
            "scanned": {"audio": audio is not None, "step": step, "frames": n}}


def main():
    ap = argparse.ArgumentParser(prog="clipforge-detect", description="Find clip-worthy moments in a recording.")
    ap.add_argument("input")
    ap.add_argument("--out", help="write JSON here (default: print)")
    ap.add_argument("--max", type=int, default=8, help="most moments to keep")
    a = ap.parse_args()
    res = scan(a.input, max_moments=a.max)
    js = json.dumps(res, indent=2)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(js + "\n")
        print(json.dumps({"ok": True, "out": a.out, "moments": len(res["moments"]), "letterbox": res["letterbox"]}))
    else:
        print(js)


if __name__ == "__main__":
    main()
