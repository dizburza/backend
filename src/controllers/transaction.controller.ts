import { Request, Response } from "express";
import { BankingService } from "../services/banking.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";
import { IndexerService } from "../services/indexer.service.js";
import {
  ChartBucket,
  TransactionFilter,
  TransactionRange,
} from "../types/transaction.types.js";

const VALID_RANGES: TransactionRange[] = [
  "1h",
  "24h",
  "7d",
  "30d",
  "90d",
  "1y",
  "all",
];

const VALID_BUCKETS: ChartBucket[] = ["hour", "day", "week", "month"];

const firstParam = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return typeof value === "string" ? value : undefined;
};

/**
 * Shared query -> filter parsing so history, summary and chart accept exactly
 * the same options.
 */
const parseFilters = (query: Request["query"]): TransactionFilter => {
  const filters: TransactionFilter = {};

  const type = firstParam(query.type);
  const category = firstParam(query.category);
  const status = firstParam(query.status);
  const range = firstParam(query.range);
  const startDate = firstParam(query.startDate);
  const endDate = firstParam(query.endDate);

  if (type) filters.type = type as TransactionFilter["type"];
  if (category) filters.category = category as TransactionFilter["category"];
  if (status) filters.status = status as TransactionFilter["status"];
  if (range && VALID_RANGES.includes(range as TransactionRange)) {
    filters.range = range as TransactionRange;
  }
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);

  return filters;
};

export class TransactionController {
  /**
   * GET /api/transactions/:address
   */
  static readonly getHistory = asyncHandler(async (req: Request, res: Response) => {
    const addressParam = firstParam(req.params.address) as string;
    const page = firstParam(req.query.page);
    const limit = firstParam(req.query.limit);

    const filters: TransactionFilter = {
      ...parseFilters(req.query),
      page: page ? Number.parseInt(page, 10) : 1,
      limit: limit ? Number.parseInt(limit, 10) : 50,
    };

    const result = await BankingService.getTransactionHistory(addressParam, filters);

    ApiResponse.success(res, result);
  });

  /**
   * GET /api/transactions/:address/summary
   */
  static readonly getSummary = asyncHandler(async (req: Request, res: Response) => {
    const addressParam = firstParam(req.params.address) as string;

    const result = await BankingService.getTransactionSummary(
      addressParam,
      parseFilters(req.query)
    );

    ApiResponse.success(res, result);
  });

  /**
   * GET /api/transactions/:address/chart
   */
  static readonly getChart = asyncHandler(async (req: Request, res: Response) => {
    const addressParam = firstParam(req.params.address) as string;
    const requested = firstParam(req.query.bucket);
    const bucket = VALID_BUCKETS.includes(requested as ChartBucket)
      ? (requested as ChartBucket)
      : "month";

    const result = await BankingService.getTransactionChart(
      addressParam,
      parseFilters(req.query),
      bucket
    );

    ApiResponse.success(res, result);
  });

  /**
   * POST /api/transactions/record
   *
   * Takes a txHash only. Amounts, addresses and direction are read back from
   * the chain, because anyone authenticated could otherwise post themselves an
   * arbitrary inflow. Purely a latency shortcut: the indexer picks the same
   * transaction up on its next pass whether or not this is called.
   */
  static readonly recordTransaction = asyncHandler(
    async (req: Request, res: Response) => {
      const { txHash, description, memo, category } = req.body;

      const transactions = await IndexerService.indexTransactionByHash(txHash, {
        description,
        memo,
        category,
      });

      if (transactions.length === 0) {
        throw new AppError(
          "No cNGN transfers found in that transaction, or it is not yet mined",
          404
        );
      }

      ApiResponse.created(
        res,
        { transactions, count: transactions.length },
        "Transaction recorded successfully"
      );
    }
  );
}
