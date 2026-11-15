import { Nav } from "./nav";
import { serverConfigured } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function HubLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="hub">
      <header className="top">
        <div className="brand">Clipforge</div>
        <Nav />
        <div className="spacer" />
        <form method="post" action="/api/logout"><button className="btn small" type="submit">Log out</button></form>
      </header>
      {serverConfigured ? null : (
        <div className="banner">The server isn't connected to the site yet. Pages fill in once it's running.</div>
      )}
      {children}
    </div>
  );
}
