/** Owner API for the website (and for Claude when running the setup). Every route needs the owner token. */
import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { log, recent } from "./activity.js";
import { actorFrom, rotateBotKey } from "./auth.js";
import { config, has } from "./config.js";
import { getSetting, one, q, setSetting } from "./db.js";
import { EDGES, PLATS, UP_PLATFORM } from "./edges.js";
import { enqueue, Permanent } from "./jobs.js";
import { clipScore, clipView, findClips, upsertClip, type ClipSource } from "./library.js";
import { downloadTo, probe, stillFrame, storeFile, workPath } from "./media.js";
import { cancelPost, listPosts } from "./posts.js";
import { uploadPost } from "./publisher.js";
import { accounts, setPaused, setSlots } from "./schedule.js";
import { twitch, twitchRedirectUri } from "./sources/twitch.js";
import { GTA6_UNLOCK } from "./rules.js";

export const api = new Hono();

api.use("*", async (c, next) => {
  const a = await actorFrom(c.req.header("authorization"));
  if (a?.kind !== "owner") return c.json({ error: "owner token required" }, 401);
  await next();
});

api.onError((e, c) => {
  if (e instanceof Permanent) return c.json({ error: e.message }, 400);
  console.error("[api]", e);
  return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
});

api.get("/overview", async (c) => {
  const [clips, posts, bots, jobs] = await Promise.all([
    one("select count(*)::int as total, count(*) filter (where media_key is not null)::int as with_video, count(*) filter (where ingested_at > now() - interval '24 hours')::int as last_24h from clips"),
    one(`select count(*) filter (where status = 'published' and at > now() - interval '24 hours')::int as published_24h,
           count(*) filter (where status in ('planned','sending','sent') and at > now())::int as upcoming,
           count(*) filter (where status = 'failed' and at > now() - interval '24 hours')::int as failed_24h from posts`),
    q("select id, name, role, edge_id, key_hint, last_seen_at, disabled from bots order by case role when 'manager' then 0 else 1 end, array_position(array['man','onepct','live']::text[], edge_id)"),
    one("select count(*) filter (where status = 'queued')::int as queued, count(*) filter (where status = 'running')::int as running, count(*) filter (where status = 'failed' and updated_at > now() - interval '24 hours')::int as failed_24h from jobs"),
  ]);
  return c.json({
    now: new Date().toISOString(),
    gta6_unlocked: Date.now() >= GTA6_UNLOCK.getTime(),
    connections: {
      upload_post: has.uploadPost(), twitch_app: has.twitch(), kick_app: has.kick(),
      twitch_account: Boolean(await getSetting("twitch_user")),
    },
    clips, posts, bots, jobs,
  });
});

api.get("/clips", async (c) => {
  const rows = await findClips({
    source: (c.req.query("source") as ClipSource) || undefined,
    query: c.req.query("q") || undefined,
    usableOnly: c.req.query("usable") === "1",
    unusedOnly: c.req.query("unused") === "1",
    limit: Number(c.req.query("limit") ?? 60),
    offset: Number(c.req.query("offset") ?? 0),
  });
  return c.json({ clips: rows.map(clipView) });
});

