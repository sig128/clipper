// The bots' tool server over real HTTP requests: auth, per-bot tool lists, scoping and checks.
import "./env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { app } from "../src/app.js";
import { rotateBotKey } from "../src/auth.js";
import { q } from "../src/db.js";
import { upsertClip } from "../src/library.js";
import { closeDb, resetDb } from "./helpers.js";

const keys: Record<string, string> = {};
let rpcId = 0;

async function rpc(key: string | null, method: string, params: object = {}) {
  const res = await app.request("/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function call(key: string, name: string, args: object = {}) {
  const r = await rpc(key, "tools/call", { name, arguments: args });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const result = r.body.result;
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}

before(async () => {
  await resetDb();
  for (const b of ["manager", "worker-man", "worker-live"]) keys[b] = (await rotateBotKey(b))!;
  await upsertClip({ id: "up:a", source: "upload", title: "Airboat chaos", media_key: "00000000-0000-0000-0000-000000000000.mp4", duration_s: 20, game: "gta5", score: 50 });
  await upsertClip({ id: "tw:b", source: "twitch_clip", title: "Streamer clip", streamer_login: "someone", streamer_platform: "twitch", duration_s: 30, view_count: 900, game: "gta5", score: 80 });
});
after(closeDb);

test("no key or a wrong key gets 401", async () => {
  assert.equal((await rpc(null, "tools/list")).status, 401);
  assert.equal((await rpc("cfb_wrong", "tools/list")).status, 401);
});

test("initialize works statelessly", async () => {
  const r = await rpc(keys["worker-man"], "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "grok", version: "1" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.result.serverInfo.name, "clipforge");
  assert.match(r.body.result.instructions, /whoami/);
});

test("workers and the manager get different tools", async () => {
  const w = (await rpc(keys["worker-man"], "tools/list")).body.result.tools.map((t: any) => t.name);
  const m = (await rpc(keys.manager, "tools/list")).body.result.tools.map((t: any) => t.name);
  for (const t of ["create_edit", "render_edit", "schedule_post", "find_clips", "open_slots"]) assert.ok(w.includes(t), `worker has ${t}`);
  for (const t of ["set_slots", "accounts_overview", "set_guidance", "pause_account", "best_times"]) assert.ok(!w.includes(t), `worker lacks ${t}`);
  for (const t of ["set_slots", "accounts_overview", "set_guidance", "activity", "find_clips"]) assert.ok(m.includes(t), `manager has ${t}`);
  assert.ok(!m.includes("create_edit"));
});

test("whoami and open_slots only show the worker's own edge", async () => {
  const me = await call(keys["worker-man"], "whoami");
  assert.deepEqual(me.data.accounts.map((a: any) => a.id), ["man-ig", "man-tt", "man-yt"]);
  assert.equal(me.data.edge, "Leonida Man");
  const slots = await call(keys["worker-man"], "open_slots", { days: 1 });
  assert.ok(slots.data.slots.length > 0);
  assert.ok(slots.data.slots.every((s: any) => s.account_id.startsWith("man-")));
  const all = await call(keys.manager, "open_slots", { days: 1 });
  assert.deepEqual([...new Set(all.data.slots.map((s: any) => s.account_id.split("-")[0]))].sort(), ["live", "man", "onepct"]);
});

test("find_clips defaults to clips we may use; the brief carries the manager's guidance", async () => {
  const usable = await call(keys["worker-man"], "find_clips", {});
  assert.deepEqual(usable.data.clips.map((c: any) => c.id), ["up:a"]);
  const any = await call(keys["worker-man"], "find_clips", { usable_only: false });
  assert.deepEqual(any.data.clips.map((c: any) => c.id), ["tw:b", "up:a"]);
  assert.equal(any.data.clips[0].why_not_usable, "no video file yet");
  const g = await call(keys.manager, "set_guidance", { edge: "man", guidance: "Airboat clips are winning. More of those, fewer car crashes." });
  assert.equal(g.isError, false);
  const brief = await call(keys["worker-man"], "get_brief");
  assert.equal(brief.data.edges.length, 1);
  assert.equal(brief.data.edges[0].name, "Leonida Man");
  assert.match(brief.data.edges[0].manager_guidance, /Airboat/);
  assert.ok(brief.data.house_rules.length >= 5);
});

test("tool calls go through the same checks and scopes", async () => {
  const refused = await call(keys["worker-man"], "create_edit", { clip_id: "tw:b", hook: "Wild streamer moment" });
  assert.equal(refused.isError, true);
  assert.ok(refused.data.detail.some((c: any) => c.k === "rights"));
  const ok = await call(keys["worker-man"], "create_edit", { clip_id: "up:a", hook: "LEONIDA MAN loses airboat", commentary: "Every single time." });
  assert.equal(ok.isError, false, JSON.stringify(ok.data));
  const other = await call(keys["worker-live"], "get_edit", { edit_id: ok.data.edit_id });
  assert.equal(other.isError, true);
  const steal = await call(keys["worker-live"], "schedule_post", { edit_id: ok.data.edit_id, title: "mine now" });
  assert.equal(steal.isError, true);
  assert.match(steal.data.error, /another edge/);
  const s = await call(keys["worker-man"], "schedule_post", { edit_id: ok.data.edit_id, title: "LEONIDA MAN loses airboat", platforms: ["yt", "tt"] });
  assert.equal(s.isError, false, JSON.stringify(s.data));
  assert.deepEqual(s.data.scheduled.map((p: any) => p.platform).sort(), ["tt", "yt"]);
});

test("the manager changes slots (2-hour rule enforced), pauses accounts and reads the overview", async () => {
  const bad = await call(keys.manager, "set_slots", { account_id: "man-tt", slots: ["12:00", "13:30", "18:00", "21:00"] });
  assert.equal(bad.isError, true);
  const good = await call(keys.manager, "set_slots", { account_id: "man-tt", slots: ["11:00", "15:00", "19:00", "23:00"] });
  assert.deepEqual(good.data.slots, ["11:00", "15:00", "19:00", "23:00"]);
  assert.equal((await call(keys.manager, "pause_account", { account_id: "live-ig", paused: true })).isError, false);
  const ov = await call(keys.manager, "accounts_overview", {});
  assert.equal(ov.data.accounts.length, 9);
  assert.equal(ov.data.accounts.find((a: any) => a.account_id === "live-ig").paused, true);
  assert.equal(ov.data.accounts.find((a: any) => a.account_id === "man-yt").upcoming, 1);
  const act = await call(keys.manager, "activity", { hours: 1 });
  assert.ok(act.data.activity.some((x: any) => x.action === "slots.set" && x.actor === "manager"));
  const seen = await q("select id from bots where last_seen_at is not null order by id");
  assert.deepEqual(seen.map((r) => r.id), ["manager", "worker-live", "worker-man"]);
});

test("the owner token also works on /mcp with the manager's tools", async () => {
  const r = await rpc("owner-test-token-0123456789abcdef", "tools/list");
  assert.ok(r.body.result.tools.some((t: any) => t.name === "accounts_overview"));
});
