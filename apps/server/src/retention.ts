/**
 * Keeps the media disk from filling: video files of clips nobody used are
 * deleted after a few days (the clip stays in the library as metadata), source
 * files of used clips after two weeks, rendered edits once their posts are out
 * and three weeks old, and finished jobs after two weeks.
 */
import { unlink } from "node:fs/promises";
import { q } from "./db.js";
import { mediaPath } from "./media.js";

export const KEEP = { unusedClipDays: 3, usedClipDays: 14, renderDays: 21 };

async function drop(keys: (string | null)[]): Promise<number> {
  let n = 0;
  for (const k of keys) {
    if (!k) continue;
    try { await unlink(mediaPath(k)); n++; } catch { /* already gone */ }
  }
  return n;
}

export async function retentionPass(): Promise<{ files: number }> {
  let files = 0;
  const clips = await q<{ id: string; media_key: string; still_key: string | null }>(
    `select c.id, c.media_key, c.meta->>'still_key' as still_key from clips c
     where c.media_key is not null and c.source <> 'upload' and (
       (c.status = 'new' and c.ingested_at < now() - ($1 || ' days')::interval) or
       (c.status = 'used' and c.ingested_at < now() - ($2 || ' days')::interval
         and not exists (select 1 from edits e where e.clip_id = c.id and e.render_status in ('draft','queued','rendering'))))`,
    [String(KEEP.unusedClipDays), String(KEEP.usedClipDays)],
  );
  for (const c of clips) {
    files += await drop([c.media_key, c.still_key]);
    await q("update clips set media_key = null, meta = (meta - 'still_key') || jsonb_build_object('media_removed', now()) where id = $1", [c.id]);
  }
  const renders = await q<{ id: string; media_key: string }>(
    `select e.id, e.media_key from edits e where e.media_key is not null and e.created_at < now() - ($1 || ' days')::interval
       and not exists (select 1 from posts p where p.edit_id = e.id and p.status in ('planned','sending','sent'))`,
    [String(KEEP.renderDays)],
  );
  for (const e of renders) {
    files += await drop([e.media_key]);
    await q("update edits set media_key = null where id = $1", [e.id]);
  }
  await q("delete from jobs where status in ('done','failed') and updated_at < now() - interval '14 days'");
  return { files };
}
