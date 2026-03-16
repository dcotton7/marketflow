import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./shared/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_d1zsHf7jJRmV@ep-broad-truth-afv67u09-pooler.c-2.us-west-2.aws.neon.tech/neondb?sslmode=require",
  },
});