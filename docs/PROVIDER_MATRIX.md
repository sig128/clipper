# PROVIDER_MATRIX

Verified against current docs on **2026-11-10**, publishing rows re-checked **2026-11-13**. Status reflects what is
genuinely usable, not just whether a key is stored. Re-verify at build time.

| Provider | Role | Status | Notes (checked 2026-11-10) |
|---|---|---|---|
| faster-whisper | STT (local) | ready · $0 | word timing, EN + SV/NO, private |
| Deepgram / AssemblyAI | STT (managed) | optional | diarization/utterances at scale |
| **Gemini** | video reasoning | ready w/ key | 2026 agentic video mode watches only relevant parts → up to ~88% fewer video tokens; makes 8-hr VODs affordable |
| Anthropic | editorial reasoning | ready w/ key | briefs, hooks, grounding, structured output |
| TwelveLabs | semantic library search | optional | "find the moment where…" |
| BFL FLUX / OpenAI image | covers | optional | faithful + creative (labelled) |
| Real-ESRGAN | enhancement (local) | ready · $0 | reproducible baseline |
| Topaz | enhancement (managed) | optional | native estimate before upload |
| **Remotion** | render (optional) | license-gated | free for individuals/small co.; larger company needs paid license — pin before relying on it. FFmpeg path is license-clean. |
| **YouTube** | publish + analytics | ready w/ OAuth | Shorts upload ≈100 quota units since 4 Dec 2025 (was ≈1,600) → ~100/day on 10,000 units; uploads own quota bucket since 1 Jun 2026; unverified projects no longer forced private since 2 Nov 2026; custom Shorts thumbnails in Studio since 25 Jul 2026 and via `thumbnails.set` since 3 Nov 2026; Shorts revenue sharing needs 10M qualified Shorts views/90 days from 1 Feb 2027 |
| **Instagram** | publish Reels | gated | eligible professional account via Instagram Login; container→status→publish; 100 API posts per account per 24 h (`content_publishing_limit`); don't mix with Facebook Login tokens |
| **TikTok** | publish | export-only | unaudited = private-only; a utility posting to accounts "you/your team manage" is a named unacceptable use → owner app ships export/handoff (post kit → TikTok Studio, schedules up to 10 days ahead on desktop); ~15 Direct Post posts/day/creator; `video_cover_timestamp_ms` picks an in-video frame |
| **Kick** | source | gated | official public API (channels/livestream/events) exists; own-VOD download is via dashboard, not the API; scrapers are not official |
| Twitch | source | ready w/ auth | clip download + VOD-to-clip (broadcaster/editor auth) |
| Ayrshare | publish (multi) | optional | fallback path; verify per-account eligibility |
| xAI X Search | research | optional | source-backed trend/context + video in posts |
| Modal / Runpod | remote GPU | optional | pick ONE; only when enhancement demands it |

Sources: TikTok Content Sharing Guidelines; YouTube thumbnails.set + Shorts
thumbnail rollout (ppc.land, 2026-07-25); Instagram Content Publishing; Kick
public API launch + VOD help; Gemini agentic video (token reduction); Remotion
license/pricing. Full URLs in the build-plan artifact.
