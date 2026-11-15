import Link from "next/link";
import { sapi } from "@/lib/server";
import { ImportForm } from "../forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge · Library" };

const TABS = [
  ["all", "Everything", ""],
  ["usable", "Ready to post", "usable=1"],
  ["twitch", "Twitch clips", "source=twitch_clip"],
  ["live", "Recorded moments", "source=kick_live"],
  ["upload", "Our captures", "source=upload"],
] as const;

export default async function Library({ searchParams }: { searchParams: { tab?: string } }) {
  const tab = TABS.find((t) => t[0] === searchParams.tab) ?? TABS[0];
  const r = await sapi(`/clips?limit=96&${tab[2]}`);
  return (
    <>
      <h1>Library</h1>
      <p className="lede">Every Twitch clip we see, every moment cut from recorded streams, and our own captures. Only clips with a video file and a permission record can be posted.</p>
      <div className="tabs">
        {TABS.map(([id, label]) => <Link key={id} href={`/hub/library?tab=${id}`} className={`btn small${id === tab[0] ? " primary" : ""}`}>{label}</Link>)}
      </div>
      {!r.ok ? <p className="bad">{r.error}</p> : r.data.clips.length === 0 ? <p className="muted">No clips here yet.</p> : (
        <div className="clipgrid">
          {r.data.clips.map((c: any) => (
            <article className="clip" key={c.id}>
              {c.media_url ? <video className="media" src={c.media_url} preload="none" controls playsInline poster={c.thumbnail_url ?? undefined} />
                : c.thumbnail_url ? <img className="media" src={c.thumbnail_url} alt="" loading="lazy" /> : <div className="media" />}
              <div className="meta">
                <div className="t">{c.title ?? c.id}</div>
                <div className="row">
                  <span className={`dot ${c.usable ? "ok" : "warn"}`} />
                  <span className="muted">{c.usable ? "ready" : c.why_not_usable}</span>
                </div>
                <div className="row dim">
                  {c.streamer ? <span>{c.streamer}</span> : null}
                  {c.views ? <span>{Number(c.views).toLocaleString("en")} views</span> : null}
                  {c.duration_s ? <span>{Math.round(c.duration_s)} s</span> : null}
                  {c.status === "used" ? <span className="chip">used</span> : null}
                </div>
                {c.source_url ? <a className="dim" href={c.source_url} target="_blank" rel="noreferrer">source ↗</a> : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <div className="card section">
        <h2>Add our own capture</h2>
        <ImportForm />
      </div>
    </>
  );
}
