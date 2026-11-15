import "./env.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { actorFrom, rotateBotKey } from "../src/auth.js";
import { q } from "../src/db.js";
import { spoilerWords, editChecks, GTA6_UNLOCK } from "../src/rules.js";
import { accounts, openSlots, setSlots } from "../src/schedule.js";
import { zonedToUtc, ymdIn, hmIn, tzOffsetMinutes } from "../src/time.js";
import { closeDb, resetDb } from "./helpers.js";

before(resetDb);
after(closeDb);

test("the network: 3 edges, 9 accounts with 4 slots, 4 bots", async () => {
  assert.deepEqual((await q("select id from edges order by id")).map((r) => r.id), ["live", "man", "onepct"]);
  const accts = await accounts();
  assert.equal(accts.length, 9);
  for (const a of accts) assert.equal(a.slots.length, 4, a.id);
  assert.deepEqual((await q("select id from bots order by id")).map((r) => r.id), ["manager", "worker-live", "worker-man", "worker-onepct"]);
});

test("bot keys: shown once, hashed, old key stops working", async () => {
  const k1 = await rotateBotKey("worker-man");
  assert.ok(k1?.startsWith("cfb_"));
  const a = await actorFrom(`Bearer ${k1}`);
  assert.deepEqual(a && a.kind === "bot" ? [a.id, a.role, a.edge] : null, ["worker-man", "worker", "man"]);
  const stored = await q("select key_hash from bots where id = 'worker-man'");
  assert.notEqual(stored[0].key_hash, k1);
  const k2 = await rotateBotKey("worker-man");
  assert.equal(await actorFrom(`Bearer ${k1}`), null);
  assert.ok(await actorFrom(`Bearer ${k2}`));
  assert.equal((await actorFrom("Bearer owner-test-token-0123456789abcdef"))?.kind, "owner");
  assert.equal(await actorFrom("Bearer nope"), null);
  assert.equal(await actorFrom(undefined), null);
});

test("time zones: New York and Norway wall times, across the DST change", () => {
  assert.equal(zonedToUtc("2026-11-19", "00:00", "Europe/Oslo").toISOString(), "2026-11-18T23:00:00.000Z");
  assert.equal(GTA6_UNLOCK.toISOString(), "2026-11-18T23:00:00.000Z");
  assert.equal(zonedToUtc("2026-11-20", "19:30", "America/New_York").toISOString(), "2026-11-21T00:30:00.000Z");
  assert.equal(zonedToUtc("2026-07-01", "19:30", "America/New_York").toISOString(), "2026-07-01T23:30:00.000Z");
  const d = new Date("2026-11-21T00:30:00Z");
  assert.equal(ymdIn(d, "America/New_York"), "2026-11-20");
  assert.equal(hmIn(d, "America/New_York"), "19:30");
  assert.equal(tzOffsetMinutes("Europe/Oslo", d), 60);
});

test("open slots skip the past and slots that already have a post", async () => {
  const [man_yt] = await accounts("man").then((a) => a.filter((x) => x.platform === "yt"));
  const now = new Date("2026-11-20T12:00:00Z"); // 07:00 in New York
  const slots = await openSlots([man_yt], 1, now);
  assert.deepEqual(slots.slice(0, 4).map((s) => s.slot), ["12:00", "16:00", "19:30", "22:30"]);
  assert.equal(slots[0].at, "2026-11-20T17:00:00.000Z");
  assert.match(slots[0].owner_time, /18:00/);
});

test("slot changes follow the 2-hour rule", async () => {
  assert.match((await setSlots("man-tt", ["12:00", "13:00", "18:00", "21:00"], "manager")).error ?? "", /less than 2 hours/);
  assert.deepEqual((await setSlots("man-tt", ["21:00", "12:00", "18:00", "15:00"], "manager")).slots, ["12:00", "15:00", "18:00", "21:00"]);
  assert.match((await setSlots("nope-tt", ["12:00"], "manager")).error ?? "", /No account/);
});

test("spoiler and edit checks", () => {
  assert.deepEqual(spoilerWords("Jason dies in the final mission"), ["final mission", "dies"]);
  assert.deepEqual(spoilerWords("No spoilers, just a gator", "LEONIDA MAN vs one (1) alligator"), []);
  assert.deepEqual(spoilerWords("dead end street"), []);
  const c = editChecks({ hook: "", permission: "none", hasMedia: false, durationS: 5 });
  assert.deepEqual(c.filter((x) => x.sev === "block").map((x) => x.k).sort(), ["media", "orig", "rights"]);
  assert.deepEqual(editChecks({ hook: "LEONIDA MAN loses airboat", commentary: "Classic.", permission: "own", hasMedia: true, durationS: 20 }), []);
});
