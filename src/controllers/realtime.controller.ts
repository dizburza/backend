import { Request, Response } from "express";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";
import { ApiResponse } from "../utils/response.util.js";
import { BalanceService } from "../services/balance.service.js";
import { IndexerService } from "../services/indexer.service.js";
import { MembershipService } from "../services/membership.service.js";
import { eventHub } from "../services/events.service.js";
import { ValidationUtil } from "../utils/validation.util.js";

const firstParam = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return typeof value === "string" ? value : undefined;
};

export class RealtimeController {
  /**
   * GET /api/balances/:address
   *
   * A Mongo read, not an RPC round trip. Stale values refresh behind the
   * response and reach the client over SSE.
   */
  static readonly getBalance = asyncHandler(async (req: Request, res: Response) => {
    const address = firstParam(req.params.address) as string;
    const balance = await BalanceService.get(address);
    ApiResponse.success(res, balance);
  });

  /**
   * POST /api/transactions/watch
   *
   * Confirms a just-submitted transaction server-side. The browser submits,
   * updates optimistically and waits for the push, instead of holding a polling
   * loop open behind a blocking overlay.
   */
  static readonly watchTransaction = asyncHandler(
    async (req: Request, res: Response) => {
      const { txHash } = req.body;
      const submittedBy = req.user?.walletAddress;

      if (!submittedBy) throw new AppError("Authentication required", 401);

      await IndexerService.watchTransaction(txHash, submittedBy);

      ApiResponse.success(res, { txHash, watching: true });
    }
  );

  /**
   * GET /api/events/stream?addresses=0x..,0x..
   *
   * Authenticated by session cookie, which EventSource sends automatically.
   * Requested addresses are intersected with what this user may watch: their
   * own wallet, and their organization's treasury. A caller cannot subscribe to
   * an arbitrary address to learn when it transacts.
   */
  static readonly stream = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ success: false, message: "Authentication required" });
      return;
    }

    const requested = (firstParam(req.query.addresses) ?? "")
      .split(",")
      .map((a) => a.trim().toLowerCase())
      .filter((a) => ValidationUtil.isValidAddress(a));

    // Same rule as the REST reads, so a client cannot watch an address it is
    // not allowed to fetch. One query rather than one per membership.
    const permitted = await MembershipService.readableAddresses(user.walletAddress);

    const addresses = requested.filter((a) => permitted.has(a));

    if (addresses.length === 0) {
      res.status(400).json({ success: false, message: "No subscribable addresses supplied" });
      return;
    }

    const ip = req.ip ?? req.socket.remoteAddress ?? "unknown";

    if (eventHub.countForIp(ip) >= 10) {
      res.status(429).json({ success: false, message: "Too many open streams" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disables proxy buffering (nginx), which otherwise holds events back.
      "X-Accel-Buffering": "no",
    });

    // Flush headers immediately so the browser marks the stream as open.
    res.write(`: connected\n\n`);

    const unsubscribe = eventHub.subscribe(addresses, res, ip);

    if (!unsubscribe) {
      res.end();
      return;
    }

    req.on("close", () => {
      unsubscribe();
      res.end();
    });
  });
}
