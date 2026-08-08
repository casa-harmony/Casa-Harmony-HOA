import "server-only";

import postgres, { type Sql } from "postgres";

/**
 * Postgres connection for review comments.
 *
 * Provider-agnostic on purpose: any `DATABASE_URL` works — Neon, Supabase's
 * pooler, or a local Postgres. `prepare: false` is what makes it safe behind a
 * transaction pooler (Supabase :6543); `max: 1` keeps a serverless function
 * from opening a pool it will never reuse.
 */

let client: Sql | null = null;
let schemaReady: Promise<void> | null = null;

export function hasDatabase(): boolean {
  return !!process.env.DATABASE_URL;
}

function connect(): Sql {
  if (client) return client;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  client = postgres(url, {
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : "require",
    max: 1,
    idle_timeout: 20,
    connect_timeout: 15,
    prepare: false,
  });
  return client;
}

/**
 * Create the tables on first use.
 *
 * Cheaper than shipping a migration runner for three tables, and it means the
 * only setup step after pasting a database URL is "deploy".
 */
async function migrate(sql: Sql): Promise<void> {
  await sql`
    create table if not exists review_pins (
      id            text primary key,
      page_path     text not null,
      anchor        text not null,
      anchor_label  text not null default '',
      x_pct         double precision not null default 0.5,
      y_pct         double precision not null default 0.5,
      page_x        double precision not null default 0,
      page_y        double precision not null default 0,
      viewport_w    integer not null default 0,
      status        text not null default 'open',
      author        text not null default 'Guest',
      created_at    timestamptz not null default now(),
      resolved_at   timestamptz,
      resolved_by   text
    )
  `;
  await sql`
    create table if not exists review_messages (
      id          text primary key,
      pin_id      text not null references review_pins(id) on delete cascade,
      author      text not null default 'Guest',
      body        text not null default '',
      created_at  timestamptz not null default now()
    )
  `;
  await sql`
    create table if not exists review_attachments (
      id          text primary key,
      message_id  text not null references review_messages(id) on delete cascade,
      url         text not null,
      thumb_url   text,
      kind        text not null default 'file',
      filename    text not null default '',
      bytes       bigint not null default 0,
      created_at  timestamptz not null default now()
    )
  `;
  await sql`create index if not exists review_pins_page_idx on review_pins (page_path)`;
  await sql`create index if not exists review_messages_pin_idx on review_messages (pin_id)`;
  await sql`create index if not exists review_attachments_msg_idx on review_attachments (message_id)`;
}

export async function getSql(): Promise<Sql> {
  const sql = connect();
  if (!schemaReady) {
    schemaReady = migrate(sql).catch((err) => {
      schemaReady = null; // let the next request retry
      throw err;
    });
  }
  await schemaReady;
  return sql;
}
