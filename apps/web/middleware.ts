/** Everything on the site, the studio included, is for the owner only. */
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, validSession } from "./lib/session";
import { sameHost } from "./lib/url";

export async function middleware(req: NextRequest) {
  const secret = process.env.SESSION_SECRET;
  const configured = Boolean(secret && process.env.OWNER_PASSWORD);
  // Local development without a password stays open; a deployed site without one stays shut.
  if (!configured && !process.env.VERCEL) return NextResponse.next();
  if (configured && (await validSession(secret, req.cookies.get(COOKIE)?.value))) return NextResponse.next();
  // Stay on the host the browser used, so its cookie comes back.
  const to = req.nextUrl.pathname === "/" ? "/login" : `/login?next=${encodeURIComponent(req.nextUrl.pathname)}`;
  return NextResponse.redirect(sameHost(req, to), 307);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|login|api/login).*)"],
};
