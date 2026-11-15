/** Server configuration, read once from the environment. Nothing secret has a default. */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

function publicUrl(): string {
  if (env.PUBLIC_URL) return env.PUBLIC_URL.replace(/\/$/, "");
  if (env.RAILWAY_PUBLIC_DOMAIN) return `https://${env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${env.PORT ?? 8080}`;
}

export const config = {
  port: Number(env.PORT ?? 8080),
  databaseUrl: env.DATABASE_URL ?? "postgres://localhost:5432/clipforge",
  databaseSsl: env.PGSSL === "1",
  publicUrl: publicUrl(),
  /** The website (Vercel) uses this to call the owner API; also accepted on /mcp. */
  ownerToken: env.OWNER_TOKEN ?? "",
  /** Where the site lives, for links and the Twitch connect redirect. */
  siteUrl: (env.SITE_URL ?? "").replace(/\/$/, ""),
  mediaDir: env.MEDIA_DIR ?? "/data/media",
  workDir: env.WORK_DIR ?? "/data/work",
  mediaServiceDir: env.MEDIA_SERVICE_DIR ?? path.resolve(here, "../../../services/media"),
  python: env.PYTHON ?? "python3",
  streamlink: env.STREAMLINK ?? "streamlink",
  uploadPost: {
    apiKey: env.UPLOAD_POST_API_KEY ?? "",
    base: (env.UPLOAD_POST_BASE ?? "https://api.upload-post.com").replace(/\/$/, ""),
  },
  twitch: { clientId: env.TWITCH_CLIENT_ID ?? "", clientSecret: env.TWITCH_CLIENT_SECRET ?? "" },
  kick: {
    clientId: env.KICK_CLIENT_ID ?? "",
    clientSecret: env.KICK_CLIENT_SECRET ?? "",
    /** Comma-separated category ids; found by name when empty. */
    categoryIds: (env.KICK_CATEGORY_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(Number),
  },
  /** The owner's clock, for the dashboard and launch timing. */
  ownerTz: env.OWNER_TZ ?? "Europe/Oslo",
  /** "off" runs the API only (tests, a second instance). */
  jobs: env.JOBS !== "off",
  /** Most videos rendered at once. */
  renderConcurrency: Number(env.RENDER_CONCURRENCY ?? 1),
  /** Most live streams recorded at once. */
  maxRecorders: Number(env.MAX_RECORDERS ?? 3),
  /**
   * GTA VI rolls out by region: New Zealand first (11:00 UTC Wed 18 Nov), the US about
   * 18 hours later. Footage is fair game from the first official unlock. Launch mode runs
   * from then until 72 hours after the US unlock.
   */
  gta6UnlockUtc: env.GTA6_UNLOCK_UTC ?? "2026-11-18T11:00:00Z",
  launchEndUtc: env.LAUNCH_END_UTC ?? "2026-11-22T05:00:00Z",
  launchMode: env.LAUNCH_MODE !== "off",
};

export const has = {
  uploadPost: () => Boolean(config.uploadPost.apiKey),
  twitch: () => Boolean(config.twitch.clientId && config.twitch.clientSecret),
  kick: () => Boolean(config.kick.clientId && config.kick.clientSecret),
};
