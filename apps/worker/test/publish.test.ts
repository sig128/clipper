// Publisher tests against a recorded-shape fake of the YouTube and Instagram APIs.
// Run: pnpm --filter @clipforge/worker test
import { test } from "node:test";
import assert from "node:assert/strict";
import { publishYouTube, PublishError } from "../src/publish/youtube.js";
import { publishInstagram } from "../src/publish/instagram.js";
import { MemoryIntentStore } from "../src/publish/intents.js";
import { emptyLimits, pacificDay, youtubeRoom, spendYouTube, instagramRoom, noteInstagram } from "../src/publish/limits.js";
import { parseTimes, planBlockers, intentKey, type PlanEntry } from "@clipforge/contracts";

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fake(route: (c: Call, n: number) => Response | undefined) {
  const calls: Call[] = [];
  const f = async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, body: init.body };
    calls.push(c);
    return route(c, calls.length) ?? new Response("no route", { status: 599 });
  };
  return { f, calls };
}
const json = (o: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", ...headers } });
const VIDEO = new Uint8Array(2500).fill(7);
const NOW = () => new Date("2026-11-19T12:00:00Z");

test("YouTube: resumable upload, scheduled privacy, custom Shorts thumbnail, quota spent", async () => {
  let meta: any;
  const { f, calls } = fake((c) => {
    if (c.method === "POST" && c.url.includes("/videos?uploadType=resumable")) { meta = JSON.parse(String(c.body)); return new Response(null, { status: 200, headers: { location: "https://upload.test/session/1" } }); }
    if (c.method === "PUT" && c.url === "https://upload.test/session/1") return json({ id: "vid123" });
    if (c.method === "POST" && c.url.includes("/thumbnails/set?videoId=vid123")) return json({ items: [] });
  });
  const intents = new MemoryIntentStore(), limits = emptyLimits();
  const r = await publishYouTube({ revisionId: "rev1", acct: "a1", video: VIDEO, title: "Five stars. One pier.", description: "#GTA5 #Shorts", publishAt: "2026-11-19T17:00:00+01:00", thumbnail: new Uint8Array([1, 2, 3]) },
    { fetch: f, token: async () => "tok", intents, limits, now: NOW });
  assert.equal(r.id, "vid123");
  assert.equal(meta.status.privacyStatus, "private");
  assert.equal(meta.status.publishAt, "2026-11-19T17:00:00+01:00");
  assert.equal(calls[0].headers["X-Upload-Content-Length"], "2500");
  assert.equal(calls.length, 3);
  const it = await intents.get(intentKey("rev1", "yt", "a1"));
  assert.equal(it?.status, "published"); assert.equal(it?.remoteId, "vid123"); assert.equal(it?.session, undefined);
  assert.equal(youtubeRoom(limits, NOW()).used, 150);
});

test("YouTube: the same revision never posts twice", async () => {
  const intents = new MemoryIntentStore();
  await intents.put({ key: intentKey("rev1", "yt", "a1"), revisionId: "rev1", plat: "yt", acct: "a1", status: "published", remoteId: "vid123", attempts: 1, updatedAt: "x" });
  const { f, calls } = fake(() => undefined);
  const r = await publishYouTube({ revisionId: "rev1", acct: "a1", video: VIDEO, title: "t", description: "d" }, { fetch: f, token: async () => "tok", intents, limits: emptyLimits(), now: NOW });
  assert.deepEqual(r, { id: "vid123", skipped: true });
  assert.equal(calls.length, 0);
});

test("YouTube: a crash mid-upload resumes the same session from the right byte", async () => {
  let starts = 0, attempt = 0;
  const { f, calls } = fake((c) => {
    if (c.method === "POST" && c.url.includes("uploadType=resumable")) { starts++; return new Response(null, { status: 200, headers: { location: "https://upload.test/s/9" } }); }
    if (c.method === "PUT" && c.headers["Content-Range"] === "bytes */2500") return new Response(null, { status: 308, headers: { range: "bytes=0-999" } });
    if (c.method === "PUT") { attempt++; return attempt === 1 ? new Response("backend error", { status: 503 }) : json({ id: "vid777" }); }
  });
  const intents = new MemoryIntentStore(), limits = emptyLimits(), deps = { fetch: f, token: async () => "tok", intents, limits, now: NOW };
  const job = { revisionId: "rev2", acct: "a1", video: VIDEO, title: "t", description: "d" };
  await assert.rejects(publishYouTube(job, deps), (e: unknown) => e instanceof PublishError && e.retryable);
  assert.equal((await intents.get(intentKey("rev2", "yt", "a1")))?.session, "https://upload.test/s/9");
  const r = await publishYouTube(job, deps);
  assert.equal(r.id, "vid777");
  assert.equal(starts, 1, "only one upload session for one revision");
  const last = calls[calls.length - 1];
  assert.equal(last.headers["Content-Range"], "bytes 1000-2499/2500");
  assert.equal((last.body as Uint8Array).byteLength, 1500);
});

test("YouTube: stops before calling the API when today's quota is used up", async () => {
  const limits = emptyLimits(); spendYouTube(limits, NOW(), 9_900);
  const { f, calls } = fake(() => undefined);
  await assert.rejects(publishYouTube({ revisionId: "rev3", acct: "a1", video: VIDEO, title: "t", description: "d" }, { fetch: f, token: async () => "tok", intents: new MemoryIntentStore(), limits, now: NOW }),
    (e: unknown) => e instanceof PublishError && /quota/.test(e.message) && e.retryable);
  assert.equal(calls.length, 0);
});

test("Instagram: limit check, container, processing, publish", async () => {
  let polls = 0;
  const { f, calls } = fake((c) => {
    if (c.url.includes("/content_publishing_limit")) return json({ data: [{ quota_usage: 3, config: { quota_total: 100 } }] });
    if (c.method === "POST" && /\/ig42\/media\?/.test(c.url)) return json({ id: "c1" });
    if (c.method === "GET" && c.url.includes("/c1?")) return json({ status_code: ++polls < 3 ? "IN_PROGRESS" : "FINISHED" });
    if (c.method === "POST" && c.url.includes("/media_publish?") && c.url.includes("creation_id=c1")) return json({ id: "m1" });
  });
  const intents = new MemoryIntentStore(), limits = emptyLimits(), waits: number[] = [];
  const r = await publishInstagram({ revisionId: "rev4", acct: "a1", igUserId: "ig42", videoUrl: "https://cdn.test/v.mp4", caption: "Four cop cars. One ramp. #GTA5" },
    { fetch: f, token: async () => "igtok", intents, limits, now: NOW, sleep: async (ms) => { waits.push(ms) } });
  assert.equal(r.id, "m1");
  assert.ok(calls.find((c) => c.url.includes("media_type=REELS") && c.url.includes("video_url=https%3A%2F%2Fcdn.test%2Fv.mp4")));
  assert.deepEqual(waits, [5000, 8000]);
  assert.equal((await intents.get(intentKey("rev4", "ig", "a1")))?.status, "published");
  assert.equal(instagramRoom(limits, "a1", NOW()).used, 1);
});

test("Instagram: a rejected video fails cleanly and frees the container", async () => {
  const { f } = fake((c) => {
    if (c.url.includes("/content_publishing_limit")) return json({ data: [{ quota_usage: 0 }] });
    if (c.method === "POST" && c.url.includes("/media?")) return json({ id: "c9" });
    if (c.url.includes("/c9?")) return json({ status_code: "ERROR", status: "Video too short" });
  });
  const intents = new MemoryIntentStore();
  await assert.rejects(publishInstagram({ revisionId: "rev5", acct: "a1", igUserId: "ig42", videoUrl: "https://cdn.test/v.mp4", caption: "x" },
    { fetch: f, token: async () => "t", intents, limits: emptyLimits(), now: NOW, sleep: async () => {} }), (e: unknown) => e instanceof PublishError && !e.retryable);
  const it = await intents.get(intentKey("rev5", "ig", "a1"));
  assert.equal(it?.status, "failed"); assert.equal(it?.session, undefined); assert.match(it?.error ?? "", /couldn’t process/);
});

test("Instagram: 100 posts in 24 hours blocks the next one before any API call", async () => {
  const limits = emptyLimits(); for (let i = 0; i < 100; i++) noteInstagram(limits, "a1", new Date(NOW().getTime() - i * 60_000));
  const { f, calls } = fake(() => undefined);
  await assert.rejects(publishInstagram({ revisionId: "rev6", acct: "a1", igUserId: "ig42", videoUrl: "u", caption: "c" }, { fetch: f, token: async () => "t", intents: new MemoryIntentStore(), limits, now: NOW, sleep: async () => {} }), /100 times/);
  assert.equal(calls.length, 0);
});

test("YouTube quota day follows Pacific Time", () => {
  assert.equal(pacificDay(new Date("2026-11-19T07:59:00Z")), "2026-11-18");
  assert.equal(pacificDay(new Date("2026-11-19T08:00:00Z")), "2026-11-19");
});

test("Plan rules: times two hours apart, one edit per platform, no GTA VI before launch", () => {
  assert.deepEqual(parseTimes("21:00, 12:00 17:00").times, ["12:00", "17:00", "21:00"]);
  assert.match(parseTimes("15:00, 16:30").err ?? "", /less than 2 hours/);
  assert.match(parseTimes("25:00").err ?? "", /isn’t a time/);
  const plan: PlanEntry[] = [{ id: "e1", acct: "a1", plat: "yt", at: "2026-11-20T12:00", clip: "g1", title: "t", caption: "", status: "planned" }];
  assert.match(planBlockers({ id: "e2", clip: "g1", plat: "yt", acct: "a3", at: "2026-11-21T12:00" }, plan, "2026-11-19T10:00")[0], /once per platform/);
  assert.deepEqual(planBlockers({ id: "e3", clip: "g1", plat: "tt", acct: "a1", at: "2026-11-21T12:00" }, plan, "2026-11-19T10:00"), []);
  assert.match(planBlockers({ id: "e4", clip: "g6", plat: "yt", acct: "a1", at: "2026-11-18T11:00", game: "gta6" }, plan, "2026-11-14T10:00").join(), /before launch/);
});
