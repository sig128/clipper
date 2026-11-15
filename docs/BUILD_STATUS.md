# BUILD_STATUS

_Updated: 2026-11-13 • Owner-only build • GTA launch build (Phase 0) added_

This file is the source of truth for what works, what was actually verified,
and the next concrete task. It never claims a live API/OAuth integration was
tested when only mocks or docs were available.

---

## 🎮 GTA launch build — Phase 0 (2026-11-13)

| Capability | How verified | Evidence |
|---|---|---|
| Moment scan of a recording (motion, scene change, loudness, flash, letterbox) | `detect.py` on a 3-min synthetic capture | moments at 0:55, 1:40, 2:30; letterbox 100–130 s; 3.3 s per 3 min |
| Watch-folder intake, scans each finished file once | `intake.py --once` twice | 1 scan, then 0 (state remembered) |
| Hook + commentary (ASS styles, wrapped), loop ending, radio mutes | `render.py render` on `examples/gta-chase.edl.json` | 1080×1920 H.264/AAC 10 s; frames show hook, note box, loop fade |
| Platform cuts (`--platform tt` runs past 61 s) | `render.py render --platform tt` | trim 11.55→73.05, duration 61.5 s |
| YouTube resumable upload, resume after crash, custom Shorts thumbnail, quota | `pnpm --filter @clipforge/worker test` (fake API) | 9/9 tests pass |
| Instagram Reels container → poll → publish, 100/24 h limit, failed container freed | same test run | 9/9 tests pass |
| Plan rules shared by studio + worker (`fabric.ts`) | same test run + `tsc --noEmit` | clean |
| Studio: GTA samples, checks, Hook tab, platform cuts, real 1080×1920 export, post kits, Plan, moment scan | Playwright, 23 checks | 23/23 pass |

Not live yet: real YouTube/Instagram posting needs a container host, Redis and
your credentials (`YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN_<ACCOUNT>`,
`IG_USER_ID_<ACCOUNT>`, `IG_TOKEN_<ACCOUNT>`). The API calls were tested against
fakes of the documented request shapes, not the live services.

---

## ✅ Verified working (ran it, checked the output)

| Capability | How verified | Evidence |
|---|---|---|
| Synthetic 16:9 fixture w/ frame counter + tone | `render.py fixture` | `out/source.mp4`, ffprobe 1920×1080 30/1 |
| Normalized ffprobe metadata (rational fps, orientation, audio presence) | `render.py probe` | JSON: `r_frame_rate 30/1`, `audio_present true` |
| EDL → real 1080×1920 vertical render | `render.py render` | `out/clip_1080x1920.mp4`, ffprobe 1080×1920 30/1 h264/yuv420p + AAC 48k stereo |
| Crop 16:9 → 9:16 (even-integer px) | render log | `crop_px {w:606,h:1080,x:656,y:0}` |
| Facecam band composite + separator | extracted frames | `docs/samples/frame_*.png` |
| Word-by-word karaoke captions (libass/ASS) | extracted frames | spoken words cyan, upcoming white |
| No-shell spawn of media service | code review | argv arrays in `render.py` + worker |
| Shared EDL contract (preview == export) | code | `packages/contracts/src/edl.ts` ← render.py reads same JSON |

**Milestone 1 definition-of-done anchor met at the pipeline level:** a real MP4
is produced from the canonical EDL with no paid keys. Remaining M1 work is UI
wiring (below).

---

## 🟡 Scaffolded, real code, not yet booted here

- `apps/worker` BullMQ render worker — spawns the verified media service; needs
  Redis to run (`infra/docker-compose.yml`).
- `apps/web` Next.js app + `POST /api/renders` (validates EDL, enqueues) — needs
  `pnpm install` + Redis. Not `next build`-ed in this environment.
- `infra/` Postgres + Redis + worker compose and worker Dockerfile (installs
  ffmpeg + fonts).

---

## What is LEFT, by milestone

### Milestone 1 — end-to-end owner studio  _(core done; finish the slice)_
- [ ] Port the designed studio UI (10 sections) into `apps/web` as React.
- [ ] Resumable upload (`/api/uploads/init` + chunk complete) → quarantine probe.
- [ ] Wire local **faster-whisper** STT → editable transcript → EDL caption lines.
- [ ] SSE `/api/events` for job progress; object-storage put of the render.
- [ ] Persist projects/revisions/renders in Postgres (Drizzle migrations).
- **Needs:** nothing paid. All local.

### Milestone 2 — AI moments & editing
- [ ] Staged detector: audio features + scene/silence/motion + chat signals.
- [ ] Candidate intervals → **agentic Gemini** video reasoning on windows only.
- [ ] Editable Editorial Score (component weights) + 3 distinct variants + diff.
- **Needs:** `GEMINI_API_KEY` (+ optional Deepgram). Add OpusClip/Vizard _after_.

### Milestone 3 — covers & 4K/enhancement lab
- [ ] Frame ranking + layered cover compositor (deterministic text layers).
- [ ] Image provider (BFL FLUX / OpenAI) faithful + creative (labelled) modes.
- [ ] 4K master provenance + short-sample enhancement A/B (Real-ESRGAN local).
- **Needs:** image key; Topaz optional (Real-ESRGAN is the free local default).

### Milestone 4 — sources & live
- [ ] Twitch clip-download / VOD-to-clip (broadcaster auth) — verified capability.
- [ ] Kick metadata/events (official API) + honest own-VOD download fallback.
- [ ] Isolated yt-dlp / Streamlink connectors (permission-gated, SSRF-guarded).
- [ ] OBS companion (replay buffer) + live ring buffer + offset calibration.
- **Needs:** Twitch + Kick apps; OBS companion install.

### Milestone 5 — publishing & real analytics
- [ ] Export package + phone handoff (always available) — first.
- [ ] YouTube upload + Analytics (retention) — the strongest native path.
- [ ] Instagram Reels via Instagram Login (eligible pro account).
- [ ] TikTok: **export/handoff only** for an owner app (platform rule).
- [ ] Preflight + approvals + schedule + status reconciliation (idempotent).
- **Needs:** YouTube first, then Instagram pro account / Ayrshare.

### Milestone 6 — coordinated AI team & learning
- [ ] Bounded roles + typed task graph + atomic budget reservation.
- [ ] xAI X Search research; authenticated Grokbot bridge (read/propose/render/publish scopes, HMAC webhooks).
- [ ] Experiments (observational, honestly labelled) + evidence-backed playbook.
- **Needs:** xAI key; bridge tokens.

### Milestone 7 — hardening & release
- [ ] Test matrix (time-maps, VFR/30000-1001 fixture, caption sync, idempotent webhooks).
- [ ] Backups/restore, private-deploy guide, cost controls, benchmark report.
- **Needs:** a deploy target (see DECISIONS).

---

## Known constraints (not bugs)

- Full backend (render/workers) cannot run on Vercel serverless — needs a
  container host. The Next.js web tier can deploy to Vercel; the worker + media
  service run on a container host. See `docs/PRIVATE_DEPLOYMENT.md`.
- No real stream footage is bundled (no rights). All fixtures are synthetic and
  labelled on-frame.
- TikTok owner-app direct posting is intentionally not pursued; export/handoff
  is the supported path.

## Next concrete task
Phase 1 of the GTA build (launch month): sound-event detectors (crash, siren,
gunfire, laughter) and the GTA VI HUD learner in `detect.py`; hook lab from
YouTube Analytics retention; campaign desk; rights ledger in Postgres. Then put
the worker on a container host with Redis so YouTube and Instagram slots post
on their own.
