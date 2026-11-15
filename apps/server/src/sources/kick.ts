/**
 * Kick intake. Kick's official API has no clips endpoint, so: every 5 minutes we
 * list live GTA streams (official livestreams endpoint) for discovery and the
 * Streamer League, and mark which ledger streamers are live. The recorder then
 * records permitted streamers and cuts moments with services/media/detect.py.
 */
import { config, has } from "../config.js";
import { getSetting, q, setSetting } from "../db.js";

export class Kick {
  private tok: { value: string; exp: number } | null = null;
  constructor(private clientId: string, private clientSecret: string, private f: typeof fetch = fetch) {}

  async appToken(): Promise<string> {
    if (this.tok && this.tok.exp > Date.now() + 60_000) return this.tok.value;
    const r = await this.f("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: this.clientId, client_secret: this.clientSecret }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.access_token) throw new Error(`Kick OAuth: HTTP ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
    this.tok = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
    return this.tok.value;
  }

  async api(path: string, params: Record<string, string | string[] | undefined>): Promise<any> {
    const url = new URL(`https://api.kick.com/public/v1/${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, x);
    }
    const r = await this.f(url.toString(), { headers: { Authorization: `Bearer ${await this.appToken()}`, Accept: "application/json" } });
    const text = await r.text();
    if (!r.ok) throw new Error(`Kick ${path}: HTTP ${r.status} ${text.slice(0, 200)}`);
    return text ? JSON.parse(text) : {};
  }

  categories(query: string) { return this.api("categories", { q: query }); }
  livestreams(p: { categoryId?: number; limit?: number; sort?: "viewer_count" | "started_at"; broadcasterIds?: number[] }) {
    return this.api("livestreams", {
      category_id: p.categoryId !== undefined ? String(p.categoryId) : undefined,
      limit: String(p.limit ?? 50),
      sort: p.sort ?? "viewer_count",
      broadcaster_user_id: p.broadcasterIds?.map(String),
    });
  }
}

let kc: Kick | null = null;
export function kick(): Kick | null {
  if (!has.kick()) return null;
  return (kc ??= new Kick(config.kick.clientId, config.kick.clientSecret));
}
export function setKick(k: Kick | null) { kc = k; }

export type LiveStream = { slug: string; title: string; viewers: number; started_at: string | null; category: string; language: string | null; broadcaster_user_id: number | null };

async function gtaCategories(k: Kick): Promise<{ id: number; name: string }[]> {
  if (config.kick.categoryIds.length) return config.kick.categoryIds.map((id) => ({ id, name: "GTA" }));
  const cached = await getSetting<{ at: number; cats: { id: number; name: string }[] }>("kick_categories");
  if (cached && cached.at > Date.now() - 24 * 3600_000 && cached.cats.length) return cached.cats;
  const res = await k.categories("Grand Theft Auto");
  const cats = (res.data ?? [])
    .filter((c: any) => /grand theft auto|gta/i.test(String(c.name)))
    .map((c: any) => ({ id: Number(c.id), name: String(c.name) }));
  await setSetting("kick_categories", { at: Date.now(), cats });
  return cats;
}

const gameOf = (category: string) => (/\bvi\b|6/i.test(category) ? "gta6" : /\bv\b|5|grand theft auto/i.test(category) ? "gta5" : "other");

/** One discovery pass: who's live in GTA on Kick right now, and which ledger streamers are live. */
export async function ingestKick(): Promise<{ live: number }> {
  const k = kick();
  if (!k) return { live: 0 };
  const cats = await gtaCategories(k);
  const streams: LiveStream[] = [];
  for (const c of cats) {
    const res = await k.livestreams({ categoryId: c.id, limit: 50, sort: "viewer_count" });
    for (const s of res.data ?? []) {
      streams.push({
        slug: String(s.slug ?? s.channel?.slug ?? ""),
        title: String(s.stream_title ?? ""),
        viewers: Number(s.viewer_count ?? 0),
        started_at: s.started_at ?? null,
        category: String(s.category?.name ?? c.name),
        language: s.language ?? null,
        broadcaster_user_id: s.broadcaster_user_id ?? null,
      });
    }
  }
  streams.sort((a, b) => b.viewers - a.viewers);
  await setSetting("kick_live", { at: new Date().toISOString(), streams: streams.slice(0, 60) });
  const bySlug = new Map(streams.map((s) => [s.slug.toLowerCase(), s]));
  const ledger = await q<{ id: number; login: string }>("select id, login from streamers where platform = 'kick'");
  for (const s of ledger) {
    const l = bySlug.get(s.login.toLowerCase());
    await q(
      "update streamers set is_live = $2, live_title = $3, live_viewers = $4, live_checked_at = now(), platform_user_id = coalesce(platform_user_id, $5) where id = $1",
      [s.id, Boolean(l), l?.title ?? null, l?.viewers ?? null, l?.broadcaster_user_id ? String(l.broadcaster_user_id) : null],
    );
  }
  return { live: streams.length };
}

export { gameOf };
