import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations want a direct connection. Some DDL does not survive PgBouncer
    // in transaction mode, so hosted setups point DIRECT_DATABASE_URL at the
    // unpooled endpoint and leave DATABASE_URL pooled for the app.
    url: process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL!,
  },
  verbose: true,
  strict: true,
});
