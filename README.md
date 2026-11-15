# Clipforge

Private AI clipping studio for one owner. Long streams, gaming, interviews,
reactions and IRL video become excellent vertical shorts (TikTok, Reels,
YouTube Shorts) with far less manual work — local-first, honest about what it
has actually seen and done.

This is a private work tool: no public registration, billing, orgs or marketing
site. One owner, several social accounts, several source profiles.

## Status

**Milestone 1 (end-to-end owner studio) — core render pipeline is real and
verified.** From a canonical EDL the media service produces a genuine
1080×1920 H.264 clip with a facecam band and word-by-word karaoke captions,
with **zero paid API keys**. See `docs/BUILD_STATUS.md` for exactly what is
verified vs scaffolded, and what each remaining milestone needs.

## Architecture (the spec's default stack)

```
apps/web         Next.js App Router — studio UI + render/upload API routes
apps/worker      Node + BullMQ — drains the render queue, spawns the media service
packages/contracts  Zod EDL schema — ONE canonical timeline for preview AND export
services/media   Python + FFmpeg — probe, fixtures, deterministic render (verified)
infra            docker-compose (Postgres + Redis + worker), worker Dockerfile
examples         a real EDL you can render right now
docs             BUILD_STATUS, DECISIONS, PROVIDER_MATRIX, TIMELINE_FORMAT, deploy
```

Postgres is authoritative; Redis is only the queue. Video never renders in a web
request. Preview (browser) and export (FFmpeg) read the *same* EDL so they can't
diverge.

## Run the verified part now (no keys, no cloud)

Needs `ffmpeg`, `ffprobe`, `python3`, and the Inter + DejaVu fonts.

```bash
mkdir -p out
python3 services/media/render.py fixture --out out/source.mp4 --duration 12
python3 services/media/render.py probe  out/source.mp4
python3 services/media/render.py render --edl examples/clutch.edl.json \
  --out out/clip_1080x1920.mp4
# -> out/clip_1080x1920.mp4 : real 1080x1920 / 30fps / H.264 + AAC
```

## GTA launch build (Phase 0)

```bash
# find moments in a recording (same scoring as the studio's "Find moments")
python3 services/media/detect.py capture.mp4 --out capture.moments.json
# watch the folder your capture card records into; each finished file is scanned once
python3 services/media/intake.py --watch ~/Captures --out ~/Captures/clipforge
# render with hook, commentary, loop ending and radio mutes, cut for one platform
python3 services/media/render.py render --edl examples/gta-chase.edl.json --out out/gta_yt.mp4
python3 services/media/render.py render --edl examples/gta-chase.edl.json --out out/gta_tt.mp4 --platform tt
# publisher tests (YouTube resumable upload + Instagram Reels against fakes)
pnpm --filter @clipforge/worker test
```

Posting rules, limits and the starter network: `docs/FABRIC.md`.

## Run the full local stack

```bash
cp .env.example .env            # Milestone 1 needs no keys filled in
pnpm install
pnpm compose:up                 # Postgres + Redis + worker (CPU-only)
pnpm worker                     # or run the worker on the host
pnpm dev                        # Next.js web tier
```

## Hosted studio (Vercel)

The Vercel project builds `apps/web` (Root Directory `apps/web`) and redeploys on
every push to `main`. The build copies `apps/studio/clipforge-studio.html` into
`public/` and serves it at `/`; `/status` reports the web tier. The studio runs in
the browser and keeps the plan on that device. Rendering and auto-posting need the
worker (FFmpeg + Redis) on a server: until `REDIS_HOST` points at that Redis,
`/api/renders` answers 503 `queue_not_configured`.

## Honesty rules baked in

No fabricated timestamps, quotes, metrics or “97% viral” scores. Missing data is
“not available”, never zero. “4K” is labelled as pixels, not captured detail.
“Scheduled” never means “published”. TikTok direct posting is export/handoff
only for an owner app (platform rule — see `docs/PROVIDER_MATRIX.md`).
