# DECISIONS

Consequential architecture choices, newest first.

## 2026-11-10 — One canonical EDL, read by both preview and export
`packages/contracts/src/edl.ts` (Zod) is the single schema. The Python renderer
consumes the exact JSON it validates. Prevents the classic "looks right in
preview, wrong in export" drift. Crop is stored as source fractions; the renderer
converts to even-integer pixels. Frame rate stays rational.

## 2026-11-10 — Python+FFmpeg media service, Node-orchestrated
Node (BullMQ) is the sole queue orchestrator and spawns `render.py` as an argv
array (no shell) so untrusted EDL values can't inject commands. FFmpeg does the
dependable baseline work (crop/scale/overlay/libass/loudnorm). libass ASS gives
real word-by-word karaoke without a bespoke text renderer.

## 2026-11-10 — Local-first, zero-key Milestone 1
The whole upload→export path must work with faster-whisper (local STT) + FFmpeg,
no paid providers. Paid specialists (Gemini, image, Topaz, publishing) are opt-in
in later milestones, each behind a capability/status flag.

## 2026-11-10 — Deploy split (pending owner confirm)
Render/workers can't run on Vercel serverless. Plan: Next.js web tier on Vercel;
worker + media service + Postgres + Redis on a single container host. Avoid two
GPU clouds; add remote GPU (Modal **or** Runpod) only when enhancement demands it.

## 2026-11-10 — TikTok is export/handoff only
Verified against TikTok's current guidelines: unaudited clients are private-only,
and a utility posting to accounts "you or your team manages" is a named
unacceptable use. An owner-only app qualifies — so we ship export + phone handoff
instead of chasing an audit we can't pass.
