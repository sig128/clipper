# TIMELINE_FORMAT (EDL)

The canonical timeline. Schema: `packages/contracts/src/edl.ts`. Renderer:
`services/media/render.py`. Example: `examples/clutch.edl.json`.

## Principles
- **Times** are seconds, clip-relative (after `trim`). Caption word times are
  relative to the trimmed clip start, so burned captions line up 1:1 with the cut.
- **Crop** is fractions of the source frame (resolution-independent). The
  renderer converts to **even integer** pixels (H.264 needs even dims).
- **Frame rate** is rational (`"30000/1001"`), never silently collapsed to 30.
- **Revisions** are immutable; `revisionId` keys idempotent renders (one render
  per revision; the worker commits by it).

## Fields (summary)
```jsonc
{
  "schemaVersion": "1.0",
  "revisionId": "rev_...",            // immutable; idempotency key
  "source": { "path", "width", "height", "fps": "30/1" },
  "output": { "width": 1080, "height": 1920, "fps": 30 },
  "trim":   { "in": 1.0, "out": 11.0 },
  "crop":   { "x": 0.34, "y": 0, "w": 0.3164, "h": 1 },  // fractions of source
  "layout": "gameplay_facecam",       // full | gameplay_facecam | split_speakers | landscape_fit
  "facecam":{ "x","y","w","h","dst_h" },// source region + destination band height
  "captions": {
    "style": { "font","size","primary","secondary","outline","shadow","bold","pos" },
    "lines": [ { "words": [ { "t","d","w","conf?" } ] } ]  // karaoke timing
  },
  "audio": { "gain_db": 0, "loudnorm": true }  // -14 LUFS / -1.5 dBTP studio target
}
```

## Honesty
Caption `conf` carries STT confidence for low-confidence review. A model-proposed
word that is not in the source transcript must be marked as overlay copy, never
presented as spoken. Crop region resolution is shown to the user (e.g. a
full-height 9:16 crop from 1920×1080 is 606×1080 before scaling — not "4K").
