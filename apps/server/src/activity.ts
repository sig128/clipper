/** What every bot, the owner and the system did, newest first. The manager bot and the dashboard read this. */
import { q } from "./db.js";

export async function log(actor: string, action: string, target?: string | null, detail: object = {}): Promise<void> {
  await q("insert into activity (actor, action, target, detail) values ($1,$2,$3,$4)", [actor, action, target ?? null, JSON.stringify(detail)]).catch((e) =>
    console.error("[activity]", e instanceof Error ? e.message : e),
  );
}

export async function recent(hours = 24, limit = 200) {
  return q<{ at: Date; actor: string; action: string; target: string | null; detail: any }>(
    "select at, actor, action, target, detail from activity where at > now() - ($1 || ' hours')::interval order by at desc limit $2",
    [String(hours), limit],
  );
}
