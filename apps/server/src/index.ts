/** Boots the server: migrate, seed the network, serve HTTP, then run jobs and timers. */
import { mkdir } from "node:fs/promises";
import { serve } from "@hono/node-server";
import { log } from "./activity.js";
import { app } from "./app.js";
import { config } from "./config.js";
import { migrate, pool, q } from "./db.js";
import { seedNetwork } from "./edges.js";
import { renderGaveUp, renderJob } from "./edits.js";
import { every, handle, onGiveUp, startJobs, stopJobs } from "./jobs.js";
import { collectMetrics, postStatusJob, publishJob } from "./publisher.js";
import { retentionPass } from "./retention.js";
import { ingestKick } from "./sources/kick.js";
import { stopAllRecorders, tickRecorders } from "./sources/recorder.js";
import { ingestTwitch, twitchDownloadJob } from "./sources/twitch.js";

export function registerJobs(): void {
  handle("render", renderJob, { concurrency: config.renderConcurrency, lockMs: 25 * 60_000 });
  handle("publish", publishJob, { concurrency: 4, lockMs: 10 * 60_000 });
  handle("post_status", postStatusJob, { concurrency: 4 });
  handle("twitch_download", twitchDownloadJob, { concurrency: 2 });
  handle("twitch_ingest", () => ingestTwitch(), { concurrency: 1 });
  handle("kick_ingest", () => ingestKick(), { concurrency: 1 });
  handle("metrics", () => collectMetrics(), { concurrency: 1 });
  onGiveUp("render", renderGaveUp);
  onGiveUp("publish", async ({ postId }, error) => {
    await q("update posts set status = 'failed', error = $2, updated_at = now() where id = $1 and status in ('planned','sending')", [postId, error.slice(0, 1000)]);
    await log("system", "post.failed", postId, { error: error.slice(0, 300) });
  });
}

async function main() {
  await mkdir(config.mediaDir, { recursive: true });
  await mkdir(config.workDir, { recursive: true });
  const applied = await migrate();
  if (applied.length) console.log("migrations:", applied.join(", "));
  await seedNetwork();
  registerJobs();

  const server = serve({ fetch: app.fetch, port: config.port });
  console.log(`clipforge server on :${config.port} (${config.publicUrl})`);

  if (config.jobs) {
    startJobs();
    every("twitch", 10 * 60_000, () => ingestTwitch());
    every("kick", 5 * 60_000, () => ingestKick(), 8_000);
    every("recorders", 60_000, () => tickRecorders(), 15_000);
    every("metrics", 30 * 60_000, () => collectMetrics(), 60_000);
    every("retention", 6 * 3600_000, () => retentionPass(), 120_000);
  }

  const shutdown = async (sig: string) => {
    console.log(`${sig}: shutting down`);
    stopJobs();
    stopAllRecorders();
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (process.env.CLIPFORGE_NO_MAIN !== "1") {
  main().catch((e) => {
    console.error("fatal:", e);
    process.exit(1);
  });
}
