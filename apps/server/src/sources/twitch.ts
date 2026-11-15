/**
 * Twitch intake. Every 10 minutes: the top GTA clips of the last 24 hours (for
 * discovery and the Streamer League), plus all new clips from streamers in our
 * permission ledger. Video files are downloaded only through Twitch's official
 * Get Clips Download endpoint, which works for channels where our Twitch account
 * is an editor (the streamer's OK, enforced by Twitch).
 */
import { log } from "../activity.js";
import { config, has } from "../config.js";
import { getSetting, one, q, setSetting } from "../db.js";
import { enqueue, Permanent } from "../jobs.js";
import { clipScore, upsertClip } from "../library.js";
import { downloadTo, probe, stillFrame, storeFile, workPath } from "../media.js";

const GAMES: Record<string, string> = { "Grand Theft Auto V": "gta5", "Grand Theft Auto VI": "gta6" };
export const TWITCH_SCOPES = ["editor:manage:clips"];

export interface TwitchUser { user_id: string; login: string; access_token: string; refresh_token: string; expires_at: number }

export class Twitch {
  private tok: { value: string; exp: number } | null = null;
  constructor(private clientId: string, private clientSecret: string, private f: typeof fetch = fetch) {}

  private async oauth(params: Record<string, string>): Promise<any> {
    const r = await this.f("https://id.twitch.tv/oauth2/token", { method: "POST", body: new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...params }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Twitch OAuth: HTTP ${r.status} ${j?.message ?? ""}`);
    return j;
  }

  async appToken(): Promise<string> {
    if (this.tok && this.tok.exp > Date.now() + 60_000) return this.tok.value;
    const j = await this.oauth({ grant_type: "client_credentials" });
    this.tok = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.tok.value;
  }

  async helix(path: string, params: Record<string, string | string[] | undefined>, userToken?: string): Promise<any> {
    const url = new URL(`https://api.twitch.tv/helix/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, x);
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = userToken ?? (await this.appToken());
      const r = await this.f(url.toString(), { headers: { "Client-Id": this.clientId, Authorization: `Bearer ${token}` } });
      if (r.status === 401 && !userToken && attempt === 0) { this.tok = null; continue; }
      const text = await r.text();
      if (!r.ok) {
        const err = new Error(`Twitch ${path}: HTTP ${r.status} ${text.slice(0, 200)}`) as Error & { status?: number };
        err.status = r.status;
        throw err;
      }
      return text ? JSON.parse(text) : {};
    }
  }

  games(names: string[]) { return this.helix("games", { name: names }); }
  users(logins: string[]) { return this.helix("users", { login: logins }); }
  streams(logins: string[]) { return this.helix("streams", { user_login: logins, first: "100" }); }
  clips(p: { gameId?: string; broadcasterId?: string; startedAt?: string; first?: number; after?: string }) {
    return this.helix("clips", { game_id: p.gameId, broadcaster_id: p.broadcasterId, started_at: p.startedAt, first: String(p.first ?? 50), after: p.after });
  }
  clipDownloads(editorId: string, broadcasterId: string, clipIds: string[], userToken: string) {
    return this.helix("clips/downloads", { editor_id: editorId, broadcaster_id: broadcasterId, clip_id: clipIds }, userToken);
  }

  authorizeUrl(redirectUri: string, state: string): string {
    const u = new URL("https://id.twitch.tv/oauth2/authorize");
    u.searchParams.set("client_id", this.clientId);
    u.searchParams.set("redirect_uri", redirectUri);
    u.searchParams.set("response_type", "code");
    u.searchParams.set("scope", TWITCH_SCOPES.join(" "));
    u.searchParams.set("state", state);
    return u.toString();
  }

  exchangeCode(code: string, redirectUri: string) { return this.oauth({ code, grant_type: "authorization_code", redirect_uri: redirectUri }); }
  refresh(refreshToken: string) { return this.oauth({ grant_type: "refresh_token", refresh_token: refreshToken }); }
}

let tw: Twitch | null = null;
export function twitch(): Twitch | null {
  if (!has.twitch()) return null;
  return (tw ??= new Twitch(config.twitch.clientId, config.twitch.clientSecret));
}
export function setTwitch(t: Twitch | null) { tw = t; }

