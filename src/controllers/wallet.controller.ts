import { Request, Response } from "express";
import { BankingService } from "../services/banking.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class WalletController {
  /**
   * GET /api/wallet/:address/balance
   */
  static readonly getBalance = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;

    const balance = await BankingService.getBalance(addressParam);

    ApiResponse.success(res, {
      address: addressParam,
      balance,
      currency: "cNGN",
    });
  });

  /**
   * GET /api/wallet/:address/summary
   */
  static readonly getSummary = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;

    const summary = await BankingService.getWalletSummary(addressParam);

    ApiResponse.success(res, summary);
  });

  /**
   * POST /api/wallet/:address/sync
   */
  static readonly syncHistory = asyncHandler(async (req: Request, res: Response) => {
    const { address } = req.params as any;
    const addressParam = Array.isArray(address) ? address[0] : address;
    const { fromBlock } = req.body;

    const result = await BankingService.syncUserHistory(addressParam, fromBlock);

    ApiResponse.success(res, result, "History sync initiated");
  });
}