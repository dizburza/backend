import { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { batchPayrolls, payrollTaxLines } from "../db/schema.js";
import { MembershipService } from "../services/membership.service.js";
import { ApiResponse } from "../utils/response.util.js";

/**
 * Authorization for anything scoped to one organization.
 *
 * This replaces `requireRole("signer", "admin")`, which read the global
 * `users.role` column. That column is not membership: registration left it at
 * "user" and nothing promoted it, so a genuine owner was refused their own
 * organization, while anyone who passed `role` at registration was admitted to
 * everyone else's. The check has to be against the organization in the path, or
 * it is not really a check.
 */

const firstParam = (value: unknown): string | undefined => {
  if (Array.isArray(value)) return value[0] as string | undefined;
  return typeof value === "string" ? value : undefined;
};

const authorize = async (
  req: Request,
  res: Response,
  next: NextFunction,
  organizationId: string | undefined
) => {
  if (!req.user) {
    ApiResponse.error(res, "Authentication required", 401);
    return;
  }

  if (!organizationId) {
    ApiResponse.error(res, "Organization not identified", 400);
    return;
  }

  if (!(await MembershipService.isSignerOf(organizationId, req.user.walletAddress))) {
    // Deliberately the same message whether the organization is missing or the
    // caller simply is not in it, so this cannot be used to test for existence.
    ApiResponse.error(res, "You are not a signer of this organization", 403);
    return;
  }

  next();
};

/**
 * Guards routes keyed by a wallet address.
 *
 * These reads were `optionalAuth` with no ownership check, which meant anyone
 * could fetch any address's history. On-chain transfers are public, but the row
 * is not: it carries bank account numbers, memos, employer linkage and the
 * counterparty's name and username. That is the mapping the directory lookups
 * are rate limited to protect, handed over for free.
 */
export const requireAddressAccess = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (!req.user) {
    ApiResponse.error(res, "Authentication required", 401);
    return;
  }

  const requested = firstParam(req.params.address)?.toLowerCase();

  if (!requested) {
    ApiResponse.error(res, "Address not identified", 400);
    return;
  }

  const readable = await MembershipService.readableAddresses(req.user.walletAddress);

  if (!readable.has(requested)) {
    ApiResponse.error(res, "You cannot read this address", 403);
    return;
  }

  next();
};

/** Reads the organization from the route, or from the body when creating. */
export const requireOrganizationSigner = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const organizationId =
    firstParam(req.params.organizationId) ??
    firstParam(req.params.id) ??
    (typeof req.body?.organizationId === "string" ? req.body.organizationId : undefined);

  await authorize(req, res, next, organizationId);
};

/**
 * Batches are addressed by name, so the organization comes from the batch.
 *
 * An unknown batch is a 403 rather than a 404 for the same reason as above:
 * batch names are guessable, and confirming one exists is itself a disclosure.
 */
export const requireBatchSigner = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const batchName = firstParam(req.params.batchName);

  if (!batchName) {
    ApiResponse.error(res, "Batch not identified", 400);
    return;
  }

  const [batch] = await db
    .select({ organizationId: batchPayrolls.organizationId })
    .from(batchPayrolls)
    .where(eq(batchPayrolls.batchName, batchName))
    .limit(1);

  if (!batch) {
    ApiResponse.error(res, "You are not a signer of this organization", 403);
    return;
  }

  await authorize(req, res, next, batch.organizationId);
};

/**
 * Tax lines are addressed by id, so the organization comes from the line, the
 * same shape as `requireBatchSigner`. A line's own read rule (the person it
 * describes, or a signer of the org that paid it) lives in the document
 * service instead, because an employee may read their own line; only a signer
 * may act on one, which is what this guards.
 */
export const requireTaxLineSigner = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const lineId = firstParam(req.params.lineId);

  if (!lineId) {
    ApiResponse.error(res, "Tax line not identified", 400);
    return;
  }

  const [line] = await db
    .select({ organizationId: payrollTaxLines.organizationId })
    .from(payrollTaxLines)
    .where(eq(payrollTaxLines.id, lineId))
    .limit(1);

  if (!line) {
    ApiResponse.error(res, "You are not a signer of this organization", 403);
    return;
  }

  await authorize(req, res, next, line.organizationId);
};
