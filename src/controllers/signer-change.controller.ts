import { Request, Response } from "express";
import { SignerChangeService } from "../services/signer-change.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler } from "../middlewares/errorHandler.middleware.js";

const firstParam = (value: unknown): string =>
  Array.isArray(value) ? value[0] : (value as string);

export class SignerChangeController {
  /**
   * POST /api/organizations/:id/signer-changes
   * Record proposeSignerChange() after the frontend calls the contract.
   */
  static readonly recordProposal = asyncHandler(async (req: Request, res: Response) => {
    const organizationId = firstParam(req.params.id);
    const {
      proposalId,
      organizationAddress,
      subjectAddress,
      subjectName,
      isRemoval,
      signerEpoch,
      createdByName,
    } = req.body;

    const proposal = await SignerChangeService.recordProposal({
      proposalId,
      organizationId,
      organizationAddress,
      subjectAddress,
      subjectName,
      isRemoval: Boolean(isRemoval),
      signerEpoch,
      createdByAddress: req.user!.walletAddress,
      createdByName,
    });

    ApiResponse.created(res, proposal, "Signer change proposal recorded");
  });

  /**
   * POST /api/organizations/:id/signer-changes/:proposalId/approve
   * Record approveSignerChange() after the frontend calls the contract.
   */
  static readonly recordApproval = asyncHandler(async (req: Request, res: Response) => {
    const proposalId = firstParam(req.params.proposalId);
    const { signerName } = req.body;

    const proposal = await SignerChangeService.recordApproval(
      proposalId,
      req.user!.walletAddress,
      signerName
    );

    ApiResponse.success(res, proposal, "Approval recorded");
  });

  /**
   * POST /api/organizations/:id/signer-changes/:proposalId/execute
   * Record executeSignerChange() after the frontend calls the contract.
   */
  static readonly recordExecution = asyncHandler(async (req: Request, res: Response) => {
    const proposalId = firstParam(req.params.proposalId);
    const { txHash } = req.body;

    const proposal = await SignerChangeService.recordExecution(
      proposalId,
      req.user!.walletAddress,
      txHash
    );

    ApiResponse.success(res, proposal, "Signer change executed");
  });

  /** GET /api/organizations/:id/signer-changes */
  static readonly list = asyncHandler(async (req: Request, res: Response) => {
    const organizationId = firstParam(req.params.id);
    const proposals = await SignerChangeService.getForOrganization(organizationId);
    ApiResponse.success(res, { proposals });
  });
}
