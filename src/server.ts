import app from "./app.js";
import { ENV } from "./config/environment.js";
import { closeDb } from "./db/client.js";
import { closeRedisClient } from "./config/redis.js";
import { BlockchainListener } from "./listeners/blockchain.listener.js";
import { IndexerService } from "./services/indexer.service.js";
import { eventHub } from "./services/events.service.js";
import { ProposalService } from "./services/proposal.service.js";
import { CashLinkService } from "./services/cashlink.service.js";
import { DistributedLock } from "./services/lock.service.js";
import logger from "./utils/logger.util.js";

/**
 * Running several instances without Redis breaks quietly, which is why this is
 * a hard stop rather than a warning.
 *
 * A browser holds its stream to one instance, so it never sees events published
 * by another and its dashboard just goes still. Rate limit counters are per
 * process, so every limit is multiplied by the instance count, the lookup
 * limiter included. Nothing errors and nothing appears in the logs, so the
 * first report comes from a user. Deploy time is the last moment this is cheap
 * to fix.
 */
if (ENV.EXPECT_MULTI_INSTANCE && !ENV.REDIS_URL) {
  logger.error(
    "❌ EXPECT_MULTI_INSTANCE is set but REDIS_URL is not. Realtime events " +
      "would not cross instances, every instance would run its own indexer, " +
      "and each would keep its own rate limit counters. Set REDIS_URL, or " +
      "unset EXPECT_MULTI_INSTANCE if this really is the only instance."
  );
  process.exit(1);
}

try {
  // The Postgres pool connects lazily on first query, so there is nothing to
  // await here.

  // Optional. Without it realtime events stay inside this process.
  await eventHub.connect();

  // Latency hint on top of the indexer, so it follows the same switch: with
  // indexing off there is no cursor for it to run ahead of.
  const blockchainListener = new BlockchainListener();
  if (ENV.INDEXER_ENABLED) {
    await blockchainListener.start();
  } else {
    logger.warn("⏸️  Blockchain listener disabled via INDEXER_ENABLED=false");
  }

  // Source of truth for history. Backfills on boot.
  const indexer = new IndexerService();
  await indexer.start();

  /**
   * Settle proposals whose window has closed.
   *
   * Status is already derived on read, so nothing depends on this having run.
   * It writes the settled value down so reporting and any later query see the
   * same answer the API does. The update is idempotent, so several instances
   * running it costs nothing.
   */
  const expireProposals = async () => {
    try {
      const expired = await ProposalService.expireOverdue();
      if (expired > 0) logger.info(`⌛ Expired ${expired} proposal(s) past their window`);
    } catch (error) {
      logger.warn("Proposal expiry sweep failed:", error);
    }
  };

  await expireProposals();
  const expiryTimer = setInterval(() => void expireProposals(), 60 * 60_000);

  /**
   * Return lapsed CashLinks to their senders.
   *
   * Unlike the proposal sweep this spends money, so only one instance may run
   * it. Two would race the same links and pay for reverting transactions.
   * `reclaim` pays the sender and nobody else, so a missed sweep makes a refund
   * late rather than lost.
   */
  const cashLinkLock = new DistributedLock("dizburza:cashlink:sweeper", 5 * 60_000);
  await cashLinkLock.connect();

  const sweepCashLinks = async () => {
    try {
      if (!(await cashLinkLock.acquire())) return;

      const swept = await CashLinkService.sweepExpired();
      if (swept > 0) logger.info(`↩️  Returned ${swept} lapsed CashLink(s) to sender`);
    } catch (error) {
      logger.warn("CashLink sweep failed:", error);
    }
  };

  const cashLinkTimer = CashLinkService.enabled
    ? setInterval(() => void sweepCashLinks(), ENV.CASHLINK_SWEEP_INTERVAL_MS)
    : null;

  if (CashLinkService.enabled) await sweepCashLinks();

  // Start server
  const server = app.listen(ENV.PORT, () => {
    logger.info(`🚀 Server running on port ${ENV.PORT}`);
    logger.info(`📡 Environment: ${ENV.NODE_ENV}`);
    logger.info(`🌍 API URL: http://localhost:${ENV.PORT}/api`);
  });

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info(`${signal} signal received: closing HTTP server`);

    // Release the indexer lock before exiting so a replacement instance can
    // take over immediately rather than waiting out the TTL.
    clearInterval(expiryTimer);
    if (cashLinkTimer) clearInterval(cashLinkTimer);
    await cashLinkLock.release();
    blockchainListener.stop();
    await indexer.stop();
    await eventHub.shutdown();
    await closeRedisClient();

    // Close server
    server.close(() => {
      logger.info("HTTP server closed");
    });

    try {
      await closeDb();
    } catch (error) {
      logger.error("Error closing database pool:", error);
    }

    process.exit(0);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle uncaught exceptions
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught Exception:", error);
    shutdown("UNCAUGHT_EXCEPTION");
  });

  process.on("unhandledRejection", (reason, promise) => {
    logger.error("Unhandled Rejection at:", promise, "reason:", reason);
    shutdown("UNHANDLED_REJECTION");
  });
} catch (error) {
  logger.error("❌ Failed to start server:", error);
  process.exit(1);
}

