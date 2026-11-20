/**
 * Append-only archive of delisted tickers (Don, 20 Nov: market history is never deleted).
 * The live tables keep behaving as before: a delisted symbol is still deleted from `tickers` and
 * `ticker_slice_memberships` so no live page or scan can show it. Just before each delete, in the same transaction,
 * the rows are copied here as JSON (so a later column added to `tickers` cannot break the copy). Running it twice
 * for the same rows adds nothing. Nothing deletes from or updates these two tables.
 */
import { sql } from "drizzle-orm";

export const ARCHIVE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS tickers_delisted (id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, delisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), row JSONB NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tickers_delisted_symbol ON tickers_delisted (symbol)`,
  `CREATE TABLE IF NOT EXISTS ticker_slice_memberships_delisted (id SERIAL PRIMARY KEY, symbol TEXT NOT NULL, delisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), row JSONB NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_tsm_delisted_symbol ON ticker_slice_memberships_delisted (symbol)`,
];

type Tx = { execute: (q: any) => Promise<any> };
let ensured = false;

/** Copy this symbol's ticker and membership rows into the archive. Call inside the transaction that deletes them. */
export async function archiveDelisted(tx: Tx, symbol: string): Promise<void> {
  if (!ensured) {
    for (const stmt of ARCHIVE_DDL) await tx.execute(sql.raw(stmt));
    ensured = true;
  }
  await tx.execute(sql`INSERT INTO tickers_delisted (symbol, row) SELECT t.symbol, to_jsonb(t) FROM tickers t WHERE t.symbol = ${symbol} AND NOT EXISTS (SELECT 1 FROM tickers_delisted a WHERE a.symbol = t.symbol AND a.row = to_jsonb(t))`);
  await tx.execute(sql`INSERT INTO ticker_slice_memberships_delisted (symbol, row) SELECT m.symbol, to_jsonb(m) FROM ticker_slice_memberships m WHERE m.symbol = ${symbol} AND NOT EXISTS (SELECT 1 FROM ticker_slice_memberships_delisted a WHERE a.symbol = m.symbol AND a.row = to_jsonb(m))`);
}
