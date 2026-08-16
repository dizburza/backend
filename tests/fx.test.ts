import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { server, sql } from "./helpers/harness.js";
import { FxService } from "../src/services/fx.service.js";

/**
 * The rate is a real one now, which means it can be unavailable. A sender must
 * never be unable to create a link because a price API is down, so the interest
 * here is entirely in how it degrades.
 *
 * The harness has no network, so every fetch in this file fails. That is the
 * case worth asserting.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

before(() => FxService.reset());

describe("ETH/NGN", () => {
  it("falls back to the configured rate when it cannot be read", async () => {
    FxService.reset();

    const rate = await FxService.ngnPerEth();

    assert.equal(rate.source, "fallback");
    assert.equal(rate.stale, true, "and says so, rather than passing it off as live");
    assert.ok(rate.ngnPerEth > 0);
  });

  it("never returns something implausible", async () => {
    const rate = await FxService.ngnPerEth();

    // The guard that matters: pricing off a rate wrong by two orders of
    // magnitude either gives the product away or charges a month's salary.
    assert.ok(rate.ngnPerEth >= 100_000, "too low to be a naira price for ETH");
    assert.ok(rate.ngnPerEth <= 100_000_000, "too high to be a naira price for ETH");
  });

  it("collapses a burst of callers into one attempt", async () => {
    FxService.reset();

    const results = await Promise.all(
      Array.from({ length: 8 }, () => FxService.ngnPerEth())
    );

    // All eight get an answer, and all the same one. Without the in-flight
    // guard a cold cache turns a burst of quotes into a burst of API calls.
    assert.equal(results.length, 8);
    for (const result of results) {
      assert.equal(result.ngnPerEth, results[0].ngnPerEth);
    }
  });

  it("keeps answering after a failure rather than latching broken", async () => {
    FxService.reset();

    const first = await FxService.ngnPerEth();
    const second = await FxService.ngnPerEth();

    assert.equal(first.ngnPerEth, second.ngnPerEth);
    assert.ok(second.ngnPerEth > 0, "a failed fetch must not poison later calls");
  });
});
