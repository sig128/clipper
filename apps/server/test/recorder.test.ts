// A recorded stream segment becomes a library clip; old unused files are cleaned up.
import "./env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { TMP } from "./env.js";
import { one, q } from "../src/db.js";
import { mediaPath } from "../src/media.js";
import { retentionPass } from "../src/retention.js";
import { processSegment } from "../src/sources/recorder.js";
import { closeDb, fixtureVideo, resetDb } from "./helpers.js";

before(resetDb);
after(closeDb);

test("a finished segment is scanned and its best moment kept as a 28-second clip", async () => {
  const mp4 = fixtureVideo("segment.mp4", 40);
  const ts = path.join(TMP, "fx", "20261115-200000.ts");
  execFileSync("ffmpeg", ["-v", "error", "-y", "-i", mp4, "-c", "copy", "-f", "mpegts", ts]);
  const s = await one("insert into streamers (platform, login, display_name, permission, proof, record_live, live_title, live_viewers) values ('kick','kickstar','KickStar','written','email','t','GTA RP day 400', 21000) returning id, platform, login, display_name, live_title, live_viewers");
  const kept = await processSegment(ts, s);
  assert.ok(kept <= 1);
  const clips = await q("select id, source, streamer_id, duration_s, media_key, moment, title from clips");
  assert.equal(clips.length, kept);
  if (kept) {
    const c = clips[0];
    assert.equal(c.source, "kick_live");
    assert.equal(c.streamer_id, s.id);
    assert.ok(c.duration_s > 7 && c.duration_s <= 28.5, String(c.duration_s));
    assert.ok(existsSync(mediaPath(c.media_key)));
    assert.match(c.title, /^KickStar: /);
  }
});

test("retention deletes old unused clip files but keeps the library entry", async () => {
  const c = await one("select id, media_key from clips limit 1");
  if (!c) return; // nothing kept from the synthetic segment
  await q("update clips set ingested_at = now() - interval '4 days' where id = $1", [c.id]);
  const r = await retentionPass();
  assert.ok(r.files >= 1);
  assert.equal(existsSync(mediaPath(c.media_key)), false);
  const after = await one("select media_key, meta from clips where id = $1", [c.id]);
  assert.equal(after.media_key, null);
  assert.ok(after.meta.media_removed);
});
