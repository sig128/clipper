// Clip → edit → render (real render.py) → schedule → publish through a fake Upload-Post → status → metrics.
import "./env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { one, q } from "../src/db.js";
import { createEdit, EditRefused, getEdit } from "../src/edits.js";
import { drain } from "../src/jobs.js";
import { upsertClip } from "../src/library.js";
import { mediaPath, probe, storeFile } from "../src/media.js";
import { schedulePost } from "../src/posts.js";
import { collectMetrics, setUploadPost } from "../src/publisher.js";
import { UploadPost } from "../src/publish/uploadpost.js";
import { registerJobs } from "../src/index.js";
import { closeDb, fakeFetch, fixtureVideo, json, resetDb } from "./helpers.js";

let editId = "";
const uploads: { platform: string; idem: string | null; fields: Record<string, string[]> }[] = [];
let failNextUpload = false;

const { f } = fakeFetch(async (c) => {
  if (c.method === "POST" && c.url.pathname === "/api/upload") {
    assert.equal(c.headers.get("authorization"), "Apikey up_test_key");
    if (failNextUpload) { failNextUpload = false; return json({ message: "upstream timeout" }, 502); }
    const fd = c.body as FormData;
    const fields: Record<string, string[]> = {};
    for (const [k, v] of fd.entries()) (fields[k] ??= []).push(String(v));
    uploads.push({ platform: fields["platform[]"][0], idem: c.headers.get("idempotency-key"), fields });
    return json({ success: true, request_id: `req_${fields["platform[]"][0]}` });
  }
  if (c.url.pathname === "/api/uploadposts/status") {
    const plat = c.url.searchParams.get("request_id")!.replace("req_", "");
    return json({ request_id: c.url.searchParams.get("request_id"), status: "completed", results: [{ platform: plat, success: true, post_url: `https://${plat}.example/p/1`, platform_post_id: `${plat}-1` }] });
  }
  if (c.url.pathname.startsWith("/api/uploadposts/post-analytics/")) return json({ success: true, analytics: { views: 1234, likes: 56, comments: 7, shares: 3 } });
  return undefined;
});

before(async () => {
  await resetDb();
  registerJobs();
  setUploadPost(new UploadPost("up_test_key", "https://up.test", f));
  const src = fixtureVideo("pipeline.mp4", 12);
  const info = await probe(src);
  const key = await storeFile(src, "mp4");
  await upsertClip({ id: "up:gator", source: "upload", title: "Airboat vs gator", media_key: key, width: info.width, height: info.height, fps: info.fps, duration_s: info.duration, game: "gta5", score: 500 });
  await upsertClip({ id: "tw:nopermission", source: "twitch_clip", title: "Someone else's stream", streamer_login: "stranger", streamer_platform: "twitch", media_key: key, duration_s: 20, game: "gta5", score: 900 });
});
after(closeDb);

test("checks refuse spoilers, missing permission and missing hooks", async () => {
  await assert.rejects(createEdit({ edge: "man", clipId: "up:gator", hook: "The ending: Lucia dies", by: "worker-man" }), (e: unknown) => e instanceof EditRefused && e.checks.some((c) => c.k === "spoiler"));
  await assert.rejects(createEdit({ edge: "live", clipId: "tw:nopermission", hook: "Wild moment", by: "worker-live" }), (e: unknown) => e instanceof EditRefused && e.checks.some((c) => c.k === "rights"));
  await assert.rejects(createEdit({ edge: "man", clipId: "up:missing", hook: "x x x", by: "worker-man" }), /No clip/);
});

test("an edit with our layer is accepted", async () => {
  const { edit, checks } = await createEdit({ edge: "man", clipId: "up:gator", hook: "x", headline: "LEONIDA MAN vs one (1) alligator", commentary: "He thought the pier kept going", inS: 1, outS: 11, by: "worker-man" });
  assert.equal(edit.hook, "LEONIDA MAN vs one (1) alligator");
  assert.equal(edit.layout, "full");
  assert.deepEqual(checks, []);
  editId = edit.id;
});

test("scheduling takes the next open slot on all three platforms and queues the render", async () => {
  const r = await schedulePost({ editId, title: "LEONIDA MAN vs one (1) alligator", caption: "Leonida news at 11.", hashtags: ["GTA6", "#FloridaMan"], by: "worker-man", edgeScope: "man" });
  assert.equal(r.refused.length, 0, JSON.stringify(r.refused));
  assert.deepEqual(r.scheduled.map((p) => p.platform).sort(), ["ig", "tt", "yt"]);
  assert.deepEqual(r.scheduled[0].hashtags, ["#GTA6", "#FloridaMan"]);
  assert.equal((await getEdit(editId))!.render_status, "queued");
});

