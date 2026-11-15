import { ago, EDGE_NAME, osloTime, PLAT_NAME, sapi } from "@/lib/server";
import { cancelPost } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge · Overview" };

const dot = (on: boolean) => <span className={`dot ${on ? "ok" : "warn"}`} />;

export default async function Overview() {
  const [ov, posts, act] = await Promise.all([sapi("/overview"), sapi("/posts?hours=24&ahead=24"), sapi("/activity?hours=24")]);
  if (!ov.ok) return <><h1>Overview</h1><p className="lede">{ov.error}</p></>;
  const o = ov.data;
  const c = o.connections;
  const upcoming = posts.ok ? posts.data.posts.filter((p: any) => new Date(p.at) > new Date()).sort((a: any, b: any) => a.at.localeCompare(b.at)) : [];
  const recent = posts.ok ? posts.data.posts.filter((p: any) => new Date(p.at) <= new Date()) : [];
  return (
    <>
      <h1>Overview</h1>
      <p className="lede">Three edges, nine accounts, four posts each a day. {o.gta6_unlocked ? "GTA VI is out." : "GTA VI unlocks Thu 19 Nov at midnight."}</p>

      <div className="grid cols-4">
        <div className="card"><div className="label">Published, 24 h</div><div className="stat">{o.posts.published_24h}</div></div>
        <div className="card"><div className="label">Upcoming</div><div className="stat">{o.posts.upcoming}</div></div>
        <div className="card"><div className="label">Clips in library</div><div className="stat">{o.clips.total}</div><div className="muted">{o.clips.with_video} with video · {o.clips.last_24h} new today</div></div>
        <div className="card"><div className="label">Failed, 24 h</div><div className={`stat ${o.posts.failed_24h ? "bad" : ""}`}>{o.posts.failed_24h}</div></div>
      </div>

      <div className="grid cols-2 section">
        <div className="card">
          <h2>Connections</h2>
          <div className="stack">
            <div className="row">{dot(c.upload_post)} Upload-Post (posting to all 9 accounts) <span className="spacer" />{c.upload_post ? <span className="chip">connected</span> : <span className="chip">needs API key</span>}</div>
            <div className="row">{dot(c.twitch_app)} Twitch app (clip discovery) <span className="spacer" />{c.twitch_app ? <span className="chip">connected</span> : <span className="chip">needs client ID</span>}</div>
            <div className="row">{dot(c.twitch_account)} Twitch account (official clip downloads) <span className="spacer" /><a className="chip" href="/hub/streamers">{c.twitch_account ? "connected" : "connect"}</a></div>
            <div className="row">{dot(c.kick_app)} Kick app (live GTA streams) <span className="spacer" />{c.kick_app ? <span className="chip">connected</span> : <span className="chip">needs client ID</span>}</div>
          </div>
        </div>
        <div className="card">
          <h2>Bots</h2>
          <div className="stack">
            {o.bots.map((b: any) => (
              <div className="row" key={b.id}>
                <span className={`dot ${b.last_seen_at && Date.now() - new Date(b.last_seen_at).getTime() < 3 * 3600_000 ? "ok" : ""}`} />
                <span>{b.name}</span><span className="spacer" />
                <span className="muted">{b.key_hint ? `seen ${ago(b.last_seen_at)}` : "no key yet"}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card section">
        <h2>Next 24 hours</h2>
        {upcoming.length ? (
          <div className="tablewrap"><table>
            <thead><tr><th>Norway time</th><th>Account</th><th>Title</th><th>Status</th><th /></tr></thead>
            <tbody>{upcoming.map((p: any) => (
              <tr key={p.id}>
                <td>{osloTime(p.at)}</td>
                <td>{EDGE_NAME[p.account_id.split("-")[0]]} · {PLAT_NAME[p.platform]}</td>
                <td>{p.title}</td>
                <td><span className="chip">{p.status}</span></td>
                <td>{p.status === "planned" ? <form action={cancelPost}><input type="hidden" name="id" value={p.id} /><button className="btn small">Cancel</button></form> : null}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <p className="muted">Nothing planned yet. The worker bots fill the slots once they're connected.</p>}
      </div>

      {recent.length ? (
        <div className="card section">
          <h2>Last 24 hours</h2>
          <div className="tablewrap"><table>
            <thead><tr><th>Norway time</th><th>Account</th><th>Title</th><th>Status</th><th>Views</th></tr></thead>
            <tbody>{recent.map((p: any) => (
              <tr key={p.id}>
                <td>{osloTime(p.at)}</td>
                <td>{EDGE_NAME[p.account_id.split("-")[0]]} · {PLAT_NAME[p.platform]}</td>
                <td>{p.url ? <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a> : p.title}{p.error ? <div className="bad">{p.error}</div> : null}</td>
                <td><span className="chip">{p.status}</span></td>
                <td>{p.views ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table></div>
        </div>
      ) : null}

      <div className="card section">
        <h2>Activity</h2>
        {act.ok && act.data.activity.length ? (
          <div className="feed">{act.data.activity.map((a: any, i: number) => (
            <div key={i}><time>{osloTime(a.at)}</time><span><b>{a.actor}</b> {a.action.replace(".", " ")} {a.target ? <span className="dim">{a.target}</span> : null}</span></div>
          ))}</div>
        ) : <p className="muted">No activity in the last 24 hours.</p>}
      </div>
    </>
  );
}
