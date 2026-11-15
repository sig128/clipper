/** Media files: where they live, how they are served, and the ffmpeg/ffprobe helpers. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, stat, unlink } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { config } from "./config.js";

const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{8,160}$/;

export function mediaPath(key: string): string {
  if (!KEY.test(key)) throw new Error("bad media key");
  return path.join(config.mediaDir, key);
}

export const mediaUrl = (key: string | null | undefined) => (key ? `${config.publicUrl}/media/${key}` : null);

/** Moves (or copies) a finished file into the media store under a random, unguessable name. */
export async function storeFile(src: string, ext: string): Promise<string> {
  await mkdir(config.mediaDir, { recursive: true });
  const key = `${randomUUID()}.${ext.replace(/^\./, "")}`;
  const dest = mediaPath(key);
  try {
    await rename(src, dest);
  } catch {
    await copyFile(src, dest);
    await unlink(src).catch(() => {});
  }
  return key;
}

export async function workPath(name: string): Promise<string> {
  await mkdir(config.workDir, { recursive: true });
  return path.join(config.workDir, name);
}

/**
 * Streams a URL to a file, following redirects and refusing anything bigger than maxBytes.
 * Uses node:http(s) rather than fetch: undici asserts (and kills the process) on some
 * HTTP/1.0 servers that close the connection to end the body.
 */
export function downloadTo(url: string, dest: string, maxBytes = 1_500_000_000, timeoutMs = 10 * 60_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const go = (u: string, hops: number) => {
      let parsed: URL;
      try { parsed = new URL(u); } catch { return reject(new Error(`bad URL: ${u}`)); }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return reject(new Error("only http(s) URLs"));
      const req = (parsed.protocol === "https:" ? https : http).get(parsed, { headers: { "user-agent": "Clipforge/1.0" }, timeout: 30_000 }, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location) {
          res.resume();
          if (hops >= 5) return reject(new Error("too many redirects"));
          return go(new URL(res.headers.location, u).toString(), hops + 1);
        }
        if (code < 200 || code >= 300) { res.resume(); return reject(new Error(`download failed: HTTP ${code}`)); }
        if (Number(res.headers["content-length"] ?? 0) > maxBytes) { res.destroy(); return reject(new Error("file too large")); }
        let n = 0;
        res.on("data", (chunk: Buffer) => {
          n += chunk.length;
          if (n > maxBytes) res.destroy(new Error("file too large"));
        });
        const timer = setTimeout(() => res.destroy(new Error("download timed out")), timeoutMs);
        pipeline(res, createWriteStream(dest)).then(() => { clearTimeout(timer); resolve(n); }, (e) => { clearTimeout(timer); reject(e); });
      });
      req.on("timeout", () => req.destroy(new Error("no response from the server")));
      req.on("error", reject);
    };
    go(url, 0);
  });
}

/** Serves a stored file with HTTP range support so browsers can seek. */
export async function serveMedia(key: string, range: string | undefined): Promise<Response> {
  let file: string;
  try { file = mediaPath(key); } catch { return new Response("not found", { status: 404 }); }
  let size: number;
  try { size = (await stat(file)).size; } catch { return new Response("not found", { status: 404 }); }
  const type = key.endsWith(".mp4") ? "video/mp4" : key.endsWith(".jpg") ? "image/jpeg" : key.endsWith(".png") ? "image/png" : "application/octet-stream";
  const base = { "content-type": type, "accept-ranges": "bytes", "cache-control": "public, max-age=31536000, immutable" };
  const m = /^bytes=(\d*)-(\d*)$/.exec(range ?? "");
  if (m && (m[1] || m[2])) {
    let start = m[1] ? Number(m[1]) : size - Number(m[2]);
    let end = m[1] && m[2] ? Number(m[2]) : size - 1;
    start = Math.max(0, start); end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
    const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
    return new Response(body, { status: 206, headers: { ...base, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${size}` } });
  }
  const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
  return new Response(body, { status: 200, headers: { ...base, "content-length": String(size) } });
}

export function run(cmd: string, args: string[], opts: { timeoutMs?: number; cwd?: string } = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd: opts.cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => { stdout += d; if (stdout.length > 4e6) stdout = stdout.slice(-2e6); });
    p.stderr.on("data", (d) => { stderr += d; if (stderr.length > 4e6) stderr = stderr.slice(-2e6); });
    const timer = opts.timeoutMs ? setTimeout(() => p.kill("SIGKILL"), opts.timeoutMs) : null;
    p.on("error", (e) => { if (timer) clearTimeout(timer); reject(e); });
    p.on("close", (code) => { if (timer) clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
  });
}

export type Probe = { width: number; height: number; fps: string; duration: number };

export async function probe(file: string): Promise<Probe> {
  const r = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`ffprobe failed: ${r.stderr.slice(0, 300)}`);
  const j = JSON.parse(r.stdout);
  const s = j.streams?.[0];
  if (!s) throw new Error("no video stream");
  return { width: s.width, height: s.height, fps: s.r_frame_rate || "30/1", duration: Number(j.format?.duration ?? 0) };
}

/** Cuts [start, start+dur) into an MP4 that plays everywhere. */
export async function cutClip(src: string, dest: string, start: number, dur: number): Promise<void> {
  const r = await run("ffmpeg", [
    "-v", "error", "-y", "-ss", start.toFixed(2), "-i", src, "-t", dur.toFixed(2),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", dest,
  ], { timeoutMs: 10 * 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg cut failed: ${r.stderr.slice(-400)}`);
}

/** A JPEG still for the library grid. */
export async function stillFrame(src: string, dest: string, at: number): Promise<void> {
  const r = await run("ffmpeg", ["-v", "error", "-y", "-ss", at.toFixed(2), "-i", src, "-frames:v", "1", "-vf", "scale=480:-2", "-q:v", "4", dest], { timeoutMs: 60_000 });
  if (r.code !== 0) throw new Error(`ffmpeg still failed: ${r.stderr.slice(-300)}`);
}
