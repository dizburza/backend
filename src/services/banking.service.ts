import { ethers } from "ethers";
import { Transaction, ITransaction } from "../models/Transaction.model.js";
import { User } from "../models/User.model.js";
import { TransactionData, TransactionFilter } from "../types/transaction.types.js";
import { cNGNContract } from "../config/blockchain.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { Organization } from "../models/Organization.model.js";

export class BankingService {
  /**
   * Record a transaction from blockchain
   */
  static async recordTransaction(data: TransactionData): Promise<ITransaction> {
    // Check if transaction already exists
    const existing = await Transaction.findOne(
      data.logIndex === undefined
        ? { txHash: data.txHash }
        : { txHash: data.txHash, logIndex: data.logIndex }
    );
    if (existing) {
      const shouldUpdate =
        (!existing.fee && data.fee) ||
        (!existing.gasUsed && data.gasUsed) ||
        (!existing.blockNumber && data.blockNumber);

      if (shouldUpdate) {
        existing.fee = existing.fee || data.fee;
        existing.gasUsed = existing.gasUsed || data.gasUsed;
        existing.blockNumber = existing.blockNumber || data.blockNumber;
        await existing.save();
      }
      return existing;
    }

    // Get user IDs if they exist
    const [fromUser, toUser] = await Promise.all([
      User.findOne({ walletAddress: data.fromAddress.toLowerCase() }),
      User.findOne({ walletAddress: data.toAddress.toLowerCase() }),
    ]);

    // Generate reference number
    const reference = `TXN${Date.now()}${crypto
      .randomBytes(3)
      .toString("hex")
      .toUpperCase()}`;

    // Create transaction
    const transaction = await Transaction.create({
      ...data,
      fromAddress: data.fromAddress.toLowerCase(),
      toAddress: data.toAddress.toLowerCase(),
      fromUserId: fromUser?._id,
      toUserId: toUser?._id,
      reference,
      currency: "cNGN",
      fee: data.fee,
      gasUsed: data.gasUsed,
      status: "confirmed",
      timestamp: new Date(),
      confirmedAt: new Date(),
    });

    return transaction;
  }

