/** Planned posts: one rendered edit going out on one account at one time, checked before it's accepted. */
import { randomUUID } from "node:crypto";
import { log } from "./activity.js";
import { config } from "./config.js";
import { one, q } from "./db.js";
import { PLAT_NAME, type EdgeId } from "./edges.js";
import { getEdit, queueRender } from "./edits.js";
import { enqueue, Permanent } from "./jobs.js";
import { getClip } from "./library.js";
import { mediaUrl } from "./media.js";
import { GTA6_UNLOCK, spoilerWords } from "./rules.js";
import { accounts, openSlots } from "./schedule.js";
import { labelIn } from "./time.js";

export interface PostRow {
  id: string; edit_id: string; account_id: string; platform: "yt" | "tt" | "ig"; at: Date; title: string; caption: string; hashtags: string[];
  status: "planned" | "sending" | "sent" | "published" | "failed" | "cancelled"; intent_key: string; remote_request_id: string | null;
  remote_post_id: string | null; remote_url: string | null; error: string | null; created_by: string; created_at: Date;
}

const HOURS2 = 2 * 3600_000;

export async function schedulePost(input: {
  editId: string; accountIds?: string[]; at?: string; title: string; caption?: string; hashtags?: string[]; by: string; edgeScope?: EdgeId | null;
}): Promise<{ scheduled: ReturnType<typeof postView>[]; refused: { account_id: string; reasons: string[] }[] }> {
  const edit = await getEdit(input.editId);
  if (!edit) throw new Permanent(`No edit ${input.editId}.`);
  if (input.edgeScope && edit.edge_id !== input.edgeScope) throw new Permanent("That edit belongs to another edge.");
  if (edit.render_status === "failed") throw new Permanent(`That edit failed to render: ${edit.render_error ?? "unknown error"}. Make a new edit.`);
  const clip = await getClip(edit.clip_id);
  const edgeAccounts = await accounts(edit.edge_id);
  const wanted = input.accountIds?.length ? input.accountIds : edgeAccounts.map((a) => a.id);
  const scheduled: PostRow[] = [];
  const refused: { account_id: string; reasons: string[] }[] = [];
  const now = Date.now();
  const hashtags = (input.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)).slice(0, 8);
  const textSpoilers = spoilerWords(input.title, input.caption);

  for (const id of wanted) {
    const acct = edgeAccounts.find((a) => a.id === id);
    if (!acct) { refused.push({ account_id: id, reasons: ["Not an account of this edit's edge."] }); continue; }
    const reasons: string[] = [];
    if (acct.paused) reasons.push("Account is paused.");
    let at: Date | null = null;
    if (input.at) {
      at = new Date(input.at);
      if (Number.isNaN(at.getTime())) reasons.push("`at` isn't a valid ISO time.");
      else if (at.getTime() < now + 5 * 60_000) reasons.push("Pick a time at least 5 minutes from now.");
    } else {
      at = (await openSlots([acct], 3)).map((s) => new Date(s.at))[0] ?? null;
      if (!at) reasons.push("No open slot in the next 3 days.");
    }
    if (at && !Number.isNaN(at.getTime())) {
      const near = await one<{ at: Date }>(
        "select at from posts where account_id = $1 and status not in ('cancelled','failed') and abs(extract(epoch from (at - $2::timestamptz))) < $3 limit 1",
        [acct.id, at, HOURS2 / 1000],
      );
      if (near) reasons.push(`Less than 2 hours from another post on this account (${labelIn(near.at, acct.tz)}).`);
      const sameDay = await one<{ n: number }>(
        "select count(*)::int as n from posts where account_id = $1 and status not in ('cancelled','failed') and at between $2::timestamptz - interval '12 hours' and $2::timestamptz + interval '12 hours'",
        [acct.id, at],
      );
      if ((sameDay?.n ?? 0) >= 6) reasons.push("Already 6 posts around that day on this account.");
      if (clip?.game === "gta6" && at < GTA6_UNLOCK) reasons.push("GTA VI footage before launch (unlocks Thu 19 Nov, midnight in Norway).");
    }
    const dupEdit = await one("select id from posts where edit_id = $1 and platform = $2 and status <> 'cancelled'", [edit.id, acct.platform]);
    if (dupEdit) reasons.push(`This edit is already planned on ${PLAT_NAME[acct.platform]}. Each edit goes out once per platform.`);
    const dupClip = await one<{ edge_id: string }>(
      `select e.edge_id from posts p join edits e on e.id = p.edit_id
       where e.clip_id = $1 and p.platform = $2 and p.status <> 'cancelled' and p.edit_id <> $3 limit 1`,
      [edit.clip_id, acct.platform, edit.id],
    );
    if (dupClip) reasons.push(`This clip already goes out on ${PLAT_NAME[acct.platform]} (${dupClip.edge_id} edge). Never the same video on two of our accounts.`);
    if (textSpoilers.length) reasons.push(`Possible story spoiler in the title or caption: “${textSpoilers.join("”, “")}”.`);
    if (!input.title.trim()) reasons.push("Needs a title.");
    if (reasons.length || !at) { refused.push({ account_id: acct.id, reasons }); continue; }

    const id2 = `po_${randomUUID().slice(0, 12)}`;
    const row = await one<PostRow>(
      `insert into posts (id, edit_id, account_id, platform, at, title, caption, hashtags, intent_key, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
      [id2, edit.id, acct.id, acct.platform, at, input.title.trim().slice(0, 100), (input.caption ?? "").trim().slice(0, 2000), hashtags, `${edit.id}:${acct.platform}:${acct.id}`, input.by],
    );
    scheduled.push(row!);
    if (edit.render_status === "ready") {
      await enqueue("publish", { postId: id2 }, { uniqueKey: `publish:${id2}`, runAt: new Date(at.getTime() - 60_000) });
    }
  }
  if (scheduled.length && edit.render_status === "draft") await queueRender(edit.id, input.by);
  if (scheduled.length) await log(input.by, "post.schedule", edit.id, { posts: scheduled.map((p) => ({ id: p.id, account: p.account_id, at: p.at })) });
  return { scheduled: scheduled.map(postView), refused };
}

export async function cancelPost(postId: string, by: string, edgeScope?: EdgeId | null): Promise<{ ok: boolean; reason?: string }> {
  const p = await one<PostRow & { edge_id: string }>("select p.*, a.edge_id from posts p join accounts a on a.id = p.account_id where p.id = $1", [postId]);
  if (!p) return { ok: false, reason: "No such post." };
  if (edgeScope && p.edge_id !== edgeScope) return { ok: false, reason: "That post belongs to another edge." };
  if (p.status !== "planned") return { ok: false, reason: `It's already ${p.status}; only planned posts can be cancelled.` };
  await q("update posts set status = 'cancelled', updated_at = now() where id = $1 and status = 'planned'", [postId]);
  await log(by, "post.cancel", postId);
  return { ok: true };
}

export function postView(p: PostRow & { views?: number | null; likes?: number | null; edge_id?: string; media_key?: string | null }) {
  return {
    id: p.id, edit_id: p.edit_id, account_id: p.account_id, platform: p.platform, status: p.status,
    at: p.at.toISOString(), owner_time: labelIn(p.at, config.ownerTz), title: p.title, caption: p.caption, hashtags: p.hashtags,
    url: p.remote_url, error: p.error, views: p.views ?? null, likes: p.likes ?? null,
    video_url: p.media_key !== undefined ? mediaUrl(p.media_key) : undefined,
  };
}

/** Posts with their latest numbers. */
export async function listPosts(f: { edge?: string | null; accountId?: string; hours?: number; futureHours?: number; limit?: number } = {}) {
  const rows = await q<PostRow & { views: number | null; likes: number | null; edge_id: string; media_key: string | null }>(
    `select p.*, a.edge_id, e.media_key, m.views, m.likes from posts p
       join accounts a on a.id = p.account_id
       join edits e on e.id = p.edit_id
       left join lateral (select views, likes from metrics where post_id = p.id order by taken_at desc limit 1) m on true
     where ($1::text is null or a.edge_id = $1) and ($2::text is null or p.account_id = $2)
       and p.at > now() - ($3 || ' hours')::interval and p.at < now() + ($4 || ' hours')::interval
     order by p.at desc limit $5`,
    [f.edge ?? null, f.accountId ?? null, String(f.hours ?? 72), String(f.futureHours ?? 96), f.limit ?? 200],
  );
  return rows.map(postView);
}
