/**
 * Clipforge publish worker: takes approved plan slots off the "publish" queue
 * and posts them where an official API allows it.
 *
 *   yt  -> YouTube Data API resumable upload (+ custom Shorts thumbnail)
 *   ig  -> Instagram Content Publishing API (Reels)
 *   tt  -> handoff: TikTok's terms reject internal uploaders for accounts you or
 *          your team manage, so the studio hands over a post kit instead
 *
 * Every job is idempotent: the intent store keys on revision + platform +
 * account, so a retried job resumes the same upload or container and can never
 * post a second copy. Needs Redis for the queue; credentials come from env.
 */
import { Worker, type Job } from "bullmq";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { intentKey, type Platform } from "@clipforge/contracts";
import { FileIntentStore, stamp } from "./publish/intents.js";
import { emptyLimits, type LimitState } from "./publish/limits.js";
import { publishYouTube, refreshGoogleToken, PublishError } from "./publish/youtube.js";
import { publishInstagram } from "./publish/instagram.js";

export type PublishJob = {
  revisionId: string;
  plat: Platform;
  acct: string;
  title: string;
  caption: string;
  publishAt?: string;
  videoPath?: string; // local file for YouTube
  videoUrl?: string; // signed URL for Instagram
  coverPath?: string;
  coverUrl?: string;
};

const STATE = process.env.PUBLISH_STATE_DIR ?? "/var/lib/clipforge";
const intents = new FileIntentStore(join(STATE, "intents.json"));
const limits: LimitState = emptyLimits();
const envKey = (acct: string) => acct.toUpperCase().replace(/[^A-Z0-9]/g, "_");
const need = (name: string) => { const v = process.env[name]; if (!v) throw new PublishError(`Missing ${name}. Connect this account on the server first.`, false); return v; };

async function run(job: Job<PublishJob>) {
  const j = job.data;
  if (j.plat === "tt") {
    await intents.put(stamp({ key: intentKey(j.revisionId, "tt", j.acct), revisionId: j.revisionId, plat: "tt" as const, acct: j.acct, status: "handoff" as const, attempts: 0 }));
    return { handoff: true };
  }
  if (j.plat === "yt") {
    const token = () => refreshGoogleToken(fetch, need("YT_CLIENT_ID"), need("YT_CLIENT_SECRET"), need(`YT_REFRESH_TOKEN_${envKey(j.acct)}`));
    const video = new Uint8Array(await readFile(j.videoPath ?? need("videoPath")));
    const thumbnail = j.coverPath ? new Uint8Array(await readFile(j.coverPath)) : undefined;
    return publishYouTube({ revisionId: j.revisionId, acct: j.acct, video, title: j.title, description: j.caption, publishAt: j.publishAt, thumbnail },
      { fetch, token, intents, limits, log: (m) => job.log(m) });
  }
  const igUserId = need(`IG_USER_ID_${envKey(j.acct)}`);
  return publishInstagram({ revisionId: j.revisionId, acct: j.acct, igUserId, videoUrl: j.videoUrl ?? need("videoUrl"), caption: j.caption, coverUrl: j.coverUrl },
    { fetch, token: async () => need(`IG_TOKEN_${envKey(j.acct)}`), intents, limits });
}

export const worker = new Worker<PublishJob>("publish", async (job) => {
  try { return await run(job); }
  catch (e) {
    // non-retryable errors (bad credentials, a rejected video) stop retries right away
    if (e instanceof PublishError && !e.retryable) await job.discard();
    throw e;
  }
}, {
  connection: { host: process.env.REDIS_HOST ?? "127.0.0.1", port: Number(process.env.REDIS_PORT ?? 6379) },
  concurrency: 1, // one upload at a time keeps quota math simple and avoids bursts
});

worker.on("completed", (job, res) => console.log(`[publish] ${job.data.plat} ${job.data.acct} ${job.id} ->`, res));
worker.on("failed", (job, err) => console.error(`[publish] ${job?.data.plat} ${job?.id} failed:`, err.message));
console.log("Clipforge publish worker online. Queue: publish.");
