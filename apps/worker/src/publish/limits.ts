/**
 * Platform limits the publisher respects before it touches an API.
 *
 * YouTube: quota belongs to the Google Cloud project and resets at midnight
 * Pacific Time. Since 4 Dec 2025 an upload costs about 100 units (it was about
 * 1,600), and since 1 Jun 2026 uploads draw from their own quota bucket. The
 * default allocation is 10,000 units a day, so roughly 100 uploads.
 * Instagram: 100 API-published posts per account in any rolling 24 hours.
 * TikTok: no API posting from this tool (TikTok's terms reject internal
 * uploaders for accounts you or your team manage), so it is a handoff.
 */
export const YT_UNITS = { upload: 100, thumbnail: 50 } as const;
export const YT_DAILY_UNITS = Number(process.env.YT_DAILY_UNITS ?? 10_000);
export const IG_PER_24H = 100;
const DAY_MS = 86_400_000;

export type LimitState = { yt: Record<string, number>; ig: Record<string, number[]> };
export const emptyLimits = (): LimitState => ({ yt: {}, ig: {} });

/** The YouTube quota day, as YYYY-MM-DD in America/Los_Angeles. */
export function pacificDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function youtubeRoom(st: LimitState, now: Date, units: number = YT_UNITS.upload + YT_UNITS.thumbnail) {
  const used = st.yt[pacificDay(now)] ?? 0;
  return { ok: used + units <= YT_DAILY_UNITS, used, left: Math.max(0, YT_DAILY_UNITS - used) };
}
export function spendYouTube(st: LimitState, now: Date, units: number) {
  const k = pacificDay(now);
  st.yt[k] = (st.yt[k] ?? 0) + units;
  for (const day of Object.keys(st.yt)) if (day < pacificDay(new Date(now.getTime() - 7 * DAY_MS))) delete st.yt[day];
}

export function instagramRoom(st: LimitState, acct: string, now: Date) {
  const recent = (st.ig[acct] ?? []).filter((t) => now.getTime() - t < DAY_MS);
  return { ok: recent.length < IG_PER_24H, used: recent.length };
}
export function noteInstagram(st: LimitState, acct: string, now: Date) {
  st.ig[acct] = [...(st.ig[acct] ?? []).filter((t) => now.getTime() - t < DAY_MS), now.getTime()];
}
