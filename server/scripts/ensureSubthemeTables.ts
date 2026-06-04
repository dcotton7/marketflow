#!/usr/bin/env tsx
import "dotenv/config";
import { sql } from "drizzle-orm";
import { initializeDatabase, db } from "../db";

async function ensureSubthemeTables() {
  if (!db) {
    console.error("[ensureSubthemeTables] Database not available");
    process.exit(1);
  }

  await db.execute(sql.raw(`
    create table if not exists subthemes (
      id text primary key,
      theme_id text not null references themes(id) on delete cascade,
      name text not null,
      description text,
      sort_order integer default 0,
      is_active boolean not null default true,
      created_at timestamp default now(),
      updated_at timestamp default now()
    );
  `));

  await db.execute(sql.raw(`
    create table if not exists ticker_slice_memberships (
      id serial primary key,
      symbol text not null references tickers(symbol) on delete cascade,
      theme_id text references themes(id) on delete cascade,
      subtheme_id text references subthemes(id) on delete cascade,
      is_anchor boolean not null default false,
      is_leader_eligible boolean not null default true,
      is_default_visible boolean not null default true,
      source text not null default 'manual',
      created_at timestamp default now(),
      updated_at timestamp default now()
    );
  `));

  await db.execute(sql.raw(`
    create unique index if not exists uq_ticker_slice_memberships_symbol_theme_subtheme
    on ticker_slice_memberships(symbol, theme_id, subtheme_id);
  `));

  console.log("[ensureSubthemeTables] Ready");
}

(async () => {
  await initializeDatabase();
  await ensureSubthemeTables();
  process.exit(0);
})();
