import { Request, Response } from "express";
import { InviteService } from "../services/invite.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

export class InviteController {
  /** POST /api/organizations/:organizationId/invite */
  static readonly issue = asyncHandler(async (req: Request, res: Response) => {
    const organizationId = req.params.organizationId;
    const invite = await InviteService.issue(organizationId, req.walletAddress!);

    ApiResponse.created(res, { token: invite.token }, "Invitation link created");
  });

  /** GET /api/organizations/:organizationId/invite */
  static readonly current = asyncHandler(async (req: Request, res: Response) => {
    const invite = await InviteService.current(req.params.organizationId);

    ApiResponse.success(res, invite ? { token: invite.token } : null);
  });

  /** DELETE /api/organizations/:organizationId/invite */
  static readonly revoke = asyncHandler(async (req: Request, res: Response) => {
    await InviteService.revoke(req.params.organizationId);

    ApiResponse.success(res, null, "Invitation link revoked");
  });

  /** POST /api/organizations/:organizationId/employees/:membershipId/remind */
  static readonly remind = asyncHandler(async (req: Request, res: Response) => {
    await InviteService.remind(
      req.params.organizationId,
      req.params.membershipId,
      req.walletAddress!
    );

    ApiResponse.success(res, null, "Reminder sent");
  });

  /**
   * GET /api/invites/:token
   *
   * The only unauthenticated route here, because someone opening the link has
   * no session yet. It answers with the organization's name and nothing else.
   */
  static readonly describe = asyncHandler(async (req: Request, res: Response) => {
    const details = await InviteService.describe(req.params.token);

    if (!details) {
      ApiResponse.error(res, "This invitation link is no longer valid", 404);
      return;
    }

    ApiResponse.success(res, details);
  });

  /** POST /api/invites/:token/claim */
  static readonly claim = asyncHandler(async (req: Request, res: Response) => {
    const user = req.user!;

    const result = await InviteService.claim({
      token: req.params.token,
      userId: user.id,
      walletAddress: user.walletAddress,
      email: user.email,
      surname: user.surname,
      firstname: user.firstname,
      phoneNumber: user.phoneNumber,
    });

    ApiResponse.success(res, result, "Invitation accepted");
  });
}
