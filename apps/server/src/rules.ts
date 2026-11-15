/** The checks every edit and post passes, whoever asks: a bot, the owner or the scheduler. */
import { zonedToUtc } from "./time.js";

/** GTA VI unlocks at midnight in Norway on Thu 19 Nov 2026; pre-release footage gets removed. */
export const GTA6_UNLOCK = zonedToUtc("2026-11-19", "00:00", "Europe/Oslo");

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
