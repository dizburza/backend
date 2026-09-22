import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations, signerChangeApprovals, signerChangeProposals } from "../db/schema.js";
import type { SignerChangeApproval, SignerChangeProposal } from "../db/types.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { MembershipService } from "./membership.service.js";

export type SignerChangeDetail = SignerChangeProposal & {
  approvals: SignerChangeApproval[];
  approvalCount: number;
};

/**
 * A passive ledger of Dizburza's on-chain signer-change multisig, the same
 * relationship the batch payroll tables have to executeBatchPayroll: the
 * frontend calls the contract first, and each method here only records what
 * the call already did. Nothing decides anything, so a row can always be
 * cross-checked against the chain event that produced it.
 */
export class SignerChangeService {
  private static async requireProposal(proposalId: string): Promise<SignerChangeProposal> {
    const [row] = await db
      .select()
      .from(signerChangeProposals)
      .where(eq(signerChangeProposals.proposalId, proposalId))
      .limit(1);

    if (!row) throw new AppError("Signer change proposal not found", 404);
    return row;
  }

  /**
   * Record a proposeSignerChange() call, which the contract itself
   * auto-approves for the proposer, so this also writes that first approval.
   */
  static async recordProposal(data: {
    proposalId: string;
    organizationId: string;
    organizationAddress: string;
    subjectAddress: string;
    subjectName: string;
    isRemoval: boolean;
    signerEpoch: number;
    createdByAddress: string;
    createdByName: string;
  }): Promise<SignerChangeDetail> {
    const existing = await db
      .select()
      .from(signerChangeProposals)
      .where(eq(signerChangeProposals.proposalId, data.proposalId))
      .limit(1);

    if (existing.length > 0) return (await this.getByProposalId(data.proposalId))!;

    const [organization] = await db
      .select({ quorum: organizations.quorum })
      .from(organizations)
      .where(eq(organizations.id, data.organizationId))
      .limit(1);

    if (!organization) throw new AppError("Organization not found", 404);

    const submittedAt = new Date();
    // 30 days, matching the smart contract's TRANSACTION_EXPIRY.
    const expiresAt = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(signerChangeProposals)
        .values({
          proposalId: data.proposalId,
          organizationId: data.organizationId,
          organizationAddress: data.organizationAddress.toLowerCase(),
          subjectAddress: data.subjectAddress.toLowerCase(),
          subjectName: data.subjectName,
          isRemoval: data.isRemoval,
          signerEpoch: data.signerEpoch,
          createdByAddress: data.createdByAddress.toLowerCase(),
          quorumRequired: organization.quorum,
          submittedAt,
          expiresAt,
          status: "pending",
        })
        .returning();

      // The contract counts the proposer's own approval from the moment the
      // proposal exists, so the ledger starts at the same count rather than 0.
      await tx.insert(signerChangeApprovals).values({
        signerChangeId: row.id,
        signerAddress: data.createdByAddress.toLowerCase(),
        signerName: data.createdByName,
      });
    });

    return (await this.getByProposalId(data.proposalId))!;
  }

  static async recordApproval(
    proposalId: string,
    signerAddress: string,
    signerName: string
  ): Promise<SignerChangeDetail> {
    const proposal = await this.requireProposal(proposalId);

    const inserted = await db
      .insert(signerChangeApprovals)
      .values({
        signerChangeId: proposal.id,
        signerAddress: signerAddress.toLowerCase(),
        signerName,
      })
      .onConflictDoNothing()
      .returning({ id: signerChangeApprovals.id });

    if (inserted.length === 0) {
      throw new AppError("Signer has already approved this change", 409);
    }

    await this.syncStatus(proposal.id);
    return (await this.getByProposalId(proposalId))!;
  }

  /**
   * Record executeSignerChange(). This also applies the membership-side
   * effect: an add promotes the subject's existing membership to a signer row
   * of its own (signing and employment are separate rows, per the schema), a
   * removal deactivates it. Both are safe to call from a webhook replay or a
   * second signer's refresh, since MembershipService's own upsert and
   * deactivate are themselves idempotent.
   */
  static async recordExecution(
    proposalId: string,
    executorAddress: string,
    txHash: string
  ): Promise<SignerChangeDetail> {
    const proposal = await this.requireProposal(proposalId);
    const executedAt = new Date();

    await db
      .update(signerChangeProposals)
      .set({
        status: "executed",
        executedAt,
        executedBy: executorAddress.toLowerCase(),
        txHash,
        updatedAt: executedAt,
      })
      .where(eq(signerChangeProposals.id, proposal.id));

    if (proposal.isRemoval) {
      await MembershipService.deactivate(
        proposal.organizationId,
        proposal.subjectAddress,
        "signer"
      );
    } else {
      await MembershipService.upsert({
        organizationId: proposal.organizationId,
        address: proposal.subjectAddress,
        name: proposal.subjectName,
        role: "signer",
      });
    }

    return (await this.getByProposalId(proposalId))!;
  }

  static async getByProposalId(proposalId: string): Promise<SignerChangeDetail | null> {
    const [row] = await db
      .select()
      .from(signerChangeProposals)
      .where(eq(signerChangeProposals.proposalId, proposalId))
      .limit(1);

    if (!row) return null;
    return this.attachApprovals(row);
  }

  static async getForOrganization(organizationId: string): Promise<SignerChangeDetail[]> {
    const rows = await db
      .select()
      .from(signerChangeProposals)
      .where(eq(signerChangeProposals.organizationId, organizationId));

    return Promise.all(rows.map((row) => this.attachApprovals(row)));
  }

  private static async attachApprovals(
    row: SignerChangeProposal
  ): Promise<SignerChangeDetail> {
    const approvals = await db
      .select()
      .from(signerChangeApprovals)
      .where(eq(signerChangeApprovals.signerChangeId, row.id));

    return { ...row, approvals, approvalCount: approvals.length };
  }

  /** Approved once the ledger's own count reaches the snapshotted quorum. */
  private static async syncStatus(signerChangeId: string): Promise<void> {
    const [row] = await db
      .select()
      .from(signerChangeProposals)
      .where(eq(signerChangeProposals.id, signerChangeId))
      .limit(1);

    if (!row || row.status === "executed") return;

    const approvals = await db
      .select({ id: signerChangeApprovals.id })
      .from(signerChangeApprovals)
      .where(eq(signerChangeApprovals.signerChangeId, signerChangeId));

    const nextStatus = approvals.length >= row.quorumRequired ? "approved" : "pending";
    if (nextStatus !== row.status) {
      await db
        .update(signerChangeProposals)
        .set({ status: nextStatus, updatedAt: new Date() })
        .where(eq(signerChangeProposals.id, signerChangeId));
    }
  }
}