test("duplicates, other edges' edits and posts within 2 hours are refused", async () => {
  const again = await schedulePost({ editId, title: "Again", by: "worker-man", edgeScope: "man" });
  assert.equal(again.scheduled.length, 0);
  assert.ok(again.refused.every((x) => x.reasons.some((m) => /already planned|2 hours/.test(m))));
  await assert.rejects(schedulePost({ editId, title: "Steal", by: "worker-onepct", edgeScope: "onepct" }), /another edge/);
  const { edit: other } = await createEdit({ edge: "onepct", clipId: "up:gator", hook: "Gators in GTA 6 do this", commentary: "Watch the tail", by: "worker-onepct" });
  const dup = await schedulePost({ editId: other.id, title: "Gator detail", by: "worker-onepct", edgeScope: "onepct" });
  assert.equal(dup.scheduled.length, 0);
  assert.ok(dup.refused.every((x) => x.reasons.some((m) => /already goes out/.test(m))), JSON.stringify(dup.refused));
});

test("GTA VI footage can't be scheduled before it unlocks", async () => {
  await q("update clips set game = 'gta6' where id = 'up:gator'");
  const { edit } = await createEdit({ edge: "live", clipId: "up:gator", hook: "First look", commentary: "Day one", by: "worker-live" });
  const r = await schedulePost({ editId: edit.id, at: "2026-11-18T10:00:00Z", title: "First look", by: "worker-live", edgeScope: "live" });
  assert.equal(r.scheduled.length, 0);
  assert.ok(r.refused.every((x) => x.reasons.some((m) => /before launch/.test(m))));
  await q("update clips set game = 'gta5' where id = 'up:gator'");
});

test("render.py makes a 1080x1920 MP4 and the posts get publish jobs", async () => {
  await drain(["render"]);
  const e = (await getEdit(editId))!;
  assert.equal(e.render_status, "ready", e.render_error ?? "");
  assert.ok(existsSync(mediaPath(e.media_key!)));
  const info = await probe(mediaPath(e.media_key!));
  assert.deepEqual([info.width, info.height], [1080, 1920]);
  assert.ok(Math.abs(info.duration - 10) < 0.6, `duration ${info.duration}`);
  assert.equal((await one("select count(*)::int as n from jobs where kind = 'publish'"))!.n, 3);
});

