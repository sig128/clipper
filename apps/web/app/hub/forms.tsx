"use client";
import { useFormState, useFormStatus } from "react-dom";
import { importClip, rotateKey, saveStreamer, setupUploadPost, type FormState } from "./actions";

function Submit({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  const { pending } = useFormStatus();
  return <button className={`btn${primary ? " primary" : ""}`} type="submit" disabled={pending}>{pending ? "Working…" : children}</button>;
}

function Note({ s }: { s: FormState }) {
  if (!s) return null;
  if (s.error) return <p className="bad">{s.error}</p>;
  if (s.ok) return <p className="ok">{s.ok}</p>;
  return null;
}

export function BotKey({ id, hasKey }: { id: string; hasKey: boolean }) {
  const [s, act] = useFormState(rotateKey, null);
  return (
    <form action={act} className="stack">
      <input type="hidden" name="id" value={id} />
      <div><Submit>{hasKey ? "Replace key" : "Make key"}</Submit></div>
      {s?.key ? (
        <div className="stack">
          <span className="warn">Copy it now: it won't be shown again. The old key stopped working.</span>
          <div className="key">{s.key}</div>
          <span className="muted">Server address for the bot: <code>{s.mcp}</code></span>
        </div>
      ) : null}
      <Note s={s} />
    </form>
  );
}

export function StreamerForm() {
  const [s, act] = useFormState(saveStreamer, null);
  return (
    <form action={act} className="form">
      <div className="row">
        <label className="field">Platform
          <select name="platform" defaultValue="kick"><option value="kick">Kick</option><option value="twitch">Twitch</option></select>
        </label>
        <label className="field">Channel
          <input name="login" placeholder="channel name" required />
        </label>
        <label className="field">Permission
          <select name="permission" defaultValue="campaign">
            <option value="campaign">Paid campaign</option>
            <option value="written">Written OK</option>
            <option value="own">Our own channel</option>
            <option value="none">None (watch only)</option>
          </select>
        </label>
      </div>
      <label className="field">Proof (campaign link, message link or email reference)
        <input name="proof" placeholder="https://… or 'email 15 Nov'" />
      </label>
      <div className="row">
        <label className="field">Best edge
          <select name="edge_hint" defaultValue="live"><option value="live">Leonida Live</option><option value="man">Leonida Man</option><option value="onepct">Leonida 1%</option><option value="">Any</option></select>
        </label>
        <label className="field">Note
          <input name="note" placeholder="campaign handle to show, rate per 1K…" />
        </label>
      </div>
      <label className="check"><input type="checkbox" name="record_live" defaultChecked /> Record their live streams and cut moments</label>
      <div><Submit primary>Save streamer</Submit></div>
      <Note s={s} />
    </form>
  );
}

export function UploadPostSetup() {
  const [s, act] = useFormState(setupUploadPost, null);
  return (
    <form action={act} className="stack">
      <div><Submit primary>Create profiles and get connect links</Submit></div>
      {s?.links ? (
        <div className="stack">
          {Object.entries(s.links).filter(([, v]) => v && typeof v === "object").map(([k, v]: [string, any]) => (
            <div key={k} className="row between">
              <span><b>{v.name}</b> <span className="dim">({v.profile})</span></span>
              {typeof v.connect === "string" ? <a className="btn small" href={v.connect} target="_blank" rel="noreferrer">Connect TikTok, Instagram, YouTube</a> : <code>{JSON.stringify(v.connect).slice(0, 120)}</code>}
            </div>
          ))}
          <span className="muted">Each link works once. Afterwards press "Read connected accounts".</span>
        </div>
      ) : null}
      <Note s={s} />
    </form>
  );
}

export function ImportForm() {
  const [s, act] = useFormState(importClip, null);
  return (
    <form action={act} className="form">
      <div className="row">
        <label className="field">Video URL (direct .mp4 link to our own capture)
          <input name="url" type="url" placeholder="https://…/capture.mp4" required />
        </label>
        <label className="field">Title
          <input name="title" placeholder="What happens" />
        </label>
        <label className="field">Game
          <select name="game" defaultValue="gta5"><option value="gta5">GTA V</option><option value="gta6">GTA VI</option><option value="other">Other</option></select>
        </label>
      </div>
      <div><Submit>Add to library</Submit></div>
      <Note s={s} />
    </form>
  );
}
