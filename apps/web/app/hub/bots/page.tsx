import { ago, EDGE_NAME, sapi, serverUrl } from "@/lib/server";
import { BotKey } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge · Bots" };

const ROLE: Record<string, string> = {
  manager: "Watches all 9 accounts, compares the edges, moves posting times, pauses what isn't working and steers the workers.",
  "worker-man": "Runs Leonida Man: chaos clips as Florida-Man-style news headlines.",
  "worker-onepct": "Runs Leonida 1%: secrets, details and fast answers, titled with what people search.",
  "worker-live": "Runs Leonida Live: permitted streamer moments, the weekly Streamer League, campaigns.",
};

export default async function Bots() {
  const r = await sapi("/bots");
  return (
    <>
      <h1>Bots</h1>
      <p className="lede">Your four Grok bots connect to Clipforge as a tool server. Each gets its own key and only the tools for its job; Clipforge does the posting and enforces the limits, so the bots never hold your account logins.</p>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="row between"><span className="muted">Tool server address (MCP)</span><code>{serverUrl ? `${serverUrl}/mcp` : "available once the server runs"}</code></div>
      </div>
      {!r.ok ? <p className="bad">{r.error}</p> : (
        <div className="grid cols-2">
          {r.data.bots.map((b: any) => (
            <div className="card stack" key={b.id}>
              <div className="row between">
                <b>{b.name}</b>
                <span className="chip">{b.role === "manager" ? "manager" : EDGE_NAME[b.edge_id]}</span>
              </div>
              <p className="muted" style={{ margin: 0 }}>{ROLE[b.id]}</p>
              <div className="row dim">
                <span>{b.key_hint ? `key …${b.key_hint}` : "no key yet"}</span>
                <span>·</span>
                <span>last call {ago(b.last_seen_at)}</span>
              </div>
              <BotKey id={b.id} hasKey={Boolean(b.key_hint)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
