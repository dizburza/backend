import { ethers } from "ethers";
import { provider, tokenContract } from "../config/blockchain.js";
import { ENV } from "../config/environment.js";
import { eq, inArray, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { indexerCursors, pendingTransactions } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import { BankingService } from "./banking.service.js";
import { BalanceService } from "./balance.service.js";
import { eventHub } from "./events.service.js";
import { DistributedLock } from "./lock.service.js";
import { primeBlockTimestamps } from "../utils/blockTime.util.js";
import { TransactionCategory } from "../types/transaction.types.js";
import { withDbRetry } from "../utils/dbRetry.util.js";
import logger from "../utils/logger.util.js";

const EVENT_NAME = "Transfer";

type TransferLog = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  from: string;
  to: string;
  value: bigint;
};

type ExtraMetadata = {
  description?: string;
  memo?: string;
  category?: TransactionCategory;
};

const cursorKey = () =>
  `${ENV.CHAIN_ID}:${ENV.PAYROLL_TOKEN_ADDRESS.toLowerCase()}:${EVENT_NAME}`;

/**
 * Cursor-based log indexer.
 *
 * The live listener only sees events while the process is up, so anything
 * emitted during a restart or deploy is lost with no way to notice. This worker
 * persists progress per block instead, backfills on boot, and is the source of
 * truth. The listener and Alchemy webhooks are low-latency hints on top.
 */
export class IndexerService {
  private isRunning = false;
  private pendingRunning = false;
  private stopped = false;
  private timer: NodeJS.Timeout | null = null;
  private pendingTimer: NodeJS.Timeout | null = null;
  // Held for slightly longer than the poll interval so the leader keeps it
  // between ticks, but a crashed leader is replaced within one TTL.
  private readonly lock = new DistributedLock(
    "dizburza:indexer:leader",
    ENV.INDEXER_POLL_INTERVAL_MS * 3
  );

  /**
   * Decode cNGN Transfer logs out of a receipt or log batch.
   */
  private static parseTransferLogs(logs: readonly ethers.Log[]): TransferLog[] {
    const tokenAddress = ENV.PAYROLL_TOKEN_ADDRESS.toLowerCase();
    const parsed: TransferLog[] = [];

    for (const log of logs) {
      if (log.address.toLowerCase() !== tokenAddress) continue;

      let decoded: ethers.LogDescription | null = null;
      try {
        decoded = tokenContract.interface.parseLog({
          topics: [...log.topics],
          data: log.data,
        });
      } catch {
        continue; // not an event this ABI knows about
      }

      if (!decoded || decoded.name !== EVENT_NAME) continue;

      parsed.push({
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        from: decoded.args[0] as string,
        to: decoded.args[1] as string,
        value: decoded.args[2] as bigint,
      });
    }

    return parsed;
  }

  /**
   * Every log is indexed whether or not either party is a registered user. The
   * old listener skipped those, which silently lost treasury movements.
   */
  private static async persistTransfers(
    transfers: TransferLog[],
    options: { fetchReceipts: boolean; extra?: ExtraMetadata }
  ): Promise<Transaction[]> {
    if (transfers.length === 0) return [];

    // One RPC call per distinct block rather than per log.
    await primeBlockTimestamps(transfers.map((t) => t.blockNumber));

    const feesByTx = new Map<string, { fee?: string; gasUsed?: string }>();

    if (options.fetchReceipts) {
      const uniqueHashes = Array.from(new Set(transfers.map((t) => t.txHash)));

      await Promise.all(
        uniqueHashes.map(async (hash) => {
          try {
            const receipt = await provider.getTransactionReceipt(hash);
            if (!receipt) return;

            const gasUsed = receipt.gasUsed;
            const gasPrice =
              (receipt as { gasPrice?: bigint }).gasPrice ??
              (receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice;

            feesByTx.set(hash, {
              gasUsed: gasUsed?.toString(),
              fee: gasPrice && gasUsed ? (gasPrice * gasUsed).toString() : undefined,
            });
          } catch (error) {
            logger.warn(`Could not fetch receipt for ${hash}:`, error);
          }
        })
      );
    }

    const saved: Transaction[] = [];
    // Batch payrolls emit many transfers from the same organization address, so
    // memoise within this window rather than re-querying per log. Scoped to the
    // batch so a newly created organization is picked up on the next pass.
    const classifications = new Map<
      string,
      Awaited<ReturnType<typeof BankingService.classifyTransfer>>
    >();

    for (const transfer of transfers) {
      const senderKey = transfer.from.toLowerCase();
      let classification = classifications.get(senderKey);
      if (!classification) {
        classification = await BankingService.classifyTransfer(transfer.from);
        classifications.set(senderKey, classification);
      }
      const { type, organizationId } = classification;
      const feeInfo = feesByTx.get(transfer.txHash);

      saved.push(
        await BankingService.recordTransaction({
          txHash: transfer.txHash,
          logIndex: transfer.logIndex,
          type,
          fromAddress: transfer.from,
          toAddress: transfer.to,
          amount: transfer.value.toString(),
          blockNumber: transfer.blockNumber,
          fee: feeInfo?.fee,
          gasUsed: feeInfo?.gasUsed,
          organizationId,
          ...options.extra,
        })
      );
    }

    // Push before refreshing balances so the activity list updates instantly;
    // the balance event follows a moment later once the chain read returns.
    for (const transfer of transfers) {
      eventHub.publish({
        type: "transaction",
        address: transfer.from.toLowerCase(),
        txHash: transfer.txHash,
        direction: "sent",
      });
      eventHub.publish({
        type: "transaction",
        address: transfer.to.toLowerCase(),
        txHash: transfer.txHash,
        direction: "received",
      });
    }

    const touched = transfers.flatMap((t) => [t.from, t.to]);
    await BalanceService.invalidate(touched);

    // Anything we just indexed is no longer pending.
    await db
      .delete(pendingTransactions)
      .where(
        inArray(
          pendingTransactions.txHash,
          transfers.map((t) => t.txHash.toLowerCase())
        )
      )
      .catch(() => undefined);

    return saved;
  }

  /**
   * Register a freshly submitted transaction so the backend confirms it the
   * moment it mines, rather than the browser holding a blocking poll open.
   */
  static async watchTransaction(txHash: string, submittedBy: string) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return;

    await db
      .insert(pendingTransactions)
      .values({
        txHash: txHash.toLowerCase(),
        submittedBy: submittedBy.toLowerCase(),
        submittedAt: new Date(),
      })
      .onConflictDoNothing()
      .catch(() => undefined);
  }

