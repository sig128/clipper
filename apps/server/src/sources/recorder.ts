/**
 * Live recorder for permitted streamers (Kick and Twitch). streamlink pulls the
 * stream, ffmpeg cuts it into 5-minute segments, detect.py scores each finished
 * segment, and the best moments become 28-second clips in the library. Segments
 * are deleted once scanned, so the disk only holds clips.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readdir, readFile, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { log } from "../activity.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { upsertClip } from "../library.js";
import { cutClip, probe, run, stillFrame, storeFile, workPath } from "../media.js";
import { gameOf } from "./kick.js";

type Rec = { login: string; platform: "kick" | "twitch"; dir: string; sl: ChildProcess; ff: ChildProcess; startedAt: number };
const recs = new Map<string, Rec>();
const SEGMENT_S = 300;
const MIN_SCORE = 82;
/** detect.py scores relative to the segment's best moment, so keep only the top one per 5 minutes. */
const PER_SEGMENT = 1;

type Streamer = { id: number; platform: "kick" | "twitch"; login: string; display_name: string | null; live_title: string | null; live_viewers: number | null };

const streamUrl = (s: { platform: string; login: string }) => (s.platform === "kick" ? `https://kick.com/${s.login}` : `https://www.twitch.tv/${s.login}`);
const keyOf = (s: { platform: string; login: string }) => `${s.platform}:${s.login.toLowerCase()}`;

async function start(s: Streamer): Promise<void> {
  const dir = path.join(config.workDir, "rec", `${s.platform}-${s.login.toLowerCase()}`);
  await mkdir(dir, { recursive: true });
  const sl = spawn(config.streamlink, ["--stdout", "--retry-streams", "30", "--retry-max", "5", streamUrl(s), "best"], { stdio: ["ignore", "pipe", "pipe"] });
  const ff = spawn("ffmpeg", ["-v", "error", "-i", "pipe:0", "-c", "copy", "-f", "segment", "-segment_time", String(SEGMENT_S), "-reset_timestamps", "1", "-strftime", "1", path.join(dir, "%Y%m%d-%H%M%S.ts")], { stdio: ["pipe", "ignore", "pipe"] });
  sl.stdout!.pipe(ff.stdin!);
  sl.stderr!.on("data", () => {});
  ff.stderr!.on("data", () => {});
  ff.stdin!.on("error", () => {});
  const rec: Rec = { login: s.login, platform: s.platform, dir, sl, ff, startedAt: Date.now() };
  const done = () => { if (recs.get(keyOf(s)) === rec) recs.delete(keyOf(s)); };
  sl.on("close", () => { ff.stdin?.end(); done(); });
  ff.on("close", done);
  recs.set(keyOf(s), rec);
  await log("system", "record.start", keyOf(s));
}

function stop(k: string): void {
  const r = recs.get(k);
  if (!r) return;
  r.sl.kill("SIGINT");
  setTimeout(() => r.ff.kill("SIGINT"), 3000);
  recs.delete(k);
}

/** Scores one finished segment and keeps its best moments as clips. */
export async function processSegment(file: string, s: Streamer, category = "Grand Theft Auto V"): Promise<number> {
  const out = await workPath(`${path.basename(file)}.moments.json`);
  const r = await run(config.python, [path.join(config.mediaServiceDir, "detect.py"), file, "--out", out, "--max", "6"], { timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`detect failed: ${r.stderr.slice(-300)}`);
  const res = JSON.parse(await readFile(out, "utf8"));
  await unlink(out).catch(() => {});
  const moments: { t: number; score: number; why: string[]; cutscene: boolean }[] = (res.moments ?? [])
    .filter((m: any) => m.score >= MIN_SCORE && !m.cutscene)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, PER_SEGMENT);
  const segInfo = await probe(file).catch(() => null);
  const segDur = segInfo?.duration ?? SEGMENT_S;
  let kept = 0;
  for (const m of moments) {
    const startAt = Math.max(0, m.t - 18);
    const dur = Math.min(28, segDur - startAt);
    if (dur < 8) continue;
    const base = `${s.platform}-${s.login}-${path.basename(file, ".ts")}-${Math.round(m.t)}`.replace(/[^a-zA-Z0-9-]/g, "_");
    const mp4 = await workPath(`${base}.mp4`);
    await cutClip(file, mp4, startAt, dur);
    const info = await probe(mp4);
    const still = await workPath(`${base}.jpg`);
    await stillFrame(mp4, still, Math.min(dur / 2, 18)).catch(() => {});
    const key = await storeFile(mp4, "mp4");
    const stillKey = await storeFile(still, "jpg").catch(() => null);
    await upsertClip({
      id: `rec:${base}`,
      source: "kick_live",
      streamer_id: s.id,
      streamer_login: s.display_name ?? s.login,
      streamer_platform: s.platform,
      title: `${s.display_name ?? s.login}: ${m.why.join(", ").toLowerCase()}${s.live_title ? ` · ${s.live_title.slice(0, 80)}` : ""}`,
      url: streamUrl(s),
      media_key: key,
      width: info.width, height: info.height, fps: info.fps,
      duration_s: info.duration,
      view_count: s.live_viewers ?? 0,
      game: gameOf(category),
      created_at_source: new Date(),
      score: m.score * 10 + Math.log10((s.live_viewers ?? 0) + 1) * 50,
      moment: { t_in_clip: m.t - startAt, score: m.score, why: m.why, cutscene: m.cutscene },
      meta: stillKey ? { still_key: stillKey, live_title: s.live_title } : { live_title: s.live_title },
    });
    kept++;
  }
  return kept;
}

/** Called every minute: start/stop recorders to match who is live and permitted, and scan finished segments. */
export async function tickRecorders(): Promise<{ recording: string[]; clips: number }> {
  const wanted = await q<Streamer>(
    `select id, platform, login, display_name, live_title, live_viewers from streamers
     where record_live and permission <> 'none' and is_live order by live_viewers desc nulls last limit $1`,
    [config.maxRecorders],
  );
  const want = new Set(wanted.map(keyOf));
  for (const k of [...recs.keys()]) if (!want.has(k)) stop(k);
  for (const s of wanted) if (!recs.has(keyOf(s))) await start(s).catch((e) => console.error("[recorder] start", s.login, e.message));

  let clips = 0;
  const all = await q<Streamer>("select id, platform, login, display_name, live_title, live_viewers from streamers where record_live");
  const recRoot = path.join(config.workDir, "rec");
  const dirs = await readdir(recRoot).catch(() => [] as string[]);
  for (const d of dirs) {
    const s = all.find((x) => `${x.platform}-${x.login.toLowerCase()}` === d);
    const files = (await readdir(path.join(recRoot, d)).catch(() => [] as string[])).filter((f) => f.endsWith(".ts")).sort();
    const active = s && recs.has(keyOf(s));
    // The newest segment is still being written while recording.
    const ready = active ? files.slice(0, -1) : files;
    for (const f of ready) {
      const full = path.join(recRoot, d, f);
      const st = await stat(full).catch(() => null);
      if (!st || Date.now() - st.mtimeMs < 20_000) continue;
      try {
        if (s && st.size > 200_000) clips += await processSegment(full, s);
      } catch (e) {
        console.error("[recorder] segment", f, e instanceof Error ? e.message : e);
      } finally {
        await unlink(full).catch(() => {});
      }
    }
  }
  return { recording: [...recs.keys()], clips };
}

export function stopAllRecorders(): void {
  for (const k of [...recs.keys()]) stop(k);
}
