/**
 * POST /api/renders — validate an EDL and enqueue a render job.
 * GET  /api/renders?id=... — report job status.
 *
 * The web tier never renders inline (that would block the request and keep the
 * browser open). It validates with the shared contract and hands off to the
 * BullMQ queue the worker drains. Progress is streamed separately over
 * /api/events (SSE) so a closed tab never loses a job.
 */
import { NextResponse } from "next/server";
import { EdlZ } from "@clipforge/contracts";
import { renderQueue } from "@/lib/queue";

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

  const projectId = String((body as any)?.projectId ?? "p_local");
  // Idempotency: one render per (revisionId) — the worker commits by revision.
  const jobId = `render:${parsed.data.revisionId}`;
  const job = await renderQueue.add(
    "render",
    { projectId, edl: parsed.data, outKey: `${projectId}/${parsed.data.revisionId}.mp4` },
    { jobId, removeOnComplete: 50, removeOnFail: 50, attempts: 1 },
  );

  return NextResponse.json({ jobId: job.id, status: "queued" }, { status: 202 });
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing_id" }, { status: 400 });
  const job = await renderQueue.getJob(id);
  if (!job) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const state = await job.getState();
  return NextResponse.json({
    jobId: job.id,
    state,
    progress: job.progress,
    returnvalue: job.returnvalue ?? null,
  });
}
