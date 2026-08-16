import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { ENV } from "../config/environment.js";
import logger from "../utils/logger.util.js";
import * as schema from "./schema.js";

if (!ENV.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set");
}

/**
 * Hosted Postgres usually sits behind PgBouncer in transaction mode, where a
 * prepared statement can be issued on one backend and executed on another.
 * Neon signals it with a `-pooler` host, Supabase with `pgbouncer=true`. Left
 * on, it fails at runtime rather than at connect, so detect it here instead of
 * relying on whoever sets DATABASE_URL to remember.
 */
const isTransactionPooled = (url: string) =>
  url.includes("-pooler.") || url.includes("pgbouncer=true");

/**
 * `max` is per process. The indexer, the SSE hub and request handlers all share
 * this pool, so it needs headroom above the request concurrency alone.
 */
const queryClient = postgres(ENV.DATABASE_URL, {
  max: ENV.DATABASE_POOL_MAX,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: !isTransactionPooled(ENV.DATABASE_URL),
  onnotice: () => undefined,
});

export const db = drizzle(queryClient, { schema });

export const closeDb = async () => {
  await queryClient.end({ timeout: 5 });
  logger.info("Database pool closed");
};

export type Database = typeof db;

/** The handle a `db.transaction` callback receives. */
export type DbTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export { schema };
