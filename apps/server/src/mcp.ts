/**
 * The tool server the Grok bots call (MCP over streamable HTTP at /mcp).
 * Each bot authenticates with its own key. Workers only see tools and data for
 * their own edge; the manager sees every account and steers the workers. Every
 * write goes through the same checks as the website.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { log, recent } from "./activity.js";
import type { Actor } from "./auth.js";
import { config } from "./config.js";
import { getSetting, one, q } from "./db.js";
import { EDGES, EXPERIMENTS, HOUSE_RULES, PLAT_NAME, UP_PLATFORM, edgeDef, type EdgeId } from "./edges.js";
import { createEdit, EditRefused, getEdit, queueRender } from "./edits.js";
import { Permanent } from "./jobs.js";
import { clipView, findClips, getClip } from "./library.js";
import { mediaUrl } from "./media.js";
import { cancelPost, listPosts, schedulePost } from "./posts.js";
import { uploadPost } from "./publisher.js";
import { GTA6_UNLOCK } from "./rules.js";
import { accounts, openSlots, setPaused, setSlots } from "./schedule.js";
import { labelIn } from "./time.js";

type Bot = Extract<Actor, { kind: "bot" }>;
type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (data: unknown): Result => ({ content: [{ type: "text", text: JSON.stringify(data, null, 1) }] });
const fail = (error: string, detail?: unknown): Result => ({ isError: true, content: [{ type: "text", text: JSON.stringify({ error, ...(detail ? { detail } : {}) }, null, 1) }] });

function guard<A>(fn: (args: A) => Promise<unknown>) {
  return async (args: A): Promise<Result> => {
    try {
      return ok(await fn(args));
    } catch (e) {
      if (e instanceof EditRefused) return fail("Edit refused by the checks.", e.checks);
      if (e instanceof Permanent) return fail(e.message);
      console.error("[mcp]", e);
      return fail(`Server error: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
}

const now = () => {
  const d = new Date();
  return { utc: d.toISOString(), norway: labelIn(d, config.ownerTz), new_york: labelIn(d, "America/New_York"), gta6_unlocked: d >= GTA6_UNLOCK, gta6_unlocks: GTA6_UNLOCK.toISOString() };
};

/** Per-account numbers for the manager: last 7 days of posts and their latest readings. */
async function accountStats(days: number, edge?: string | null) {
  return q(
    `with latest as (
       select distinct on (m.post_id) m.post_id, m.views, m.likes, m.comments, m.shares, m.age_h
       from metrics m order by m.post_id, m.taken_at desc)
     select a.id as account_id, a.edge_id, a.platform, a.handle, a.slots, a.paused,
       count(p.*) filter (where p.status = 'published') as published,
       count(p.*) filter (where p.status in ('planned','sending','sent') and p.at > now()) as upcoming,
       count(p.*) filter (where p.status = 'failed') as failed,
       coalesce(sum(l.views), 0) as views,
       percentile_cont(0.5) within group (order by l.views) filter (where l.views is not null) as median_views,
       max(l.views) as best_views
     from accounts a
     left join posts p on p.account_id = a.id and p.at > now() - ($1 || ' days')::interval
     left join latest l on l.post_id = p.id
     where ($2::text is null or a.edge_id = $2)
     group by a.id order by a.edge_id, a.platform`,
    [String(days), edge ?? null],
  );
}

/** Median views per slot time (in the account's clock) over the last N days, for best-time decisions. */
async function slotStats(accountId: string, days = 21) {
  return q(
    `with latest as (select distinct on (post_id) post_id, views from metrics order by post_id, taken_at desc)
     select to_char(p.at at time zone a.tz, 'HH24:MI') as slot, count(*) as posts,
       percentile_cont(0.5) within group (order by l.views) as median_views
     from posts p join accounts a on a.id = p.account_id left join latest l on l.post_id = p.id
     where p.account_id = $1 and p.status = 'published' and p.at > now() - ($2 || ' days')::interval
     group by 1 order by median_views desc nulls last`,
    [accountId, String(days)],
  );
}

