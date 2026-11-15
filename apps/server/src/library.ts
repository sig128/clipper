/**
 * The clip library: every Twitch clip we see, every moment cut from a recorded
 * Kick stream and every upload. Permission comes from the streamer ledger at
 * read time, so changing a streamer's permission applies to all their clips.
 */
import { one, q } from "./db.js";
import { mediaUrl } from "./media.js";
import { permissionOk } from "./rules.js";

export type ClipSource = "twitch_clip" | "kick_live" | "upload";

export interface ClipRow {
  id: string; source: ClipSource; streamer_id: number | null; streamer_login: string | null; streamer_platform: string | null;
  title: string | null; url: string | null; embed_url: string | null; thumbnail_url: string | null; media_key: string | null;
  width: number | null; height: number | null; fps: string | null; duration_s: number | null; view_count: number | null;
  game: string | null; language: string | null; created_at_source: Date | null; ingested_at: Date; score: number;
  moment: any; status: "new" | "used" | "rejected"; meta: any; permission: string;
}

/** Views per hour since the clip was made, softened so older big clips still rank. */
export function clipScore(views: number, createdAt: Date | null, now = new Date()): number {
  const hours = createdAt ? Math.max(0, (now.getTime() - createdAt.getTime()) / 3600_000) : 24;
  return Math.round((Math.log10(views + 1) * 100 + (views / (hours + 2) ** 0.8)) * 10) / 10;
}

const SELECT = `
  select c.*, case when c.source = 'upload' then 'own' else coalesce(s.permission, 'none') end as permission
  from clips c left join streamers s on s.id = c.streamer_id`;

export async function getClip(id: string): Promise<ClipRow | undefined> {
  return one<ClipRow>(`${SELECT} where c.id = $1`, [id]);
}

export async function upsertClip(c: Partial<ClipRow> & { id: string; source: ClipSource }): Promise<void> {
  await q(
    `insert into clips (id, source, streamer_id, streamer_login, streamer_platform, title, url, embed_url, thumbnail_url, media_key,
       width, height, fps, duration_s, view_count, game, language, created_at_source, score, moment, meta)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     on conflict (id) do update set
       title = coalesce(excluded.title, clips.title),
       view_count = greatest(coalesce(excluded.view_count, 0), coalesce(clips.view_count, 0)),
       score = excluded.score,
       thumbnail_url = coalesce(excluded.thumbnail_url, clips.thumbnail_url),
       media_key = coalesce(clips.media_key, excluded.media_key),
       streamer_id = coalesce(clips.streamer_id, excluded.streamer_id),
       meta = clips.meta || excluded.meta`,
    [c.id, c.source, c.streamer_id ?? null, c.streamer_login ?? null, c.streamer_platform ?? null, c.title ?? null, c.url ?? null,
     c.embed_url ?? null, c.thumbnail_url ?? null, c.media_key ?? null, c.width ?? null, c.height ?? null, c.fps ?? null,
     c.duration_s ?? null, c.view_count ?? null, c.game ?? null, c.language ?? null, c.created_at_source ?? null, c.score ?? 0,
     c.moment ? JSON.stringify(c.moment) : null, JSON.stringify(c.meta ?? {})],
  );
}

export interface ClipFilter {
  query?: string; source?: ClipSource; streamer?: string; game?: string;
  usableOnly?: boolean; unusedOnly?: boolean; sinceHours?: number; limit?: number; offset?: number;
}

export async function findClips(f: ClipFilter = {}): Promise<ClipRow[]> {
  const where: string[] = ["c.status <> 'rejected'"];
  const p: unknown[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); where.push(sql.replace("?", `$${p.length}`)); };
  if (f.query) add("(c.title ilike ? )", `%${f.query}%`);
  if (f.source) add("c.source = ?", f.source);
  if (f.streamer) add("lower(c.streamer_login) = lower(?)", f.streamer);
  if (f.game) add("c.game = ?", f.game);
  if (f.sinceHours) add("c.ingested_at > now() - (? || ' hours')::interval", String(f.sinceHours));
  if (f.unusedOnly) where.push("c.status = 'new'");
  if (f.usableOnly) where.push("c.media_key is not null and (c.source = 'upload' or s.permission in ('own','campaign','written'))");
  p.push(Math.min(100, f.limit ?? 20), f.offset ?? 0);
  return q<ClipRow>(`${SELECT} where ${where.join(" and ")} order by c.score desc, c.ingested_at desc limit $${p.length - 1} offset $${p.length}`, p);
}

/** What the bots and the website see for a clip. */
export function clipView(c: ClipRow) {
  return {
    id: c.id,
    source: c.source,
    title: c.title,
    streamer: c.streamer_login ? `${c.streamer_login} (${c.streamer_platform})` : null,
    views: c.view_count,
    duration_s: c.duration_s,
    game: c.game,
    permission: c.permission,
    usable: Boolean(c.media_key) && permissionOk(c.permission),
    why_not_usable: !c.media_key ? "no video file yet" : !permissionOk(c.permission) ? "no permission record" : null,
    media_url: mediaUrl(c.media_key),
    thumbnail_url: c.thumbnail_url,
    source_url: c.url,
    moment: c.moment ?? null,
    status: c.status,
    created: c.created_at_source ?? c.ingested_at,
  };
}
