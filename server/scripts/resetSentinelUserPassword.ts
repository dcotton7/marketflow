#!/usr/bin/env tsx
/**
 * Reset or create a Sentinel login (LOCAL or any DB in DATABASE_URL).
 *
 * Usage:
 *   npx tsx server/scripts/resetSentinelUserPassword.ts --username Don --password "YourNewPass" --admin
 *   npx tsx server/scripts/resetSentinelUserPassword.ts --email you@example.com --password "YourNewPass"
 *
 * Env: DATABASE_URL (from .env). Does not print the password.
 */
import "dotenv/config";
import bcrypt from "bcryptjs";
import pg from "pg";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

const username = arg("--username")?.trim();
const email = arg("--email")?.trim();
const password = arg("--password");
const makeAdmin = process.argv.includes("--admin");
const tier = arg("--tier")?.trim() || (makeAdmin ? "admin" : "pro");

(async () => {
  if (!password || password.length < 6) {
    console.error("Provide --password with at least 6 characters.");
    process.exit(1);
  }
  if (!username && !email) {
    console.error("Provide --username and/or --email.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("No DATABASE_URL in environment.");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const pool = new pg.Pool({ connectionString: url, max: 2 });

  try {
    let user: { id: number; username: string; email: string } | undefined;

    if (username) {
      const found = await pool.query<{ id: number; username: string; email: string }>(
        `SELECT id, username, email FROM sentinel_users WHERE LOWER(username) = LOWER($1)`,
        [username]
      );
      user = found.rows[0];
    }
    if (!user && email) {
      const found = await pool.query<{ id: number; username: string; email: string }>(
        `SELECT id, username, email FROM sentinel_users WHERE LOWER(email) = LOWER($1)`,
        [email]
      );
      user = found.rows[0];
    }

    if (user) {
      await pool.query(
        `UPDATE sentinel_users
         SET password_hash = $1,
             is_active = true,
             is_admin = CASE WHEN $2::boolean THEN true ELSE is_admin END,
             tier = CASE WHEN $2::boolean THEN $3 ELSE tier END
         WHERE id = $4`,
        [hash, makeAdmin, tier, user.id]
      );
      console.log(`Updated password for user "${user.username}" (id=${user.id}, email=${user.email}).`);
      if (makeAdmin) console.log("Granted admin + tier:", tier);
      return;
    }

    const newUsername = username || email!.split("@")[0];
    const newEmail = email || `${newUsername.toLowerCase()}@local.invalid`;

    const inserted = await pool.query<{ id: number; username: string; email: string }>(
      `INSERT INTO sentinel_users (username, email, password_hash, is_admin, is_active, tier)
       VALUES ($1, $2, $3, $4, true, $5)
       RETURNING id, username, email`,
      [newUsername, newEmail, hash, makeAdmin, makeAdmin ? "admin" : tier]
    );
    const row = inserted.rows[0];
    console.log(`Created user "${row.username}" (id=${row.id}, email=${row.email}).`);
    if (makeAdmin) console.log("Admin account with tier: admin");
  } finally {
    await pool.end();
  }
})();
