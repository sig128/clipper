/** The checks every edit and post passes, whoever asks: a bot, the owner or the scheduler. */
import { config } from "./config.js";

/**
 * GTA VI's first official unlock: New Zealand midnight, Wed 18 Nov 2026 11:00 UTC
 * (12:00 in Norway). Anything before it is pre-release footage, which Rockstar removes.
 */
export const GTA6_UNLOCK = new Date(config.gta6UnlockUtc);
/** Launch mode ends 72 hours after the US unlock. */
export const LAUNCH_END = new Date(config.launchEndUtc);

export const inLaunchWindow = (at: Date = new Date()) => config.launchMode && at >= GTA6_UNLOCK && at < LAUNCH_END;
/** Minimum gap between posts on one account: 2 hours normally, 90 minutes in the launch window. */
export const spacingMs = (at: Date) => (inLaunchWindow(at) ? 90 : 120) * 60_000;
/** Most posts per account per day: 6 normally (the plan is 4), 8 in the launch window. */
export const maxPerDay = (at: Date) => (inLaunchWindow(at) ? 8 : 6);
export const gapText = (ms: number) => (ms % 3600_000 === 0 ? `${ms / 3600_000} hours` : `${ms / 60_000} minutes`);

/**
 * When each region gets the game. "reported" times come from PlayStation Store listings
 * (compiled by GTAVice.net, Sep 2026); Rockstar hasn't confirmed them. "assumed" ones are
 * local midnight. Xbox owners can switch region and play at the New Zealand time.
 */
export const UNLOCKS = [
  { region: "New Zealand", utc: "2026-11-18T11:00:00Z", source: "reported" },
  { region: "Australia (east)", utc: "2026-11-18T13:00:00Z", source: "reported" },
  { region: "Japan, Korea", utc: "2026-11-18T15:00:00Z", source: "assumed" },
  { region: "UAE", utc: "2026-11-18T20:00:00Z", source: "reported" },
  { region: "Europe (CET)", utc: "2026-11-18T23:00:00Z", source: "assumed" },
  { region: "UK", utc: "2026-11-19T00:00:00Z", source: "assumed" },
  { region: "US and Canada", utc: "2026-11-19T05:00:00Z", source: "reported" },
  { region: "Mexico, Central America", utc: "2026-11-19T06:00:00Z", source: "reported" },
] as const;

export function launchStatus(now = new Date()) {
  const open = UNLOCKS.filter((u) => new Date(u.utc) <= now).map((u) => u.region);
  const next = UNLOCKS.find((u) => new Date(u.utc) > now) ?? null;
  const us = new Date("2026-11-19T05:00:00Z");
  return {
    first_unlock: GTA6_UNLOCK.toISOString(),
    gta6_footage_allowed: now >= GTA6_UNLOCK,
    launch_mode: inLaunchWindow(now),
    launch_mode_ends: LAUNCH_END.toISOString(),
    unlocked_regions: open,
    next_unlock: next,
    phase: now < GTA6_UNLOCK ? "pre-launch" : now < us ? "rollout: the game is out but the US can't play yet" : inLaunchWindow(now) ? "launch week" : "after launch",
  };
}

const SPOILERS = [
  "ending", "endings", "final mission", "last mission", "dies", "died", "death of", "killed off", "betray", "betrays",
  "betrayal", "plot twist", "twist ending", "post-credits", "post credits", "credits scene", "epilogue", "who dies",
];

export function spoilerWords(...texts: (string | null | undefined)[]): string[] {
  const hay = texts.filter(Boolean).join(" \n ").toLowerCase();
  return SPOILERS.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[-\s]/g, "[-\\s]")}([^a-z]|$)`).test(hay));
}

export type Check = { k: string; sev: "block" | "warn"; t: string };

export const permissionOk = (p: string | null | undefined) => p === "own" || p === "campaign" || p === "written";

export function editChecks(input: {
  hook: string; commentary?: string | null; headline?: string | null; clipTitle?: string | null;
  permission: string; hasMedia: boolean; cutscene?: boolean; durationS: number;
}): Check[] {
  const out: Check[] = [];
  if (!input.hasMedia) out.push({ k: "media", sev: "block", t: "No video file we're allowed to use for this clip yet." });
  if (!permissionOk(input.permission)) out.push({ k: "rights", sev: "block", t: "No permission record for this streamer. Add one on the Streamers page first." });
  if (!input.hook.trim()) out.push({ k: "orig", sev: "block", t: "Needs a hook: our own layer is what keeps the post monetizable." });
  const sp = spoilerWords(input.hook, input.commentary, input.headline);
  if (sp.length) out.push({ k: "spoiler", sev: "block", t: `Possible story spoiler: “${sp.join("”, “")}”. Rephrase.` });
  if (input.cutscene) out.push({ k: "cutscene", sev: "block", t: "Looks like a cutscene (black bars). Rockstar bans isolated cutscenes." });
  if (!input.commentary?.trim()) out.push({ k: "note", sev: "warn", t: "Add one line of commentary: posts with our own commentary hold monetization better." });
  if (input.durationS < 8) out.push({ k: "short", sev: "warn", t: "Under 8 seconds: usually too short to land a payoff." });
  if (input.durationS > 90) out.push({ k: "long", sev: "warn", t: "Over 90 seconds: Reels caps at 90 s and Shorts at 3 min." });
  if (input.clipTitle && spoilerWords(input.clipTitle).length) out.push({ k: "spoiler-src", sev: "warn", t: "The source clip's title mentions story words; check the clip itself for spoilers." });
  return out;
}

export const blocking = (checks: Check[]) => checks.filter((c) => c.sev === "block");
