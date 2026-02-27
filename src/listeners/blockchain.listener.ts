import { ethers } from "ethers";
import { cNGNContract } from "../config/blockchain.js";
import { BankingService } from "../services/banking.service.js";
import { User } from "../models/User.model.js";
import { Organization } from "../models/Organization.model.js";
import logger from "../utils/logger.util.js";

export class BlockchainListener {
  private isListening: boolean = false;
  private restartAttempts: number = 0;
  private readonly maxRestartAttempts: number = 5;
  private readonly restartDelayMs: number = 5000;

  private getFeeAndGasUsed(
    receipt: ethers.TransactionReceipt,
    tx: ethers.TransactionResponse
  ): { fee?: string; gasUsed?: string } {
    const effectiveGasPrice =
      ("effectiveGasPrice" in (receipt as object)
        ? (receipt as { effectiveGasPrice?: bigint }).effectiveGasPrice
        : undefined) ?? tx.gasPrice;
    const gasUsed = receipt.gasUsed;
    const fee = effectiveGasPrice
      ? (effectiveGasPrice * gasUsed).toString()
      : undefined;

    return {
      fee,
      gasUsed: gasUsed?.toString(),
    };
  }

  private async handleTransferEvent(
    from: string,
    to: string,
    value: bigint,
    event: any
  ) {
    logger.debug(
      `📝 Transfer detected: ${from} -> ${to} (${ethers.formatUnits(value, 6)} cNGN)`
    );

    const [fromUser, toUser] = await Promise.all([
      User.findOne({ walletAddress: from.toLowerCase() }),
      User.findOne({ walletAddress: to.toLowerCase() }),
    ]);

    if (!fromUser && !toUser) return;

    const tx = await event.getTransaction();
    const receipt = await event.getTransactionReceipt();
    const { fee, gasUsed } = this.getFeeAndGasUsed(receipt, tx);

    let type: "send" | "receive" | "payroll";

    const isFromOrganization = await Organization.findOne({
      contractAddress: from.toLowerCase(),
    });

    if (isFromOrganization) {
      type = "payroll";
    } else if (fromUser && fromUser.walletAddress === from.toLowerCase()) {
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
      fee,
      gasUsed,
      organizationId: isFromOrganization ? String(isFromOrganization._id) : undefined,
    });

    logger.info(`✅ Transaction recorded: ${tx.hash} (${type})`);
  }

  private async getTxTypeAndOrganizationId(
    fromAddress: string,
    walletAddress: string
  ): Promise<{
    type: "send" | "receive" | "payroll";
    organizationId?: string;
  }> {
    const organization = await Organization.findOne({
      contractAddress: fromAddress.toLowerCase(),
    });

    if (organization) {
      return {
        type: "payroll",
        organizationId: String(organization._id),
      };
    }

    if (fromAddress.toLowerCase() === walletAddress.toLowerCase()) {
      return { type: "send" };
    }

    return { type: "receive" };
  }

  private async syncSingleUserHistoryEvent(
    event: any,
    walletAddress: string
  ): Promise<"synced" | "duplicate" | "ignored"> {
    try {
      const parsedLog = cNGNContract.interface.parseLog({
        topics: [...event.topics],
        data: event.data,
      });

      if (!parsedLog) return "ignored";

      const from = parsedLog.args[0];
      const to = parsedLog.args[1];
      const value = parsedLog.args[2];

      const tx = await event.getTransaction();
      const receipt = await event.getTransactionReceipt();

      const { fee, gasUsed } = this.getFeeAndGasUsed(receipt, tx);

      const { type, organizationId } = await this.getTxTypeAndOrganizationId(
        from,
        walletAddress
      );

      await BankingService.recordTransaction({
        txHash: tx.hash,
        type,
        fromAddress: from,
        toAddress: to,
        amount: value.toString(),
        blockNumber: receipt.blockNumber,
        fee,
        gasUsed,
        organizationId,
      });

      return "synced";
    } catch (error: any) {
      if (error?.message?.includes("duplicate")) {
        return "duplicate";
      }

      logger.error(`❌ Error syncing transaction:`, error);
      return "ignored";
    }
  }

  async start() {
    if (this.isListening) {
      logger.warn("Blockchain listener already running");
      return;
    }

    try {
      logger.info("🎧 Starting blockchain event listener...");
      await this.setupListener();
      this.isListening = true;
      this.restartAttempts = 0;
      logger.info("✅ Blockchain listener started successfully");
    } catch (error: any) {
      logger.error("❌ Failed to start blockchain listener:", error);
      await this.handleRestart();
    }
  }

  private async setupListener() {
    cNGNContract.on("Transfer", async (from, to, value, event) => {
      try {
        await this.handleTransferEvent(from, to, value, event);
      } catch (error: any) {
        if (error?.message?.includes("filter not found")) {
          logger.warn("⚠️ Filter expired, restarting listener...");
          await this.handleRestart();
        } else {
          logger.error("❌ Error processing transfer event:", error);
        }
      }
    });
  }

  private async handleRestart() {
    if (this.restartAttempts >= this.maxRestartAttempts) {
      logger.error(
        `❌ Max restart attempts (${this.maxRestartAttempts}) reached. Stopping listener.`
      );
      this.stop();
      return;
    }

    this.restartAttempts++;
    const delay = this.restartDelayMs * this.restartAttempts;

    logger.info(
      `🔄 Restarting listener in ${delay}ms (attempt ${this.restartAttempts}/${this.maxRestartAttempts})...`
    );

    this.stop();

    await new Promise((resolve) => setTimeout(resolve, delay));
    await this.start();
  }

  stop() {
    if (this.isListening) {
      cNGNContract.removeAllListeners("Transfer");
      this.isListening = false;
      this.restartAttempts = 0;
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
        const result = await this.syncSingleUserHistoryEvent(
          event,
          walletAddress
        );

        if (result === "synced") {
          synced++;
        } else if (result === "duplicate") {
          skipped++;
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

          const { fee, gasUsed } = this.getFeeAndGasUsed(receipt, tx);

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
            fee,
            gasUsed,
            organizationId: organization
              ? String(organization._id)
              : undefined,
          });

          synced++;
        } catch (error: any) {
          if (error.message?.includes("duplicate")) {
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
