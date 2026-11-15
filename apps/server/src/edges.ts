/**
 * The three edges. Each edge is one brand on YouTube, TikTok and Instagram,
 * posting four times a day, run by one worker bot. The brief is what that bot
 * reads before every decision; the manager can add guidance on top.
 */
import { q } from "./db.js";

export type EdgeId = "man" | "onepct" | "live";
export type Plat = "yt" | "tt" | "ig";
export const PLATS: Plat[] = ["yt", "tt", "ig"];
export const PLAT_NAME: Record<Plat, string> = { yt: "YouTube Shorts", tt: "TikTok", ig: "Instagram Reels" };
/** Upload-Post's names for our platforms. */
export const UP_PLATFORM: Record<Plat, "youtube" | "tiktok" | "instagram"> = { yt: "youtube", tt: "tiktok", ig: "instagram" };

/** Posting times are set in the audience's clock: most English GTA viewers are in North America. */
export const AUDIENCE_TZ = "America/New_York";

export interface EdgeBrief {
  promise: string;
  proven: string;
  twist: string;
  formats: string[];
  hook: string;
  examples: string[];
  lengths: Record<Plat, string>;
  layout: "full" | "landscape_fit";
  sources: string;
  avoid: string[];
  hashtags: string[];
  /** Ready titles for the launch window; use one only when the clip actually shows it. */
  launch_titles: string[];
}

export interface EdgeDef {
  id: EdgeId;
  name: string;
  uploadPostUser: string;
  lane: string;
  slots: string[];
  brief: EdgeBrief;
}

