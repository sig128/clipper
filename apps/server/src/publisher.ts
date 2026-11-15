/**
 * Jobs that take a planned post to a live post: send at the slot time through
 * Upload-Post (idempotent on the post's intent key), follow its status, and
 * collect the numbers at 1 h, 3 h, 24 h, 72 h and 7 days.
 */
import { log } from "./activity.js";
import { config, has } from "./config.js";
import { one, q } from "./db.js";
import { UP_PLATFORM } from "./edges.js";
import { getEdit } from "./edits.js";
import { enqueue, Later } from "./jobs.js";
import { getClip } from "./library.js";
import { mediaUrl } from "./media.js";
import type { PostRow } from "./posts.js";
import { readMetrics, readStatus, UploadPost, UploadPostError } from "./publish/uploadpost.js";
import { GTA6_UNLOCK } from "./rules.js";

let client: UploadPost | null = null;
export function uploadPost(): UploadPost | null {
  if (!has.uploadPost()) return null;
  return (client ??= new UploadPost(config.uploadPost.apiKey, config.uploadPost.base));
}
/** Tests swap in a client backed by a fake fetch. */
export function setUploadPost(c: UploadPost | null) { client = c; }

type PostCtx = PostRow & { edge_id: string; upload_post_user: string; paused: boolean };

const fail = async (postId: string, error: string) => {
  await q("update posts set status = 'failed', error = $2, updated_at = now() where id = $1", [postId, error.slice(0, 1000)]);
  await log("system", "post.failed", postId, { error: error.slice(0, 300) });
};

export async function publishJob({ postId }: { postId: string }): Promise<object> {
  const p = await one<PostCtx>(
    `select p.*, a.edge_id, a.paused, e.upload_post_user from posts p
       join accounts a on a.id = p.account_id join edges e on e.id = a.edge_id where p.id = $1`,
    [postId],
  );
  if (!p) return { skip: "gone" };
  if (p.status !== "planned" && p.status !== "sending") return { skip: p.status };
  if (p.paused) {
    await q("update posts set status = 'cancelled', error = 'account paused', updated_at = now() where id = $1", [postId]);
    return { skip: "paused" };
  }
  const edit = await getEdit(p.edit_id);
  if (!edit) { await fail(postId, "edit missing"); return { failed: true }; }
  if (edit.render_status === "failed") { await fail(postId, `render failed: ${edit.render_error ?? ""}`); return { failed: true }; }
  if (edit.render_status !== "ready" || !edit.media_key) throw new Later(120_000, "waiting for render");
  const wait = p.at.getTime() - Date.now();
  if (wait > 3 * 60_000) throw new Later(wait - 60_000, "not time yet");
  if (Date.now() - p.at.getTime() > 6 * 3600_000) { await fail(postId, "missed its slot by more than 6 hours"); return { failed: true }; }
  const clip = await getClip(edit.clip_id);
  if (clip?.game === "gta6" && Date.now() < GTA6_UNLOCK.getTime()) { await fail(postId, "GTA VI footage before launch"); return { failed: true }; }
  const up = uploadPost();
  if (!up) throw new Later(10 * 60_000, "Upload-Post isn't connected yet");

  await q("update posts set status = 'sending', updated_at = now() where id = $1", [postId]);
  const tags = p.hashtags ?? [];
  const caption = [p.caption || p.title, tags.join(" ")].filter(Boolean).join("\n\n");
  try {
    const r = await up.upload({
      user: p.upload_post_user,
      platform: UP_PLATFORM[p.platform],
      videoUrl: mediaUrl(edit.media_key)!,
      caption: p.platform === "yt" ? p.title : caption,
      youtubeTitle: p.title,
      youtubeDescription: caption,
      tags,
      idempotencyKey: p.intent_key,
    });
    await q("update posts set status = 'sent', remote_request_id = $2, error = null, updated_at = now() where id = $1", [postId, r.requestId]);
    await log("system", "post.sent", postId, { account: p.account_id, request: r.requestId });
    if (r.requestId) {
      await enqueue("post_status", { postId }, { uniqueKey: `post_status:${postId}`, runAt: new Date(Date.now() + 90_000), maxAttempts: 10 });
    }
    return { sent: r.requestId };
  } catch (e) {
    if (e instanceof UploadPostError && !e.retryable) { await fail(postId, e.message); return { failed: e.message }; }
    throw e; // retried with backoff; the idempotency key stops a double post
  }
}

export async function postStatusJob({ postId }: { postId: string }): Promise<object> {
  const p = await one<PostRow>("select * from posts where id = $1", [postId]);
  if (!p || p.status !== "sent" || !p.remote_request_id) return { skip: true };
  const up = uploadPost();
  if (!up) throw new Later(10 * 60_000, "Upload-Post isn't connected");
  const raw = await up.status(p.remote_request_id);
  const s = readStatus(raw, UP_PLATFORM[p.platform]);
  if (s.state === "done") {
    await q("update posts set status = 'published', remote_url = coalesce($2, remote_url), remote_post_id = coalesce($3, remote_post_id), updated_at = now() where id = $1", [postId, s.url ?? null, s.postId ?? null]);
    await log("system", "post.published", postId, { url: s.url ?? null });
    return { published: true };
  }
  if (s.state === "failed") { await fail(postId, s.message ?? "failed on the platform"); return { failed: true }; }
  if (Date.now() - p.at.getTime() > 3 * 3600_000) {
    await q("update posts set error = 'Upload-Post still processing after 3 hours; check its dashboard', updated_at = now() where id = $1", [postId]);
    return { gaveUp: true };
  }
  throw new Later(60_000, "still processing");
}

const AGES = [1, 3, 24, 72, 168];

/** Hourly: take a reading for each post that just passed one of the sample ages. */
export async function collectMetrics(): Promise<number> {
  const up = uploadPost();
  if (!up) return 0;
  const posts = await q<PostRow & { readings: number[] }>(
    `select p.*, coalesce((select array_agg(age_h) from metrics m where m.post_id = p.id), '{}') as readings
     from posts p where p.status in ('published','sent') and p.remote_request_id is not null and p.at > now() - interval '8 days'`,
  );
  let n = 0;
  for (const p of posts) {
    const age = (Date.now() - p.at.getTime()) / 3600_000;
    const due = AGES.filter((a) => age >= a && !(p.readings ?? []).some((r) => r >= a * 0.75));
    if (!due.length) continue;
    try {
      const raw = await up.postAnalytics(p.remote_request_id!, UP_PLATFORM[p.platform]);
      const m = readMetrics(raw);
      await q(
        "insert into metrics (post_id, age_h, views, likes, comments, shares, saves, raw) values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing",
        [p.id, Math.round(age * 10) / 10, m.views, m.likes, m.comments, m.shares, m.saves, JSON.stringify(raw).slice(0, 20000)],
      );
      n++;
    } catch (e) {
      console.error("[metrics]", p.id, e instanceof Error ? e.message : e);
    }
  }
  return n;
}