  /**
   * Resolve submitted transactions ahead of the cursor. The cursor stays behind
   * the tip for reorg safety, which is correct but too slow for a send the user
   * is watching. This closes that gap without weakening the cursor.
   */
  private async sweepPending() {
    const stale = new Date(Date.now() - 10 * 60_000);

    // Give up on anything that never mined within ten minutes. The cursor will
    // still pick it up if it lands later.
    await db
      .delete(pendingTransactions)
      .where(lt(pendingTransactions.submittedAt, stale))
      .catch(() => undefined);

    const pending = await withDbRetry(
      () => db.select().from(pendingTransactions).limit(50),
      { label: "pending transaction sweep" }
    );

    for (const entry of pending) {
      try {
        const indexed = await IndexerService.indexTransactionByHash(entry.txHash);

        if (indexed.length > 0) {
          await db
            .delete(pendingTransactions)
            .where(eq(pendingTransactions.txHash, entry.txHash));
        } else {
          await db
            .update(pendingTransactions)
            .set({ attempts: entry.attempts + 1, lastCheckedAt: new Date() })
            .where(eq(pendingTransactions.txHash, entry.txHash));
        }
      } catch (error) {
        logger.warn(`Pending sweep failed for ${entry.txHash}:`, error);
      }
    }
  }

