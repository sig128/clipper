/** HTTP routes: health, media files, the bots' MCP endpoint, the owner API and the Twitch connect callback. */
import { Hono } from "hono";
import { log } from "./activity.js";
import { api } from "./api.js";
import { actorFrom } from "./auth.js";
import { config, has } from "./config.js";
import { getSetting, one, setSetting } from "./db.js";
import { handleMcp } from "./mcp.js";
import { serveMedia } from "./media.js";
import { twitch, twitchRedirectUri } from "./sources/twitch.js";

export const app = new Hono();

app.get("/", (c) => c.text("Clipforge server. See /health."));

app.get("/health", async (c) => {
  let db = false;
  try { db = Boolean(await one("select 1 as ok")); } catch { db = false; }
  return c.json({ ok: db, db, jobs: config.jobs, connections: { upload_post: has.uploadPost(), twitch: has.twitch(), kick: has.kick() } }, db ? 200 : 503);
});

app.get("/media/:key", (c) => serveMedia(c.req.param("key"), c.req.header("range")));
app.on("HEAD", "/media/:key", async (c) => {
  const r = await serveMedia(c.req.param("key"), undefined);
  await r.body?.cancel();
  return new Response(null, { status: r.status, headers: r.headers });
});

app.all("/mcp", async (c) => {
  const actor = await actorFrom(c.req.header("authorization"));
  if (!actor) return c.json({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized: send your bot key as a Bearer token." }, id: null }, 401, { "WWW-Authenticate": "Bearer" });
  const bot = actor.kind === "bot" ? actor : { kind: "bot" as const, id: "owner", name: "Owner", role: "manager" as const, edge: null };
  return handleMcp(c.req.raw, bot);
});

app.route("/api", api);

app.get("/auth/twitch/callback", async (c) => {
  const t = twitch();
  const saved = await getSetting<{ state: string; exp: number }>("twitch_oauth_state");
  const code = c.req.query("code");
  const page = (msg: string, status: 200 | 400 = 200) =>
    c.html(`<!doctype html><meta name=viewport content="width=device-width"><body style="font:16px system-ui;background:#0b0b0d;color:#eee;padding:40px"><p>${msg}</p>${config.siteUrl ? `<p><a style="color:#fff" href="${config.siteUrl}/streamers">Back to Clipforge</a></p>` : ""}`, status);
  if (!t || !saved || saved.state !== c.req.query("state") || saved.exp < Date.now() || !code) return page("That link expired or didn't come from Clipforge. Start again from the Streamers page.", 400);
  const tok = await t.exchangeCode(code, twitchRedirectUri());
  const me = await t.helix("users", {}, tok.access_token);
  const u = me.data?.[0];
  await setSetting("twitch_user", { user_id: u.id, login: u.login, access_token: tok.access_token, refresh_token: tok.refresh_token, expires_at: Date.now() + (tok.expires_in ?? 3600) * 1000 });
  await setSetting("twitch_oauth_state", { state: "", exp: 0 });
  await log("owner", "twitch.connect", u.login);
  return page(`Twitch account ${u.login} connected. Streamers who add ${u.login} as an editor can now have their clips downloaded.`);
});
