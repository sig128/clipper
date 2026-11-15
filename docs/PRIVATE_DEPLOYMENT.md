# PRIVATE_DEPLOYMENT

Owner-only. No public registration. Default-deny, authenticated, HTTPS.

## Topology
```
Vercel (or any Node host)         Container host (VPS / Fly / Render / a box)
┌───────────────────────┐         ┌───────────────────────────────────────┐
│ apps/web  (Next.js)   │  HTTPS   │ apps/worker (BullMQ)                   │
│  - studio UI          │ ───────► │ services/media (ffmpeg+python)        │
│  - /api/renders enqueue│  Redis   │ Postgres (authoritative)              │
│  - /api/events (SSE)  │ ◄─────── │ Redis (queue)   Object storage (S3)   │
└───────────────────────┘         └───────────────────────────────────────┘
```
The render/worker tier **cannot** be Vercel serverless (long-running, needs
ffmpeg and disk). Put the web tier anywhere; put the worker on a container host.

## Security checklist
- Owner identity (passkey/OIDC) — no public sign-up.
- Tokens/keys server-side only, encrypted with a deployment-owned key, redacted
  in logs, never sent to an LLM as prompt content.
- SSRF guards on every remote media fetch (block private/link-local/metadata IPs,
  validate nested HLS). Allowlist a LAN media host explicitly if needed.
- Object storage private; time-limited scoped URLs only for a renderer/publisher.
- Queue is at-least-once → idempotent commits (one publication intent per
  approved revision; store remote IDs before retrying).

## Continuous deploy
Push to the repo → web tier redeploys (Vercel) → worker image rebuilds on the
container host. Milestone 1 needs no secrets; later milestones add keys via the
host's secret store, never committed.