  /**
   * Verify a single transaction against the chain and index its transfers.
   * Used by POST /transactions/record so a client can only ever accelerate
   * indexing of something that genuinely happened.
   */
  static async indexTransactionByHash(
    txHash: string,
    extra?: ExtraMetadata
  ): Promise<Transaction[]> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) return [];

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== 1) return [];

    const transfers = IndexerService.parseTransferLogs(receipt.logs);

    return IndexerService.persistTransfers(transfers, {
      fetchReceipts: true,
      extra,
    });
  }

  private static async loadCursor() {
    const key = cursorKey();

    const [existing] = await withDbRetry(
      () =>
        db
          .select()
          .from(indexerCursors)
          .where(eq(indexerCursors.key, key))
          .limit(1),
      { label: "indexer cursor read" }
    );

    if (existing) return existing;

    // Only on the very first boot, because after this the cursor is the record.
    // Left at 0 it walks from genesis, which is hundreds of thousands of empty
    // eth_getLogs windows before it reaches anything real.
    if (ENV.INDEXER_START_BLOCK === 0) {
      logger.warn(
        "⚠️  INDEXER_START_BLOCK is 0, so the first backfill starts at genesis. " +
          "Set it to the block the payroll token was deployed at before this " +
          "runs against a real chain."
      );
    }

    const [created] = await db
      .insert(indexerCursors)
      .values({
        key,
        chainId: ENV.CHAIN_ID,
        contractAddress: ENV.PAYROLL_TOKEN_ADDRESS.toLowerCase(),
        eventName: EVENT_NAME,
        // Start one below so the first pass includes the configured block.
        lastIndexedBlock: Math.max(0, ENV.INDEXER_START_BLOCK - 1),
      })
      .onConflictDoUpdate({
        target: indexerCursors.key,
        set: { updatedAt: new Date() },
      })
      .returning();

    return created;
  }

  /**
   * Index one window of blocks. Returns true when there may be more work
   * immediately available, so a catch-up backfill doesn't wait a full poll
   * interval between windows.
   */
  private async indexOnce(): Promise<boolean> {
    const cursor = await IndexerService.loadCursor();

    const latest = await provider.getBlockNumber();
    // Stay behind the tip so a reorg resolves before we write anything.
    const safeTo = latest - ENV.INDEXER_CONFIRMATIONS;
    const fromBlock = cursor.lastIndexedBlock + 1;

    if (safeTo < fromBlock) return false;

    const toBlock = Math.min(safeTo, fromBlock + ENV.INDEXER_BLOCK_RANGE - 1);

    const logs = await tokenContract.queryFilter(
      tokenContract.filters[EVENT_NAME](),
      fromBlock,
      toBlock
    );

    const transfers = IndexerService.parseTransferLogs(logs as ethers.Log[]);

    await IndexerService.persistTransfers(transfers, {
      fetchReceipts: ENV.INDEXER_FETCH_RECEIPTS,
    });

    // Worth retrying rather than dropping: the transfers above are already
    // written, so losing this leaves the next pass re-reading a window it has
    // already persisted. Idempotent, but paid for in RPC calls every time.
    await withDbRetry(
      () =>
        db
          .update(indexerCursors)
          .set({ lastIndexedBlock: toBlock, lastRunAt: new Date(), lastError: null, updatedAt: new Date() })
          .where(eq(indexerCursors.key, cursorKey())),
      { label: "indexer cursor advance" }
    );

    if (transfers.length > 0) {
      logger.info(
        `🧭 Indexed ${transfers.length} transfer(s) in blocks ${fromBlock}-${toBlock}`
      );
    }

    // More blocks remain behind the safe tip, so keep going without sleeping.
    return toBlock < safeTo;
  }

  private async pendingTick() {
    if (this.pendingRunning || this.stopped) return;
    this.pendingRunning = true;
    try {
      await this.sweepPending();
    } catch (error) {
      logger.warn("Pending sweep pass failed:", error);
    } finally {
      this.pendingRunning = false;
    }
  }

  private async tick() {
    if (this.isRunning || this.stopped) return;

    // Only the leader advances the cursor. Followers stay warm and take over
    // if the leader dies.
    if (!(await this.lock.acquire())) return;

    this.isRunning = true;

    try {
      // Drain the backlog, but bound each tick so a deep backfill can still be
      // interrupted by shutdown and doesn't monopolise the process.
      let iterations = 0;
      let hasMore = true;

      while (hasMore && iterations < 25 && !this.stopped) {
        hasMore = await this.indexOnce();
        iterations++;
      }
    } catch (error: any) {
      logger.error("❌ Indexer pass failed:", error);
      await db
        .update(indexerCursors)
        .set({ lastError: String(error?.message ?? error), lastRunAt: new Date() })
        .where(eq(indexerCursors.key, cursorKey()))
        .catch(() => undefined);
    } finally {
      this.isRunning = false;
    }
  }

  async start() {
    if (!ENV.INDEXER_ENABLED) {
      logger.warn("⏸️  Indexer disabled via INDEXER_ENABLED=false");
      return;
    }

    if (!ENV.PAYROLL_TOKEN_ADDRESS) {
      logger.error("❌ Indexer not started: PAYROLL_TOKEN_ADDRESS is not configured");
      return;
    }

    this.stopped = false;
    await this.lock.connect();

    const cursor = await IndexerService.loadCursor();
    logger.info(
      `🧭 Indexer starting from block ${cursor.lastIndexedBlock + 1} ` +
        `(${ENV.INDEXER_CONFIRMATIONS} confirmations behind tip)`
    );

    void this.tick();
    this.timer = setInterval(() => void this.tick(), ENV.INDEXER_POLL_INTERVAL_MS);

    // Faster cadence than the block cursor: a user watching their own send
    // should see it confirm in seconds, not after the confirmation lag.
    void this.pendingTick();
    this.pendingTimer = setInterval(
      () => void this.pendingTick(),
      ENV.INDEXER_PENDING_INTERVAL_MS
    );
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.pendingTimer) {
      clearInterval(this.pendingTimer);
      this.pendingTimer = null;
    }
    await this.lock.disconnect();
    logger.info("🛑 Indexer stopped");
  }
}