/** Add our own footage (a direct video URL) to the library. */
api.post("/clips/import", async (c) => {
  const b = await c.req.json<{ url: string; title?: string; game?: string }>();
  if (!/^https?:\/\//.test(b.url ?? "")) throw new Permanent("Give a direct http(s) video URL.");
  const tmp = await workPath(`import-${randomBytes(6).toString("hex")}.mp4`);
  await downloadTo(b.url, tmp);
  const info = await probe(tmp);
  const still = await workPath(`import-${randomBytes(6).toString("hex")}.jpg`);
  await stillFrame(tmp, still, Math.min(2, info.duration / 2)).catch(() => {});
  const key = await storeFile(tmp, "mp4");
  const stillKey = await storeFile(still, "jpg").catch(() => null);
  const id = `up:${randomBytes(8).toString("hex")}`;
  await upsertClip({ id, source: "upload", title: b.title ?? "Own capture", media_key: key, width: info.width, height: info.height, fps: info.fps, duration_s: info.duration, game: b.game ?? "gta5", created_at_source: new Date(), score: clipScore(1000, new Date()), meta: stillKey ? { still_key: stillKey } : {} });
  await log("owner", "clip.import", id);
  return c.json({ id });
});

api.post("/clips/:id/reject", async (c) => {
  await q("update clips set status = 'rejected' where id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

api.get("/accounts", async (c) => {
  const rows = await accounts();
  const stats = await q(
    `with latest as (select distinct on (post_id) post_id, views from metrics order by post_id, taken_at desc)
     select p.account_id, count(*) filter (where p.status = 'published')::int as published_7d, coalesce(sum(l.views),0)::int as views_7d,
            count(*) filter (where p.status in ('planned','sending','sent') and p.at > now())::int as upcoming
     from posts p left join latest l on l.post_id = p.id where p.at > now() - interval '7 days' group by p.account_id`,
  );
  return c.json({ accounts: rows.map((a) => ({ ...a, ...(stats.find((s: any) => s.account_id === a.id) ?? { published_7d: 0, views_7d: 0, upcoming: 0 }) })), edges: await q("select id, name, upload_post_user, lane, guidance from edges order by id") });
});

api.put("/accounts/:id", async (c) => {
  const b = await c.req.json<{ slots?: string[]; paused?: boolean; handle?: string }>();
  const id = c.req.param("id");
  if (b.slots) { const r = await setSlots(id, b.slots, "owner"); if (r.error) throw new Permanent(r.error); }
  if (typeof b.paused === "boolean") await setPaused(id, b.paused, "owner");
  if (typeof b.handle === "string") await q("update accounts set handle = $2 where id = $1", [id, b.handle.trim() || null]);
  return c.json({ ok: true });
});

api.get("/posts", async (c) => c.json({ posts: await listPosts({ edge: c.req.query("edge") || null, hours: Number(c.req.query("hours") ?? 72), futureHours: Number(c.req.query("ahead") ?? 96) }) }));
api.post("/posts/:id/cancel", async (c) => c.json(await cancelPost(c.req.param("id"), "owner")));

api.get("/bots", async (c) => c.json({ bots: await q("select id, name, role, edge_id, key_hint, last_seen_at, disabled from bots order by case role when 'manager' then 0 else 1 end, array_position(array['man','onepct','live']::text[], edge_id)") }));
api.post("/bots/:id/rotate", async (c) => {
  const key = await rotateBotKey(c.req.param("id"));
  if (!key) throw new Permanent("No such bot.");
  await log("owner", "bot.rotate", c.req.param("id"));
  return c.json({ id: c.req.param("id"), key, mcp_url: `${config.publicUrl}/mcp`, note: "Shown once. Paste it into the bot as its MCP authorization token." });
});
api.post("/bots/:id/disable", async (c) => {
  await q("update bots set disabled = true where id = $1", [c.req.param("id")]);
  return c.json({ ok: true });
});

api.get("/streamers", async (c) => c.json({ streamers: await q("select * from streamers order by permission <> 'none' desc, is_live desc, login") }));
api.post("/streamers", async (c) => {
  const b = await c.req.json<{ platform: "twitch" | "kick"; login: string; permission?: string; proof?: string; note?: string; record_live?: boolean; edge_hint?: string }>();
  if (!["twitch", "kick"].includes(b.platform) || !/^[A-Za-z0-9_.-]{2,40}$/.test(b.login ?? "")) throw new Permanent("platform twitch|kick and a channel login are required.");
  const perm = b.permission ?? "none";
  if (!["none", "campaign", "written", "own"].includes(perm)) throw new Permanent("permission must be none, campaign, written or own.");
  if (perm !== "none" && !b.proof?.trim()) throw new Permanent("Add proof for the permission: a campaign link, a message link or an email reference.");
  const row = await one(
    `insert into streamers (platform, login, permission, proof, note, record_live, edge_hint) values ($1,lower($2),$3,$4,$5,$6,$7)
     on conflict (platform, login) do update set permission = excluded.permission, proof = excluded.proof, note = excluded.note, record_live = excluded.record_live, edge_hint = excluded.edge_hint
     returning *`,
    [b.platform, b.login, perm, b.proof ?? null, b.note ?? null, Boolean(b.record_live), b.edge_hint ?? null],
  );
  await log("owner", "streamer.set", `${b.platform}:${b.login}`, { permission: perm, record_live: Boolean(b.record_live) });
  return c.json({ streamer: row });
});

api.get("/activity", async (c) => c.json({ activity: await recent(Number(c.req.query("hours") ?? 24), 300) }));
api.get("/live", async (c) => c.json({ kick: (await getSetting("kick_live")) ?? null, permitted_live: await q("select * from streamers where is_live order by live_viewers desc nulls last") }));

/** Creates the three Upload-Post profiles if missing and returns a connect link for each. */
api.post("/upload-post/setup", async (c) => {
  const up = uploadPost();
  if (!up) throw new Permanent("Set UPLOAD_POST_API_KEY on the server first.");
  const existing = await up.listProfiles().catch(() => ({}));
  const names = new Set<string>(((existing as any)?.profiles ?? (existing as any)?.users ?? []).map((p: any) => p.username));
  const out: Record<string, unknown> = {};
  for (const e of EDGES) {
    if (!names.has(e.uploadPostUser)) await up.createProfile(e.uploadPostUser, e.name).catch((err) => { out[`${e.id}_create_error`] = err.message; });
    const link = await up.connectUrl(e.uploadPostUser, PLATS.map((p) => UP_PLATFORM[p]), config.siteUrl ? `${config.siteUrl}/accounts` : undefined);
    out[e.id] = { profile: e.uploadPostUser, name: e.name, connect: link?.access_url ?? link?.url ?? link };
  }
  await log("owner", "uploadpost.setup", null);
  return c.json(out);
});

/** Reads which social accounts are connected in each profile and stores the handles. */
api.get("/upload-post/profiles", async (c) => {
  const up = uploadPost();
  if (!up) throw new Permanent("Set UPLOAD_POST_API_KEY on the server first.");
  const res: any = await up.listProfiles();
  const profiles: any[] = res?.profiles ?? res?.users ?? [];
  for (const e of EDGES) {
    const p = profiles.find((x) => x.username === e.uploadPostUser);
    for (const plat of PLATS) {
      const sa = p?.social_accounts?.[UP_PLATFORM[plat]];
      const handle = sa ? (typeof sa === "string" ? sa : sa.handle ?? sa.username ?? sa.display_name ?? null) : null;
      await q("update accounts set handle = $2 where id = $1", [`${e.id}-${plat}`, handle || null]);
    }
  }
  return c.json({ profiles });
});

/** Starts connecting our Twitch account (the editor account) for official clip downloads. */
api.get("/twitch/connect", async (c) => {
  const t = twitch();
  if (!t) throw new Permanent("Set TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET on the server first.");
  const state = randomBytes(16).toString("hex");
  await setSetting("twitch_oauth_state", { state, exp: Date.now() + 15 * 60_000 });
  return c.json({ url: t.authorizeUrl(twitchRedirectUri(), state), redirect_uri: twitchRedirectUri() });
});

api.post("/jobs/run", async (c) => {
  const b: { kind: string; payload?: object } = await c.req.json<{ kind: string; payload?: object }>().catch(() => ({ kind: "" }));
  if (!["twitch_ingest", "kick_ingest", "metrics"].includes(b.kind)) throw new Permanent("kind must be twitch_ingest, kick_ingest or metrics");
  return c.json({ id: await enqueue(b.kind, b.payload ?? {}, { uniqueKey: `manual:${b.kind}` }) });
});
