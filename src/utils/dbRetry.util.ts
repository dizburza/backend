import { isTransientDbError } from "./pgError.util.js";
import logger from "./logger.util.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run a database operation again if the connection, rather than the query,
 * failed.
 *
 * A hosted database is reachable over a name and a socket, so both can fail
 * briefly without anything being wrong with the data: 55 indexer passes died on
 * `ENOTFOUND` during one DNS blip, and later ones on `ETIMEDOUT`. The cursor
 * meant none of it was lost, only delayed and noisy, but every caller was
 * writing its own version of that recovery or none at all.
 *
 * Only for reads and idempotent writes. Everything this wraps is either a
 * select or an upsert keyed on something stable, so a retry that duplicates
 * work still lands on one row.
 */
export const withDbRetry = async <T>(
  operation: () => Promise<T>,
  options: { attempts?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> => {
  const { attempts = 3, baseDelayMs = 250, label = "database operation" } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isTransientDbError(error) || attempt === attempts) throw error;

      // Doubling, because the failures worth retrying are the ones where
      // something upstream needs a moment: a suspended compute waking, a
      // resolver refilling its cache.
      const delay = baseDelayMs * 2 ** (attempt - 1);

      logger.warn(`Retrying ${label} after a connection failure`, {
        attempt,
        of: attempts,
        delayMs: delay,
        error: error instanceof Error ? error.message : String(error),
      });

      await sleep(delay);
    }
  }

  throw lastError;
};
