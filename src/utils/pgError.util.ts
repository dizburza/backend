/** Postgres unique-violation. */
export const UNIQUE_VIOLATION = "23505";

type PostgresErrorish = {
  code?: string;
  constraint_name?: string;
  cause?: unknown;
};

/**
 * Find the driver error inside whatever Drizzle threw.
 *
 * Drizzle wraps driver errors in its own error type, so `err.code` is undefined
 * at the top level and a naive check silently fails to recognise a constraint
 * violation. That turns an intended 409 into a 500 and, worse, looks like it is
 * working until something actually collides.
 */
const unwrap = (err: unknown): PostgresErrorish | null => {
  let current: unknown = err;

  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = current as PostgresErrorish;
    if (typeof candidate.code === "string") return candidate;
    current = candidate.cause;
  }

  return null;
};

/** True when this error is a unique violation, optionally on a named index. */
export const isUniqueViolation = (err: unknown, constraintIncludes?: string): boolean => {
  const pg = unwrap(err);
  if (pg?.code !== UNIQUE_VIOLATION) return false;
  if (!constraintIncludes) return true;

  return String(pg.constraint_name ?? "").includes(constraintIncludes);
};

/**
 * Codes that mean the connection failed rather than the query did.
 *
 * Both halves are needed. The socket errors arrive as a `cause` from Node, and
 * the five digit ones are Postgres telling us the server ended the session,
 * which is what a serverless database does when it suspends or fails over.
 */
const TRANSIENT_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EPIPE",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "CONNECTION_DESTROYED",
  "CONNECTION_ENDED",
  "08000",
  "08001",
  "08003",
  "08006",
  "57P01",
  "57P03",
]);

/**
 * True when retrying the same query might work.
 *
 * Deliberately narrow. A constraint violation or a syntax error would fail
 * identically every time, and retrying it wastes a connection and delays the
 * error the caller needs to see.
 */
export const isTransientDbError = (err: unknown): boolean => {
  let current: unknown = err;

  for (let depth = 0; depth < 5 && current; depth++) {
    const candidate = current as PostgresErrorish;
    if (typeof candidate.code === "string" && TRANSIENT_CODES.has(candidate.code)) {
      return true;
    }
    current = candidate.cause;
  }

  return false;
};
