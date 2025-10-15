import { Request, Response } from "express";
import { BankingService } from "../services/banking.service";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class TransactionController {
  /**
   * GET /api/transactions/:address
   */
  static getHistory = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { page, limit, type, category, startDate, endDate, status } =
      req.query;

    const filters: any = {
      page: page ? parseInt(page as string) : 1,
      limit: limit ? parseInt(limit as string) : 50,
    };

    if (type) filters.type = type;
    if (category) filters.category = category;
    if (status) filters.status = status;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    const result = await BankingService.getTransactionHistory(address, filters);

    ApiResponse.success(res, result);
  });

  /**
   * POST /api/transactions/record
   */
  static recordTransaction = asyncHandler(
    async (req: Request, res: Response) => {
      const {
        txHash,
        type,
        fromAddress,
        toAddress,
        amount,
        description,
        memo,
        category,
        qrCode,
        batchId,
        batchName,
        organizationId,
        blockNumber,
      } = req.body;

      const transaction = await BankingService.recordTransaction({
        txHash,
        type,
        fromAddress,
        toAddress,
        amount,
        description,
        memo,
        category,
        qrCode,
        batchId,
        batchName,
        organizationId,
        blockNumber,
      });

      ApiResponse.created(
        res,
        transaction,
        "Transaction recorded successfully"
      );
    }
  );
}