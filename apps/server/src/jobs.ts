/**
 * A small durable job queue on Postgres (FOR UPDATE SKIP LOCKED), plus timers
 * for recurring work. Jobs survive restarts; a crashed job is picked up again
 * once its lock expires. unique_key keeps one queued/running job per key.
 */
import { one, q } from "./db.js";

export type Job = { id: number; kind: string; payload: any; attempts: number; max_attempts: number; run_at: Date };
type Handler = (payload: any, job: Job) => Promise<unknown>;
type Registered = { fn: Handler; concurrency: number; lockMs: number; running: number };

/** Throw to run the job again later without counting it as a failed attempt. */
export class Later extends Error {
  constructor(public ms: number, why = "waiting") { super(why); }
}

/** Throw for errors a retry can't fix (bad input, permission refused). */
export class Permanent extends Error {
  readonly retryable = false;
}

const handlers = new Map<string, Registered>();
const giveUp = new Map<string, (payload: any, error: string) => Promise<void>>();

export function handle(kind: string, fn: Handler, opts: { concurrency?: number; lockMs?: number } = {}): void {
  handlers.set(kind, { fn, concurrency: opts.concurrency ?? 2, lockMs: opts.lockMs ?? 10 * 60_000, running: 0 });
}

/** Called once when a job has failed for the last time. */
export function onGiveUp(kind: string, fn: (payload: any, error: string) => Promise<void>): void {
  giveUp.set(kind, fn);
}

export async function enqueue(kind: string, payload: object = {}, opts: { runAt?: Date; uniqueKey?: string; maxAttempts?: number } = {}): Promise<number | null> {
  const r = await one<{ id: number }>(
    `insert into jobs (kind, payload, run_at, unique_key, max_attempts) values ($1,$2,coalesce($3, now()),$4,$5)
     on conflict (unique_key) where unique_key is not null and status in ('queued','running') do nothing
     returning id`,
    [kind, JSON.stringify(payload), opts.runAt ?? null, opts.uniqueKey ?? null, opts.maxAttempts ?? 5],
  );
  return r?.id ?? null;
}

async function claim(kind: string, lockMs: number): Promise<Job | undefined> {
  return one<Job>(
    `update jobs set status = 'running', attempts = attempts + 1, locked_until = now() + ($2 || ' milliseconds')::interval, updated_at = now()
     where id = (
       select id from jobs
       where kind = $1 and ((status = 'queued' and run_at <= now()) or (status = 'running' and locked_until < now()))
       order by run_at limit 1 for update skip locked)
     returning id, kind, payload, attempts, max_attempts, run_at`,
    [kind, String(lockMs)],
  );
}

const backoff = (attempt: number) => Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));

async function execute(kind: string, h: Registered, job: Job): Promise<void> {
  try {
    const result = await h.fn(job.payload, job);
    await q("update jobs set status = 'done', result = $2, locked_until = null, last_error = null, updated_at = now() where id = $1", [job.id, JSON.stringify(result ?? null)]);
  } catch (e) {
    if (e instanceof Later) {
      await q(
        `update jobs set status = 'queued', attempts = attempts - 1, run_at = now() + ($2 || ' milliseconds')::interval,
         locked_until = null, last_error = $3, updated_at = now() where id = $1`,
        [job.id, String(e.ms), e.message],
      );
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const final = job.attempts >= job.max_attempts || (e as { retryable?: boolean })?.retryable === false;
    await q(
      `update jobs set status = $2, run_at = now() + ($3 || ' milliseconds')::interval, locked_until = null, last_error = $4, updated_at = now() where id = $1`,
      [job.id, final ? "failed" : "queued", String(backoff(job.attempts)), msg.slice(0, 2000)],
    );
    console.error(`[job ${kind}#${job.id}] attempt ${job.attempts}/${job.max_attempts}${final ? " (gave up)" : ""}: ${msg}`);
    if (final) await giveUp.get(kind)?.(job.payload, msg).catch((err) => console.error(`[job ${kind}] give-up hook`, err));
  }
}

/** Claims and runs one due job of this kind; false when none was due. */
async function runOne(kind: string): Promise<boolean> {
  const h = handlers.get(kind);
  if (!h) return false;
  const job = await claim(kind, h.lockMs);
  if (!job) return false;
  h.running++;
  try { await execute(kind, h, job); } finally { h.running--; }
  return true;
}

let stopping = false;
let ticking = false;
const timers: NodeJS.Timeout[] = [];

export function startJobs(pollMs = 2000): void {
  const tick = async () => {
    if (stopping || ticking) return;
    ticking = true;
    try {
      for (const [kind, h] of handlers) {
        while (h.running < h.concurrency) {
          const job = await claim(kind, h.lockMs);
          if (!job) break;
          h.running++;
          void execute(kind, h, job).finally(() => { h.running--; });
        }
      }
    } finally {
      ticking = false;
    }
  };
  timers.push(setInterval(() => tick().catch((e) => console.error("[jobs] tick", e)), pollMs));
}

/** Runs fn every `ms`, never overlapping itself; the first run comes after `firstMs`. */
export function every(name: string, ms: number, fn: () => Promise<unknown>, firstMs = 5_000): void {
  let busy = false;
  const run = async () => {
    if (busy || stopping) return;
    busy = true;
    try { await fn(); } catch (e) { console.error(`[every ${name}]`, e instanceof Error ? e.message : e); } finally { busy = false; }
  };
  timers.push(setTimeout(run, firstMs));
  timers.push(setInterval(run, ms));
}

export function stopJobs(): void {
  stopping = true;
  for (const t of timers) { clearInterval(t); clearTimeout(t); }
}

/** Runs everything due right now, one at a time, and waits (tests and scripts). */
export async function drain(kinds?: string[]): Promise<number> {
  let n = 0;
  for (let pass = 0; pass < 100; pass++) {
    let ran = false;
    for (const kind of kinds ?? [...handlers.keys()]) {
      while (await runOne(kind)) { n++; ran = true; }
    }
    if (!ran) break;
  }
  return n;
}