export const EDGES: EdgeDef[] = [
  {
    id: "man",
    name: "Leonida Man",
    uploadPostUser: "leonida-man",
    lane: "chaos",
    slots: ["12:00", "16:00", "19:30", "22:30"],
    brief: {
      promise: "The wildest thing that happened in Leonida today, told like a Florida Man news story.",
      proven: "Chaos moments (crashes, police chases, physics, NPCs, wildlife) are GTA's most shared short format. Rockstar built GTA VI's first trailer from real Florida viral videos and gave the game a TikTok-style filter, so viewers already read Leonida as Florida Man country.",
      twist: "Every clip is a breaking-news headline: 'LEONIDA MAN steals airboat, gets chased by gator'. News ticker and map pin on screen. One clip a day is 'Leonida Man of the Day'.",
      formats: [
        "Payoff first: the crash/escape/fail frame in the first second, then rewind to how it started.",
        "Headline as the hook: LEONIDA MAN / LEONIDA WOMAN + verb + absurd detail, max 8 words.",
        "One line of deadpan commentary as the note, like a local news anchor.",
        "TikTok cut can chain 2-3 moments around one theme (e.g. three airboat disasters).",
      ],
      hook: "News headline in caps: 'LEONIDA MAN …'. Specific, absurd, no clickbait the clip can't pay off.",
      examples: [
        "LEONIDA MAN tries to outrun cops on a jet ski",
        "LEONIDA WOMAN parks on the beach, regrets it instantly",
        "LEONIDA MAN vs one (1) alligator",
      ],
      lengths: { yt: "15-35 s", tt: "35-75 s", ig: "15-45 s" },
      layout: "full",
      sources: "Own gameplay uploads first, then permitted streamer clips with chaos moments (crashes, chases, physics).",
      avoid: [
        "Blood or kills in the first 7 seconds (YouTube limits ads on those).",
        "Killing-spree compilations.",
        "Headlines about real people or real crimes; the joke is the game.",
      ],
      hashtags: ["#GTA6", "#GTAVI", "#Leonida", "#FloridaMan", "#GTA"],
      launch_titles: [
        "LEONIDA MAN gets 5 stars in his first 10 minutes",
        "LEONIDA MAN meets his first gator",
        "LEONIDA WOMAN steals a cop car on day one",
        "LEONIDA MAN tries the airboat. The airboat wins.",
        "Day 1 in Leonida and the police are already done with us",
        "Leonida NPCs react to LEONIDA MAN",
      ],
    },
  },
  {
    id: "onepct",
    name: "Leonida 1%",
    uploadPostUser: "leonida-1pct",
    lane: "guide",
    slots: ["11:00", "15:00", "18:30", "21:30"],
    brief: {
      promise: "Things only 1% of players know about Leonida: secrets, details and fast answers.",
      proven: "After Red Dead Redemption 2, 'insane details you missed' became its own genre, and early guide sites kept their search traffic for years. 'gta 6' drew about 9.9M US searches a month in June 2026.",
      twist: "Titles are the exact phrase people search. The answer lands in the first 3 seconds. A running series: 'Day 12: something Rockstar hid in Leonida'.",
      formats: [
        "Discovery: show the place or detail in the first second, then how to find it (map pin).",
        "Guide answer: 'How to … in GTA 6' answered in 3 seconds, then the steps.",
        "Detail: 'Rockstar actually made …' with the detail on screen immediately.",
        "Comparison: GTA V vs GTA VI side by side, one verdict line at the end.",
      ],
      hook: "The search phrase or the surprising fact, not a teaser: 'Fastest money in GTA 6 (no glitch)'.",
      examples: [
        "Day 3: the NPC who remembers you in GTA 6",
        "How to get the airboat early in GTA 6",
        "GTA 6 rain does this to your clothes",
      ],
      lengths: { yt: "20-45 s", tt: "35-75 s", ig: "20-45 s" },
      layout: "full",
      sources: "Own gameplay uploads; permitted streamer clips that show a detail or answer a question.",
      avoid: [
        "Story spoilers: endings, character deaths, final missions, twists.",
        "Isolated cutscenes (Rockstar's policy).",
        "Glitch or exploit tutorials that Rockstar patches or bans for.",
      ],
      hashtags: ["#GTA6", "#GTAVI", "#GTA6Tips", "#GTA6Secrets", "#Leonida"],
      launch_titles: [
        "GTA 6 first 10 minutes (no spoilers)",
        "How big is the GTA 6 map? We drove across it",
        "GTA 6 wanted system explained in 30 seconds",
        "How to make money fast in GTA 6 (day one)",
        "Is GTA 6 worth it? 60 seconds, no spoilers",
        "The GTA 6 detail nobody noticed on day one",
        "GTA 6 before you play: 5 things to know",
      ],
    },
  },
  {
    id: "live",
    name: "Leonida Live",
    uploadPostUser: "leonida-live",
    lane: "streamers",
    slots: ["13:00", "17:00", "20:30", "23:30"],
    brief: {
      promise: "The best streamer moments in GTA right now, ranked every week.",
      proven: "Kick out-watched Twitch on GTA V (82.5M vs 49.5M hours in July 2026), and Kick streamers pay clippers: one paid over $1.4M to 303 clippers in five weeks. Clipping campaigns pay $0.20-$6 per 1,000 views from any country.",
      twist: "Weekly Streamer League: power rankings of GTA streamers by how their clips perform. First-reaction clips in launch week. Roleplay scenes shown from several streamers' views with names on screen.",
      formats: [
        "Streamer moment: facecam reaction kept in, streamer name on screen, payoff first.",
        "League update: 'Streamer League week 1: #1 is …' with the top clip.",
        "Multi-view: the same roleplay scene from two streamers, names on screen.",
        "First reactions: launch-week first impressions from several streamers.",
      ],
      hook: "Name + what happened: 'xQc finds out what Leonida police do' — always credit the streamer.",
      examples: [
        "Streamer League week 1: the top 3 GTA 6 moments",
        "His chat told him not to take the boat",
        "Two streamers, one robbery, two very different endings",
      ],
      lengths: { yt: "20-45 s", tt: "35-75 s", ig: "20-45 s" },
      layout: "landscape_fit",
      sources: "Only streamers with permission (campaign or written OK). Twitch clips we can download, Kick streams we record.",
      avoid: [
        "Any streamer without a permission record.",
        "Cutting the streamer's face or name out.",
        "Campaign rules: put the required handle/hashtag on screen when the campaign asks.",
      ],
      hashtags: ["#GTA6", "#GTAVI", "#Kick", "#Twitch", "#GTARP"],
      launch_titles: [
        "Streamers' first reaction to Leonida",
        "His first 5 minutes in GTA 6 went exactly like this",
        "Streamers vs GTA 6 police, day one",
        "Streamer League: launch day top 3",
        "Chat told him not to take the boat",
      ],
    },
  },
];

