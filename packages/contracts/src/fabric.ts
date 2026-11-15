/**
 * The posting fabric: accounts, their daily slots, planned posts, rights and
 * publication intents. The studio's Plan view and the publish worker share
 * these shapes and rules, so "can this go out?" has one answer everywhere.
 */
import { z } from "zod";

export const Platform = z.enum(["yt", "tt", "ig"]);
export type Platform = z.infer<typeof Platform>;
export const PLATFORM_NAME: Record<Platform, string> = { yt: "YouTube Shorts", tt: "TikTok", ig: "Instagram Reels" };

export const Lane = z.enum(["chaos", "guide", "rp", "arabic", "partner"]);
export const Game = z.enum(["gta6", "gta5", "gtarp", "other"]);

/** "HH:MM", 24-hour, local time of the owner (Europe/Oslo by default). */
export const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Account = z.object({
  id: z.string().min(1),
  order: z.number().int().nonnegative().default(0),
  name: z.string().min(1).max(40),
  lane: Lane,
  lang: z.string().max(24).default("English"),
  plats: z.array(Platform).min(1),
  slots: z.array(Clock).min(1).max(6),
});
export type Account = z.infer<typeof Account>;

export const PlanEntry = z.object({
  id: z.string().min(1),
  acct: z.string().min(1),
  plat: Platform,
  /** local wall time "YYYY-MM-DDTHH:MM" */
  at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/),
  clip: z.string().min(1),
  title: z.string(),
  caption: z.string().default(""),
  len: z.number().nonnegative().optional(),
  game: Game.optional(),
  status: z.enum(["planned", "posted"]).default("planned"),
  postedAt: z.string().nullable().optional(),
});
export type PlanEntry = z.infer<typeof PlanEntry>;

export const Rights = z.enum(["own", "partner", "campaign", "unknown"]);
export const RightsRecord = z.object({
  sourceId: z.string(),
  rights: Rights,
  owner: z.string().optional(),
  /** where the OK lives: a message link, an email, the campaign page */
  proof: z.string().optional(),
  expires: z.string().optional(),
});
export type RightsRecord = z.infer<typeof RightsRecord>;

export const FlagSeverity = z.enum(["high", "med", "lock"]);
export const Flag = z.object({
  k: z.enum(["launch", "cutscene", "spoiler", "orig", "rights", "radio", "open7", "ttlen", "dup", "spacing", "limit"]),
  sev: FlagSeverity,
  t: z.string(),
  w: z.string(),
  plat: Platform.optional(),
});
export type Flag = z.infer<typeof Flag>;

/** One post going out once: the idempotency key is revision + platform + account. */
export const PublicationIntent = z.object({
  key: z.string(),
  revisionId: z.string(),
  plat: Platform,
  acct: z.string(),
  status: z.enum(["planned", "uploading", "processing", "published", "failed", "handoff"]),
  remoteId: z.string().optional(),
  /** YouTube resumable session, kept so a retry resumes instead of re-uploading */
  session: z.string().optional(),
  attempts: z.number().int().nonnegative().default(0),
  error: z.string().optional(),
  updatedAt: z.string(),
});
export type PublicationIntent = z.infer<typeof PublicationIntent>;
export const intentKey = (revisionId: string, plat: Platform, acct: string) => `${revisionId}:${plat}:${acct}`;

/** GTA VI unlocks at local midnight on 19 November 2026. Rockstar removes pre-release footage. */
export const GTA6_UNLOCK_LOCAL = "2026-11-19T00:00";

/** Daily times must be at least two hours apart; at most six a day. */
export function parseTimes(input: string): { times?: string[]; err?: string } {
  const out: string[] = [];
  for (const t of input.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d{1,2})[:.](\d{2})$/.exec(t);
    if (!m || +m[1] > 23 || +m[2] > 59) return { err: `“${t}” isn’t a time. Use 24-hour times like 12:00, 17:30.` };
    out.push(`${m[1].padStart(2, "0")}:${m[2]}`);
  }
  const u = [...new Set(out)].sort();
  const min = (s: string) => +s.slice(0, 2) * 60 + +s.slice(3);
  for (let i = 1; i < u.length; i++) if (min(u[i]) - min(u[i - 1]) < 120) return { err: `${u[i - 1]} and ${u[i]} are less than 2 hours apart.` };
  if (!u.length) return { err: "Add at least one time." };
  if (u.length > 6) return { err: "Six times a day is the most. More than that tends to hurt reach." };
  return { times: u };
}

/** Rules the plan enforces before anything is scheduled. Pure: no clock or I/O. */
export function planBlockers(entry: Pick<PlanEntry, "id" | "clip" | "plat" | "acct" | "at" | "game">, plan: PlanEntry[], now: string): string[] {
  const out: string[] = [];
  if (plan.some((e) => e.id !== entry.id && e.clip === entry.clip && e.plat === entry.plat))
    out.push(`Already planned on ${PLATFORM_NAME[entry.plat]}. Each edit goes out once per platform.`);
  if (entry.at < now) out.push("That time has already passed.");
  if (entry.game === "gta6" && entry.at < GTA6_UNLOCK_LOCAL) out.push("GTA VI footage before launch.");
  return out;
}
