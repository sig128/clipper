import { sapi } from "@/lib/server";
import { connectTwitch } from "../actions";
import { StreamerForm } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge · Streamers" };

const PERM: Record<string, string> = { campaign: "paid campaign", written: "written OK", own: "our channel", none: "watch only" };

export default async function Streamers({ searchParams }: { searchParams: { error?: string } }) {
  const [s, live, ov] = await Promise.all([sapi("/streamers"), sapi("/live"), sapi("/overview")]);
  const kick: any[] = live.ok ? live.data.kick?.streams ?? [] : [];
  return (
    <>
      <h1>Streamers</h1>
      <p className="lede">The permission ledger. Clipforge only posts footage from streamers listed here with a campaign or a written OK, and only records the ones you tick.</p>
      {searchParams.error ? <div className="banner">{searchParams.error}</div> : null}
      <div className="grid cols-2">
        <div className="card">
          <h2>Add or update a streamer</h2>
          <StreamerForm />
        </div>
        <div className="card stack">
          <h2>Twitch clip downloads</h2>
          <p className="muted" style={{ margin: 0 }}>Twitch only lets editors download a channel's clips. Connect the Twitch account streamers add as an editor, then ask each permitted streamer to add it.</p>
          <div className="row">
            <span className={`dot ${ov.ok && ov.data.connections.twitch_account ? "ok" : "warn"}`} />
            <span>{ov.ok && ov.data.connections.twitch_account ? "Twitch account connected" : "Not connected"}</span>
          </div>
          <form action={connectTwitch}><button className="btn">Connect Twitch account</button></form>
        </div>
      </div>
      <div className="card section">
        <h2>Ledger</h2>
        {!s.ok ? <p className="bad">{s.error}</p> : s.data.streamers.length === 0 ? <p className="muted">No streamers yet. Start with the ones whose clipping campaigns you've joined.</p> : (
          <div className="tablewrap"><table>
            <thead><tr><th>Channel</th><th>Permission</th><th>Proof</th><th>Records</th><th>Live</th></tr></thead>
            <tbody>{s.data.streamers.map((x: any) => (
              <tr key={x.id}>
                <td><b>{x.display_name ?? x.login}</b> <span className="dim">{x.platform}</span></td>
                <td><span className="chip"><span className={`dot ${x.permission === "none" ? "warn" : "ok"}`} />{PERM[x.permission]}</span></td>
                <td className="muted">{x.proof ?? "—"}</td>
                <td>{x.record_live ? "yes" : "no"}</td>
                <td>{x.is_live ? <span className="ok">live · {Number(x.live_viewers ?? 0).toLocaleString("en")}</span> : <span className="dim">offline</span>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      <div className="card section">
        <h2>Live on Kick in GTA right now</h2>
        {kick.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Channel</th><th>Viewers</th><th>Title</th></tr></thead>
            <tbody>{kick.slice(0, 25).map((k) => (
              <tr key={k.slug}><td><a href={`https://kick.com/${k.slug}`} target="_blank" rel="noreferrer">{k.slug}</a></td><td>{Number(k.viewers).toLocaleString("en")}</td><td className="muted">{k.title}</td></tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Shows up once the Kick app is connected.</p>}
      </div>
    </>
  );
}
