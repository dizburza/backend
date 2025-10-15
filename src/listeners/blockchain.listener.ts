import { ethers } from "ethers";
import { cNGNContract } from "../config/blockchain";
import { BankingService } from "../services/banking.service";
import { User } from "../models/User.model";
import logger from "../utils/logger.util";

export class BlockchainListener {
  private isListening: boolean = false;

  /**
   * Start listening to cNGN Transfer events
   */
  async start() {
    if (this.isListening) {
      logger.warn("Blockchain listener already running");
      return;
    }

    logger.info("🎧 Starting blockchain event listener...");

    cNGNContract.on("Transfer", async (from, to, value, event) => {
      try {
        logger.debug(
          `📝 Transfer detected: ${from} -> ${to} (${ethers.formatUnits(
            value,
            6
          )} cNGN)`
        );

        // Check if either party is a registered user
        const [fromUser, toUser] = await Promise.all([
          User.findOne({ walletAddress: from.toLowerCase() }),
          User.findOne({ walletAddress: to.toLowerCase() }),
        ]);

        // Only record if at least one party is in our system
        if (fromUser || toUser) {
          const tx = await event.getTransaction();
          const receipt = await event.getTransactionReceipt();

          // Determine transaction type
          let type: "send" | "receive" =
            from.toLowerCase() === fromUser?.walletAddress ? "send" : "receive";

          await BankingService.recordTransaction({
            txHash: tx.hash,
            type,
            fromAddress: from,
            toAddress: to,
            amount: value.toString(),
            blockNumber: receipt.blockNumber,
          });

          logger.info(`✅ Transaction recorded: ${tx.hash}`);
        }
      } catch (error) {
        logger.error("❌ Error processing transfer event:", error);
      }
    });

    this.isListening = true;
    logger.info("✅ Blockchain listener started successfully");
  }

  /**
   * Stop listening
   */
  stop() {
    if (this.isListening) {
      cNGNContract.removeAllListeners("Transfer");
      this.isListening = false;
      logger.info("🛑 Blockchain listener stopped");
    }
  }

  /**
   * Sync historical transactions for a user
   */
  async syncUserHistory(walletAddress: string, fromBlock: number = 0) {
    logger.info(
      `🔄 Syncing history for ${walletAddress} from block ${fromBlock}...`
    );

    try {
      // Get Transfer events where user is sender or receiver
      const sentFilter = cNGNContract.filters.Transfer(walletAddress, null);
      const receivedFilter = cNGNContract.filters.Transfer(null, walletAddress);

      const [sentEvents, receivedEvents] = await Promise.all([
        cNGNContract.queryFilter(sentFilter, fromBlock, "latest"),
        cNGNContract.queryFilter(receivedFilter, fromBlock, "latest"),
      ]);

      const allEvents = [...sentEvents, ...receivedEvents].sort(
        (a, b) => a.blockNumber - b.blockNumber
      );

      logger.info(`📦 Found ${allEvents.length} historical transactions`);

      for (const event of allEvents) {
        try {
          const { args } = event as unknown as { args: [string, string, string] };
          const [from, to, value] = args;
          const tx = await event.getTransaction();
          const receipt = await event.getTransactionReceipt();

          const type: "send" | "receive" =
            from.toLowerCase() === walletAddress.toLowerCase()
              ? "send"
              : "receive";

          await BankingService.recordTransaction({
            txHash: tx.hash,
            type,
            fromAddress: from,
            toAddress: to,
            amount: value.toString(),
            blockNumber: receipt.blockNumber,
          });
        } catch (error) {
          logger.error(`❌ Error syncing transaction:`, error);
        }
      }

      logger.info(`✅ History sync completed for ${walletAddress}`);
      return { synced: allEvents.length };
    } catch (error) {
      logger.error("❌ Error syncing user history:", error);
      throw error;
    }
  }
}