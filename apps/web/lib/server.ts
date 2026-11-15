/** Calls the Clipforge server's owner API from the site's server side. The token never reaches the browser. */
const base = (process.env.CLIPFORGE_SERVER_URL ?? "").replace(/\/$/, "");
const token = process.env.CLIPFORGE_OWNER_TOKEN ?? "";

export const serverConfigured = Boolean(base && token);
export const serverUrl = base;

export type Res<T> = { ok: true; data: T } | { ok: false; error: string };

export async function sapi<T = any>(path: string, init: { method?: string; json?: unknown } = {}): Promise<Res<T>> {
  if (!serverConfigured) return { ok: false, error: "The Clipforge server isn't connected to this site yet." };
  try {
    const res = await fetch(`${base}/api${path}`, {
      method: init.method ?? "GET",
      headers: { authorization: `Bearer ${token}`, ...(init.json !== undefined ? { "content-type": "application/json" } : {}) },
      body: init.json !== undefined ? JSON.stringify(init.json) : undefined,
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: (data as any)?.error ?? `Server answered ${res.status}` };
    return { ok: true, data: data as T };
  } catch (e) {
    return { ok: false, error: `Can't reach the server: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const osloTime = (iso: string | Date | null | undefined) =>
  iso ? new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Oslo", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso)) : "—";

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 90) return "just now";
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

export const EDGE_NAME: Record<string, string> = { man: "Leonida Man", onepct: "Leonida 1%", live: "Leonida Live" };
export const PLAT_NAME: Record<string, string> = { yt: "YouTube", tt: "TikTok", ig: "Instagram" };
