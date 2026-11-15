/** Absolute URL on the host the browser used (Next can report "localhost" in req.url behind proxies and in `next start`). */
export function sameHost(req: Request, path: string): string {
  const h = req.headers;
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? new URL(req.url).host;
  const proto = (h.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")).split(",")[0].trim();
  return `${proto}://${host}${path}`;
}
