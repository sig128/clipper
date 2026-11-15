"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  ["/hub", "Overview"],
  ["/hub/library", "Library"],
  ["/hub/accounts", "Accounts"],
  ["/hub/bots", "Bots"],
  ["/hub/streamers", "Streamers"],
] as const;

export function Nav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="Clipforge">
      {LINKS.map(([href, label]) => (
        <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>{label}</Link>
      ))}
      <a href="/">Studio</a>
    </nav>
  );
}
