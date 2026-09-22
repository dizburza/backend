import type {
  balances,
  payrollTaxLines,
  taxAuthorities,
  taxBands,
  taxRegimes,
  tokens,
  batchPayrollApprovals,
  batchPayrollRecipients,
  batchPayrolls,
  employeeAuditLogs,
  indexerCursors,
  onchainEvents,
  organizationMembers,
  organizations,
  proposals,
  proposalVotes,
  relayedTransactions,
  pendingTransactions,
  signerChangeApprovals,
  signerChangeProposals,
  transactions,
  users,
} from "./schema.js";

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;

export type OrganizationMember = typeof organizationMembers.$inferSelect;
export type NewOrganizationMember = typeof organizationMembers.$inferInsert;
export type MembershipRole = OrganizationMember["role"];

export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;

export type BatchPayroll = typeof batchPayrolls.$inferSelect;
export type NewBatchPayroll = typeof batchPayrolls.$inferInsert;

export type BatchPayrollRecipient = typeof batchPayrollRecipients.$inferSelect;
export type NewBatchPayrollRecipient = typeof batchPayrollRecipients.$inferInsert;

export type BatchPayrollApproval = typeof batchPayrollApprovals.$inferSelect;
export type NewBatchPayrollApproval = typeof batchPayrollApprovals.$inferInsert;

export type SignerChangeProposal = typeof signerChangeProposals.$inferSelect;
export type NewSignerChangeProposal = typeof signerChangeProposals.$inferInsert;

export type SignerChangeApproval = typeof signerChangeApprovals.$inferSelect;
export type NewSignerChangeApproval = typeof signerChangeApprovals.$inferInsert;

export type Balance = typeof balances.$inferSelect;
export type Proposal = typeof proposals.$inferSelect;
export type NewProposal = typeof proposals.$inferInsert;
export type ProposalVote = typeof proposalVotes.$inferSelect;
export type RelayedTransaction = typeof relayedTransactions.$inferSelect;

export type Token = typeof tokens.$inferSelect;
export type NewToken = typeof tokens.$inferInsert;
export type IndexerCursor = typeof indexerCursors.$inferSelect;
export type PendingTransaction = typeof pendingTransactions.$inferSelect;
export type OnchainEvent = typeof onchainEvents.$inferSelect;
export type EmployeeAuditLog = typeof employeeAuditLogs.$inferSelect;

export type TaxRegime = typeof taxRegimes.$inferSelect;
export type TaxBand = typeof taxBands.$inferSelect;
export type TaxAuthority = typeof taxAuthorities.$inferSelect;
export type PayrollTaxLine = typeof payrollTaxLines.$inferSelect;
export type NewPayrollTaxLine = typeof payrollTaxLines.$inferInsert;

/**
 * An organization with its signer rows attached. Most callers want them
 * together, and the frontend session still reads them off the organization.
 */
export type OrganizationWithSigners = Organization & {
  signers: OrganizationMember[];
};
