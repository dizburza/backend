import { Request, Response } from "express";
import { BankingService } from "../services/banking.service";
import { ApiResponse } from "../utils/response.util";
import { asyncHandler } from "../middlewares/errorHandler.middleware";

export class WalletController {
  /**
   * GET /api/wallet/:address/balance
   */
  static getBalance = asyncHandler(async (req: Request, res: Response) => {
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
  static getSummary = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;

    const summary = await BankingService.getWalletSummary(address);

    ApiResponse.success(res, summary);
  });

  /**
   * POST /api/wallet/:address/sync
   */
  static syncHistory = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params;
    const { fromBlock } = req.body;

    const result = await BankingService.syncUserHistory(address, fromBlock);

    ApiResponse.success(res, result, "History sync initiated");
  });
}