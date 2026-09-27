import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { ENV } from "../config/environment.js";
import logger from "../utils/logger.util.js";

/**
 * Applies pending migrations from the runtime image.
 *
 * drizzle-kit is a dev dependency and the deployed image installs with
 * --omit=dev, so `db:migrate` cannot run there. The migrator ships inside
 * drizzle-orm, which is a production dependency, so this can.
 */
const url = ENV.DIRECT_DATABASE_URL || ENV.DATABASE_URL;

if (!url) {
  logger.error("Neither DIRECT_DATABASE_URL nor DATABASE_URL is set");
  process.exit(1);
}

// One connection, no prepared statements: DDL runs once and some of it does not
// survive a transaction pooler.
const client = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });

try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  logger.info("Migrations applied");
  await client.end();
} catch (error) {
  logger.error("Migration failed:", error);
  await client.end({ timeout: 5 });
  process.exit(1);
}
