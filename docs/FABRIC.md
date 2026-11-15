# FABRIC: the GTA posting system

_Added 2026-11-13 for GTA VI launch season (unlock: Thursday 19 November 2026, local midnight)._

One loop runs all day. A person approves each post in about two minutes.

```
capture -> detect -> edit -> check -> adapt -> schedule -> publish -> learn
```

| Step | Where | What happens |
|---|---|---|
| Capture | `services/media/intake.py` (watch folder), studio drop zone | Capture-card recordings land in a folder; each finished file is scanned once. |
| Detect | `services/media/detect.py`, studio “Find moments” | Motion, scene changes, loud spikes, flashes and black bars (cutscenes). Same scoring in both places. |
| Edit | studio editor | Win-first cut, captions, the GTA preset, hook + commentary (the original layer), loop ending. |
| Check | studio checks, `packages/contracts/src/fabric.ts` | Launch lock, cutscene, spoiler words, originality, permission, radio music, 7-second opening, TikTok length. |
| Adapt | studio export, `render.py --platform` | Shorts (≤60 s), TikTok (runs past 61 s with lead-in), Reels (≤90 s). |
| Schedule | studio Plan | Accounts × daily slots for 7 days; limits; duplicate guard; auto-fill. |
| Publish | `apps/worker/src/publish-worker.ts`, post kits | YouTube + Instagram through official APIs; TikTok as a post kit for TikTok Studio. |
| Learn | Insights (P1: hook lab) | Retention per hook and moment type feeds the next ranking. |

## Rules the code enforces

**Blocks planning (high):**
- GTA VI footage before unlock. Rockstar: “No pre-release leaked footage of any kind.”
- Cutscenes posted on their own (letterbox detected, not marked as gameplay).
- Spoiler words in the title, hook, commentary, caption or transcript (“ending”, “final mission”, “dies”, …).
- No original layer: neither a hook nor a commentary line. YouTube’s reused/inauthentic rules, TikTok’s originality rule for Creator Rewards and Meta’s unoriginal-content penalties all key on added value.
- Another streamer’s footage without a permission record (written OK or campaign terms).
- The same edit already planned on that platform (each edit goes out once per platform, never the same file on two of our accounts).
- A time that has passed.

**Warns (medium):** radio music (licensed songs), graphic violence in the first 7 seconds of the YouTube cut, a TikTok cut under 61 seconds, less than 2 hours since the last post on that account.

## Limits designed around

| Platform | How we post | Limit |
|---|---|---|
| YouTube | Data API resumable upload, custom Shorts thumbnail | ~100 units per upload since 4 Dec 2025 (was ~1,600); default 10,000 units/day → ~100 uploads; own bucket since 1 Jun 2026; unverified projects no longer forced private since 2 Nov 2026; Shorts thumbnails via API since 3 Nov 2026. Quota day = Pacific Time. |
| Instagram | Content Publishing API (Reels) | 100 API posts per account per rolling 24 h; the worker also reads `content_publishing_limit`. |
| TikTok | Post kit → TikTok Studio scheduler (desktop, up to 10 days ahead) | TikTok’s terms reject “a utility tool to help upload contents to the account(s) you or your team manages”; unaudited apps post private only; ~15 posts/day/creator through Direct Post. |

House rule: 2–4 posts per account per day, at least 2 hours apart, one niche and one language per account. Keep YouTube to 2–3 channels so each clears 10M qualified Shorts views per 90 days (≈111K/day) before Shorts revenue sharing changes on 1 Feb 2027.

## Never double-post

`apps/worker/src/publish/intents.ts` keys every post on `revision:platform:account`.
YouTube stores the resumable session URL before any bytes move and resumes from
the byte the server reports; Instagram stores the container id before waiting on
it. A retried job continues the same upload or container, or returns the
existing remote id.

## Starter network (working names)

| Account | Platforms | Lane | Daily times |
|---|---|---|---|
| Leonida Daily | YouTube, TikTok, Instagram | Chaos moments | 12:00, 17:00, 21:00 |
| Leonida Guides | YouTube | Guides | 15:00, 19:00 |
| RP Desk | TikTok, YouTube | Roleplay | 13:00, 20:00, 23:00 |
| Arabic GTA | TikTok, YouTube, Instagram | Kick streamer moments | 14:00, 18:00, 22:00 |
| Partner desk | TikTok | Paid campaigns | 16:00 |
