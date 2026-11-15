/** Accounts and their four daily slots (in the audience's clock), open slots, and slot changes. */
import { parseTimes } from "@clipforge/contracts";
import { log } from "./activity.js";
import { config } from "./config.js";
import { q } from "./db.js";
import type { EdgeId, Plat } from "./edges.js";
import { addDays, labelIn, ymdIn, zonedToUtc } from "./time.js";

export interface AccountRow { id: string; edge_id: EdgeId; platform: Plat; handle: string | null; slots: string[]; tz: string; paused: boolean }

export async function accounts(edge?: EdgeId | null): Promise<AccountRow[]> {
  return edge
    ? q<AccountRow>("select * from accounts where edge_id = $1 order by platform", [edge])
    : q<AccountRow>("select * from accounts order by edge_id, platform");
}

export type Slot = { account_id: string; platform: Plat; slot: string; at: string; audience_time: string; owner_time: string };

/** Slots in the next `days` days with no post within an hour of them. */
export async function openSlots(accts: AccountRow[], days = 2, now = new Date()): Promise<Slot[]> {
  if (!accts.length) return [];
  const taken = await q<{ account_id: string; at: Date }>(
    "select account_id, at from posts where account_id = any($1) and status not in ('cancelled','failed') and at > now() - interval '2 hours'",
    [accts.map((a) => a.id)],
  );
  const out: Slot[] = [];
  for (const a of accts) {
    if (a.paused) continue;
    const today = ymdIn(now, a.tz);
    for (let d = 0; d <= days; d++) {
      const ymd = addDays(today, d);
      for (const s of a.slots) {
        const at = zonedToUtc(ymd, s, a.tz);
        if (at.getTime() < now.getTime() + 10 * 60_000) continue;
        if (at.getTime() > now.getTime() + days * 86400_000) continue;
        if (taken.some((t) => t.account_id === a.id && Math.abs(t.at.getTime() - at.getTime()) < 60 * 60_000)) continue;
        out.push({ account_id: a.id, platform: a.platform, slot: s, at: at.toISOString(), audience_time: labelIn(at, a.tz), owner_time: labelIn(at, config.ownerTz) });
      }
    }
  }
  return out.sort((x, y) => x.at.localeCompare(y.at));
}

export async function setSlots(accountId: string, slots: string[], by: string): Promise<{ slots?: string[]; error?: string }> {
  const parsed = parseTimes(slots.join(","));
  if (parsed.err) return { error: parsed.err };
  const r = await q<{ slots: string[] }>("update accounts set slots = $2 where id = $1 returning slots", [accountId, parsed.times]);
  if (!r.length) return { error: `No account ${accountId}.` };
  await log(by, "slots.set", accountId, { slots: parsed.times });
  return { slots: r[0].slots };
}

export async function setPaused(accountId: string, paused: boolean, by: string): Promise<boolean> {
  const r = await q("update accounts set paused = $2 where id = $1 returning id", [accountId, paused]);
  if (r.length) await log(by, paused ? "account.pause" : "account.resume", accountId);
  return r.length > 0;
}
