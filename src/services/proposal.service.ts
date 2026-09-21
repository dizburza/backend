import { ethers } from "ethers";
import { and, desc, eq, inArray, lte } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations, proposalVotes, proposals } from "../db/schema.js";
import type { Proposal, ProposalVote } from "../db/types.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { MembershipService } from "./membership.service.js";
import { TokenService } from "./token.service.js";
import { eventHub } from "./events.service.js";
import { isUniqueViolation } from "../utils/pgError.util.js";
import logger from "../utils/logger.util.js";

export type ProposalView = Proposal & {
  amountFormatted: string | null;
  votesFor: number;
  votesAgainst: number;
  votes: Array<Pick<ProposalVote, "voterAddress" | "voterName" | "choice" | "comment" | "createdAt">>;
  organizationName: string;
  organizationSlug: string;
};

/**
 * Governance proposals.
 *
 * A proposal is a record that the signers decided something. It never moves
 * funds: settling one is a payroll batch, which carries its own quorum on
 * chain. That keeps a single path for money out of an organization, and it is
 * the path the multisig actually guards.
 */
export class ProposalService {
  /**
   * Status worked out from the votes, never stored and trusted.
   *
   * `passed` and `rejected` are latched once written, because a decision that
   * has been acted on cannot be undone by the window later closing.
   */
  private static resolveStatus(
    proposal: Proposal,
    votesFor: number,
    votesAgainst: number,
    now = new Date()
  ): Proposal["status"] {
    if (proposal.status === "cancelled") return "cancelled";
    if (proposal.status === "passed" || proposal.status === "rejected") {
      return proposal.status;
    }

    if (votesFor >= proposal.votesRequired) return "passed";

    // Quorum voting against settles it early, the same way quorum in favour
    // does. Waiting out the clock on a decided question helps nobody.
    if (votesAgainst >= proposal.votesRequired) return "rejected";

    // No longer reachable: even every remaining signer voting for would fall
    // short, so the proposal is finished whatever the clock says.
    const undecided = proposal.signerCountAtCreation - votesFor - votesAgainst;
    if (votesFor + Math.max(0, undecided) < proposal.votesRequired) return "rejected";

    if (now > proposal.closesAt) return "expired";
    return "open";
  }

  private static async decorate(
    rows: Array<{ proposal: Proposal; organizationName: string; organizationSlug: string }>
  ): Promise<ProposalView[]> {
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.proposal.id);

    const [votes, token] = await Promise.all([
      db
        .select()
        .from(proposalVotes)
        .where(inArray(proposalVotes.proposalId, ids))
        .orderBy(desc(proposalVotes.createdAt)),
      TokenService.getDefault(),
    ]);

    const byProposal = new Map<string, ProposalVote[]>();
    for (const vote of votes) {
      const list = byProposal.get(vote.proposalId) ?? [];
      list.push(vote);
      byProposal.set(vote.proposalId, list);
    }

