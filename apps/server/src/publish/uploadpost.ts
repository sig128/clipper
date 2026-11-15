/**
 * Upload-Post client: one API that posts to TikTok (through its audited app),
 * Instagram Reels and YouTube Shorts for each of our three profiles, and reads
 * back status and per-post numbers. Docs: https://docs.upload-post.com
 */
export class UploadPostError extends Error {
  constructor(message: string, public status: number, public retryable: boolean) { super(message); }
}

export type UpPlatform = "tiktok" | "instagram" | "youtube";

export interface UploadInput {
  user: string;
  platform: UpPlatform;
  videoUrl: string;
  /** TikTok / Instagram caption, and the YouTube title fallback */
  caption: string;
  youtubeTitle?: string;
  youtubeDescription?: string;
  tags?: string[];
  idempotencyKey: string;
}

export class UploadPost {
  constructor(private apiKey: string, private base = "https://api.upload-post.com", private f: typeof fetch = fetch) {}

  private async req(method: string, path: string, opts: { form?: FormData; json?: unknown; query?: Record<string, string>; headers?: Record<string, string> } = {}): Promise<any> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { Authorization: `Apikey ${this.apiKey}`, ...opts.headers };
    let body: BodyInit | undefined;
    if (opts.form) body = opts.form;
    else if (opts.json !== undefined) { body = JSON.stringify(opts.json); headers["content-type"] = "application/json"; }
    let res: Response;
    try {
      res = await this.f(url.toString(), { method, headers, body });
    } catch (e) {
      throw new UploadPostError(`Upload-Post unreachable: ${e instanceof Error ? e.message : e}`, 0, true);
    }
    const text = await res.text();
    let data: any = text;
    try { data = text ? JSON.parse(text) : {}; } catch { /* keep text */ }
    if (!res.ok || data?.success === false) {
      const msg = (typeof data === "object" && (data.message || data.error || data.detail)) || String(text).slice(0, 300) || `HTTP ${res.status}`;
      throw new UploadPostError(`Upload-Post ${res.status}: ${typeof msg === "string" ? msg : JSON.stringify(msg)}`, res.status, res.status === 429 || res.status >= 500 || res.status === 0);
    }
    return data;
  }

  /** Starts an upload (async on Upload-Post's side). Returns the request id to poll. */
  async upload(p: UploadInput): Promise<{ requestId: string | null; raw: any }> {
    const fd = new FormData();
    fd.append("user", p.user);
    fd.append("platform[]", p.platform);
    fd.append("video", p.videoUrl);
    fd.append("title", p.caption.slice(0, 2000));
    fd.append("async_upload", "true");
    if (p.platform === "youtube") {
      fd.append("youtube_title", (p.youtubeTitle ?? p.caption).slice(0, 100));
      fd.append("youtube_description", (p.youtubeDescription ?? p.caption).slice(0, 4900));
      for (const t of (p.tags ?? []).slice(0, 15)) fd.append("tags[]", t.replace(/^#/, ""));
      fd.append("categoryId", "20"); // Gaming
      fd.append("privacyStatus", "public");
      fd.append("selfDeclaredMadeForKids", "false");
      fd.append("containsSyntheticMedia", "false");
    } else if (p.platform === "tiktok") {
      fd.append("post_mode", "DIRECT_POST");
      fd.append("privacy_level", "PUBLIC_TO_EVERYONE");
      fd.append("is_aigc", "false");
    } else {
      fd.append("media_type", "REELS");
      fd.append("share_to_feed", "true");
    }
    const raw = await this.req("POST", "/api/upload", { form: fd, headers: { "Idempotency-Key": p.idempotencyKey } });
    return { requestId: raw?.request_id ?? raw?.requestId ?? raw?.job_id ?? null, raw };
  }

  status(requestId: string) {
    return this.req("GET", "/api/uploadposts/status", { query: { request_id: requestId } });
  }

  postAnalytics(requestId: string, platform?: UpPlatform) {
    return this.req("GET", `/api/uploadposts/post-analytics/${encodeURIComponent(requestId)}`, { query: platform ? { platform } : {} });
  }

  bestTimes(platform: UpPlatform, profile: string, timezone = "America/New_York", top = 6) {
    return this.req("GET", "/api/uploadposts/best-times", { query: { platform, profile_username: profile, timezone, top: String(top) } });
  }

  listProfiles() {
    return this.req("GET", "/api/uploadposts/users");
  }

  createProfile(username: string, displayName?: string) {
    return this.req("POST", "/api/uploadposts/users", { json: { username, display_name: displayName } });
  }

  /** A single-use link where the owner connects that profile's social accounts. */
  connectUrl(username: string, platforms: UpPlatform[], redirectUrl?: string) {
    return this.req("POST", "/api/uploadposts/users/generate-jwt", { json: { username, platforms, redirect_url: redirectUrl } });
  }
}

/** Status payloads vary by platform; this finds our platform's result and what it says. */
export function readStatus(raw: any, platform: UpPlatform): { state: "done" | "failed" | "pending"; url?: string; postId?: string; message?: string } {
  const results: any[] = Array.isArray(raw?.results) ? raw.results : [];
  const r = results.find((x) => String(x?.platform ?? "").toLowerCase() === platform) ?? (results.length === 1 ? results[0] : undefined);
  const top = String(raw?.status ?? "").toLowerCase();
  const pick = (o: any, keys: string[]) => keys.map((k) => o?.[k]).find((v) => typeof v === "string" && v.length > 0);
  if (r) {
    const st = String(r.status ?? "").toLowerCase();
    const url = pick(r, ["post_url", "url", "permalink", "video_url", "share_url"]);
    const postId = pick(r, ["platform_post_id", "post_id", "video_id", "media_id", "id"]);
    if (["queued", "processing", "in_progress", "pending", "retryable"].includes(st)) return { state: "pending", message: r.message };
    if (r.success === true || st === "completed" || st === "success") return { state: "done", url, postId, message: r.message };
    if (r.success === false || st === "failed" || st === "skipped") return { state: "failed", message: r.message ?? "Upload-Post reported a failure." };
  }
  if (top === "failed" || top === "not_found") return { state: "failed", message: raw?.message ?? `status ${top}` };
  if (top === "completed" && !r) return { state: "done" };
  return { state: "pending" };
}

const KEYS: Record<string, string[]> = {
  views: ["views", "view_count", "plays", "video_views", "play_count"],
  likes: ["likes", "like_count"],
  comments: ["comments", "comment_count"],
  shares: ["shares", "share_count"],
  saves: ["saves", "saved", "favorites", "favorite_count"],
};

/** Pulls the usual counters out of an analytics payload, wherever they sit. Missing means "not reported". */
export function readMetrics(raw: any): Record<"views" | "likes" | "comments" | "shares" | "saves", number | null> {
  const out: Record<string, number | null> = { views: null, likes: null, comments: null, shares: null, saves: null };
  const seen = new Set<any>();
  const walk = (o: any, depth: number) => {
    if (!o || typeof o !== "object" || depth > 6 || seen.has(o)) return;
    seen.add(o);
    for (const [k, v] of Object.entries(o)) {
      for (const [name, aliases] of Object.entries(KEYS)) {
        if (out[name] === null && aliases.includes(k.toLowerCase()) && typeof v === "number" && Number.isFinite(v)) out[name] = v;
      }
      if (typeof v === "object") walk(v, depth + 1);
    }
  };
  walk(raw, 0);
  return out as any;
}
