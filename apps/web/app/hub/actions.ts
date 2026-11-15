"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sapi } from "@/lib/server";

export type FormState = { error?: string; ok?: string; key?: string; mcp?: string; id?: string; links?: Record<string, any> } | null;

export async function rotateKey(_prev: FormState, form: FormData): Promise<FormState> {
  const id = String(form.get("id") ?? "");
  const r = await sapi<{ key: string; mcp_url: string }>(`/bots/${encodeURIComponent(id)}/rotate`, { method: "POST" });
  revalidatePath("/hub/bots");
  return r.ok ? { key: r.data.key, mcp: r.data.mcp_url, id } : { error: r.error };
}

export async function saveStreamer(_prev: FormState, form: FormData): Promise<FormState> {
  const body = {
    platform: String(form.get("platform") ?? "kick"),
    login: String(form.get("login") ?? "").trim().replace(/^@/, ""),
    permission: String(form.get("permission") ?? "none"),
    proof: String(form.get("proof") ?? "").trim() || undefined,
    note: String(form.get("note") ?? "").trim() || undefined,
    record_live: form.get("record_live") === "on",
    edge_hint: String(form.get("edge_hint") ?? "") || undefined,
  };
  const r = await sapi("/streamers", { method: "POST", json: body });
  revalidatePath("/hub/streamers");
  return r.ok ? { ok: `Saved ${body.login}.` } : { error: r.error };
}

export async function connectTwitch(): Promise<void> {
  const r = await sapi<{ url: string }>("/twitch/connect");
  if (!r.ok) redirect(`/hub/streamers?error=${encodeURIComponent(r.error)}`);
  redirect(r.data.url);
}

export async function setupUploadPost(_prev: FormState): Promise<FormState> {
  const r = await sapi<Record<string, any>>("/upload-post/setup", { method: "POST" });
  return r.ok ? { links: r.data } : { error: r.error };
}

export async function refreshHandles(): Promise<void> {
  await sapi("/upload-post/profiles");
  revalidatePath("/hub/accounts");
}

export async function importClip(_prev: FormState, form: FormData): Promise<FormState> {
  const r = await sapi<{ id: string }>("/clips/import", { method: "POST", json: { url: String(form.get("url") ?? ""), title: String(form.get("title") ?? "") || undefined, game: String(form.get("game") ?? "gta5") } });
  revalidatePath("/hub/library");
  return r.ok ? { ok: `Added to the library (${r.data.id}).` } : { error: r.error };
}

export async function cancelPost(form: FormData): Promise<void> {
  await sapi(`/posts/${encodeURIComponent(String(form.get("id")))}/cancel`, { method: "POST" });
  revalidatePath("/hub");
  revalidatePath("/hub/accounts");
}

export async function togglePause(form: FormData): Promise<void> {
  await sapi(`/accounts/${encodeURIComponent(String(form.get("id")))}`, { method: "PUT", json: { paused: form.get("paused") === "1" } });
  revalidatePath("/hub/accounts");
}