    return rows.map(({ proposal, organizationName, organizationSlug }) => {
      const cast = byProposal.get(proposal.id) ?? [];
      const votesFor = cast.filter((v) => v.choice === "for").length;
      const votesAgainst = cast.length - votesFor;

      return {
        ...proposal,
        status: ProposalService.resolveStatus(proposal, votesFor, votesAgainst),
        amountFormatted:
          proposal.amount === null
            ? null
            : ethers.formatUnits(proposal.amount, token.decimals),
        votesFor,
        votesAgainst,
        votes: cast.map((v) => ({
          voterAddress: v.voterAddress,
          voterName: v.voterName,
          choice: v.choice,
          comment: v.comment,
          createdAt: v.createdAt,
        })),
        organizationName,
        organizationSlug,
      };
    });
  }

  private static readonly selection = {
    proposal: proposals,
    organizationName: organizations.name,
    organizationSlug: organizations.slug,
  };

  /**
   * Tell the organization's signers that governance moved.
   *
   * Best effort on purpose: a push is a hint that the cached view is stale, and
   * failing to deliver one must never fail the vote that was already recorded.
   */
  private static async announce(
    organizationId: string,
    proposalId: string,
    action: "created" | "voted" | "decided" | "cancelled"
  ): Promise<void> {
    try {
      const [organization] = await db
        .select({ contractAddress: organizations.contractAddress })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1);

      if (!organization) return;

      eventHub.publish({
        type: "proposal",
        address: organization.contractAddress.toLowerCase(),
        organizationId,
        proposalId,
        action,
      });
    } catch (error) {
      logger.warn("Could not announce proposal change:", error);
    }
  }

  static async create(input: {
    organizationId: string;
    title: string;
    description?: string;
    amount?: string;
    closesAt: Date;
    createdByAddress: string;
    createdByUserId?: string;
  }): Promise<ProposalView> {
    const creator = input.createdByAddress.toLowerCase();

    if (!(await MembershipService.isSignerOf(input.organizationId, creator))) {
      throw new AppError("Only a signer of this organization can raise a proposal", 403);
    }

    const [organization] = await db
      .select({ id: organizations.id, quorum: organizations.quorum })
      .from(organizations)
      .where(eq(organizations.id, input.organizationId))
      .limit(1);

    if (!organization) throw new AppError("Organization not found", 404);

    if (input.closesAt.getTime() <= Date.now()) {
      throw new AppError("The voting window must close in the future", 400);
    }

    const signers = await MembershipService.signersOf(input.organizationId);
    const token = await TokenService.getDefault();

    const amount =
      input.amount === undefined || input.amount.trim() === ""
        ? null
        : (await TokenService.parse(input.amount)).toString();

    const [row] = await db
      .insert(proposals)
      .values({
        organizationId: input.organizationId,
        title: input.title,
        description: input.description,
        amount,
        tokenId: amount === null ? null : token.id,
        currency: amount === null ? null : token.symbol,
        createdByAddress: creator,
        createdByUserId: input.createdByUserId,
        // Snapshotted, not read live at vote time. See the schema comment.
        votesRequired: organization.quorum,
        signerCountAtCreation: signers.length,
        closesAt: input.closesAt,
      })
      .returning();

    await ProposalService.announce(input.organizationId, row.id, "created");

    return (await ProposalService.getById(row.id))!;
  }

  static async getById(id: string): Promise<ProposalView | null> {
    const [row] = await db
      .select(ProposalService.selection)
      .from(proposals)
      .innerJoin(organizations, eq(organizations.id, proposals.organizationId))
      .where(eq(proposals.id, id))
      .limit(1);

    if (!row) return null;
    const [view] = await ProposalService.decorate([row]);
    return view;
  }

  /** Reading is signers only, the same as raising and voting. */
  static async assertSigner(organizationId: string, address: string): Promise<void> {
    if (!(await MembershipService.isSignerOf(organizationId, address))) {
      throw new AppError("You are not a signer of this organization", 403);
    }
  }

  static async listForOrganization(
    organizationId: string,
    status?: Proposal["status"]
  ): Promise<{ proposals: ProposalView[]; stats: Record<string, number> }> {
    const rows = await db
      .select(ProposalService.selection)
      .from(proposals)
      .innerJoin(organizations, eq(organizations.id, proposals.organizationId))
      .where(eq(proposals.organizationId, organizationId))
      .orderBy(desc(proposals.createdAt));

    const decorated = await ProposalService.decorate(rows);

    const stats = decorated.reduce<Record<string, number>>(
      (acc, proposal) => {
        acc[proposal.status] = (acc[proposal.status] ?? 0) + 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, open: 0, passed: 0, rejected: 0, expired: 0, cancelled: 0 }
    );

    return {
      proposals: status ? decorated.filter((p) => p.status === status) : decorated,
      stats,
    };
  }

  /**
   * Record a signer's vote.
   *
   * Only active signers of this organization may vote, and only once. The
   * unique index is what actually enforces the second part, so two tabs
   * submitting at the same moment cannot both land.
   */
  static async vote(input: {
    proposalId: string;
    voterAddress: string;
    voterUserId?: string;
    voterName: string;
    choice: "for" | "against";
    comment?: string;
  }): Promise<ProposalView> {
    const voter = input.voterAddress.toLowerCase();
    const proposal = await ProposalService.getById(input.proposalId);

    if (!proposal) throw new AppError("Proposal not found", 404);

    // Membership first, so a stranger cannot read a proposal's state out of the
    // error message. Checking status first answered "this proposal is rejected"
    // to someone with no business knowing it exists.
    if (!(await MembershipService.isSignerOf(proposal.organizationId, voter))) {
      throw new AppError("Only a signer of this organization can vote", 403);
    }

    if (proposal.status !== "open") {
      throw new AppError(`This proposal is ${proposal.status} and cannot be voted on`, 409);
    }

    try {
      await db.insert(proposalVotes).values({
        proposalId: proposal.id,
        voterAddress: voter,
        voterUserId: input.voterUserId,
        voterName: input.voterName,
        choice: input.choice,
        comment: input.comment,
      });
    } catch (err) {
      if (isUniqueViolation(err, "proposal_voter")) {
        throw new AppError("You have already voted on this proposal", 409);
      }
      throw err;
    }

    // Latch the outcome the moment it is reached, so the record says when the
    // decision happened rather than when someone next looked at it.
    const updated = (await ProposalService.getById(proposal.id))!;
    if (updated.status === "passed" || updated.status === "rejected") {
      await db
        .update(proposals)
        .set({ status: updated.status, decidedAt: new Date() })
        .where(and(eq(proposals.id, proposal.id), eq(proposals.status, "open")));

      await ProposalService.announce(proposal.organizationId, proposal.id, "decided");

      return (await ProposalService.getById(proposal.id))!;
    }

    await ProposalService.announce(proposal.organizationId, proposal.id, "voted");

    return updated;
  }

  /** Withdraw a proposal. Only the signer who raised it, and only while open. */
  static async cancel(id: string, requestedBy: string): Promise<ProposalView> {
    const proposal = await ProposalService.getById(id);
    if (!proposal) throw new AppError("Proposal not found", 404);

    if (proposal.createdByAddress !== requestedBy.toLowerCase()) {
      throw new AppError("Only the signer who raised this proposal can withdraw it", 403);
    }

    if (proposal.status !== "open") {
      throw new AppError(`This proposal is ${proposal.status} and cannot be withdrawn`, 409);
    }

    await db
      .update(proposals)
      .set({ status: "cancelled", decidedAt: new Date() })
      .where(eq(proposals.id, id));

    await ProposalService.announce(proposal.organizationId, id, "cancelled");

    return (await ProposalService.getById(id))!;
  }

  /**
   * Close out proposals whose window has passed without a decision.
   *
   * Status is already derived on read, so this only writes the settled value
   * down. Nothing depends on it having run.
   */
  static async expireOverdue(): Promise<number> {
    const overdue = await db
      .update(proposals)
      .set({ status: "expired", decidedAt: new Date() })
      .where(and(eq(proposals.status, "open"), lte(proposals.closesAt, new Date())))
      .returning({ id: proposals.id });

    return overdue.length;
  }

  /** Who may still vote, for showing an outstanding-signatures list. */
  static async pendingSigners(id: string): Promise<Array<{ address: string; name: string }>> {
    const proposal = await ProposalService.getById(id);
    if (!proposal) throw new AppError("Proposal not found", 404);

    const signers = await MembershipService.signersOf(proposal.organizationId);
    const voted = new Set(proposal.votes.map((v) => v.voterAddress));

    // A signer who has not claimed their invitation has no address, so there is
    // nothing on chain that could vote for them.
    return signers
      .filter((s): s is typeof s & { address: string } => Boolean(s.address))
      .filter((s) => !voted.has(s.address))
      .map((s) => ({ address: s.address, name: s.name }));
  }
}
