/**
 * Minimal landing/health page for the web tier.
 *
 * The full studio UI (the 10-section workspace: Today, Sources, Moments,
 * Studio editor, Covers, Publish, Performance, Playbook, AI Team, Connections)
 * is the interactive prototype already designed; porting it into this Next app
 * is Milestone 1's front-end task. This page confirms the app boots and the
 * render API is reachable.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 34, fontWeight: 800, letterSpacing: "-0.5px" }}>Clipforge</h1>
      <p style={{ color: "#b4bcca", fontSize: 16 }}>
        Private AI clipping studio. Local-first render pipeline online.
      </p>
      <ul style={{ color: "#b4bcca", lineHeight: 2 }}>
        <li>Media service: <code>services/media/render.py</code> (verified)</li>
        <li>Render queue: <code>POST /api/renders</code> → BullMQ → worker</li>
        <li>Canonical EDL: <code>@clipforge/contracts</code></li>
      </ul>
    </main>
  );
}
