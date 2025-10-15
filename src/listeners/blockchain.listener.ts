import { ethers } from "ethers";
import { cNGNContract } from "../config/blockchain";
import { BankingService } from "../services/banking.service";
import { User } from "../models/User.model";
import { Organization } from "../models/Organization.model";
import logger from "../utils/logger.util";
import mongoose from "mongoose";

export class BlockchainListener {
  private isListening: boolean = false;

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

        const [fromUser, toUser] = await Promise.all([
          User.findOne({ walletAddress: from.toLowerCase() }),
          User.findOne({ walletAddress: to.toLowerCase() }),
        ]);

        if (fromUser || toUser) {
          const tx = await event.getTransaction();
          const receipt = await event.getTransactionReceipt();

          let type: "send" | "receive" | "payroll" = "receive";

          const isFromOrganization = await Organization.findOne({
            contractAddress: from.toLowerCase(),
          });

          if (isFromOrganization) {
            type = "payroll";
          } else if (
            fromUser &&
            fromUser.walletAddress === from.toLowerCase()
          ) {
            type = "send";
          } else {
            type = "receive";
          }

          await BankingService.recordTransaction({
            txHash: tx.hash,
            type,
            fromAddress: from,
            toAddress: to,
            amount: value.toString(),
            blockNumber: receipt.blockNumber,
            organizationId: isFromOrganization
              ? (isFromOrganization._id as mongoose.Types.ObjectId).toString()
              : undefined,
          });

          logger.info(`✅ Transaction recorded: ${tx.hash} (${type})`);
        }
      } catch (error) {
        logger.error("❌ Error processing transfer event:", error);
      }
    });

    this.isListening = true;
    logger.info("✅ Blockchain listener started successfully");
  }

  stop() {
    if (this.isListening) {
      cNGNContract.removeAllListeners("Transfer");
      this.isListening = false;
      logger.info("🛑 Blockchain listener stopped");
    }
  }

  async syncUserHistory(walletAddress: string, fromBlock: number = 0) {
    logger.info(
      `🔄 Syncing history for ${walletAddress} from block ${fromBlock}...`
    );

    try {
      const sentFilter = cNGNContract.filters.Transfer(walletAddress, null);
      const receivedFilter = cNGNContract.filters.Transfer(null, walletAddress);

      const [sentEvents, receivedEvents] = await Promise.all([
        cNGNContract.queryFilter(sentFilter, fromBlock, "latest"),
        cNGNContract.queryFilter(receivedFilter, fromBlock, "latest"),
      ]);

      const allEvents = [...sentEvents, ...receivedEvents]
        .filter(
          (event, index, self) =>
            index ===
            self.findIndex((e) => e.transactionHash === event.transactionHash)
        )
        .sort((a, b) => a.blockNumber - b.blockNumber);

      logger.info(`📦 Found ${allEvents.length} historical transactions`);

      let synced = 0;
      let skipped = 0;

      for (const event of allEvents) {
        try {
          const parsedLog = cNGNContract.interface.parseLog({
            topics: [...event.topics],
            data: event.data,
          });

          if (!parsedLog) continue;

          const from = parsedLog.args[0];
          const to = parsedLog.args[1];
          const value = parsedLog.args[2];

          const tx = await event.getTransaction();
          const receipt = await event.getTransactionReceipt();

          let type: "send" | "receive" | "payroll" = "receive";

          const isFromOrganization = await Organization.findOne({
            contractAddress: from.toLowerCase(),
          });

          if (isFromOrganization) {
            type = "payroll";
          } else if (from.toLowerCase() === walletAddress.toLowerCase()) {
            type = "send";
          } else {
            type = "receive";
          }

          await BankingService.recordTransaction({
            txHash: tx.hash,
            type,
            fromAddress: from,
            toAddress: to,
            amount: value.toString(),
            blockNumber: receipt.blockNumber,
            organizationId: isFromOrganization
              ? (isFromOrganization._id as mongoose.Types.ObjectId).toString()
              : undefined,
          });

          synced++;
        } catch (error: any) {
          if (error.message && error.message.includes("duplicate")) {
            skipped++;
          } else {
            logger.error(`❌ Error syncing transaction:`, error);
          }
        }
      }

      logger.info(
        `✅ History sync completed for ${walletAddress}: ${synced} synced, ${skipped} skipped`
      );
      return { total: allEvents.length, synced, skipped };
    } catch (error) {
      logger.error("❌ Error syncing user history:", error);
      throw error;
    }
  }

  getStatus(): { isListening: boolean } {
    return { isListening: this.isListening };
  }

  async syncOrganizationPayrolls(
    contractAddress: string,
    fromBlock: number = 0
  ) {
    logger.info(
      `🔄 Syncing payroll transactions for organization ${contractAddress} from block ${fromBlock}...`
    );

    try {
      const filter = cNGNContract.filters.Transfer(contractAddress, null);
      const events = await cNGNContract.queryFilter(
        filter,
        fromBlock,
        "latest"
      );

      logger.info(`📦 Found ${events.length} payroll transactions`);

      let synced = 0;
      let skipped = 0;

      for (const event of events) {
        try {
          const parsedLog = cNGNContract.interface.parseLog({
            topics: [...event.topics],
            data: event.data,
          });

          if (!parsedLog) continue;

          const from = parsedLog.args[0];
          const to = parsedLog.args[1];
          const value = parsedLog.args[2];

          const tx = await event.getTransaction();
          const receipt = await event.getTransactionReceipt();

          const organization = await Organization.findOne({
            contractAddress: contractAddress.toLowerCase(),
          });

          await BankingService.recordTransaction({
            txHash: tx.hash,
            type: "payroll",
            fromAddress: from,
            toAddress: to,
            amount: value.toString(),
            blockNumber: receipt.blockNumber,
            organizationId: organization
              ? (organization._id as mongoose.Types.ObjectId).toString()
              : undefined,
          });

          synced++;
        } catch (error: any) {
          if (error.message && error.message.includes("duplicate")) {
            skipped++;
          } else {
            logger.error(`❌ Error syncing payroll transaction:`, error);
          }
        }
      }

      logger.info(
        `✅ Organization payroll sync completed: ${synced} synced, ${skipped} skipped`
      );
      return { total: events.length, synced, skipped };
    } catch (error) {
      logger.error("❌ Error syncing organization payrolls:", error);
      throw error;
    }
  }
}
