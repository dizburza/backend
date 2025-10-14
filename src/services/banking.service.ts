import { ethers } from "ethers";
import { Transaction, ITransaction } from "../models/Transaction.model";
import { User } from "../models/User.model";
import { TransactionData, TransactionFilter } from "../types/transaction.types";
import { cNGNContract } from "../config/blockchain";
import crypto from "crypto";

export class BankingService {
  /**
   * Record a transaction from blockchain
   */
  static async recordTransaction(data: TransactionData): Promise<ITransaction> {
    // Check if transaction already exists
    const existing = await Transaction.findOne({ txHash: data.txHash });
    if (existing) {
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
    // This will be implemented in blockchain.listener.ts
    // For now, return a placeholder
    return { message: "History sync queued", walletAddress, fromBlock };
  }
}