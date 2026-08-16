import { ethers } from "ethers";
import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db } from "../db/client.js";
import { organizations, transactions, users } from "../db/schema.js";
import type { Transaction } from "../db/types.js";
import {
  ChartBucket,
  TransactionData,
  TransactionFilter,
  TransactionRange,
} from "../types/transaction.types.js";
import { getBlockDate } from "../utils/blockTime.util.js";
import { BalanceService } from "./balance.service.js";
import { TokenService } from "./token.service.js";

export class BankingService {
  /**
   * Classify a transfer independently of who is viewing it. Per-viewer
   * direction ("sent"/"received") is derived in the read layer instead, so a
   * single global row stays correct for both counterparties.
   */
  static async classifyTransfer(fromAddress: string): Promise<{
    type: "send" | "payroll";
    organizationId?: string;
  }> {
    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.contractAddress, fromAddress.toLowerCase()))
      .limit(1);

    if (organization) {
      return { type: "payroll", organizationId: organization.id };
    }

    return { type: "send" };
  }

  static async recordTransaction(data: TransactionData): Promise<Transaction> {
    const txHash = data.txHash.toLowerCase();
    const fromAddress = data.fromAddress.toLowerCase();
    const toAddress = data.toAddress.toLowerCase();
    const logIndex = data.logIndex;

    const [fromUser, toUser, blockDate, token] = await Promise.all([
      db.select({ id: users.id }).from(users).where(eq(users.walletAddress, fromAddress)).limit(1),
      db.select({ id: users.id }).from(users).where(eq(users.walletAddress, toAddress)).limit(1),
      getBlockDate(data.blockNumber),
      TokenService.getDefault(),
    ]);

    // Block time, not insert time. Otherwise every backfilled row collapses to
    // "indexed just now" and time-range queries stop meaning anything.
    const timestamp = blockDate ?? new Date();

    // One statement, no read-then-write race. COALESCE keeps whatever is
    // already stored and only fills gaps, so a webhook that landed first is
    // never clobbered by a later pass with less detail.
    const [row] = await db
      .insert(transactions)
      .values({
        txHash,
        logIndex,
        type: data.type,
        fromAddress,
        toAddress,
        fromUserId: fromUser[0]?.id,
        toUserId: toUser[0]?.id,
        amount: data.amount,
        tokenId: token.id,
        currency: data.currency || token.symbol,
        fee: data.fee,
        gasUsed: data.gasUsed,
        description: data.description,
        memo: data.memo,
        category: data.category,
        qrCode: data.qrCode,
        merchantName: data.merchantName,
        batchId: data.batchId,
        batchName: data.batchName,
        organizationId: data.organizationId,
        blockNumber: data.blockNumber,
        status: data.status || "confirmed",
        timestamp,
        confirmedAt: timestamp,
        reference: `TXN${Date.now()}${crypto.randomBytes(3).toString("hex").toUpperCase()}`,
        bankAccountNumber: data.bankDetails?.accountNumber,
        bankName: data.bankDetails?.bankName,
        bankAccountName: data.bankDetails?.accountName,
      })
      .onConflictDoUpdate({
        target: [transactions.txHash, transactions.logIndex],
        set: {
          fee: sql`coalesce(${transactions.fee}, excluded.fee)`,
          gasUsed: sql`coalesce(${transactions.gasUsed}, excluded.gas_used)`,
          blockNumber: sql`coalesce(${transactions.blockNumber}, excluded.block_number)`,
          organizationId: sql`coalesce(${transactions.organizationId}, excluded.organization_id)`,
          fromUserId: sql`coalesce(${transactions.fromUserId}, excluded.from_user_id)`,
          toUserId: sql`coalesce(${transactions.toUserId}, excluded.to_user_id)`,
          // Repair rows written before a block timestamp could be resolved.
          timestamp: sql`excluded.timestamp`,
          confirmedAt: sql`excluded.confirmed_at`,
          updatedAt: new Date(),
        },
      })
      .returning();

    if (!row) throw new Error(`Failed to record transaction ${txHash}`);
    return row;
  }

  /**
   * Translate a named range into a start date. Returns undefined for "all" so
   * the caller leaves the timestamp bound off entirely.
   */
  static resolveRangeStart(range?: TransactionRange): Date | undefined {
    if (!range || range === "all") return undefined;

    const MS = {
      "1h": 3_600_000,
      "24h": 86_400_000,
      "7d": 604_800_000,
      "30d": 2_592_000_000,
      "90d": 7_776_000_000,
      "1y": 31_536_000_000,
    } as const;

    const span = MS[range];
    return span ? new Date(Date.now() - span) : undefined;
  }

  /**
   * Shared predicate so history, summary and chart never drift apart on which
   * rows they consider.
   */
  private static buildWhere(walletAddress: string, filters: TransactionFilter) {
    const wallet = walletAddress.toLowerCase();
    const { type, category, endDate, status = "confirmed", range } = filters;

    const clauses = [
      or(eq(transactions.fromAddress, wallet), eq(transactions.toAddress, wallet)),
      eq(transactions.status, status),
    ];

    if (type) clauses.push(eq(transactions.type, type));
    if (category) clauses.push(eq(transactions.category, category));

    // An explicit startDate wins over the coarser named range.
    const startDate = filters.startDate ?? this.resolveRangeStart(range);
    if (startDate) clauses.push(gte(transactions.timestamp, startDate));
    if (endDate) clauses.push(lte(transactions.timestamp, endDate));

    return and(...clauses);
  }

  static async getTransactionHistory(
    walletAddress: string,
    filters: TransactionFilter = {}
  ) {
    const { page = 1, limit = 50 } = filters;
    const wallet = walletAddress.toLowerCase();
    const where = this.buildWhere(wallet, filters);

    const [rows, [totals]] = await Promise.all([
      db
        .select({
          transaction: transactions,
          fromUsername: sql<string | null>`from_user.username`,
          fromFullName: sql<string | null>`from_user.full_name`,
          toUsername: sql<string | null>`to_user.username`,
          toFullName: sql<string | null>`to_user.full_name`,
        })
        .from(transactions)
        .leftJoin(sql`${users} as from_user`, sql`from_user.id = ${transactions.fromUserId}`)
        .leftJoin(sql`${users} as to_user`, sql`to_user.id = ${transactions.toUserId}`)
        .where(where)
        .orderBy(desc(transactions.timestamp))
        .limit(limit)
        .offset((page - 1) * limit),
      db.select({ total: count() }).from(transactions).where(where),
    ]);

    const total = totals?.total ?? 0;

    const { decimals } = await TokenService.getDefault();

    const formatted = rows.map(({ transaction, ...names }) => {
      const isOutgoing = transaction.fromAddress === wallet;
      const amount = ethers.formatUnits(transaction.amount, decimals);

      return {
        ...transaction,
        fromUser: names.fromUsername
          ? { username: names.fromUsername, fullName: names.fromFullName }
          : null,
        toUser: names.toUsername
          ? { username: names.toUsername, fullName: names.toFullName }
          : null,
        direction: isOutgoing ? "sent" : "received",
        displayAmount: `${isOutgoing ? "-" : "+"}${amount}`,
      };
    });

    return {
      transactions: formatted,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit) || 1,
        hasMore: page * limit < total,
      },
    };
  }

  /**
   * Aggregated totals. numeric(78,0) sums uint256 exactly, so unlike the old
   * Decimal128 path there is no parsing or truncation on the way out.
   */
  static async getTransactionSummary(
    walletAddress: string,
    filters: TransactionFilter = {}
  ) {
    const wallet = walletAddress.toLowerCase();
    const { status = "confirmed" } = filters;

    const [result] = await db
      .select({
        totalCount: count(),
        inflowCount: sql<number>`count(*) filter (where ${transactions.toAddress} = ${wallet})::int`,
        outflowCount: sql<number>`count(*) filter (where ${transactions.fromAddress} = ${wallet})::int`,
        inflowRaw: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.toAddress} = ${wallet}), 0)::text`,
        outflowRaw: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAddress} = ${wallet}), 0)::text`,
      })
      .from(transactions)
      .where(this.buildWhere(wallet, filters));

    const inflowRaw = result?.inflowRaw ?? "0";
    const outflowRaw = result?.outflowRaw ?? "0";
    const { decimals } = await TokenService.getDefault();

    return {
      walletAddress: wallet,
      status,
      totalCount: result?.totalCount ?? 0,
      inflowCount: result?.inflowCount ?? 0,
      outflowCount: result?.outflowCount ?? 0,
      inflowAmount: ethers.formatUnits(inflowRaw, decimals),
      outflowAmount: ethers.formatUnits(outflowRaw, decimals),
      inflowAmountRaw: inflowRaw,
      outflowAmountRaw: outflowRaw,
    };
  }

  /**
   * Bucketed inflow/outflow for charting.
   *
   * generate_series produces the buckets, so a month with no activity comes
   * back as zero instead of being missing from the series. The old aggregation
   * only returned buckets that had rows, which made the chart skip quiet
   * periods entirely.
   */
  static async getTransactionChart(
    walletAddress: string,
    filters: TransactionFilter = {},
    bucket: ChartBucket = "month"
  ) {
    const wallet = walletAddress.toLowerCase();
    const end = filters.endDate ?? new Date();
    const { decimals } = await TokenService.getDefault();

    // With no bound, "all" means all: start at this address's first
    // transaction rather than silently capping the series at a year.
    let start = filters.startDate ?? this.resolveRangeStart(filters.range);
    if (!start) {
      const [earliest] = await db
        .select({ first: sql<string | null>`min(${transactions.timestamp})::text` })
        .from(transactions)
        .where(this.buildWhere(wallet, { ...filters, range: "all" }));

      // Aggregates come back as text rather than a driver-parsed Date.
      start = earliest?.first ? new Date(earliest.first) : end;
    }

    // bucket lands in sql.raw, so re-check it here rather than trusting every
    // caller to have validated it upstream.
    const safeBucket: ChartBucket = (["hour", "day", "week", "month"] as const).includes(
      bucket
    )
      ? bucket
      : "month";

    const step = sql.raw(`'1 ${safeBucket}'::interval`);
    const unit = sql.raw(`'${safeBucket}'`);

    const rows = await db.execute<{
      bucket_start: Date;
      inflow: string;
      outflow: string;
      tx_count: number;
    }>(sql`
      select
        b.bucket_start,
        coalesce(sum(t.amount) filter (where t.to_address = ${wallet}), 0)::text as inflow,
        coalesce(sum(t.amount) filter (where t.from_address = ${wallet}), 0)::text as outflow,
        count(t.id)::int as tx_count
      from generate_series(
        date_trunc(${unit}, ${start.toISOString()}::timestamptz),
        date_trunc(${unit}, ${end.toISOString()}::timestamptz),
        ${step}
      ) as b(bucket_start)
      left join ${transactions} t
        on date_trunc(${unit}, t.timestamp) = b.bucket_start
       and t.status = 'confirmed'
       and (t.from_address = ${wallet} or t.to_address = ${wallet})
      group by b.bucket_start
      order by b.bucket_start
    `);

    return {
      walletAddress: wallet,
      bucket: safeBucket,
      range: filters.range ?? "all",
      points: rows.map((row) => ({
        bucketStart: row.bucket_start,
        // Numbers, not strings, because this feeds a chart axis. Safe only
        // because formatUnits has already scaled it down: never parse a raw
        // base-unit value this way.
        incoming: Number.parseFloat(ethers.formatUnits(row.inflow, decimals)),
        outgoing: Number.parseFloat(ethers.formatUnits(row.outflow, decimals)),
        incomingRaw: row.inflow,
        outgoingRaw: row.outflow,
        count: row.tx_count,
      })),
    };
  }

  /**
   * Balance, served from the cached row rather than a fresh `balanceOf` on
   * every request.
   */
  static async getBalance(walletAddress: string): Promise<string> {
    const { formatted } = await BalanceService.get(walletAddress);
    return formatted;
  }

  static async getWalletSummary(walletAddress: string) {
    const [balance, history] = await Promise.all([
      this.getBalance(walletAddress),
      this.getTransactionHistory(walletAddress, { limit: 10 }),
    ]);

    return { balance, recentTransactions: history.transactions };
  }
}
