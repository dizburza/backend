import { Request, Response } from "express";
import { ProposalService } from "../services/proposal.service.js";
import { ApiResponse } from "../utils/response.util.js";
import { asyncHandler, AppError } from "../middlewares/errorHandler.middleware.js";
import type { Proposal } from "../db/types.js";

const firstParam = (value: unknown): string => {
  if (Array.isArray(value)) return (value[0] as string) ?? "";
  return typeof value === "string" ? value : "";
};

/** The signed-in signer, which every write here needs. */
const actor = (req: Request) => {
  if (!req.user) throw new AppError("Authentication required", 401);
  return {
    address: req.user.walletAddress,
    userId: req.user.id,
    name: req.user.fullName || req.user.username,
  };
};

export class ProposalController {
  static readonly create = asyncHandler(async (req: Request, res: Response) => {
    const { organizationId, title, description, amount, closesAt } = req.body;
    const who = actor(req);

    const closes = new Date(closesAt);
    if (Number.isNaN(closes.getTime())) {
      throw new AppError("closesAt must be a valid date", 400);
    }

    const proposal = await ProposalService.create({
      organizationId,
      title,
      description,
      amount,
      closesAt: closes,
      createdByAddress: who.address,
      createdByUserId: who.userId,
    });

    ApiResponse.created(res, proposal, "Proposal raised");
  });

  static readonly listForOrganization = asyncHandler(
    async (req: Request, res: Response) => {
      const organizationId = firstParam(req.params.organizationId);
      const status = firstParam(req.query.status) || undefined;

      await ProposalService.assertSigner(organizationId, actor(req).address);

      const result = await ProposalService.listForOrganization(
        organizationId,
        status as Proposal["status"] | undefined
      );

      ApiResponse.success(res, {
        ...result,
        totalProposals: result.stats.total,
      });
    }
  );

  static readonly getById = asyncHandler(async (req: Request, res: Response) => {
    const proposal = await ProposalService.getById(firstParam(req.params.id));

    if (!proposal) {
      ApiResponse.error(res, "Proposal not found", 404);
      return;
    }

    await ProposalService.assertSigner(proposal.organizationId, actor(req).address);

    const pendingSigners = await ProposalService.pendingSigners(proposal.id);
    ApiResponse.success(res, { ...proposal, pendingSigners });
  });

  static readonly vote = asyncHandler(async (req: Request, res: Response) => {
    const { choice, comment } = req.body;
    const who = actor(req);

    const proposal = await ProposalService.vote({
      proposalId: firstParam(req.params.id),
      voterAddress: who.address,
      voterUserId: who.userId,
      voterName: who.name,
      choice,
      comment,
    });

    ApiResponse.success(res, proposal, "Vote recorded");
  });

  static readonly cancel = asyncHandler(async (req: Request, res: Response) => {
    const who = actor(req);
    const proposal = await ProposalService.cancel(firstParam(req.params.id), who.address);

    ApiResponse.success(res, proposal, "Proposal withdrawn");
  });
}
