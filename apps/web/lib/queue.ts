import { Queue } from "bullmq";

/**
 * Shared render queue handle for API routes. The worker (apps/worker) drains it.
 *
 * Created on first use, so importing this module never opens a Redis connection
 * (`next build` imports every route while collecting page data). Returns null when
 * the deployment has no Redis configured — the hosted studio-only deploy on Vercel —
 * so routes can answer 503 instead of hanging on a connection that will never open.
 * Locally it falls back to 127.0.0.1:6379 (docker compose).
 */
let queue: Queue | null | undefined;

const host = () => process.env.REDIS_HOST ?? "127.0.0.1";
const port = () => Number(process.env.REDIS_PORT ?? 6379);

/** True when this deployment has a Redis to queue renders on (checks env only, no connection). */
export function queueConfigured(): boolean {
  return Boolean(process.env.REDIS_HOST) || !process.env.VERCEL;
}

export function renderQueue(): Queue | null {
  if (queue !== undefined) return queue;
  if (!queueConfigured()) return (queue = null);
  // Commands wait for a live connection instead of piling up while Redis is down.
  queue = new Queue("render", { connection: { host: host(), port: port(), enableOfflineQueue: false } });
  // An 'error' event with no listener would crash the process; log each new error once.
  let last = "";
  queue.on("error", (err) => {
    if (err.message !== last) console.error("[render-queue]", err.message);
    last = err.message;
  });
  return queue;
}

/**
 * The queue once Redis answers; null when none is configured. Throws if Redis
 * doesn't answer within `ms` (BullMQ would otherwise wait for it indefinitely).
 */
export async function readyRenderQueue(ms = 3000): Promise<Queue | null> {
  const q = renderQueue();
  if (!q) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Redis at ${host()}:${port()} didn't answer within ${ms / 1000} s`)), ms);
  });
  try {
    await Promise.race([q.waitUntilReady(), timeout]);
  } finally {
    clearTimeout(timer);
  }
  return q;
}
