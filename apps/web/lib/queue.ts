import { Queue } from "bullmq";

/** Shared render queue handle for API routes. The worker (apps/worker) drains it. */
const connection = {
  host: process.env.REDIS_HOST ?? "127.0.0.1",
  port: Number(process.env.REDIS_PORT ?? 6379),
};

export const renderQueue = new Queue("render", { connection });
