/**
 * Publication intents: one per (revision, platform, account). The publisher
 * writes the intent BEFORE each remote step and stores remote ids as soon as it
 * has them, so a crash or a retried queue job resumes instead of posting twice.
 */
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { PublicationIntent } from "@clipforge/contracts";

export interface IntentStore {
  get(key: string): Promise<PublicationIntent | undefined>;
  put(intent: PublicationIntent): Promise<void>;
}

export class MemoryIntentStore implements IntentStore {
  map = new Map<string, PublicationIntent>();
  async get(key: string) { return this.map.get(key); }
  async put(i: PublicationIntent) { this.map.set(i.key, { ...i }); }
}

/** A JSON file, written atomically. Enough for a single-owner deployment; swap for Postgres later. */
export class FileIntentStore implements IntentStore {
  private cache: Record<string, PublicationIntent> | null = null;
  private chain: Promise<void> = Promise.resolve();
  constructor(private path: string) {}
  private async load() {
    if (this.cache) return this.cache;
    try { this.cache = JSON.parse(await readFile(this.path, "utf8")); } catch { this.cache = {}; }
    return this.cache!;
  }
  async get(key: string) { return (await this.load())[key]; }
  async put(i: PublicationIntent) {
    this.chain = this.chain.then(async () => {
      const all = await this.load();
      all[i.key] = { ...i };
      await mkdir(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.tmp`;
      await writeFile(tmp, JSON.stringify(all, null, 1));
      await rename(tmp, this.path);
    });
    return this.chain;
  }
}

export const stamp = <T extends object>(o: T) => ({ ...o, updatedAt: new Date().toISOString() });