export const twitchRedirectUri = () => `${config.publicUrl}/auth/twitch/callback`;

/** Our Twitch account's user token (the editor account), refreshed when close to expiry. */
export async function twitchUserToken(): Promise<TwitchUser | null> {
  const t = twitch();
  const u = await getSetting<TwitchUser>("twitch_user");
  if (!t || !u) return null;
  if (u.expires_at > Date.now() + 5 * 60_000) return u;
  const j = await t.refresh(u.refresh_token);
  const next = { ...u, access_token: j.access_token, refresh_token: j.refresh_token ?? u.refresh_token, expires_at: Date.now() + (j.expires_in ?? 3600) * 1000 };
  await setSetting("twitch_user", next);
  return next;
}

async function gameIds(t: Twitch): Promise<Record<string, string>> {
  const cached = await getSetting<{ at: number; ids: Record<string, string> }>("twitch_games");
  if (cached && cached.at > Date.now() - 24 * 3600_000 && Object.keys(cached.ids).length) return cached.ids;
  const res = await t.games(Object.keys(GAMES));
  const ids: Record<string, string> = {};
  for (const g of res.data ?? []) if (GAMES[g.name]) ids[g.id] = GAMES[g.name];
  await setSetting("twitch_games", { at: Date.now(), ids });
  return ids;
}

function toClip(c: any, game: string, streamerId: number | null) {
  const created = c.created_at ? new Date(c.created_at) : null;
  return {
    id: `tw:${c.id}`,
    source: "twitch_clip" as const,
    streamer_id: streamerId,
    streamer_login: c.broadcaster_name ?? null,
    streamer_platform: "twitch",
    title: c.title ?? null,
    url: c.url ?? null,
    embed_url: c.embed_url ?? null,
    thumbnail_url: c.thumbnail_url ?? null,
    duration_s: typeof c.duration === "number" ? c.duration : null,
    view_count: c.view_count ?? 0,
    game,
    language: c.language ?? null,
    created_at_source: created,
    score: clipScore(c.view_count ?? 0, created),
    meta: { broadcaster_id: c.broadcaster_id, creator_name: c.creator_name, vod_offset: c.vod_offset ?? null, twitch_clip_id: c.id },
  };
}

/** One intake pass. Returns how many clips were added or refreshed. */
export async function ingestTwitch(now = new Date()): Promise<{ clips: number; downloads: number }> {
  const t = twitch();
  if (!t) return { clips: 0, downloads: 0 };
  let n = 0;
  const ids = await gameIds(t);
  const ledger = await q<{ id: number; login: string; platform_user_id: string | null; permission: string; record_live: boolean }>(
    "select id, login, platform_user_id, permission, record_live from streamers where platform = 'twitch'",
  );
  const byBroadcaster = new Map(ledger.filter((s) => s.platform_user_id).map((s) => [s.platform_user_id!, s.id]));

  const since24 = new Date(now.getTime() - 24 * 3600_000).toISOString();
  for (const [gameId, game] of Object.entries(ids)) {
    const res = await t.clips({ gameId, startedAt: since24, first: 50 });
    for (const c of res.data ?? []) { await upsertClip(toClip(c, game, byBroadcaster.get(c.broadcaster_id) ?? null)); n++; }
  }

  // Resolve ledger logins to user ids, then pull each permitted streamer's own new clips.
  const missing = ledger.filter((s) => !s.platform_user_id).map((s) => s.login);
  if (missing.length) {
    const users = await t.users(missing.slice(0, 100));
    for (const u of users.data ?? []) {
      await q("update streamers set platform_user_id = $2, display_name = $3 where platform = 'twitch' and lower(login) = lower($1)", [u.login, u.id, u.display_name]);
      await q("update clips set streamer_id = (select id from streamers where platform = 'twitch' and platform_user_id = $1) where source = 'twitch_clip' and meta->>'broadcaster_id' = $1 and streamer_id is null", [u.id]);
    }
  }
  const permitted = await q<{ id: number; platform_user_id: string }>(
    "select id, platform_user_id from streamers where platform = 'twitch' and permission <> 'none' and platform_user_id is not null",
  );
  const since48 = new Date(now.getTime() - 48 * 3600_000).toISOString();
  for (const s of permitted) {
    const res = await t.clips({ broadcasterId: s.platform_user_id, startedAt: since48, first: 20 });
    for (const c of res.data ?? []) {
      await upsertClip(toClip(c, ids[c.game_id] ?? "other", s.id));
      n++;
    }
  }

  // Live status for permitted streamers we record.
  const rec = ledger.filter((s) => s.record_live && s.permission !== "none");
  if (rec.length) {
    const live = await t.streams(rec.map((s) => s.login));
    const on = new Map<string, any>((live.data ?? []).map((s: any) => [String(s.user_login).toLowerCase(), s]));
    for (const s of rec) {
      const l = on.get(s.login.toLowerCase());
      await q("update streamers set is_live = $2, live_title = $3, live_viewers = $4, live_checked_at = now() where id = $1", [s.id, Boolean(l), l?.title ?? null, l?.viewer_count ?? null]);
    }
  }

  // Queue official downloads for permitted clips that have no file yet.
  let downloads = 0;
  if (await getSetting("twitch_user")) {
    const want = await q<{ id: string }>(
      `select c.id from clips c join streamers s on s.id = c.streamer_id
       where c.source = 'twitch_clip' and c.media_key is null and s.permission <> 'none'
         and coalesce(c.meta->>'download_error', '') = '' and c.ingested_at > now() - interval '3 days'
       order by c.score desc limit 15`,
    );
    for (const w of want) if (await enqueue("twitch_download", { clipId: w.id }, { uniqueKey: `twitch_download:${w.id}`, maxAttempts: 3 })) downloads++;
  }
  return { clips: n, downloads };
}

