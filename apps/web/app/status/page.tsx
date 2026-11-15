/**
 * Status page for the web tier (/status). The studio itself is served at "/"
 * (apps/studio/clipforge-studio.html, copied into public/ at build time).
 */
import { queueConfigured } from "@/lib/queue";

export const dynamic = "force-dynamic";

export default function Status() {
  const queue = queueConfigured() ? "configured" : "not configured (set REDIS_HOST)";
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.5px" }}>Clipforge</h1>
      <p style={{ color: "#b4bcca", fontSize: 16 }}>
        Private AI clipping studio. This page reports the web tier.
      </p>
      <ul style={{ color: "#b4bcca", lineHeight: 2 }}>
        <li>Studio: <a href="/" style={{ color: "#eef1f6" }}>/</a> (runs in the browser; plan saved on this device)</li>
        <li>Render queue: <code>POST /api/renders</code> → BullMQ → worker — {queue}</li>
        <li>Canonical EDL: <code>@clipforge/contracts</code></li>
      </ul>
    </main>
  );
}
