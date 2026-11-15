/**
 * YouTube Shorts publishing with the Data API v3 resumable upload.
 *
 *  1. POST the metadata to start a resumable session (Location header = session URL)
 *  2. the session URL is saved in the intent BEFORE any bytes move
 *  3. PUT the bytes; if a previous attempt died, ask the session how far it got
 *     (PUT with `Content-Range: bytes * /SIZE`) and send only the rest
 *  4. set the custom thumbnail (Shorts thumbnails via thumbnails.set since 3 Nov 2026);
 *     a thumbnail failure never undoes a published video
 *
 * Scheduling: `publishAt` needs privacyStatus "private"; YouTube flips it public.
 */
import { intentKey, type PublicationIntent } from "@clipforge/contracts";
import { stamp, type IntentStore } from "./intents.js";
import { spendYouTube, youtubeRoom, YT_UNITS, type LimitState } from "./limits.js";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
const UPLOAD = "https://www.googleapis.com/upload/youtube/v3";

export interface YouTubeJob {
  revisionId: string;
  acct: string;
  video: Uint8Array;
  contentType?: string; // video/mp4 by default
  title: string;
  description: string;
  tags?: string[];
  publishAt?: string; // RFC 3339; schedules the Short
  thumbnail?: Uint8Array; // PNG
  syntheticMedia?: boolean; // YouTube's altered-or-synthetic disclosure
}
export interface Deps { fetch: Fetch; token: () => Promise<string>; intents: IntentStore; limits: LimitState; now?: () => Date; log?: (m: string) => void }

export class PublishError extends Error { constructor(message: string, public retryable: boolean) { super(message) } }

async function failText(r: Response) {
  const t = await r.text().catch(() => "");
  try { const j = JSON.parse(t); return j?.error?.message ?? t.slice(0, 300); } catch { return t.slice(0, 300); }
}

export async function startSession(f: Fetch, token: string, job: YouTubeJob): Promise<string> {
  const body = {
    snippet: { title: job.title.slice(0, 100), description: job.description.slice(0, 5000), tags: job.tags?.slice(0, 30), categoryId: "20" },
    status: {
      privacyStatus: job.publishAt ? "private" : "public",
      ...(job.publishAt ? { publishAt: job.publishAt } : {}),
      selfDeclaredMadeForKids: false,
      ...(job.syntheticMedia != null ? { containsSyntheticMedia: job.syntheticMedia } : {}),
    },
  };
  const r = await f(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Length": String(job.video.byteLength),
      "X-Upload-Content-Type": job.contentType ?? "video/mp4",
    },
    body: JSON.stringify(body),
  });
  const loc = r.headers.get("location");
  if (!r.ok || !loc) throw new PublishError(`YouTube refused the upload: ${await failText(r)}`, r.status >= 500 || r.status === 429);
  return loc;
}

/** How many bytes the session already has (resume after a crash). */
export async function sessionOffset(f: Fetch, session: string, size: number): Promise<{ done?: string; offset: number }> {
  const r = await f(session, { method: "PUT", headers: { "Content-Length": "0", "Content-Range": `bytes */${size}` } });
  if (r.status === 200 || r.status === 201) return { done: (await r.json()).id, offset: size };
  if (r.status === 308) { const range = r.headers.get("range"); return { offset: range ? Number(range.split("-")[1]) + 1 : 0 }; }
  if (r.status === 404 || r.status === 410) return { offset: -1 }; // session expired: start a new one
  throw new PublishError(`YouTube session check failed: ${await failText(r)}`, true);
}

export async function sendBytes(f: Fetch, session: string, job: YouTubeJob, offset: number): Promise<string> {
  const size = job.video.byteLength, chunk = job.video.subarray(offset);
  const r = await f(session, {
    method: "PUT",
    headers: { "Content-Type": job.contentType ?? "video/mp4", "Content-Length": String(chunk.byteLength), ...(offset ? { "Content-Range": `bytes ${offset}-${size - 1}/${size}` } : {}) },
    body: chunk as unknown as BodyInit,
  });
  if (r.status === 200 || r.status === 201) return (await r.json()).id;
  throw new PublishError(`YouTube upload stopped: ${await failText(r)}`, r.status >= 500 || r.status === 308 || r.status === 429);
}

export async function setThumbnail(f: Fetch, token: string, videoId: string, png: Uint8Array) {
  const r = await f(`${UPLOAD}/thumbnails/set?videoId=${encodeURIComponent(videoId)}`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "image/png" }, body: png as unknown as BodyInit,
  });
  if (!r.ok) throw new PublishError(`Thumbnail not set: ${await failText(r)}`, false);
}

/** Publish one Short exactly once for this revision + account. */
export async function publishYouTube(job: YouTubeJob, d: Deps): Promise<{ id: string; skipped?: boolean }> {
  const now = d.now ?? (() => new Date()), log = d.log ?? (() => {});
  const key = intentKey(job.revisionId, "yt", job.acct);
  let it: PublicationIntent = (await d.intents.get(key)) ?? stamp({ key, revisionId: job.revisionId, plat: "yt" as const, acct: job.acct, status: "planned" as const, attempts: 0 });
  if (it.status === "published" && it.remoteId) return { id: it.remoteId, skipped: true };
  const room = youtubeRoom(d.limits, now());
  if (!it.session && !room.ok) throw new PublishError(`YouTube quota for today is used up (${room.used} units). It resets at midnight Pacific Time.`, true);

  const token = await d.token();
  it = stamp({ ...it, attempts: it.attempts + 1, error: undefined });
  let offset = 0, id: string | undefined;
  if (it.session) {
    const s = await sessionOffset(d.fetch, it.session, job.video.byteLength);
    if (s.done) id = s.done;
    else if (s.offset < 0) it = stamp({ ...it, session: undefined });
    else { offset = s.offset; log(`resuming upload at byte ${offset}`); }
  }
  if (!id && !it.session) {
    const session = await startSession(d.fetch, token, job);
    spendYouTube(d.limits, now(), YT_UNITS.upload);
    it = stamp({ ...it, status: "uploading" as const, session });
    await d.intents.put(it); // remember the session before any bytes move
  }
  try {
    if (!id) id = await sendBytes(d.fetch, it.session!, job, offset);
  } catch (e) {
    await d.intents.put(stamp({ ...it, error: (e as Error).message }));
    throw e;
  }
  it = stamp({ ...it, status: "published" as const, remoteId: id, session: undefined });
  await d.intents.put(it);
  if (job.thumbnail) {
    try { await setThumbnail(d.fetch, token, id, job.thumbnail); spendYouTube(d.limits, now(), YT_UNITS.thumbnail); }
    catch (e) { log(`published ${id}, but ${(e as Error).message}`); }
  }
  return { id };
}

/** Exchange a stored refresh token for a short-lived access token. */
export async function refreshGoogleToken(f: Fetch, clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const r = await f("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }).toString(),
  });
  if (!r.ok) throw new PublishError(`Google sign-in expired. Reconnect YouTube. (${await failText(r)})`, false);
  return (await r.json()).access_token;
}
