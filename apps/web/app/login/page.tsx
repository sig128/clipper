export const dynamic = "force-dynamic";
export const metadata = { title: "Clipforge" };

export default function Login({ searchParams }: { searchParams: { error?: string; setup?: string; next?: string } }) {
  return (
    <main className="login">
      <form className="card login-card" method="post" action="/api/login">
        <div className="brand">Clipforge</div>
        <p className="muted">Private studio. Owner only.</p>
        <input type="hidden" name="next" value={searchParams.next ?? "/hub"} />
        <label className="field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" autoFocus required />
        </label>
        {searchParams.error ? <p className="bad">That password didn't match.</p> : null}
        {searchParams.setup ? <p className="bad">Login isn't set up on this deployment yet.</p> : null}
        <button className="btn primary" type="submit">Open Clipforge</button>
      </form>
    </main>
  );
}
