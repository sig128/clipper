/**
 * Edits: a clip plus our layer (hook, commentary, layout, trim), rendered to a
 * 1080x1920 MP4 by services/media/render.py. A rendered edit is what gets posted.
 */
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { EdlZ, type Edl } from "@clipforge/contracts";
import { log } from "./activity.js";
import { config } from "./config.js";
import { one, q } from "./db.js";
import { edgeDef, type EdgeId } from "./edges.js";
import { enqueue, Permanent } from "./jobs.js";
import { getClip, type ClipRow } from "./library.js";
import { mediaPath, probe, run, storeFile, workPath, type Probe } from "./media.js";
import { blocking, editChecks, type Check } from "./rules.js";

export interface EditRow {
  id: string; edge_id: EdgeId; clip_id: string; created_by: string; hook: string; commentary: string | null; headline: string | null;
  layout: "full" | "landscape_fit"; in_s: number; out_s: number; edl: Edl | null; render_status: "draft" | "queued" | "rendering" | "ready" | "failed";
  render_error: string | null; media_key: string | null; duration_s: number | null; checks: Check[]; created_at: Date;
}

export const getEdit = (id: string) => one<EditRow>("select * from edits where id = $1", [id]);

export class EditRefused extends Error {
  constructor(public checks: Check[]) { super(blocking(checks).map((c) => c.t).join(" ")); }
}

export async function createEdit(input: {
  edge: EdgeId; clipId: string; hook: string; commentary?: string; headline?: string;
  inS?: number; outS?: number; layout?: "full" | "landscape_fit"; by: string;
}): Promise<{ edit: EditRow; checks: Check[] }> {
  const clip = await getClip(input.clipId);
  if (!clip) throw new Permanent(`No clip with id ${input.clipId}.`);
  const dur = clip.duration_s ?? 0;
  const inS = Math.max(0, Math.min(input.inS ?? 0, Math.max(0, dur - 1)));
  const outS = Math.min(dur || Infinity, input.outS ?? (dur || 30));
  if (!(outS > inS)) throw new Permanent("out_s must be after in_s.");
  const hook = (input.headline?.trim() || input.hook.trim()).slice(0, 70);
  const checks = editChecks({
    hook, commentary: input.commentary, headline: input.headline, clipTitle: clip.title,
    permission: clip.permission, hasMedia: Boolean(clip.media_key), cutscene: Boolean(clip.moment?.cutscene), durationS: outS - inS,
  });
  if (blocking(checks).length) throw new EditRefused(checks);
  const layout = input.layout ?? edgeDef(input.edge)?.brief.layout ?? "full";
  const id = `ed_${randomUUID().slice(0, 12)}`;
  const edit = await one<EditRow>(
    `insert into edits (id, edge_id, clip_id, created_by, hook, commentary, headline, layout, in_s, out_s, checks)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
    [id, input.edge, clip.id, input.by, hook, input.commentary?.trim().slice(0, 90) || null, input.headline?.trim() || null, layout, inS, outS, JSON.stringify(checks)],
  );
  await log(input.by, "edit.create", id, { clip: clip.id, hook });
  return { edit: edit!, checks };
}

/** Centre 9:16 crop for "full"; the whole frame for "landscape_fit" (render.py fits it over a blurred fill). */
export function cropFor(layout: string, w: number, h: number) {
  if (layout === "landscape_fit") return { x: 0, y: 0, w: 1, h: 1 };
  const target = 9 / 16;
  if (w / h > target) { const cw = (h * target) / w; return { x: (1 - cw) / 2, y: 0, w: cw, h: 1 }; }
  const ch = (w / target) / h;
  return { x: 0, y: (1 - ch) / 2, w: 1, h: Math.min(1, ch) };
}

export function buildEdl(edit: Pick<EditRow, "id" | "hook" | "commentary" | "layout" | "in_s" | "out_s">, sourcePath: string, src: Probe, title?: string | null): Edl {
  return EdlZ.parse({
    schemaVersion: "1.0",
    revisionId: edit.id,
    title: title ?? undefined,
    source: { path: sourcePath, width: src.width, height: src.height, fps: /^\d+\/\d+$/.test(src.fps) ? src.fps : "30/1" },
    output: { width: 1080, height: 1920, fps: 30 },
    trim: { in: edit.in_s, out: Math.min(edit.out_s, src.duration || edit.out_s) },
    crop: cropFor(edit.layout, src.width, src.height),
    layout: edit.layout,
    hook: { text: edit.hook.slice(0, 70), dur: 2.5 },
    note: edit.commentary ? { text: edit.commentary.slice(0, 90) } : undefined,
    loopSeam: true,
  });
}

export async function queueRender(editId: string, by: string): Promise<void> {
  const r = await q("update edits set render_status = 'queued', render_error = null where id = $1 and render_status in ('draft','failed') returning id", [editId]);
  if (r.length) {
    await enqueue("render", { editId }, { uniqueKey: `render:${editId}`, maxAttempts: 3 });
    await log(by, "edit.render", editId);
  }
}

/** Job: render one edit, store the MP4, then let its planned posts go out. */
export async function renderJob({ editId }: { editId: string }): Promise<object> {
  const edit = await getEdit(editId);
  if (!edit) throw new Permanent("edit not found");
  if (edit.render_status === "ready") return { already: true };
  const clip = (await getClip(edit.clip_id)) as ClipRow;
  if (!clip?.media_key) throw new Permanent("clip has no media");
  await q("update edits set render_status = 'rendering' where id = $1", [editId]);
  const src = mediaPath(clip.media_key);
  const info = await probe(src);
  const edl = buildEdl(edit, src, info, clip.title);
  const edlFile = await workPath(`${editId}.edl.json`);
  const out = await workPath(`${editId}.mp4`);
  await writeFile(edlFile, JSON.stringify(edl));
  const r = await run(config.python, [path.join(config.mediaServiceDir, "render.py"), "render", "--edl", edlFile, "--out", out], { timeoutMs: 20 * 60_000 });
  await unlink(edlFile).catch(() => {});
  if (r.code !== 0) throw new Error(`render failed: ${(r.stderr || r.stdout).slice(-600)}`);
  const key = await storeFile(out, "mp4");
  const dur = edl.trim.out - edl.trim.in;
  await q("update edits set render_status = 'ready', media_key = $2, duration_s = $3, edl = $4, render_error = null where id = $1", [editId, key, dur, JSON.stringify(edl)]);
  await q("update clips set status = 'used' where id = $1 and status = 'new'", [clip.id]);
  await log("system", "edit.ready", editId, { duration_s: dur });
  const posts = await q<{ id: string; at: Date }>("select id, at from posts where edit_id = $1 and status = 'planned'", [editId]);
  for (const p of posts) await enqueue("publish", { postId: p.id }, { uniqueKey: `publish:${p.id}`, runAt: new Date(p.at.getTime() - 60_000) });
  return { key, posts: posts.length };
}

export async function renderGaveUp({ editId }: { editId: string }, error: string): Promise<void> {
  await q("update edits set render_status = 'failed', render_error = $2 where id = $1", [editId, error.slice(0, 1000)]);
  await log("system", "edit.failed", editId, { error: error.slice(0, 300) });
}
