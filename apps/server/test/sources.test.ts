// Twitch and Kick intake against recorded-shape fakes, plus the official clip download into the library.
import "./env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createReadStream, statSync } from "node:fs";
import http from "node:http";
import { getSetting, one, q, setSetting } from "../src/db.js";
import { drain } from "../src/jobs.js";
import { findClips } from "../src/library.js";
import { registerJobs } from "../src/index.js";
import { Kick, ingestKick, setKick } from "../src/sources/kick.js";
import { Twitch, ingestTwitch, pickDownloadUrl, setTwitch } from "../src/sources/twitch.js";
import { closeDb, fakeFetch, fixtureVideo, json, resetDb } from "./helpers.js";

let server: http.Server;
let fileUrl = "";

const clip = (id: string, broadcaster: string, name: string, views: number, game: string, hoursAgo: number) => ({
  id, url: `https://clips.twitch.tv/${id}`, embed_url: `https://clips.twitch.tv/embed?clip=${id}`, broadcaster_id: broadcaster, broadcaster_name: name,
  creator_name: "viewer", video_id: "", game_id: game, language: "en", title: `${name} clip ${id}`, view_count: views,
  created_at: new Date(Date.now() - hoursAgo * 3600_000).toISOString(), thumbnail_url: `https://thumbs/${id}.jpg`, duration: 28.5, vod_offset: 120, is_featured: false,
});

before(async () => {
  await resetDb();
  registerJobs();
  const file = fixtureVideo("twitch-clip.mp4", 10);
  server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "video/mp4", "content-length": statSync(file).size });
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  fileUrl = `http://127.0.0.1:${(server.address() as any).port}/clip.mp4`;
});
after(async () => { server.close(); await closeDb(); });

test("Twitch: top GTA clips for discovery, a permitted streamer's clips, and an official download", async () => {
  const { f, calls } = fakeFetch((c) => {
    const p = c.url.pathname, s = c.url.searchParams;
    if (c.url.host === "id.twitch.tv") return json({ access_token: "app-token", expires_in: 3600 });
    assert.equal(c.headers.get("client-id"), "tw_client");
    if (p === "/helix/games") return json({ data: [{ id: "32982", name: "Grand Theft Auto V" }, { id: "999", name: "Grand Theft Auto VI" }] });
    if (p === "/helix/clips" && s.get("game_id") === "32982") return json({ data: [clip("AAA", "b1", "Streamer1", 50_000, "32982", 3), clip("BBB", "b2", "Other", 9_000, "32982", 20)], pagination: {} });
    if (p === "/helix/clips" && s.get("game_id") === "999") return json({ data: [], pagination: {} });
    if (p === "/helix/users") return json({ data: [{ id: "b1", login: "streamer1", display_name: "Streamer1" }] });
    if (p === "/helix/clips" && s.get("broadcaster_id") === "b1") return json({ data: [clip("AAA", "b1", "Streamer1", 50_100, "32982", 3), clip("CCC", "b1", "Streamer1", 700, "32982", 30)], pagination: {} });
    if (p === "/helix/streams") return json({ data: [{ user_login: "streamer1", title: "GTA RP day 1", viewer_count: 12000 }] });
    if (p === "/helix/clips/downloads") {
      assert.equal(c.headers.get("authorization"), "Bearer user-token");
      assert.equal(s.get("editor_id"), "u_me");
      return json({ data: [{ clip_id: s.get("clip_id"), landscape_download_url: fileUrl, portrait_download_url: null }] });
    }
    return undefined;
  });
  setTwitch(new Twitch("tw_client", "tw_secret", f));
  await q("insert into streamers (platform, login, permission, proof, record_live) values ('twitch','streamer1','campaign','https://whop.example/campaign/1', true)");
  await setSetting("twitch_user", { user_id: "u_me", login: "ourclipdesk", access_token: "user-token", refresh_token: "r", expires_at: Date.now() + 3600_000 });

  const r = await ingestTwitch();
  assert.equal(r.clips, 4);
  assert.equal(r.downloads, 2, "AAA and CCC belong to the permitted streamer");
  const s = await one("select platform_user_id, display_name, is_live, live_viewers from streamers where login = 'streamer1'");
  assert.deepEqual([s.platform_user_id, s.display_name, s.is_live, s.live_viewers], ["b1", "Streamer1", true, 12000]);
  const aaa = await one("select streamer_id, view_count, game, meta from clips where id = 'tw:AAA'");
  assert.ok(aaa.streamer_id);
  assert.equal(aaa.view_count, 50_100);
  assert.equal(aaa.game, "gta5");
  assert.equal((await one("select streamer_id from clips where id = 'tw:BBB'")).streamer_id, null);
  assert.ok(calls.some((c) => c.url.pathname === "/helix/games"));

  await drain(["twitch_download"]);
  const usable = await findClips({ usableOnly: true });
  assert.deepEqual(usable.map((c) => c.id).sort(), ["tw:AAA", "tw:CCC"]);
  const got = await one("select media_key, width, height, duration_s from clips where id = 'tw:AAA'");
  assert.ok(got.media_key);
  assert.deepEqual([got.width, got.height], [1920, 1080]);
  assert.ok(Math.abs(got.duration_s - 10) < 0.5);
  assert.equal((await getSetting<any>("twitch_games")).ids["999"], "gta6");
});

test("pickDownloadUrl prefers the landscape file", () => {
  assert.equal(pickDownloadUrl({ portrait_download_url: "https://p.mp4", landscape_download_url: "https://l.mp4" }), "https://l.mp4");
  assert.equal(pickDownloadUrl({ something: "https://cdn/clip-download/1.mp4" }), "https://cdn/clip-download/1.mp4");
  assert.equal(pickDownloadUrl({ x: 1 }), null);
});

test("Kick: live GTA streams for discovery, and ledger streamers marked live", async () => {
  const { f } = fakeFetch((c) => {
    if (c.url.host === "id.kick.com") {
      assert.match(String(c.body), /grant_type=client_credentials/);
      return json({ access_token: "kick-token", expires_in: 3600 });
    }
    assert.equal(c.headers.get("authorization"), "Bearer kick-token");
    if (c.url.pathname === "/public/v1/categories") return json({ data: [{ id: 15, name: "Grand Theft Auto V" }, { id: 77, name: "Just Chatting" }] });
    if (c.url.pathname === "/public/v1/livestreams" && c.url.searchParams.get("category_id") === "15")
      return json({ data: [
        { slug: "kickstar", stream_title: "GTA RP: day 400", viewer_count: 21000, started_at: "2026-11-15T10:00:00Z", category: { name: "Grand Theft Auto V" }, broadcaster_user_id: 7, language: "en" },
        { slug: "small", stream_title: "chill", viewer_count: 40, category: { name: "Grand Theft Auto V" }, broadcaster_user_id: 8 },
      ] });
    return undefined;
  });
  setKick(new Kick("kick_client", "kick_secret", f));
  await q("insert into streamers (platform, login, permission, proof) values ('kick','kickstar','written','email 2026-11-15')");
  const r = await ingestKick();
  assert.equal(r.live, 2);
  const live = await getSetting<any>("kick_live");
  assert.deepEqual(live.streams.map((s: any) => s.slug), ["kickstar", "small"]);
  const k = await one("select is_live, live_viewers, platform_user_id from streamers where login = 'kickstar'");
  assert.deepEqual([k.is_live, k.live_viewers, k.platform_user_id], [true, 21000, "7"]);
});