test("at slot time each post goes to Upload-Post once, with the right fields, and survives a retry", async () => {
  await q("update posts set at = now() + interval '90 seconds' where edit_id = $1", [editId]);
  await q("update jobs set run_at = now() where kind = 'publish'");
  failNextUpload = true;
  await drain(["publish"]);
  // the 502 put one job back in the queue with backoff; run it now
  await q("update jobs set run_at = now() where kind = 'publish' and status = 'queued'");
  await drain(["publish"]);
  assert.equal(uploads.length, 3);
  const byPlat = Object.fromEntries(uploads.map((u) => [u.platform, u]));
  const posts = await q("select platform, intent_key, status from posts where edit_id = $1", [editId]);
  for (const p of posts) {
    assert.equal(p.status, "sent");
    const up = byPlat[{ yt: "youtube", tt: "tiktok", ig: "instagram" }[p.platform as "yt"]];
    assert.equal(up.idem, p.intent_key, "idempotency key is the post's intent key");
    assert.equal(up.fields.user[0], "leonida-man");
    assert.match(up.fields.video[0], /^https:\/\/clipforge\.test\/media\/.+\.mp4$/);
  }
  assert.equal(byPlat.youtube.fields.youtube_title[0], "LEONIDA MAN vs one (1) alligator");
  assert.equal(byPlat.youtube.fields.categoryId[0], "20");
  assert.deepEqual(byPlat.youtube.fields["tags[]"], ["GTA6", "FloridaMan"]);
  assert.equal(byPlat.tiktok.fields.post_mode[0], "DIRECT_POST");
  assert.equal(byPlat.tiktok.fields.privacy_level[0], "PUBLIC_TO_EVERYONE");
  assert.match(byPlat.tiktok.fields.title[0], /Leonida news at 11\.\n\n#GTA6 #FloridaMan/);
  assert.equal(byPlat.instagram.fields.media_type[0], "REELS");
});

test("status polling marks posts published with their links; metrics get read", async () => {
  await q("update jobs set run_at = now() where kind = 'post_status'");
  await drain(["post_status"]);
  const posts = await q("select platform, status, remote_url, remote_post_id from posts where edit_id = $1 order by platform", [editId]);
  assert.deepEqual(posts.map((p) => [p.platform, p.status, p.remote_url, p.remote_post_id]), [
    ["ig", "published", "https://instagram.example/p/1", "instagram-1"],
    ["tt", "published", "https://tiktok.example/p/1", "tiktok-1"],
    ["yt", "published", "https://youtube.example/p/1", "youtube-1"],
  ]);
  await q("update posts set at = now() - interval '2 hours' where edit_id = $1", [editId]);
  assert.equal(await collectMetrics(), 3);
  const m = await q("select views, likes, comments, shares, age_h from metrics");
  assert.deepEqual(m.map((r) => [r.views, r.likes, r.comments, r.shares]), [[1234, 56, 7, 3], [1234, 56, 7, 3], [1234, 56, 7, 3]]);
  assert.equal(await collectMetrics(), 0, "no second reading until the next sample age");
});

test("the same clip never goes out twice on one platform, even from another edge", async () => {
  const { edit } = await createEdit({ edge: "live", clipId: "up:gator", hook: "Second try", commentary: "x", by: "worker-live" });
  const r = await schedulePost({ editId: edit.id, accountIds: ["live-yt"], title: "Second try", by: "worker-live", edgeScope: "live" });
  assert.equal(r.scheduled.length, 0);
  assert.match(r.refused[0].reasons.join(" "), /already goes out/);
});

test("a paused account's planned post is cancelled at send time", async () => {
  const media = (await getEdit(editId))!.media_key;
  await upsertClip({ id: "up:second", source: "upload", title: "Second capture", media_key: (await one("select media_key from clips where id = 'up:gator'"))!.media_key, duration_s: 12, game: "gta5", score: 10 });
  const { edit } = await createEdit({ edge: "onepct", clipId: "up:second", hook: "Pause test", commentary: "x", by: "worker-onepct" });
  await q("update edits set render_status = 'ready', media_key = $2 where id = $1", [edit.id, media]);
  const r = await schedulePost({ editId: edit.id, accountIds: ["onepct-yt"], title: "Pause test", by: "worker-onepct", edgeScope: "onepct" });
  assert.equal(r.scheduled.length, 1, JSON.stringify(r.refused));
  await q("update accounts set paused = true where id = 'onepct-yt'");
  await q("update posts set at = now() + interval '60 seconds' where id = $1", [r.scheduled[0].id]);
  await q("update jobs set run_at = now() where kind = 'publish' and status = 'queued'");
  const before = uploads.length;
  await drain(["publish"]);
  assert.equal((await one("select status from posts where id = $1", [r.scheduled[0].id]))!.status, "cancelled");
  assert.equal(uploads.length, before, "nothing sent for a paused account");
});

test("launch week allows posts 90 minutes apart; outside it the 2-hour rule holds", async () => {
  await upsertClip({ id: "up:l1", source: "upload", title: "Launch clip 1", media_key: (await one("select media_key from clips where id = 'up:gator'"))!.media_key, duration_s: 12, game: "gta6", score: 5 });
  await upsertClip({ id: "up:l2", source: "upload", title: "Launch clip 2", media_key: (await one("select media_key from clips where id = 'up:gator'"))!.media_key, duration_s: 12, game: "gta6", score: 5 });
  await upsertClip({ id: "up:l3", source: "upload", title: "Late clip", media_key: (await one("select media_key from clips where id = 'up:gator'"))!.media_key, duration_s: 12, game: "gta6", score: 5 });
  const mk = async (clip: string) => (await createEdit({ edge: "onepct", clipId: clip, hook: "GTA 6 first 10 minutes", commentary: "No spoilers", by: "worker-onepct" })).edit.id;
  const a = await schedulePost({ editId: await mk("up:l1"), accountIds: ["onepct-tt"], at: "2026-11-19T12:00:00Z", title: "GTA 6 first 10 minutes (no spoilers)", by: "worker-onepct", edgeScope: "onepct" });
  assert.equal(a.scheduled.length, 1, JSON.stringify(a.refused));
  const b = await schedulePost({ editId: await mk("up:l2"), accountIds: ["onepct-tt"], at: "2026-11-19T13:40:00Z", title: "How big is the GTA 6 map?", by: "worker-onepct", edgeScope: "onepct" });
  assert.equal(b.scheduled.length, 1, "100 minutes apart is fine in launch week: " + JSON.stringify(b.refused));
  const c = await schedulePost({ editId: await mk("up:l3"), accountIds: ["onepct-tt"], at: "2026-11-19T14:30:00Z", title: "Too close", by: "worker-onepct", edgeScope: "onepct" });
  assert.match(c.refused[0].reasons.join(" "), /Less than 90 minutes/);
  await q("update posts set at = at + interval '10 days' where account_id = 'onepct-tt'");
  const d = await schedulePost({ editId: (await one("select id from edits where clip_id = 'up:l3'"))!.id, accountIds: ["onepct-tt"], at: "2026-11-29T14:30:00Z", title: "Outside launch week", by: "worker-onepct", edgeScope: "onepct" });
  assert.match(d.refused[0].reasons.join(" "), /Less than 2 hours/);
});