/**
 * The rollout gives an ~18-hour window where the game is out (New Zealand first) but
 * most of the audience, the US especially, can't play yet: demand for footage is at its
 * peak and supply is thin. Being first matters most there.
 */
export const LAUNCH_PLAYBOOK = [
  "Pre-launch (now until Wed 18 Nov 12:00 Norway): warm the accounts with GTA V clips framed as the countdown ('3 days to Leonida'). Never repost Rockstar trailers.",
  "Rollout (Wed 12:00 Norway until Thu 06:00 Norway, when the US unlocks): the game is out in New Zealand, Australia, Asia and Europe but not the US. Post first-look footage for people waiting: 'before you play', 'first look', 'no spoilers'. This is the window that matters most.",
  "Launch week (until Sun 22 Nov 06:00 Norway): up to 8 posts per account per day, at least 90 minutes apart. Run every 15 minutes, call trending_now first, and post a fast-rising moment as soon as it's rendered instead of waiting for the next fixed slot.",
  "Being first beats being polished, but the payoff still has to land in the first second. Use a launch title only when the clip actually shows it.",
  "Spoiler-free is a selling point at launch: say 'no spoilers' in the caption. The tools block story spoilers and cutscenes anyway.",
];

export const EXPERIMENTS = [
  "Trend remake: the week's biggest real-world trend recreated inside GTA, with the trending sound.",
  "Real viral clip remade in-game: our footage only, with a caption naming the original (never the original video).",
  "Nature-documentary narration over NPC chaos, in an original narrator voice (not a real person's).",
];

export const HOUSE_RULES = [
  "Four posts per account per day, at least 2 hours apart. Each edit goes out once per platform, and never on two of our accounts on the same platform.",
  "No GTA VI footage before its first official unlock (New Zealand: Wed 18 Nov 2026, 12:00 Norway time). Rockstar removes pre-release footage.",
  "Launch week (first unlock until Sun 22 Nov 06:00 Norway): up to 8 posts per account per day, at least 90 minutes apart.",
  "No story spoilers (endings, deaths, final missions, twists) in titles, hooks, captions or the clip itself. No isolated cutscenes.",
  "Every post needs our own layer: a hook and ideally one line of commentary. Plain reposts get demonetized as reused content.",
  "Other people's footage only with a permission record (campaign or written OK). The tools refuse anything else.",
  "Keep blood and kills out of the first 7 seconds of YouTube cuts.",
];

export function edgeDef(id: string): EdgeDef | undefined {
  return EDGES.find((e) => e.id === id);
}

/** Creates the edges, their 9 accounts and the 4 bots on first start; later starts only add what's missing. */
export async function seedNetwork(): Promise<void> {
  for (const e of EDGES) {
    await q(
      `insert into edges (id, name, upload_post_user, lane, brief) values ($1,$2,$3,$4,$5)
       on conflict (id) do update set name = excluded.name, lane = excluded.lane, brief = excluded.brief`,
      [e.id, e.name, e.uploadPostUser, e.lane, JSON.stringify(e.brief)],
    );
    for (const p of PLATS) {
      await q(
        `insert into accounts (id, edge_id, platform, slots, tz) values ($1,$2,$3,$4,$5) on conflict (id) do nothing`,
        [`${e.id}-${p}`, e.id, p, e.slots, AUDIENCE_TZ],
      );
    }
    await q(
      `insert into bots (id, name, role, edge_id) values ($1,$2,'worker',$3) on conflict (id) do nothing`,
      [`worker-${e.id}`, `${e.name} worker`, e.id],
    );
  }
  await q(`insert into bots (id, name, role) values ('manager','Network manager','manager') on conflict (id) do nothing`);
}
