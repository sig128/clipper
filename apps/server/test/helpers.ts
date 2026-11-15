import { TMP } from "./env.js";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate, pool } from "../src/db.js";
import { seedNetwork } from "../src/edges.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(here, "../../..");

export async function resetDb(): Promise<void> {
  await pool.query("drop schema if exists public cascade; create schema public;");
  await migrate();
  await seedNetwork();
}

/** A synthetic 1920x1080 test video made by render.py's fixture command. */
export function fixtureVideo(name = "fixture.mp4", seconds = 12): string {
  mkdirSync(path.join(TMP, "fx"), { recursive: true });
  const out = path.join(TMP, "fx", name);
  execFileSync("python3", [path.join(REPO, "services/media/render.py"), "fixture", "--out", out, "--duration", String(seconds)], { stdio: "pipe" });
  return out;
}

export type Call = { url: URL; method: string; headers: Headers; body: any };

/** A fetch that answers from a route function and records every call. */
export function fakeFetch(route: (c: Call) => Response | undefined | Promise<Response | undefined>) {
  const calls: Call[] = [];
  const f = (async (input: any, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const c: Call = { url, method: (init.method ?? "GET").toUpperCase(), headers: new Headers(init.headers as any), body: init.body };
    calls.push(c);
    return (await route(c)) ?? new Response(JSON.stringify({ message: `no route for ${c.method} ${url.pathname}` }), { status: 599 });
  }) as typeof fetch;
  return { f, calls };
}

export const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });

export async function closeDb(): Promise<void> {
  await pool.end();
}
