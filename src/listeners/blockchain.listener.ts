import { ethers } from "ethers";
import { tokenContract } from "../config/blockchain.js";
import { BankingService } from "../services/banking.service.js";
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
    // Base units. Formatting here would need the token's decimals, and a log
    // line is not worth a lookup that the indexer already does downstream.
    logger.debug(`📝 Transfer detected: ${from} -> ${to} (${value})`);

    // Previously this returned early unless one side was a registered user,
    // which silently dropped organization treasury movements. Index everything
    // and let the read layer decide what's relevant to a given viewer.
    const logIndex = event?.index ?? event?.log?.index;

    // Without an index we cannot tell this log apart from its siblings in the
    // same transaction. Skip it: this listener is only a latency hint, and the
    // cursor indexer always decodes a real index.
    if (typeof logIndex !== "number") {
      logger.warn(`Transfer in ${event?.log?.transactionHash} has no log index, leaving it to the indexer`);
      return;
    }

    const tx = await event.getTransaction();
    const receipt = await event.getTransactionReceipt();
    const { fee, gasUsed } = this.getFeeAndGasUsed(receipt, tx);

    const { type, organizationId } = await BankingService.classifyTransfer(from);

    await BankingService.recordTransaction({
      txHash: tx.hash,
      logIndex,
      type,
      fromAddress: from,
      toAddress: to,
      amount: value.toString(),
      blockNumber: receipt.blockNumber,
      fee,
      gasUsed,
      organizationId,
    });

    logger.info(`✅ Transaction recorded: ${tx.hash} (${type})`);
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
    tokenContract.on("Transfer", async (from, to, value, event) => {
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
      tokenContract.removeAllListeners("Transfer");
      this.isListening = false;
      this.restartAttempts = 0;
      logger.info("🛑 Blockchain listener stopped");
    }
  }

}
