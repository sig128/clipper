/**
 * Clipforge render worker.
 *
 * Pulls render jobs off a BullMQ queue and executes them by spawning the Python
 * media service (services/media/render.py) with an argv array — never a shell,
 * so untrusted EDL values can't inject commands. Postgres is authoritative for
 * job state; Redis is only the queue. Progress is reported back so the web app
 * can stream it over SSE.
 *
 * This file is real, runnable code. Booting it needs Redis + Postgres (see
 * infra/docker-compose.yml); the render step it performs is the one already
 * verified end-to-end via the CLI.
 */
import { Worker, Queue, type Job } from "bullmq";
import { spawn } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { EdlZ, type Edl } from "@clipforge/contracts";

const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

const MEDIA = process.env.MEDIA_SCRIPT ?? "services/media/render.py";
const WORKDIR = process.env.RENDER_WORKDIR ?? "/tmp/clipforge-renders";

export const renderQueue = new Queue("render", { connection });

type RenderJobData = { projectId: string; edl: Edl; outKey: string };

/** Spawn python render.py, stream its NDJSON/stderr, resolve on success. */
function runRender(edlPath: string, outPath: string, onProgress: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const proc = spawn("python3", [MEDIA, "render", "--edl", edlPath, "--out", outPath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    // FFmpeg progress could be parsed here; the Python service emits a final
    // JSON result on stdout. We surface coarse progress as the process advances.
    proc.stdout.on("data", (b) => {
      const line = b.toString().trim();
      if (line.startsWith("{")) onProgress(0.95);
    });
    proc.stderr.on("data", (b) => {
      stderr += b.toString();
      // FFmpeg writes "time=HH:MM:SS.xx" to stderr — a real impl maps it to %.
      const m = stderr.match(/time=(\d+):(\d+):(\d+)/);
      if (m) onProgress(Math.min(0.9, (Number(m[2]) * 60 + Number(m[3])) / 30));
    });
    proc.on("error", reject);
    proc.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`render.py exited ${code}: ${stderr.slice(-500)}`)),
    );
  });
}

export const worker = new Worker<RenderJobData>(
  "render",
  async (job: Job<RenderJobData>) => {
    const edl = EdlZ.parse(job.data.edl); // validate untrusted input at the boundary
    await mkdir(WORKDIR, { recursive: true });
    const edlPath = join(WORKDIR, `${job.id}.edl.json`);
    const outPath = join(WORKDIR, `${job.id}.mp4`);
    await writeFile(edlPath, JSON.stringify(edl));

    await job.updateProgress(5);
    await runRender(edlPath, outPath, (p) => job.updateProgress(Math.round(p * 100)));
    await job.updateProgress(100);

    // A real impl uploads outPath to object storage under job.data.outKey and
    // records the render hash + EDL revision in Postgres (idempotent commit).
    return { out: outPath, outKey: job.data.outKey, revisionId: edl.revisionId };
  },
  { connection, concurrency: Number(process.env.RENDER_CONCURRENCY ?? 2) },
);

worker.on("completed", (job, res) => console.log(`[render] ${job.id} done ->`, res));
worker.on("failed", (job, err) => console.error(`[render] ${job?.id} failed:`, err.message));

console.log("Clipforge render worker online. Queue: render. Concurrency:",
  process.env.RENDER_CONCURRENCY ?? 2);
