import { Request, Response } from "express";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";
import { ApiResponse } from "../utils/response.util.js";
import { CashLinkService } from "../services/cashlink.service.js";
import { ENV } from "../config/environment.js";

const firstParam = (value: unknown): string => {
  if (Array.isArray(value)) return (value[0] as string) ?? "";
  return typeof value === "string" ? value : "";
};

export class CashLinkController {
  /** What the browser needs to build a link before it has one. */
  static readonly config = asyncHandler(async (_req: Request, res: Response) => {
    ApiResponse.success(res, {
      enabled: CashLinkService.enabled,
      contractAddress: CashLinkService.enabled ? ENV.CASHLINK_ADDRESS : null,
      chainId: ENV.CHAIN_ID,
      defaultWindowSeconds: ENV.CASHLINK_WINDOW_SECONDS,
      name: "Dizburza CashLink",
      version: "1",
    });
  });

  /**
   * GET /api/cashlinks/quote?amount=
   *
   * The total the sender is agreeing to, before they agree to it.
   */
  static readonly quote = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError("Authentication required", 401);

    const raw = firstParam(req.query.amount);
    if (!/^\d+$/.test(raw)) throw new AppError("amount must be in base units", 400);

    ApiResponse.success(
      res,
      await CashLinkService.quote(BigInt(raw), req.user.walletAddress)
    );
  });

  /**
   * GET /api/cashlinks/:claimAddress
   *
   * Public, because a claimer has no account yet when they open the link. It
   * answers with amount, expiry and state, and nothing that identifies anyone.
   */
  static readonly publicView = asyncHandler(async (req: Request, res: Response) => {
    ApiResponse.success(
      res,
      await CashLinkService.publicView(firstParam(req.params.claimAddress))
    );
  });

  /** POST /api/cashlinks — record a link the sender has created on chain. */
  static readonly record = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError("Authentication required", 401);

    const link = await CashLinkService.record({
      claimAddress: req.body.claimAddress,
      txHash: req.body.txHash,
      description: req.body.description,
      sender: { userId: req.user.id, walletAddress: req.user.walletAddress },
    });

    ApiResponse.success(res, link, "Link created", 201);
  });

  /**
   * POST /api/cashlinks/:claimAddress/claim
   *
   * The signature comes from the link's own key, made in the claimer's browser
   * over their address. The recipient is taken from the session and never from
   * the body, so a link can only ever be claimed into a registered account.
   */
  static readonly claim = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError("Authentication required", 401);

    const result = await CashLinkService.claim(
      firstParam(req.params.claimAddress),
      req.body.signature,
      { userId: req.user.id, walletAddress: req.user.walletAddress }
    );

    ApiResponse.success(res, result, "Claimed");
  });

  /** POST /api/cashlinks/:claimAddress/cancelled — record an on-chain cancel. */
  static readonly markCancelled = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError("Authentication required", 401);

    await CashLinkService.markCancelled(
      firstParam(req.params.claimAddress),
      req.body.txHash,
      { walletAddress: req.user.walletAddress }
    );

    ApiResponse.success(res, { ok: true }, "Cancelled");
  });

  /** GET /api/cashlinks — the caller's own links, descriptions included. */
  static readonly list = asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) throw new AppError("Authentication required", 401);

    ApiResponse.success(res, await CashLinkService.listForSender(req.user.walletAddress));
  });
}
