import { Request, Response } from "express";
import { BankingService } from "../services/banking.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class WalletController {
  /**
   * GET /api/wallet/:address/balance
   */
  static readonly getBalance = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const balance = await BankingService.getBalance(address);

    ApiResponse.success(res, {
      address,
      balance,
      currency: "cNGN",
    });
  });

  /**
   * GET /api/wallet/:address/summary
   */
  static readonly getSummary = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const summary = await BankingService.getWalletSummary(address);

    ApiResponse.success(res, summary);
  });

  /**
   * POST /api/wallet/:address/sync
   */
  static readonly syncHistory = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { fromBlock } = req.body;

    const result = await BankingService.syncUserHistory(address, fromBlock);

    ApiResponse.success(res, result, "History sync initiated");
  });
}