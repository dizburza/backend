import { ethers } from "ethers";
import { provider, cNGNContract } from "../config/blockchain.js";

export class BlockchainService {
  /**
   * Verify transaction exists and succeeded on blockchain
   */
  static async verifyTransaction(txHash: string): Promise<{
    isValid: boolean;
    from?: string;
    to?: string;
    amount?: string;
    blockNumber?: number;
  }> {
    try {
      const receipt = await provider.getTransactionReceipt(txHash);

      if (receipt?.status !== 1) {
        return { isValid: false };
      }

      const tx = await provider.getTransaction(txHash);
      if (!tx) {
        return { isValid: false };
      }

      const cngnAddress = (await cNGNContract.getAddress()).toLowerCase();

      // Parse Transfer event from logs
      const transferLog = receipt.logs.find(
        (log) =>
          log.address.toLowerCase() ===
          cngnAddress
      );

      if (!transferLog) {
        return { isValid: false };
      }

      const iface = new ethers.Interface([
        "event Transfer(address indexed from, address indexed to, uint256 value)",
      ]);

      const parsed = iface.parseLog({
        topics: transferLog.topics as string[],
        data: transferLog.data,
      });

      if (!parsed) {
        return { isValid: false };
      }

      return {
        isValid: true,
        from: parsed.args.from,
        to: parsed.args.to,
        amount: parsed.args.value.toString(),
        blockNumber: receipt.blockNumber,
      };
    } catch (error) {
      console.error("Error verifying transaction:", error);
      return { isValid: false };
    }
  }

  /**
   * Get current block number
   */
  static async getCurrentBlock(): Promise<number> {
    return await provider.getBlockNumber();
  }

  /**
   * Get gas price
   */
  static async getGasPrice(): Promise<string> {
    const feeData = await provider.getFeeData();
    return feeData.gasPrice?.toString() || "0";
  }
}