async function streamerBoard(days: number) {
  return q(
    `select coalesce(s.display_name, c.streamer_login) as streamer, coalesce(s.platform, c.streamer_platform) as platform,
       coalesce(s.permission, 'none') as permission, count(*) as clips, coalesce(sum(c.view_count), 0) as clip_views,
       max(c.view_count) as top_clip_views, bool_or(coalesce(s.is_live, false)) as live_now
     from clips c left join streamers s on s.id = c.streamer_id
     where c.streamer_login is not null and coalesce(c.created_at_source, c.ingested_at) > now() - ($1 || ' days')::interval
     group by 1, 2, 3 order by clip_views desc limit 30`,
    [String(days)],
  );
}

export function buildServer(bot: Bot): McpServer {
  const server = new McpServer({ name: "clipforge", version: "1.0.0" }, { instructions: "Clipforge: GTA clip library, edits, renders and the posting schedule for three edges (Leonida Man, Leonida 1%, Leonida Live) on YouTube, TikTok and Instagram. Call whoami and get_brief first." });
  const isManager = bot.role === "manager";
  const myEdge = bot.edge;
  const edgeArg: Record<string, z.ZodTypeAny> = isManager ? { edge: z.enum(["man", "onepct", "live"]).optional().describe("Limit to one edge") } : {};
  const scopeEdge = (e?: string | null) => (isManager ? (e as EdgeId | undefined) ?? null : myEdge);

  server.registerTool("whoami", { description: "Who you are, which accounts you run, and the time in Norway and New York. Call this first.", inputSchema: {} }, guard(async () => {
    const accts = await accounts(isManager ? null : myEdge);
    return { bot: bot.id, role: bot.role, edge: myEdge ? edgeDef(myEdge)?.name : "all edges", accounts: accts.map((a) => ({ id: a.id, platform: PLAT_NAME[a.platform], handle: a.handle, slots: a.slots, slot_clock: a.tz, paused: a.paused })), now: now() };
  }));

  server.registerTool("get_brief", { description: "The edge brief (what this account network posts and how), the manager's current guidance, the house rules and the open experiments.", inputSchema: { ...edgeArg } }, guard(async (a: { edge?: string }) => {
    const ids = isManager ? (a.edge ? [a.edge] : EDGES.map((e) => e.id)) : [myEdge!];
    const rows = await q<{ id: string; name: string; brief: any; guidance: string }>("select id, name, brief, guidance from edges where id = any($1) order by id", [ids]);
    return { edges: rows.map((r) => ({ id: r.id, name: r.name, ...r.brief, manager_guidance: r.guidance || null })), house_rules: HOUSE_RULES, experiments: EXPERIMENTS, now: now() };
  }));

  server.registerTool("find_clips", {
    description: "Search the clip library (Twitch clips, recorded Kick/Twitch moments, uploads), best first. By default only clips we may post and haven't used.",
    inputSchema: {
      query: z.string().optional().describe("Words in the clip title"),
      source: z.enum(["twitch_clip", "kick_live", "upload"]).optional(),
      streamer: z.string().optional(),
      game: z.enum(["gta5", "gta6", "other"]).optional(),
      usable_only: z.boolean().default(true).describe("Only clips with a video file and a permission record"),
      unused_only: z.boolean().default(true),
      since_hours: z.number().int().positive().max(24 * 30).optional(),
      limit: z.number().int().min(1).max(50).default(15),
    },
  }, guard(async (a: any) => {
    const rows = await findClips({ query: a.query, source: a.source, streamer: a.streamer, game: a.game, usableOnly: a.usable_only, unusedOnly: a.unused_only, sinceHours: a.since_hours, limit: a.limit });
    return { clips: rows.map(clipView) };
  }));

  server.registerTool("get_clip", { description: "One clip with its details and detected moment.", inputSchema: { clip_id: z.string() } }, guard(async (a: { clip_id: string }) => {
    const c = await getClip(a.clip_id);
    if (!c) throw new Permanent("No such clip.");
    return clipView(c);
  }));

  if (!isManager) {
    server.registerTool("create_edit", {
      description: "Make an edit from a usable clip: our hook (or news headline), one line of commentary, trim and layout. Runs the checks (permission, spoilers, cutscenes, our own layer) and refuses if one fails.",
      inputSchema: {
        clip_id: z.string(),
        hook: z.string().min(3).max(70).describe("On-screen hook, first 2.5 s. For Leonida Man use the headline style."),
        commentary: z.string().max(90).optional().describe("One line of our commentary shown on screen"),
        headline: z.string().max(70).optional().describe("Leonida Man news headline; replaces the hook text when given"),
        in_s: z.number().min(0).optional().describe("Start, seconds into the clip"),
        out_s: z.number().positive().optional().describe("End, seconds into the clip"),
        layout: z.enum(["full", "landscape_fit"]).optional().describe("full = 9:16 crop; landscape_fit = whole frame over a blurred fill (keeps facecams)"),
      },
    }, guard(async (a: any) => {
      const { edit, checks } = await createEdit({ edge: myEdge!, clipId: a.clip_id, hook: a.hook, commentary: a.commentary, headline: a.headline, inS: a.in_s, outS: a.out_s, layout: a.layout, by: bot.id });
      return { edit_id: edit.id, warnings: checks.filter((c) => c.sev === "warn"), next: "render_edit, then schedule_post (scheduling also starts the render)" };
    }));

    server.registerTool("render_edit", { description: "Render an edit to a 1080x1920 MP4 (takes about a minute).", inputSchema: { edit_id: z.string() } }, guard(async (a: { edit_id: string }) => {
      const e = await getEdit(a.edit_id);
      if (!e || e.edge_id !== myEdge) throw new Permanent("No such edit on your edge.");
      await queueRender(e.id, bot.id);
      return { edit_id: e.id, status: (await getEdit(e.id))!.render_status };
    }));

    server.registerTool("schedule_post", {
      description: "Schedule a rendered (or rendering) edit on your edge's accounts. Without `at` it takes each account's next open slot. Refuses duplicates, posts closer than 2 hours, spoilers and GTA VI footage before launch.",
      inputSchema: {
        edit_id: z.string(),
        platforms: z.array(z.enum(["yt", "tt", "ig"])).optional().describe("Default: all three"),
        at: z.string().optional().describe("ISO time, e.g. 2026-11-20T00:30:00Z; omit to use the next open slot"),
        title: z.string().min(3).max(100).describe("YouTube title; also the first line on TikTok/Instagram"),
        caption: z.string().max(2000).optional(),
        hashtags: z.array(z.string()).max(8).optional(),
      },
    }, guard(async (a: any) => {
      const accts = a.platforms?.length ? a.platforms.map((p: string) => `${myEdge}-${p}`) : undefined;
      return schedulePost({ editId: a.edit_id, accountIds: accts, at: a.at, title: a.title, caption: a.caption, hashtags: a.hashtags, by: bot.id, edgeScope: myEdge });
    }));
  }

  server.registerTool("get_edit", { description: "An edit's render status and video link.", inputSchema: { edit_id: z.string() } }, guard(async (a: { edit_id: string }) => {
    const e = await getEdit(a.edit_id);
    if (!e || (!isManager && e.edge_id !== myEdge)) throw new Permanent("No such edit.");
    return { id: e.id, edge: e.edge_id, clip_id: e.clip_id, hook: e.hook, commentary: e.commentary, render_status: e.render_status, render_error: e.render_error, video_url: mediaUrl(e.media_key), duration_s: e.duration_s, checks: e.checks };
  }));

  server.registerTool("open_slots", { description: "Free posting slots in the next days for your accounts (manager: all accounts).", inputSchema: { days: z.number().int().min(1).max(7).default(2), ...edgeArg } }, guard(async (a: { days: number; edge?: string }) => {
    return { slots: await openSlots(await accounts(scopeEdge(a.edge)), a.days) };
  }));

  server.registerTool("list_posts", { description: "Recent and upcoming posts with status, link and latest views.", inputSchema: { hours_back: z.number().int().min(1).max(24 * 14).default(72), hours_ahead: z.number().int().min(0).max(24 * 7).default(48), ...edgeArg } }, guard(async (a: any) => {
    return { posts: await listPosts({ edge: scopeEdge(a.edge), hours: a.hours_back, futureHours: a.hours_ahead }) };
  }));

  server.registerTool("cancel_post", { description: "Cancel a planned post that hasn't gone out yet.", inputSchema: { post_id: z.string() } }, guard(async (a: { post_id: string }) => {
    return cancelPost(a.post_id, bot.id, isManager ? null : myEdge);
  }));

  server.registerTool("streamer_board", { description: "Streamer League data: GTA streamers ranked by clip views, with permission status and who is live.", inputSchema: { days: z.number().int().min(1).max(30).default(7) } }, guard(async (a: { days: number }) => {
    return { board: await streamerBoard(a.days) };
  }));

  server.registerTool("live_now", { description: "GTA streams live on Kick right now (top by viewers) and which permitted streamers are live.", inputSchema: {} }, guard(async () => {
    const kick = await getSetting<{ at: string; streams: unknown[] }>("kick_live");
    const ours = await q("select platform, login, display_name, permission, record_live, live_title, live_viewers from streamers where is_live order by live_viewers desc nulls last");
    return { kick_gta: kick ?? null, permitted_live: ours };
  }));

  if (isManager) {
    server.registerTool("accounts_overview", { description: "All 9 accounts: posts, upcoming, failures, total and median views, slots and pause state.", inputSchema: { days: z.number().int().min(1).max(30).default(7), ...edgeArg } }, guard(async (a: any) => {
      return { accounts: await accountStats(a.days, a.edge), now: now() };
    }));

    server.registerTool("best_times", { description: "Best posting times for one account: our own median views per slot, plus Upload-Post's recommendation for that platform and profile.", inputSchema: { account_id: z.string() } }, guard(async (a: { account_id: string }) => {
      const acct = await one<{ id: string; edge_id: string; platform: "yt" | "tt" | "ig"; slots: string[]; tz: string }>("select * from accounts where id = $1", [a.account_id]);
      if (!acct) throw new Permanent("No such account.");
      const edge = edgeDef(acct.edge_id)!;
      let upload_post: unknown = "Upload-Post not connected yet";
      const up = uploadPost();
      if (up) upload_post = await up.bestTimes(UP_PLATFORM[acct.platform], edge.uploadPostUser, acct.tz).catch((e) => `unavailable: ${e.message}`);
      return { account: acct.id, current_slots: acct.slots, slot_clock: acct.tz, our_slots: await slotStats(acct.id), upload_post };
    }));

    server.registerTool("set_slots", { description: "Change an account's daily posting times (in its slot clock, America/New_York). Keep 4 a day, at least 2 hours apart.", inputSchema: { account_id: z.string(), slots: z.array(z.string()).min(1).max(6) } }, guard(async (a: { account_id: string; slots: string[] }) => {
      const r = await setSlots(a.account_id, a.slots, bot.id);
      if (r.error) throw new Permanent(r.error);
      return { account_id: a.account_id, slots: r.slots, note: r.slots!.length !== 4 ? "The plan is 4 posts a day per account." : undefined };
    }));

    server.registerTool("pause_account", { description: "Pause or resume an account. Paused accounts get no new posts and planned ones are cancelled at send time.", inputSchema: { account_id: z.string(), paused: z.boolean() } }, guard(async (a: { account_id: string; paused: boolean }) => {
      if (!(await setPaused(a.account_id, a.paused, bot.id))) throw new Permanent("No such account.");
      return { account_id: a.account_id, paused: a.paused };
    }));

    server.registerTool("set_guidance", { description: "Steer a worker: guidance text shown at the top of that edge's brief (what's winning, what to stop, today's focus).", inputSchema: { edge: z.enum(["man", "onepct", "live"]), guidance: z.string().max(1500) } }, guard(async (a: { edge: string; guidance: string }) => {
      await q("update edges set guidance = $2 where id = $1", [a.edge, a.guidance]);
      await log(bot.id, "guidance.set", a.edge, { guidance: a.guidance.slice(0, 300) });
      return { edge: a.edge, guidance: a.guidance };
    }));

    server.registerTool("activity", { description: "What every bot and the system did recently.", inputSchema: { hours: z.number().int().min(1).max(168).default(24) } }, guard(async (a: { hours: number }) => {
      return { activity: await recent(a.hours, 300) };
    }));
  }

  return server;
}

/** Handles one MCP request statelessly: a fresh server per call, scoped to the calling bot. */
export async function handleMcp(req: Request, bot: Bot): Promise<Response> {
  const server = buildServer(bot);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(req);
  } finally {
    // JSON responses are complete here, so the per-request server can go.
    void transport.close().catch(() => {});
    void server.close().catch(() => {});
  }
}
