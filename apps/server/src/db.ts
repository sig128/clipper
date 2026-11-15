/** Postgres access: one pool, tiny query helpers, and the schema migrations. */
import pg from "pg";
import { config } from "./config.js";

// Return int8 / numeric as numbers; our counts fit comfortably.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
});

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, params)).rows as T[];
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const out = await fn(c);
    await c.query("commit");
    return out;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

const MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "001_init",
    sql: `
create table edges (
  id text primary key,
  name text not null,
  upload_post_user text not null,
  lane text not null,
  brief jsonb not null,
  guidance text not null default '',
  created_at timestamptz not null default now()
);

create table accounts (
  id text primary key,
  edge_id text not null references edges(id),
  platform text not null check (platform in ('yt','tt','ig')),
  handle text,
  slots text[] not null,
  tz text not null default 'America/New_York',
  paused boolean not null default false,
  unique (edge_id, platform)
);

create table streamers (
  id bigserial primary key,
  platform text not null check (platform in ('twitch','kick')),
  login text not null,
  platform_user_id text,
  display_name text,
  permission text not null default 'none' check (permission in ('none','campaign','written','own')),
  proof text,
  note text,
  record_live boolean not null default false,
  edge_hint text references edges(id),
  is_live boolean not null default false,
  live_title text,
  live_viewers int,
  live_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, login)
);

create table clips (
  id text primary key,
  source text not null check (source in ('twitch_clip','kick_live','upload')),
  streamer_id bigint references streamers(id),
  streamer_login text,
  streamer_platform text,
  title text,
  url text,
  embed_url text,
  thumbnail_url text,
  media_key text,
  width int, height int, fps text,
  duration_s real,
  view_count int,
  game text,
  language text,
  created_at_source timestamptz,
  ingested_at timestamptz not null default now(),
  score real not null default 0,
  moment jsonb,
  status text not null default 'new' check (status in ('new','used','rejected')),
  meta jsonb not null default '{}'
);
create index clips_recent on clips (ingested_at desc);
create index clips_rank on clips (status, score desc);

create table edits (
  id text primary key,
  edge_id text not null references edges(id),
  clip_id text not null references clips(id),
  created_by text not null,
  hook text not null,
  commentary text,
  headline text,
  layout text not null default 'full',
  in_s real not null,
  out_s real not null,
  edl jsonb,
  render_status text not null default 'draft' check (render_status in ('draft','queued','rendering','ready','failed')),
  render_error text,
  media_key text,
  duration_s real,
  checks jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table posts (
  id text primary key,
  edit_id text not null references edits(id),
  account_id text not null references accounts(id),
  platform text not null,
  at timestamptz not null,
  title text not null,
  caption text not null default '',
  hashtags text[] not null default '{}',
  status text not null default 'planned' check (status in ('planned','sending','sent','published','failed','cancelled')),
  intent_key text not null unique,
  remote_request_id text,
  remote_post_id text,
  remote_url text,
  error text,
  created_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index posts_edit_platform on posts (edit_id, platform) where status <> 'cancelled';
create index posts_account_time on posts (account_id, at);

create table metrics (
  post_id text not null references posts(id),
  taken_at timestamptz not null default now(),
  age_h real not null,
  views int, likes int, comments int, shares int, saves int,
  raw jsonb,
  primary key (post_id, taken_at)
);

create table bots (
  id text primary key,
  name text not null,
  role text not null check (role in ('manager','worker')),
  edge_id text references edges(id),
  key_hash text,
  key_hint text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz,
  disabled boolean not null default false
);

create table activity (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text,
  detail jsonb not null default '{}'
);
create index activity_recent on activity (at desc);

create table settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create table jobs (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null default '{}',
  run_at timestamptz not null default now(),
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  max_attempts int not null default 5,
  locked_until timestamptz,
  unique_key text,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index jobs_one_active on jobs (unique_key) where unique_key is not null and status in ('queued','running');
create index jobs_due on jobs (kind, status, run_at);
`,
  },
];

/** Applies new migrations in order, once, even if two instances start together. */
export async function migrate(): Promise<string[]> {
  return tx(async (c) => {
    await c.query("select pg_advisory_xact_lock(711_2026)");
    await c.query("create table if not exists schema_migrations (id text primary key, applied_at timestamptz not null default now())");
    const done = new Set((await c.query("select id from schema_migrations")).rows.map((r) => r.id as string));
    const applied: string[] = [];
    for (const m of MIGRATIONS) {
      if (done.has(m.id)) continue;
      await c.query(m.sql);
      await c.query("insert into schema_migrations (id) values ($1)", [m.id]);
      applied.push(m.id);
    }
    return applied;
  });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  return (await one<{ value: T }>("select value from settings where key = $1", [key]))?.value;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await q(
    "insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value, updated_at = now()",
    [key, JSON.stringify(value)],
  );
}
