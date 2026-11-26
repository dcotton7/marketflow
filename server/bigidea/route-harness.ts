/**
 * Test helper: the real BigIdea routes on a throwaway Postgres, with a fake session.
 *
 * Needs BIGIDEA_TEST_DATABASE_URL pointing at a scratch database that already has the schema
 * (`DATABASE_URL=<scratch> npx drizzle-kit push`). Never point it at a real database: it inserts test users and
 * rows. Without the variable the DB tests print "skipped" and exit 0.
 *
 * Each request names its user in the X-Test-User header; the fake session middleware copies it to
 * req.session.userId, which is what the app's own session sets after login.
 */
import express from "express";
import type { AddressInfo } from "node:net";

export const TEST_DB_URL = process.env.BIGIDEA_TEST_DATABASE_URL;

export interface Harness {
  call: (method: string, path: string, user: number | null, body?: unknown) => Promise<{ status: number; body: any }>;
  sql: (text: string, params?: unknown[]) => Promise<any[]>;
  users: { owner: number; alice: number; bob: number };
  close: () => Promise<void>;
}

export async function startHarness(extraEnv: Record<string, string> = {}): Promise<Harness | null> {
  if (!TEST_DB_URL) {
    console.log("skipped: set BIGIDEA_TEST_DATABASE_URL to a scratch Postgres with the schema pushed");
    return null;
  }
  if (/render\.com|neon\.tech|amazonaws|supabase/i.test(TEST_DB_URL)) throw new Error("refusing a hosted database");
  process.env.DATABASE_URL = TEST_DB_URL;
  Object.assign(process.env, extraEnv);
  const dbMod = await import("../db");
  await dbMod.initializeDatabase();
  const pool = dbMod.getPool();
  if (!pool) throw new Error("test database did not connect");
  const sql = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows;

  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const mk = async (name: string, admin: boolean) =>
    (await sql(
      `INSERT INTO sentinel_users (username, email, password_hash, is_admin, tier) VALUES ($1, $2, 'x', $3, $4) RETURNING id`,
      [`${name}-${stamp}`, `${name}-${stamp}@test.invalid`, admin, admin ? "admin" : "free"],
    ))[0].id as number;
  const users = { owner: await mk("owner", true), alice: await mk("alice", false), bob: await mk("bob", false) };
  process.env.OWNER_USER_IDS = String(users.owner);

  const { registerBigIdeaRoutes } = await import("./routes");
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use((req, _res, next) => {
    const u = req.header("x-test-user");
    (req as any).session = u ? { userId: Number(u) } : {};
    next();
  });
  registerBigIdeaRoutes(app as any);
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const call = async (method: string, path: string, user: number | null, body?: unknown) => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (user != null) headers["x-test-user"] = String(user);
    const r = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let parsed: any = text;
    try { parsed = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, body: parsed };
  };
  const close = async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
  };
  return { call, sql, users, close };
}
