# Clipforge media service

Pure-stdlib Python + FFmpeg. No pip dependencies. Requires `ffmpeg`/`ffprobe` on
PATH and the Inter + DejaVu fonts (the worker image installs them).

```bash
# 1) synthesize a 16:9 test source (visible frame counter + tone)
python3 render.py fixture --out ../../out/source.mp4 --duration 12 --fps 30

# 2) normalized probe (rational fps preserved, orientation, audio presence)
python3 render.py probe ../../out/source.mp4

# 3) render a vertical clip from a canonical EDL
python3 render.py render --edl ../../examples/clutch.edl.json \
  --out ../../out/clip_1080x1920.mp4
```

What `render` does, from one EDL:
trim → crop (16:9 → 9:16, even-integer px) → optional facecam band → scale to
1080×1920 → burn karaoke captions (libass/ASS) → H.264 high/yuv420p + AAC 48k,
`+faststart`.

Design rules enforced here: argv arrays (never a shell), rational frame rate
preserved, deterministic output, honest synthetic fixtures labelled on-frame.
