import { decryptText, encryptText } from "./config";

/** One row per user. Tokens are decrypted only in memory; nothing here is logged or returned by a route. */
export interface SchwabConnection {
  userId: number;
  accessToken: string | null;
  refreshToken: string | null;
  accessExpiresAt: number | null; // ms
  refreshExpiresAt: number | null; // ms, 7 days from sign-in
  lastError: string | null;
  syncWatchlistId: number | null;
  lastSyncAt: number | null;
}

export interface SchwabStore {
  load(userId: number): Promise<SchwabConnection | null>;
  /** Saves tokens and expiry (and clears lastError). */
  saveTokens(c: Pick<SchwabConnection, "userId" | "accessToken" | "refreshToken" | "accessExpiresAt" | "refreshExpiresAt">): Promise<void>;
  /** Deletes the tokens (Disconnect, or a refused refresh); the sync list id stays. */
  clearTokens(userId: number, lastError: string | null): Promise<void>;
  setSync(userId: number, watchlistId: number, at: number): Promise<void>;
  /** Users with a stored refresh token. */
  connectedUsers(): Promise<number[]>;
}

export const emptyConnection = (userId: number): SchwabConnection => ({
  userId, accessToken: null, refreshToken: null, accessExpiresAt: null, refreshExpiresAt: null,
  lastError: null, syncWatchlistId: null, lastSyncAt: null,
});

export class MemoryStore implements SchwabStore {
  rows = new Map<number, SchwabConnection>();
  async load(userId: number) {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }
  async saveTokens(c: Parameters<SchwabStore["saveTokens"]>[0]) {
    this.rows.set(c.userId, { ...(this.rows.get(c.userId) ?? emptyConnection(c.userId)), ...c, lastError: null });
  }
  async clearTokens(userId: number, lastError: string | null) {
    const r = this.rows.get(userId) ?? emptyConnection(userId);
    this.rows.set(userId, { ...r, accessToken: null, refreshToken: null, accessExpiresAt: null, refreshExpiresAt: null, lastError });
  }
  async setSync(userId: number, watchlistId: number, at: number) {
    const r = this.rows.get(userId) ?? emptyConnection(userId);
    this.rows.set(userId, { ...r, syncWatchlistId: watchlistId, lastSyncAt: at });
  }
  async connectedUsers() {
    return [...this.rows.values()].filter((r) => r.refreshToken).map((r) => r.userId);
  }
}

export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: any[] }>;
}

export const SCHEMA = [
  `create table if not exists schwab_connection (
    user_id integer primary key,
    access_enc text,
    refresh_enc text,
    access_expires_at timestamptz,
    refresh_expires_at timestamptz,
    last_error text,
    sync_watchlist_id integer,
    last_sync_at timestamptz,
    updated_at timestamptz default now()
  )`,
  `create table if not exists schwab_synced_rows (
    item_id integer primary key,
    user_id integer not null,
    watchlist_id integer not null,
    symbol text not null
  )`,
];

export async function ensureSchwabSchema(db: Queryable): Promise<void> {
  for (const s of SCHEMA) await db.query(s);
}

const ms = (v: unknown) => (v ? new Date(v as string).getTime() : null);
const iso = (v: number | null) => (v === null ? null : new Date(v).toISOString());

export class PgStore implements SchwabStore {
  constructor(private db: Queryable, private key: Buffer) {}

  private open(v: string | null): string | null {
    if (!v) return null;
    try {
      return decryptText(this.key, v);
    } catch {
      return null; // another key (a new app secret): treated as signed out
    }
  }

  async load(userId: number): Promise<SchwabConnection | null> {
    const { rows } = await this.db.query("select * from schwab_connection where user_id = $1", [userId]);
    const r = rows[0];
    if (!r) return null;
    return {
      userId, accessToken: this.open(r.access_enc), refreshToken: this.open(r.refresh_enc),
      accessExpiresAt: ms(r.access_expires_at), refreshExpiresAt: ms(r.refresh_expires_at), lastError: r.last_error,
      syncWatchlistId: r.sync_watchlist_id, lastSyncAt: ms(r.last_sync_at),
    };
  }

  async saveTokens(c: Parameters<SchwabStore["saveTokens"]>[0]) {
    await this.db.query(
      `insert into schwab_connection (user_id, access_enc, refresh_enc, access_expires_at, refresh_expires_at, last_error, updated_at)
       values ($1, $2, $3, $4, $5, null, now())
       on conflict (user_id) do update set access_enc = $2, refresh_enc = $3, access_expires_at = $4,
         refresh_expires_at = $5, last_error = null, updated_at = now()`,
      [c.userId, c.accessToken ? encryptText(this.key, c.accessToken) : null,
        c.refreshToken ? encryptText(this.key, c.refreshToken) : null, iso(c.accessExpiresAt), iso(c.refreshExpiresAt)],
    );
  }

  async clearTokens(userId: number, lastError: string | null) {
    await this.db.query(
      `insert into schwab_connection (user_id, last_error) values ($1, $2)
       on conflict (user_id) do update set access_enc = null, refresh_enc = null, access_expires_at = null,
         refresh_expires_at = null, last_error = $2, updated_at = now()`,
      [userId, lastError],
    );
  }

  async setSync(userId: number, watchlistId: number, at: number) {
    await this.db.query(
      `insert into schwab_connection (user_id, sync_watchlist_id, last_sync_at) values ($1, $2, $3)
       on conflict (user_id) do update set sync_watchlist_id = $2, last_sync_at = $3`,
      [userId, watchlistId, iso(at)],
    );
  }

  async connectedUsers() {
    const { rows } = await this.db.query("select user_id from schwab_connection where refresh_enc is not null");
    return rows.map((r) => Number(r.user_id));
  }
}