  /**
   * Get transaction history with filters and pagination
   */
  static async getTransactionHistory(
    walletAddress: string,
    filters: TransactionFilter = {}
  ) {
    const {
      page = 1,
      limit = 50,
      type,
      category,
      startDate,
      endDate,
      status = "confirmed",
    } = filters;

    const query: any = {
      $or: [
        { fromAddress: walletAddress.toLowerCase() },
        { toAddress: walletAddress.toLowerCase() },
      ],
      status,
    };

    if (type) query.type = type;
    if (category) query.category = category;
    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    const transactions = await Transaction.find(query)
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("fromUserId toUserId", "username fullName")
      .lean();

    const total = await Transaction.countDocuments(query);

    // Format transactions with direction
    const formatted = transactions.map((tx) => ({
      ...tx,
      direction:
        tx.fromAddress === walletAddress.toLowerCase() ? "sent" : "received",
      displayAmount:
        tx.fromAddress === walletAddress.toLowerCase()
          ? `-${ethers.formatUnits(tx.amount, 6)}`
          : `+${ethers.formatUnits(tx.amount, 6)}`,
      fee: tx.fee,
      gasUsed: tx.gasUsed,
    }));

    return {
      transactions: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * Get aggregated transaction totals for a wallet.
   * Totals are computed server-side (Mongo aggregation) for fast UX and correctness.
   */
  static async getTransactionSummary(
    walletAddress: string,
    filters: TransactionFilter = {}
  ) {
    const {
      type,
      category,
      startDate,
      endDate,
      status = "confirmed",
    } = filters;

    const walletLower = walletAddress.toLowerCase();

    const match: any = {
      $or: [{ fromAddress: walletLower }, { toAddress: walletLower }],
      status,
    };

    if (type) match.type = type;
    if (category) match.category = category;
    if (startDate || endDate) {
      match.timestamp = {};
      if (startDate) match.timestamp.$gte = startDate;
      if (endDate) match.timestamp.$lte = endDate;
    }

    const [result] = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalCount: { $sum: 1 },
          inflowCount: {
            $sum: {
              $cond: [{ $eq: ["$toAddress", walletLower] }, 1, 0],
            },
          },
          outflowCount: {
            $sum: {
              $cond: [{ $eq: ["$fromAddress", walletLower] }, 1, 0],
            },
          },
          inflowAmountRaw: {
            $sum: {
              $cond: [
                { $eq: ["$toAddress", walletLower] },
                { $toDecimal: "$amount" },
                0,
              ],
            },
          },
          outflowAmountRaw: {
            $sum: {
              $cond: [
                { $eq: ["$fromAddress", walletLower] },
                { $toDecimal: "$amount" },
                0,
              ],
            },
          },
        },
      },
    ]);

    const inflowRaw = result?.inflowAmountRaw?.toString?.() ?? "0";
    const outflowRaw = result?.outflowAmountRaw?.toString?.() ?? "0";

    const inflowAmount = ethers.formatUnits(BigInt(inflowRaw.split(".")[0] || "0"), 6);
    const outflowAmount = ethers.formatUnits(BigInt(outflowRaw.split(".")[0] || "0"), 6);

    return {
      walletAddress: walletLower,
      status,
      totalCount: result?.totalCount ?? 0,
      inflowCount: result?.inflowCount ?? 0,
      outflowCount: result?.outflowCount ?? 0,
      inflowAmount,
      outflowAmount,
      inflowAmountRaw: inflowRaw,
      outflowAmountRaw: outflowRaw,
    };
  }

  /**
   * Get balance from blockchain
   */
  static async getBalance(walletAddress: string): Promise<string> {
    const balance = await cNGNContract.balanceOf(walletAddress);
    return ethers.formatUnits(balance, 6);
  }

  /**
   * Get wallet summary (balance + recent activity)
   */
  static async getWalletSummary(walletAddress: string) {
    const [balance, history] = await Promise.all([
      this.getBalance(walletAddress),
      this.getTransactionHistory(walletAddress, { limit: 10 }),
      User.findOne({ walletAddress: walletAddress.toLowerCase() }),
    ]);

    return {
      balance,
      recentTransactions: history.transactions
    };
  }

  /**
   * Sync historical transactions for a user
   */
  static async syncUserHistory(walletAddress: string, fromBlock: number = 0) {
    const normalized = walletAddress.toLowerCase();

    const getTxTypeAndOrganizationId = async (
      fromAddress: string
    ): Promise<{ type: "send" | "receive" | "payroll"; organizationId?: string }> => {
      const organization = await Organization.findOne({
        contractAddress: fromAddress.toLowerCase(),
      });

      if (organization) {
        return {
          type: "payroll",
          organizationId: (organization._id as mongoose.Types.ObjectId).toString(),
        };
      }

      if (fromAddress.toLowerCase() === normalized) {
        return { type: "send" };
      }

      return { type: "receive" };
    };

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

    let synced = 0;
    let skipped = 0;

    for (const event of allEvents) {
      try {
        const parsedLog = cNGNContract.interface.parseLog({
          topics: [...event.topics],
          data: event.data,
        });

        if (!parsedLog) {
          skipped++;
          continue;
        }

        const from = parsedLog.args[0];
        const to = parsedLog.args[1];
        const value = parsedLog.args[2];

        const tx = await event.getTransaction();
        const receipt = await event.getTransactionReceipt();
        const { type, organizationId } = await getTxTypeAndOrganizationId(from);

        const effectiveGasPrice =
          (receipt as any)?.effectiveGasPrice ?? (tx as any)?.gasPrice;
        const gasUsed = (receipt as any)?.gasUsed;
        const fee =
          effectiveGasPrice && gasUsed
            ? (BigInt(effectiveGasPrice.toString()) * BigInt(gasUsed.toString())).toString()
            : undefined;

        await BankingService.recordTransaction({
          txHash: event.transactionHash,
          type,
          fromAddress: from,
          toAddress: to,
          amount: value.toString(),
          blockNumber: receipt.blockNumber,
          fee,
          gasUsed: gasUsed ? gasUsed.toString() : undefined,
          organizationId,
        });

        synced++;
      } catch (error: any) {
        if (error?.message?.includes("duplicate")) {
          skipped++;
          continue;
        }
        skipped++;
      }
    }

    return { walletAddress, fromBlock, total: allEvents.length, synced, skipped };
  }
}