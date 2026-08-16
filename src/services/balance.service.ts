import { ethers } from "ethers";
import { and, eq } from "drizzle-orm";
import { provider } from "../config/blockchain.js";
import { db } from "../db/client.js";
import { balances } from "../db/schema.js";
import type { Balance } from "../db/types.js";
import { eventHub } from "./events.service.js";
import { TokenService } from "./token.service.js";
import logger from "../utils/logger.util.js";

// How long a cached balance is served without a background refresh. Transfers
// invalidate immediately via the indexer, so this only covers movements the
// indexer can't see (direct mints, transfers on a contract we don't watch).
const STALE_AFTER_MS = 30_000;

export type BalanceView = {
  address: string;
  raw: string;
  decimals: number;
  formatted: string;
  fetchedAt: string;
  stale: boolean;
};

const toView = (row: Balance, stale: boolean): BalanceView => ({
  address: row.address,
  raw: row.raw,
  decimals: row.decimals,
  formatted: ethers.formatUnits(row.raw, row.decimals),
  fetchedAt: row.fetchedAt.toISOString(),
  stale,
});

/**
 * Balances served from the database instead of the browser's RPC connection.
 *
 * Every mount of a balance card used to issue its own `balanceOf` call, so the
 * number flickered through "Loading..." on every page visit. The read path is
 * now a single indexed row lookup. The chain is consulted server-side only:
 * once per address on first sight, then whenever the indexer sees a transfer
 * touching it.
 */
export class BalanceService {
  private static readonly inflight = new Map<string, Promise<Balance>>();

  /**
   * Read the balance straight from the contract and persist it.
   * Concurrent callers for the same address share one RPC call.
   */
  static async refresh(address: string): Promise<Balance> {
    const normalized = address.toLowerCase();

    const existing = BalanceService.inflight.get(normalized);
    if (existing) return existing;

    const task = (async () => {
      const token = await TokenService.getDefault();

      const [raw, blockNumber] = await Promise.all([
        TokenService.contractFor(token).balanceOf(normalized) as Promise<bigint>,
        provider.getBlockNumber().catch(() => undefined),
      ]);

      const values = {
        raw: raw.toString(),
        decimals: token.decimals,
        blockNumber,
        fetchedAt: new Date(),
      };

      const [row] = await db
        .insert(balances)
        .values({ address: normalized, tokenId: token.id, ...values })
        .onConflictDoUpdate({
          target: [balances.address, balances.tokenId],
          set: values,
        })
        .returning();

      if (!row) throw new Error(`Failed to persist balance for ${normalized}`);

      eventHub.publish({
        type: "balance",
        address: normalized,
        raw: row.raw,
        decimals: row.decimals,
      });

      return row;
    })();

    BalanceService.inflight.set(normalized, task);
    try {
      return await task;
    } finally {
      BalanceService.inflight.delete(normalized);
    }
  }

  /**
   * Cached read. Never blocks on RPC unless this address has never been seen.
   */
  static async get(address: string): Promise<BalanceView> {
    const normalized = address.toLowerCase();

    const token = await TokenService.getDefault();

    const [row] = await db
      .select()
      .from(balances)
      .where(and(eq(balances.address, normalized), eq(balances.tokenId, token.id)))
      .limit(1);

    if (!row) {
      // First sight of this address. One synchronous read, then it stays cached.
      const fresh = await BalanceService.refresh(normalized);
      return toView(fresh, false);
    }

    const isStale = Date.now() - row.fetchedAt.getTime() > STALE_AFTER_MS;

    if (isStale) {
      // Serve what we have and refresh behind the response, so the client never
      // waits on the chain. The update reaches them over SSE.
      void BalanceService.refresh(normalized).catch((error) =>
        logger.warn(`Background balance refresh failed for ${normalized}:`, error)
      );
    }

    return toView(row, isStale);
  }

  /**
   * Called by the indexer after transfers are persisted. Refreshes every
   * touched address and pushes the new values to connected clients.
   */
  static async invalidate(addresses: string[]): Promise<void> {
    const unique = Array.from(new Set(addresses.map((a) => a.toLowerCase())));

    await Promise.all(
      unique.map((address) =>
        BalanceService.refresh(address).catch((error) =>
          logger.warn(`Balance invalidation failed for ${address}:`, error)
        )
      )
    );
  }
}
