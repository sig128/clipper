/** Who is calling: the owner (website / admin) or one of the four bots, each with its own key. */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";
import { one, q } from "./db.js";
import type { EdgeId } from "./edges.js";

export type Actor =
  | { kind: "owner"; id: "owner" }
  | { kind: "bot"; id: string; name: string; role: "manager" | "worker"; edge: EdgeId | null };

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function same(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

const lastSeen = new Map<string, number>();

export async function actorFrom(authorization: string | undefined | null): Promise<Actor | null> {
  const m = /^Bearer\s+(.+)$/i.exec(authorization ?? "");
  if (!m) return null;
  const token = m[1].trim();
  if (config.ownerToken && config.ownerToken.length >= 24 && same(token, config.ownerToken)) return { kind: "owner", id: "owner" };
  if (!token.startsWith("cfb_")) return null;
  const bot = await one<{ id: string; name: string; role: "manager" | "worker"; edge_id: EdgeId | null }>(
    "select id, name, role, edge_id from bots where key_hash = $1 and not disabled",
    [sha256(token)],
  );
  if (!bot) return null;
  const now = Date.now();
  if ((lastSeen.get(bot.id) ?? 0) < now - 60_000) {
    lastSeen.set(bot.id, now);
    await q("update bots set last_seen_at = now() where id = $1", [bot.id]);
  }
  return { kind: "bot", id: bot.id, name: bot.name, role: bot.role, edge: bot.edge_id };
}

/** Makes a new key for a bot; the old one stops working. The key is returned once and only its hash is kept. */
export async function rotateBotKey(botId: string): Promise<string | null> {
  const key = `cfb_${randomBytes(24).toString("base64url")}`;
  const r = await q("update bots set key_hash = $2, key_hint = $3, disabled = false where id = $1 returning id", [botId, sha256(key), key.slice(-4)]);
  return r.length ? key : null;
}

export const ownerOnly = (a: Actor | null): a is Extract<Actor, { kind: "owner" }> => a?.kind === "owner";
