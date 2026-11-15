import { NextResponse } from "next/server";
import { COOKIE } from "@/lib/session";
import { sameHost } from "@/lib/url";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const res = NextResponse.redirect(sameHost(req, "/login"), 303);
  res.cookies.set(COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
