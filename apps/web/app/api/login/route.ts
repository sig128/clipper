import { NextResponse } from "next/server";
import { COOKIE, makeSession, passwordMatches } from "@/lib/session";
import { sameHost } from "@/lib/url";

export const dynamic = "force-dynamic";

const safeNext = (n: unknown) => (typeof n === "string" && /^\/[A-Za-z0-9/_-]*$/.test(n) ? n : "/hub");

export async function POST(req: Request) {
  const go = (to: string) => NextResponse.redirect(sameHost(req, to), 303);
  const secret = process.env.SESSION_SECRET;
  const expected = process.env.OWNER_PASSWORD;
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  if (!secret || !expected) return go("/login?setup=1");
  const typed = String(form.get("password") ?? "");
  if (!(await passwordMatches(secret, typed, expected))) {
    await new Promise((r) => setTimeout(r, 600));
    return go(`/login?error=1&next=${encodeURIComponent(next)}`);
  }
  const res = go(next);
  res.cookies.set(COOKIE, await makeSession(secret), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 30 * 86_400 });
  return res;
}
