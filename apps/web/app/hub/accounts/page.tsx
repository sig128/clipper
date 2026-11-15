import { EDGE_NAME, osloTime, PLAT_NAME, sapi } from "@/lib/server";
import { refreshHandles, togglePause } from "../actions";
import { UploadPostSetup } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge · Accounts" };

export default async function Accounts() {
  const [r, posts] = await Promise.all([sapi("/accounts"), sapi("/posts?hours=0&ahead=48")]);
  if (!r.ok) return <><h1>Accounts</h1><p className="lede">{r.error}</p></>;
  const EDGE_ORDER = ["man", "onepct", "live"], PLAT_ORDER = ["yt", "tt", "ig"];
  const edges: any[] = [...r.data.edges].sort((a, b) => EDGE_ORDER.indexOf(a.id) - EDGE_ORDER.indexOf(b.id));
  const accounts: any[] = [...r.data.accounts].sort((a, b) => PLAT_ORDER.indexOf(a.platform) - PLAT_ORDER.indexOf(b.platform));
  const upcoming: any[] = posts.ok ? posts.data.posts : [];
  return (
    <>
      <h1>Accounts</h1>
      <p className="lede">Each edge is one brand on YouTube, TikTok and Instagram. Posting times are in New York time, where most English GTA viewers are; the manager bot moves them when the numbers say so.</p>
      {edges.map((e) => (
        <section className="section" key={e.id}>
          <div className="row between"><h2>{e.name}</h2><span className="dim">Upload-Post profile: <code>{e.upload_post_user}</code></span></div>
          {e.guidance ? <div className="banner good" style={{ marginBottom: 12 }}>Manager: {e.guidance}</div> : null}
          <div className="grid cols-3">
            {accounts.filter((a) => a.edge_id === e.id).map((a) => (
              <div className="card stack" key={a.id}>
                <div className="row between">
                  <b>{PLAT_NAME[a.platform]}</b>
                  <span className="chip"><span className={`dot ${a.handle ? (a.paused ? "warn" : "ok") : ""}`} />{a.handle ? (a.paused ? "paused" : a.handle) : "not connected"}</span>
                </div>
                <div className="row dim">{a.slots.map((s: string) => <span key={s} className="chip">{s} NY</span>)}</div>
                <div className="mini3">
                  <div><div className="label">Posts 7 d</div><b>{a.published_7d}</b></div>
                  <div><div className="label">Views 7 d</div><b>{Number(a.views_7d).toLocaleString("en")}</b></div>
                  <div><div className="label">Upcoming</div><b>{a.upcoming}</b></div>
                </div>
                {upcoming.filter((p) => p.account_id === a.id).slice(0, 4).map((p) => (
                  <div key={p.id} className="row muted" style={{ fontSize: 13 }}><span>{osloTime(p.at)}</span><span className="dim">·</span><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</span></div>
                ))}
                <form action={togglePause}>
                  <input type="hidden" name="id" value={a.id} />
                  <input type="hidden" name="paused" value={a.paused ? "0" : "1"} />
                  <button className="btn small">{a.paused ? "Resume" : "Pause"}</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="grid cols-2 section">
        <div className="card">
          <h2>Connect the accounts</h2>
          <p className="muted">Clipforge creates the three Upload-Post profiles and gives you one link per edge. Each link connects that edge's TikTok, Instagram and YouTube in a few taps.</p>
          <UploadPostSetup />
        </div>
        <div className="card">
          <h2>After connecting</h2>
          <p className="muted">Read which accounts are connected so the handles show here.</p>
          <form action={refreshHandles}><button className="btn">Read connected accounts</button></form>
        </div>
      </div>
      <p className="dim section">{EDGE_NAME.man}, {EDGE_NAME.onepct} and {EDGE_NAME.live}: 4 posts per account per day, at least 2 hours apart.</p>
    </>
  );
}
