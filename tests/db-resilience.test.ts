import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTransientDbError, isUniqueViolation } from "../src/utils/pgError.util.js";
import { withDbRetry } from "../src/utils/dbRetry.util.js";

/**
 * Telling a connection failure apart from a query failure.
 *
 * 55 indexer passes died in one afternoon, first on a DNS blip and later on
 * read timeouts, and every one of them was survivable. The cursor meant nothing
 * was lost, so what this guards is the difference between retrying and giving
 * up, not correctness of the data.
 */

/** The shape Drizzle actually throws: no code on top, the real one in `cause`. */
const drizzleWrapped = (driverError: Record<string, unknown>) =>
  Object.assign(new Error("Failed query: select ..."), { cause: driverError });

describe("classifying a database error", () => {
  it("sees through Drizzle's wrapper to the socket error underneath", () => {
    const err = drizzleWrapped({
      code: "ENOTFOUND",
      errno: -3008,
      syscall: "getaddrinfo",
      hostname: "ep-red-hill-axww2k9t-pooler.c-4.us-east-2.aws.neon.tech",
    });

    assert.equal(isTransientDbError(err), true);
  });

  it("treats a read timeout as transient", () => {
    assert.equal(
      isTransientDbError(drizzleWrapped({ code: "ETIMEDOUT", syscall: "read" })),
      true
    );
  });

  it("treats the server ending the session as transient", () => {
    // What a serverless database does when it suspends or fails over.
    assert.equal(isTransientDbError(drizzleWrapped({ code: "57P01" })), true);
  });

  it("does not call a constraint violation transient", () => {
    const err = drizzleWrapped({ code: "23505", constraint_name: "users_username_unique" });

    assert.equal(isTransientDbError(err), false);
    // The existing classifier still recognises it, so the two do not overlap.
    assert.equal(isUniqueViolation(err), true);
  });

  it("does not call an ordinary error transient", () => {
    assert.equal(isTransientDbError(new Error("syntax error at or near")), false);
    assert.equal(isTransientDbError(undefined), false);
  });
});

describe("retrying a database operation", () => {
  it("returns the value once the connection comes back", async () => {
    let calls = 0;

    const value = await withDbRetry(
      async () => {
        calls++;
        if (calls < 3) throw drizzleWrapped({ code: "ECONNRESET" });
        return "cursor";
      },
      { attempts: 3, baseDelayMs: 1 }
    );

    assert.equal(value, "cursor");
    assert.equal(calls, 3);
  });

  it("gives up after the last attempt and rethrows what failed", async () => {
    let calls = 0;

    await assert.rejects(
      withDbRetry(
        async () => {
          calls++;
          throw drizzleWrapped({ code: "ETIMEDOUT" });
        },
        { attempts: 3, baseDelayMs: 1 }
      ),
      /Failed query/
    );

    assert.equal(calls, 3);
  });

  it("does not retry a constraint violation", async () => {
    let calls = 0;

    // Retrying this would waste a connection and delay the 409 the caller is
    // waiting for, since it fails identically every time.
    await assert.rejects(
      withDbRetry(
        async () => {
          calls++;
          throw drizzleWrapped({ code: "23505" });
        },
        { attempts: 3, baseDelayMs: 1 }
      )
    );

    assert.equal(calls, 1);
  });

  it("does not retry an operation that succeeded", async () => {
    let calls = 0;

    await withDbRetry(async () => { calls++; }, { attempts: 3, baseDelayMs: 1 });

    assert.equal(calls, 1);
  });
});
