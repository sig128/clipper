# Clipforge server

`apps/server` runs on Railway around the clock. The site on Vercel (`apps/web`) is
the owner's window into it; the four Grok bots work through its tool server.

```
Twitch clips ─┐                          ┌─ /mcp ← 4 Grok bots (one key each)
Kick live ────┼─→ clip library ─→ edits ─→ render ─→ schedule ─→ Upload-Post ─→ 9 accounts
uploads ──────┘   (Postgres + /data)        (render.py)  (4 slots/day)          │
                                                                              metrics ─→ manager
```

## What runs

| Every | What |
|---|---|
| 10 min | Twitch: top GTA V / GTA VI clips of the last 24 h, plus every permitted streamer's new clips; official downloads for channels where our Twitch account is an editor |
| 5 min | Kick: live GTA streams (official API) and which permitted streamers are live |
| 1 min | Recorder: records permitted streamers with "record" ticked; each 5-minute segment is scanned by `detect.py` and its best moment kept as a 28 s clip |
| 2 s | Job queue (Postgres): renders, publishing at slot time, status checks, downloads |
| 30 min | Metrics: each post's numbers at 1 h, 3 h, 24 h, 72 h and 7 days |
| 6 h | Retention: unused clip files after 3 days, used sources after 14, renders after 21 |

## Rules enforced in code

Every edit and post passes the same checks whoever asks: permission record for other
people's footage, no GTA VI footage before Thu 19 Nov 2026 00:00 Norway, spoiler words,
cutscene flag, our own hook, at least 2 hours between posts on an account, at most 6 a
day, each edit once per platform, and never the same clip on two of our accounts on one
platform. Publishing is idempotent: the post's intent key goes to Upload-Post as the
`Idempotency-Key`, so a retry never double-posts.

## Environment (Railway)

| Variable | What |
|---|---|
| `DATABASE_URL` | Railway Postgres (reference variable) |
| `OWNER_TOKEN` | Shared with the site (`CLIPFORGE_OWNER_TOKEN` on Vercel) |
| `UPLOAD_POST_API_KEY` | Upload-Post Basic plan; profiles `leonida-man`, `leonida-1pct`, `leonida-live` |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | dev.twitch.tv app; add `https://<server>/auth/twitch/callback` as a redirect URL |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | Kick developer app (client credentials) |
| `SITE_URL` | The Vercel site, for links back |
| `MEDIA_DIR`, `WORK_DIR` | On the volume mounted at `/data` |

## Site (Vercel)

| Variable | What |
|---|---|
| `CLIPFORGE_SERVER_URL` | The Railway URL |
| `CLIPFORGE_OWNER_TOKEN` | Same value as `OWNER_TOKEN` on the server |
| `OWNER_PASSWORD`, `SESSION_SECRET` | Owner login for the whole site, studio included |

## Owner API

All under `/api`, `Authorization: Bearer <OWNER_TOKEN>`: `overview`, `clips`, `clips/import`,
`accounts`, `posts`, `bots/:id/rotate`, `streamers`, `activity`, `live`, `upload-post/setup`
(creates the three profiles and returns connect links), `upload-post/profiles`,
`twitch/connect`.

## Tests

`pnpm --filter @clipforge/server test` with a Postgres at `DATABASE_URL`
(default `postgres://postgres@127.0.0.1:55432/clipforge_test`): 29 tests covering the
schedule, checks, the bot tool server over HTTP, the full clip → render → Upload-Post →
status → metrics path (real `render.py`), Twitch and Kick intake, the recorder and retention.
