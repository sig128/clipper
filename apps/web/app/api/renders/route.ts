/**
 * POST /api/renders — validate an EDL and enqueue a render job.
 * GET  /api/renders?id=... — report job status.
 *
 * The web tier never renders inline (that would block the request and keep the
 * browser open). It validates with the shared contract and hands off to the
 * BullMQ queue the worker drains. Progress is streamed separately over
 * /api/events (SSE) so a closed tab never loses a job.
 *
 * Without Redis (the hosted studio-only deploy) both answer 503 with a reason.
 */
import { NextResponse } from "next/server";
import { EdlZ } from "@clipforge/contracts";
import { readyRenderQueue } from "@/lib/queue";
import type { Queue } from "bullmq";

// Never prerender at build time; every call talks to the queue.
export const dynamic = "force-dynamic";

const noQueue = () =>
  NextResponse.json(
    { error: "queue_not_configured", detail: "Set REDIS_HOST (and REDIS_PORT) to the Redis the render worker uses." },
    { status: 503 },
  );
const queueDown = (err: unknown) =>
  NextResponse.json(
    { error: "queue_unavailable", detail: err instanceof Error ? err.message : String(err) },
    { status: 503 },
  );

/** The ready queue, or the 503 response to send instead. */
async function queueOr503(): Promise<Queue | Response> {
  try {
    return (await readyRenderQueue()) ?? noQueue();
  } catch (err) {
    return queueDown(err);
  }
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = EdlZ.safeParse((body as any)?.edl);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_edl", issues: parsed.error.issues },
      { status: 422 },
    );
  }

  const queue = await queueOr503();
  if (queue instanceof Response) return queue;

  const projectId = String((body as any)?.projectId ?? "p_local");
  // Idempotency: one render per (revisionId) — the worker commits by revision.
  // BullMQ rejects custom ids containing ":", so the prefix uses "-" and the id is encoded.
  const jobId = `render-${encodeURIComponent(parsed.data.revisionId)}`;
  try {
    const job = await queue.add(
      "render",
      { projectId, edl: parsed.data, outKey: `${projectId}/${parsed.data.revisionId}.mp4` },
      { jobId, removeOnComplete: 50, removeOnFail: 50, attempts: 1 },
    );
    return NextResponse.json({ jobId: job.id, status: "queued" }, { status: 202 });
  } catch (err) {
    return queueDown(err);
  }
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const queue = await queueOr503();
  if (queue instanceof Response) return queue;
  try {
    const job = await queue.getJob(id);
    if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
    const state = await job.getState();
    return NextResponse.json({
      jobId: job.id,
      state,
      progress: job.progress,
      returnvalue: job.returnvalue ?? null,
    });
  } catch (err) {
    return queueDown(err);
  }
}
