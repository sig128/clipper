/**
 * Instagram Reels through the Content Publishing API:
 *   container (media_type=REELS, video_url) -> poll status_code -> media_publish.
 * The container id is saved in the intent right away, so a retry waits on the
 * same container instead of creating a second Reel. Instagram allows 100
 * API-published posts per account in a rolling 24 hours; the publisher checks
 * its own ledger and the account's content_publishing_limit before starting.
 *
 * The video must be reachable at a public, time-limited URL (object storage
 * signed URL); Instagram fetches it itself.
 */
import { intentKey, type PublicationIntent } from "@clipforge/contracts";
import { stamp, type IntentStore } from "./intents.js";
import { instagramRoom, noteInstagram, IG_PER_24H, type LimitState } from "./limits.js";
import { PublishError, type Fetch } from "./youtube.js";

const BASE = process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com";
const VER = process.env.IG_GRAPH_VERSION ?? "v23.0";
const api = (path: string, q: Record<string, string>) => `${BASE}/${VER}/${path}?${new URLSearchParams(q)}`;

export interface ReelJob { revisionId: string; acct: string; igUserId: string; videoUrl: string; caption: string; coverUrl?: string; shareToFeed?: boolean }
export interface IgDeps { fetch: Fetch; token: () => Promise<string>; intents: IntentStore; limits: LimitState; now?: () => Date; sleep?: (ms: number) => Promise<void>; maxWaitMs?: number }

async function igJson(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new PublishError(`Instagram: ${j?.error?.message ?? r.statusText}`, r.status >= 500 || r.status === 429 || j?.error?.is_transient === true);
  return j;
}

export async function publishingLimit(f: Fetch, igUserId: string, token: string) {
  const j = await igJson(await f(api(`${igUserId}/content_publishing_limit`, { fields: "quota_usage,config", access_token: token })));
  const row = j.data?.[0] ?? {};
  return { used: Number(row.quota_usage ?? 0), total: Number(row.config?.quota_total ?? IG_PER_24H) };
}

export async function createReel(f: Fetch, job: ReelJob, token: string): Promise<string> {
  const q: Record<string, string> = { media_type: "REELS", video_url: job.videoUrl, caption: job.caption.slice(0, 2200), share_to_feed: String(job.shareToFeed ?? true), access_token: token };
  if (job.coverUrl) q.cover_url = job.coverUrl;
  return (await igJson(await f(api(`${job.igUserId}/media`, q), { method: "POST" }))).id;
}

export async function waitForContainer(f: Fetch, containerId: string, token: string, sleep: (ms: number) => Promise<void>, maxWaitMs = 10 * 60_000) {
  let waited = 0, delay = 5_000;
  for (;;) {
    const j = await igJson(await f(api(containerId, { fields: "status_code,status", access_token: token })));
    if (j.status_code === "FINISHED") return;
    if (j.status_code === "ERROR" || j.status_code === "EXPIRED") throw new PublishError(`Instagram couldn’t process the video (${j.status_code}${j.status ? `: ${j.status}` : ""}).`, false);
    if (waited >= maxWaitMs) throw new PublishError("Instagram is still processing the video. It will be checked again.", true);
    await sleep(delay); waited += delay; delay = Math.min(60_000, Math.round(delay * 1.6));
  }
}

export async function publishInstagram(job: ReelJob, d: IgDeps): Promise<{ id: string; skipped?: boolean }> {
  const now = d.now ?? (() => new Date()), sleep = d.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const key = intentKey(job.revisionId, "ig", job.acct);
  let it: PublicationIntent = (await d.intents.get(key)) ?? stamp({ key, revisionId: job.revisionId, plat: "ig" as const, acct: job.acct, status: "planned" as const, attempts: 0 });
  if (it.status === "published" && it.remoteId) return { id: it.remoteId, skipped: true };
  const token = await d.token();
  it = stamp({ ...it, attempts: it.attempts + 1, error: undefined });
  try {
    if (!it.session) {
      if (!instagramRoom(d.limits, job.acct, now()).ok) throw new PublishError("This account has posted 100 times through the API in the last 24 hours.", true);
      const lim = await publishingLimit(d.fetch, job.igUserId, token);
      if (lim.used >= lim.total) throw new PublishError(`Instagram’s limit is reached (${lim.used} of ${lim.total} in 24 hours).`, true);
      const container = await createReel(d.fetch, job, token);
      it = stamp({ ...it, status: "processing" as const, session: container });
      await d.intents.put(it); // remember the container before waiting on it
    }
    await waitForContainer(d.fetch, it.session!, token, sleep, d.maxWaitMs);
    const pub = await igJson(await d.fetch(api(`${job.igUserId}/media_publish`, { creation_id: it.session!, access_token: token }), { method: "POST" }));
    noteInstagram(d.limits, job.acct, now());
    it = stamp({ ...it, status: "published" as const, remoteId: pub.id, session: undefined });
    await d.intents.put(it);
    return { id: pub.id };
  } catch (e) {
    const err = e as PublishError;
    // a dead container can't be retried; drop it so the next attempt starts fresh
    await d.intents.put(stamp(err.retryable === false ? { ...it, status: "failed" as const, session: undefined, error: err.message } : { ...it, error: err.message }));
    throw e;
  }
}