/** Finds the first http URL in the download response; landscape first because render.py crops from it. */
export function pickDownloadUrl(entry: any): string | null {
  if (!entry || typeof entry !== "object") return null;
  for (const k of ["landscape_download_url", "download_url", "url", "portrait_download_url"]) {
    if (typeof entry[k] === "string" && /^https?:\/\//.test(entry[k])) return entry[k];
  }
  for (const v of Object.values(entry)) if (typeof v === "string" && /^https?:\/\//.test(v) && /mp4|download|clip/i.test(v)) return v;
  return null;
}

/** Job: download one permitted clip through Twitch's official endpoint into the library. */
export async function twitchDownloadJob({ clipId }: { clipId: string }): Promise<object> {
  const t = twitch();
  const user = await twitchUserToken();
  if (!t || !user) throw new Permanent("Twitch account not connected");
  const c = await one<{ id: string; media_key: string | null; meta: any; duration_s: number | null }>("select id, media_key, meta, duration_s from clips where id = $1", [clipId]);
  if (!c || c.media_key) return { skip: true };
  let res: any;
  try {
    res = await t.clipDownloads(user.user_id, c.meta.broadcaster_id, [c.meta.twitch_clip_id], user.access_token);
  } catch (e: any) {
    if (e?.status === 401 || e?.status === 403) {
      await q("update clips set meta = meta || $2 where id = $1", [clipId, JSON.stringify({ download_error: "Our Twitch account isn't an editor of this channel yet." })]);
      throw new Permanent("not an editor of this channel");
    }
    throw e;
  }
  const url = pickDownloadUrl(res?.data?.[0]);
  if (!url) {
    await q("update clips set meta = meta || $2 where id = $1", [clipId, JSON.stringify({ download_error: "Twitch returned no download URL." })]);
    throw new Permanent(`no download url in ${JSON.stringify(res).slice(0, 200)}`);
  }
  const tmp = await workPath(`${clipId.replace(/[^a-z0-9]/gi, "_")}.mp4`);
  await downloadTo(url, tmp);
  const info = await probe(tmp);
  const still = await workPath(`${clipId.replace(/[^a-z0-9]/gi, "_")}.jpg`);
  await stillFrame(tmp, still, Math.min(2, info.duration / 2)).catch(() => {});
  const key = await storeFile(tmp, "mp4");
  const thumbKey = await storeFile(still, "jpg").catch(() => null);
  await q(
    "update clips set media_key = $2, width = $3, height = $4, fps = $5, duration_s = $6, meta = meta || $7 where id = $1",
    [clipId, key, info.width, info.height, info.fps, info.duration, JSON.stringify(thumbKey ? { still_key: thumbKey } : {})],
  );
  await log("system", "clip.download", clipId);
  return { key };
}
