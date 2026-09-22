import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * Token amounts are uint256 base units. numeric(78, 0) holds the full range
 * exactly, which is the main reason for moving off Mongo: Decimal128 tops out
 * at 34 significant digits and needed hand-written parsing on the way out.
 */
const tokenAmount = (name: string) => numeric(name, { precision: 78, scale: 0 });

/** Checksummed addresses are stored lowercased so comparisons never surprise. */
const address = (name: string) => varchar(name, { length: 42 });

const txHash = (name: string) => varchar(name, { length: 66 });

/**
 * What a person is to one organization.
 *
 * Deliberately separate from `user_role`: signing is a relationship with a
 * particular organization, not a property of the person. One address can sign
 * for several organizations, so it cannot be a column on the user.
 */
export const membershipRole = pgEnum("membership_role", [
  "owner",
  "signer",
  "employee",
]);

/**
 * Whether the person behind a membership has claimed it. HR seeds a row from a
 * name and an email, and it stays `invited` until someone opens the invite link
 * and attaches a wallet to it.
 */
export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "joined",
]);

export const transactionType = pgEnum("transaction_type", [
  "send",
  "receive",
  "payroll",
  "qr_payment",
  "bank_transfer",
  "airtime",
  "bills",
]);

export const transactionCategory = pgEnum("transaction_category", [
  "salary",
  "food",
  "transport",
  "utilities",
  "entertainment",
  "shopping",
  "health",
  "other",
]);

export const transactionStatus = pgEnum("transaction_status", [
  "pending",
  "confirmed",
  "failed",
]);

export const batchStatus = pgEnum("batch_status", [
  "pending",
  "approved",
  "executed",
  "cancelled",
  "expired",
]);

/** Mirrors the contract's SignerProposal: proposed, executed, or timed out. */
export const signerChangeStatus = pgEnum("signer_change_status", [
  "pending",
  "approved",
  "executed",
  "expired",
]);

export const auditAction = pgEnum("audit_action", ["ADD", "UPDATE", "REMOVE"]);

export const taxStatus = pgEnum("tax_status", ["computed", "remitted", "failed"]);

export const relayStatus = pgEnum("relay_status", ["submitted", "confirmed", "failed"]);

/**
 * `claiming` is a lease, not a chain state.
 *
 * The escrow only knows open or settled, so two people opening the same link at
 * once would both be shown a claim button and one would watch their transaction
 * revert. This holds a short lease while a claim is in flight, which is what
 * lets the second person be told rather than surprised.
 */
export const cashLinkStatus = pgEnum("cash_link_status", [
  "open",
  "claiming",
  "claimed",
  "cancelled",
  "reclaimed",
]);

export const proposalStatus = pgEnum("proposal_status", [
  "open",
  "passed",
  "rejected",
  "expired",
  "cancelled",
]);

export const voteChoice = pgEnum("vote_choice", ["for", "against"]);

/**
 * The ERC-20s this deployment knows about.
 *
 * Exists so the payroll token is configuration rather than something compiled
 * in. Decimals in particular were hardcoded to 6 in four places, which happens
 * to be right for cNGN and for USDC, and would have silently corrupted every
 * amount for a token with any other precision.
 *
 * Exactly one token is the default at a time, enforced by the partial unique
 * index below. Dizburza pays in one currency: this is here to make swapping it
 * cheap, not to run several at once. Paying salaries in a second currency would
 * mean capturing an exchange rate at disbursement for the naira PAYE figure and
 * carrying it on the receipt forever, which is a much larger decision than a
 * token registry.
 */
export const tokens = pgTable(
  "tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chainId: integer("chain_id").notNull(),
    address: address("address").notNull(),
    symbol: varchar("symbol", { length: 16 }).notNull(),
    name: text("name"),
    /** Read from the contract on first sight, never assumed. */
    decimals: integer("decimals").notNull(),
    /** Icon shown beside amounts. A new token needs a new asset either way. */
    logoUrl: text("logo_url"),
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tokens_chain_address_key").on(t.chainId, t.address),
    uniqueIndex("tokens_single_default_key")
      .on(t.chainId)
      .where(sql`is_default and is_active`),
  ]
);

/**
 * A tax regime is a dated set of bands and reliefs for one jurisdiction.
 *
 * Rates are data, never code. Nigerian personal income tax rules have changed
 * recently enough that hardcoding them would bake in a figure that is wrong the
 * moment the law moves again, and a payroll product cannot ship a code release
 * to correct a tax rate mid-year. Historic regimes stay in the table so a
 * receipt reissued years later recomputes with the rules that actually applied.
 */
export const taxRegimes = pgTable(
  "tax_regimes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    jurisdiction: text("jurisdiction").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: true }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: true }),

    // Consolidated relief: the greater of a fixed floor or a percentage of
    // gross, plus a further percentage of gross.
    reliefFixedMinor: numeric("relief_fixed_minor", { precision: 78, scale: 0 })
      .notNull()
      .default("0"),
    reliefPercentOfGross: numeric("relief_percent_of_gross", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),
    reliefAdditionalPercentOfGross: numeric("relief_additional_percent_of_gross", {
      precision: 6,
      scale: 3,
    })
      .notNull()
      .default("0"),

    /** Floor expressed as a percentage of gross, applied when bands yield less. */
    minimumTaxPercent: numeric("minimum_tax_percent", { precision: 6, scale: 3 })
      .notNull()
      .default("0"),

    /** Cleared once a human has checked the figures against the current law. */
    verified: boolean("verified").notNull().default(false),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tax_regimes_effective_idx").on(t.jurisdiction, t.effectiveFrom)]
);

/** One graduated band. `upperBoundMinor` null means the top, open-ended band. */
export const taxBands = pgTable(
  "tax_bands",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    regimeId: uuid("regime_id")
      .notNull()
      .references(() => taxRegimes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    lowerBoundMinor: numeric("lower_bound_minor", { precision: 78, scale: 0 }).notNull(),
    upperBoundMinor: numeric("upper_bound_minor", { precision: 78, scale: 0 }),
    ratePercent: numeric("rate_percent", { precision: 6, scale: 3 }).notNull(),
  },
  (t) => [uniqueIndex("tax_bands_regime_position_key").on(t.regimeId, t.position)]
);

/**
 * Where deducted tax is sent. Nigerian PAYE is remitted to the employee's state
 * internal revenue service, so this is keyed by state rather than being one
 * national account.
 */
export const taxAuthorities = pgTable(
  "tax_authorities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    stateCode: varchar("state_code", { length: 16 }).notNull(),
    /** Placeholder until the authority accepts on-chain settlement directly. */
    walletAddress: address("wallet_address").notNull(),
    isPlaceholder: boolean("is_placeholder").notNull().default(true),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tax_authorities_state_key").on(t.stateCode)]
);

/**
 * The gross/tax/net breakdown behind one employee's line in a batch.
 *
 * The employee is the taxpayer: the employer deducts and remits on their
 * behalf, so the receipt is issued in the employee's name and carries the
 * employer only as the remitting party.
 */
export const payrollTaxLines = pgTable(
  "payroll_tax_lines",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchPayrolls.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    walletAddress: address("wallet_address").notNull(),

    grossMinor: tokenAmount("gross_minor").notNull(),
    taxMinor: tokenAmount("tax_minor").notNull(),
    netMinor: tokenAmount("net_minor").notNull(),

    regimeId: uuid("regime_id").references(() => taxRegimes.id, { onDelete: "set null" }),
    taxAuthorityId: uuid("tax_authority_id").references(() => taxAuthorities.id, {
      onDelete: "set null",
    }),

    /** Per-band working, kept so a receipt can show how the figure was reached. */
    breakdown: jsonb("breakdown").$type<Record<string, unknown>>(),

    status: taxStatus("status").notNull().default("computed"),
    /** The on-chain transfer that settled the tax portion, once executed. */
    remittanceTxHash: txHash("remittance_tx_hash"),
    remittedAt: timestamp("remitted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("payroll_tax_lines_batch_wallet_key").on(t.batchId, t.walletAddress),
    index("payroll_tax_lines_user_idx").on(t.userId, t.createdAt.desc()),
    index("payroll_tax_lines_org_idx").on(t.organizationId, t.createdAt.desc()),
  ]
);

export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    slug: varchar("slug", { length: 60 }).notNull(),
    contractAddress: address("contract_address").notNull(),
    organizationHash: varchar("organization_hash", { length: 66 }).notNull(),
    creatorAddress: address("creator_address").notNull(),
    businessEmail: text("business_email").notNull(),

    /**
     * Normalised on the way in and unique across the platform. A company
     * registration is one real company, so a second organization claiming the
     * same number is either a duplicate or someone else's identity.
     * Nulls stay distinct in Postgres, so unregistered organizations are fine.
     */
    registrationNumber: text("registration_number"),
    taxIdentificationNumber: varchar("tax_identification_number", { length: 32 }),
    registrationType: text("registration_type"),
    certificateFileUrl: text("certificate_file_url"),
    certificateFileName: text("certificate_file_name"),
    certificateUploadedAt: timestamp("certificate_uploaded_at", { withTimezone: true }),

    quorum: integer("quorum").notNull(),

    industry: text("industry"),
    size: text("size"),
    description: text("description"),

    payrollCurrency: varchar("payroll_currency", { length: 16 }).notNull().default("cNGN"),
    defaultPaymentDay: integer("default_payment_day"),
    timeZone: text("time_zone").notNull().default("Africa/Lagos"),

    /** Applied when an employee has no state of residence recorded. */
    defaultTaxStateCode: varchar("default_tax_state_code", { length: 16 }),
    taxEnabled: boolean("tax_enabled").notNull().default(false),

    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("organizations_slug_key").on(t.slug),
    uniqueIndex("organizations_contract_address_key").on(t.contractAddress),
    uniqueIndex("organizations_hash_key").on(t.organizationHash),
    uniqueIndex("organizations_registration_number_key").on(t.registrationNumber),
    uniqueIndex("organizations_tin_key").on(t.taxIdentificationNumber),
    index("organizations_creator_idx").on(t.creatorAddress),
  ]
);

/**
 * A 6-digit code proving the sender controls the business email typed during
 * onboarding, before any organization row exists to attach it to. Keyed by
 * email rather than an organization id for that reason.
 *
 * Only the hash is stored, the same reasoning as the auth challenge nonce:
 * a copy of this table should be worth nothing to whoever takes it.
 */
export const organizationEmailVerifications = pgTable(
  "organization_email_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    email: text("email").notNull(),
    codeHash: varchar("code_hash", { length: 64 }).notNull(),
    attempts: integer("attempts").notNull().default(0),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("organization_email_verifications_email_idx").on(t.email)]
);

/**
 * Every relationship between a person and an organization, signer or employee.
 *
 * The two have different cardinality and the table encodes that. Signing is
 * uncapped: on chain one address can already be a signer of any number of
 * clones, so forbidding it off chain would just make state we cannot represent.
 * Employment is capped at one by the partial unique index below, because PAYE
 * needs a single unambiguous employer of record per person.
 *
 * Keyed by address rather than user id: a signer can be named during setup
 * before they have registered, and the address is what the contract knows.
 *
 * A row can also exist before anyone is behind it. HR imports employees from a
 * spreadsheet of names, emails and salaries, so the row carries the employment
 * terms and waits at `status = 'invited'` with no address until that person
 * opens the invite link and claims it. Claiming attaches an identity to terms
 * that were already set, and must never be able to write the terms themselves.
 */
export const organizationMembers = pgTable(
  "organization_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Filled in once the address has an account, null before that. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Null while the row is an invitation. HR seeds an employee from a CSV
     * knowing a name and an email, and the wallet does not exist until that
     * person signs up and claims the row.
     */
    address: address("address"),
    /** How the invitation reaches them, and how a claim finds the right row. */
    email: text("email"),
    /**
     * Held on the membership rather than read from the user, since it is
     * collected while seeding the row and there is no user behind it yet.
     */
    phone: text("phone"),
    status: membershipStatus("status").notNull().default("joined"),
    name: text("name").notNull(),
    role: membershipRole("role").notNull(),

    /** Title within the organization, distinct from the membership role. */
    jobRole: text("job_role"),
    salary: tokenAmount("salary"),
    department: text("department"),
    employeeId: text("employee_id"),
    /** Whether `salary` is the gross figure or the take-home figure. */
    salaryIsGross: boolean("salary_is_gross").notNull().default(true),

    isActive: boolean("is_active").notNull().default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [
    // Nulls stay distinct here, which is what lets many unclaimed invitations
    // coexist: they have no address to collide on.
    uniqueIndex("organization_members_org_address_role_key").on(
      t.organizationId,
      t.address,
      t.role
    ),
    // One invitation per email per organization, so a CSV imported twice does
    // not produce two rows for the same person to claim.
    uniqueIndex("organization_members_org_email_key")
      .on(t.organizationId, sql`lower(${t.email})`)
      .where(sql`email is not null and is_active`),
    // The employment cap. Enforced in the database rather than in a service
    // check, so a concurrent add cannot slip a second employer past it. An
    // unclaimed invitation has no address, so it does not consume the cap:
    // someone may be invited by several organizations and employed by one.
    uniqueIndex("organization_members_single_employment_key")
      .on(t.address)
      .where(sql`role = 'employee' and is_active`),
    index("organization_members_address_active_idx").on(t.address, t.isActive),
    index("organization_members_org_role_idx").on(t.organizationId, t.role, t.isActive),
    index("organization_members_user_idx").on(t.userId),
    index("organization_members_org_status_idx").on(t.organizationId, t.status),
  ]
);

/**
 * The link HR sends so staff can claim the rows already seeded for them.
 *
 * One live link per organization, and the token is a bearer credential: anyone
 * holding it can present themselves as staff of this organization. That is the
 * same shape as a CashLink, and the same rule applies, which is that the token
 * is the whole secret and nothing else gates it.
 *
 * What bounds the damage is what a claim can do, not who can reach the link. A
 * claim only ever attaches an identity to an invitation that already exists,
 * matched by the email HR entered. Someone with the token but no seeded row
 * gets nothing, so a leaked link does not create employees or let anyone write
 * their own salary.
 *
 * `revokedAt` is how a leaked link is closed, and issuing a new one revokes the
 * old: the partial unique index below allows exactly one live token per
 * organization.
 */
export const organizationInvites = pgTable(
  "organization_invites",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Random, urlsafe, and the only thing the link carries. */
    token: text("token").notNull(),
    createdBy: address("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null means it does not expire on its own. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("organization_invites_token_key").on(t.token),
    uniqueIndex("organization_invites_live_key")
      .on(t.organizationId)
      .where(sql`revoked_at is null`),
  ]
);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    walletAddress: address("wallet_address").notNull(),
    /**
     * Never null, because it is how one person finds another to pay them. It is
     * generated from the address when nobody has given a name yet.
     */
    username: varchar("username", { length: 40 }).notNull(),
    /**
     * Null until the person fills in their profile. Signing in creates the row
     * from an address alone, so a placeholder here would be a fake name that
     * nothing could tell apart from a real one, and the gate that asks for the
     * real one would have nothing to test.
     */
    surname: text("surname"),
    firstname: text("firstname"),
    fullName: text("full_name"),
    email: text("email"),
    phoneNumber: text("phone_number"),
    avatar: text("avatar"),

    /**
     * PAYE is remitted to the employee's state of residence, not the employer's.
     * Both of these belong to the person, so they stay here rather than moving
     * to the membership row with the employment terms.
     */
    taxStateCode: varchar("tax_state_code", { length: 16 }),
    taxIdentificationNumber: varchar("tax_identification_number", { length: 32 }),

    dateOfBirth: timestamp("date_of_birth", { withTimezone: true }),
    addressLine: text("address_line"),
    city: text("city"),
    country: text("country").default("Nigeria"),

    currency: varchar("currency", { length: 16 }).notNull().default("cNGN"),
    notifications: boolean("notifications").notNull().default(true),
    language: varchar("language", { length: 8 }).notNull().default("en"),
    timezone: text("timezone").notNull().default("Africa/Lagos"),

    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("users_wallet_address_key").on(t.walletAddress),
    uniqueIndex("users_username_key").on(t.username),
  ]
);

export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    txHash: txHash("tx_hash").notNull(),
    // Every row is decoded from a specific Transfer log, so this is always
    // known. Keeping it NOT NULL means the unique key below needs no
    // NULLS NOT DISTINCT, which would have required Postgres 15+.
    logIndex: integer("log_index").notNull(),

    type: transactionType("type").notNull(),
    fromAddress: address("from_address").notNull(),
    toAddress: address("to_address").notNull(),
    fromUserId: uuid("from_user_id").references(() => users.id, { onDelete: "set null" }),
    toUserId: uuid("to_user_id").references(() => users.id, { onDelete: "set null" }),

    amount: tokenAmount("amount").notNull(),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    // Snapshot of the symbol at the time, so a statement printed after the
    // payroll token is swapped still names what was actually paid.
    currency: varchar("currency", { length: 16 }).notNull(),
    fee: tokenAmount("fee"),
    gasUsed: numeric("gas_used", { precision: 78, scale: 0 }),

    description: text("description"),
    memo: text("memo"),
    reference: varchar("reference", { length: 64 }),
    category: transactionCategory("category"),
    qrCode: text("qr_code"),
    merchantName: text("merchant_name"),

    batchId: uuid("batch_id").references(() => batchPayrolls.id, {
      onDelete: "set null",
    }),
    batchName: text("batch_name"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),

    blockNumber: integer("block_number"),
    status: transactionStatus("status").notNull().default("pending"),

    // Block time, not insert time. Every range query depends on this.
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),

    bankAccountNumber: text("bank_account_number"),
    bankName: text("bank_name"),
    bankAccountName: text("bank_account_name"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One row per emitted log. A batch payroll emits one Transfer per
    // recipient, so the hash alone is not unique.
    uniqueIndex("transactions_hash_log_key").on(t.txHash, t.logIndex),
    index("transactions_from_time_idx").on(t.fromAddress, t.timestamp.desc()),
    index("transactions_to_time_idx").on(t.toAddress, t.timestamp.desc()),
    index("transactions_status_time_idx").on(t.status, t.timestamp.desc()),
    index("transactions_org_time_idx").on(t.organizationId, t.timestamp.desc()),
    index("transactions_reference_idx").on(t.reference),
  ]
);

export const batchPayrolls = pgTable(
  "batch_payrolls",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchName: text("batch_name").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizationAddress: address("organization_address").notNull(),
    creatorAddress: address("creator_address").notNull(),

    totalAmount: tokenAmount("total_amount").notNull(),
    status: batchStatus("status").notNull().default("pending"),
    quorumRequired: integer("quorum_required").notNull(),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executedBy: address("executed_by"),
    txHash: txHash("tx_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("batch_payrolls_name_key").on(t.batchName),
    index("batch_payrolls_org_status_idx").on(t.organizationId, t.status),
  ]
);

export const batchPayrollRecipients = pgTable(
  "batch_payroll_recipients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchPayrolls.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    walletAddress: address("wallet_address").notNull(),
    amount: tokenAmount("amount").notNull(),
    employeeName: text("employee_name").notNull(),
  },
  (t) => [index("batch_payroll_recipients_batch_idx").on(t.batchId)]
);

export const batchPayrollApprovals = pgTable(
  "batch_payroll_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => batchPayrolls.id, { onDelete: "cascade" }),
    signerAddress: address("signer_address").notNull(),
    signerName: text("signer_name").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One approval per signer per batch, so approvalCount can be a count()
    // rather than a field that drifts.
    uniqueIndex("batch_payroll_approvals_batch_signer_key").on(t.batchId, t.signerAddress),
  ]
);

/**
 * A record of Dizburza's on-chain SignerProposal: adding or removing a signer
 * once the organization is past bootstrap and every signer-set change needs
 * quorum. This is not the `proposals` table. That one is a pure off-chain
 * governance record with no chain counterpart; a signer change is a real
 * on-chain multisig flow (proposeSignerChange / approveSignerChange /
 * executeSignerChange), so this mirrors batch_payrolls instead: a passive
 * ledger of what the contract already did, written after each call succeeds,
 * never the thing that decides it.
 *
 * `proposalId` is the contract's own id, `keccak256(subject, isRemoval,
 * signerEpoch)`, so a row here can always be resolved back to the call that
 * approves or executes it. `signerEpoch` is snapshotted for the same reason a
 * batch snapshots quorum: a proposal is judged by the epoch it was raised
 * under, and a later signer change bumping the epoch must not let a stale
 * approval be replayed against a different signer set.
 */
export const signerChangeProposals = pgTable(
  "signer_change_proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    organizationAddress: address("organization_address").notNull(),
    proposalId: varchar("proposal_id", { length: 66 }).notNull(),

    subjectAddress: address("subject_address").notNull(),
    subjectName: text("subject_name").notNull(),
    isRemoval: boolean("is_removal").notNull().default(false),
    signerEpoch: integer("signer_epoch").notNull(),

    createdByAddress: address("created_by_address").notNull(),
    quorumRequired: integer("quorum_required").notNull(),
    status: signerChangeStatus("status").notNull().default("pending"),

    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    executedAt: timestamp("executed_at", { withTimezone: true }),
    executedBy: address("executed_by"),
    txHash: txHash("tx_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("signer_change_proposals_proposal_id_key").on(t.proposalId),
    index("signer_change_proposals_org_status_idx").on(t.organizationId, t.status),
  ]
);

export const signerChangeApprovals = pgTable(
  "signer_change_approvals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    signerChangeId: uuid("signer_change_id")
      .notNull()
      .references(() => signerChangeProposals.id, { onDelete: "cascade" }),
    signerAddress: address("signer_address").notNull(),
    signerName: text("signer_name").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One approval per signer per proposal, same reasoning as batch approvals:
    // approvalCount is a count() of these rows, never a stored field.
    uniqueIndex("signer_change_approvals_change_signer_key").on(
      t.signerChangeId,
      t.signerAddress
    ),
  ]
);

/**
 * Cached balances, one row per address per token.
 *
 * `decimals` is copied from the token rather than joined. This table exists so
 * a balance read is a single indexed row lookup, and an ERC-20's decimals never
 * change, so the copy cannot drift.
 */
/**
 * A governance decision put to the organization's signers.
 *
 * A proposal records that the signers agreed to something, with an amount
 * attached. It deliberately does not move money: paying it out is a batch
 * payroll, which has its own quorum enforced on chain. Keeping disbursement in
 * one place means there is exactly one path funds can leave by, and it is the
 * one the multisig actually guards.
 */
export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),

    /** Requested amount in base units. Null for a proposal that asks for none. */
    amount: tokenAmount("amount"),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),
    currency: varchar("currency", { length: 16 }),

    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdByAddress: address("created_by_address").notNull(),

    /**
     * Quorum and signer count captured when the proposal was raised.
     *
     * The same reasoning as `signerEpoch` on a batch: a vote is judged by the
     * bar it was put to people under. Reading quorum live would let a config
     * change retroactively pass or sink a proposal that people had already
     * voted on.
     */
    votesRequired: integer("votes_required").notNull(),
    signerCountAtCreation: integer("signer_count_at_creation").notNull(),

    status: proposalStatus("status").notNull().default("open"),
    opensAt: timestamp("opens_at", { withTimezone: true }).notNull().defaultNow(),
    closesAt: timestamp("closes_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),

    /** Set once a payroll batch settles what this proposal asked for. */
    settledBatchId: uuid("settled_batch_id").references(() => batchPayrolls.id, {
      onDelete: "set null",
    }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("proposals_org_status_idx").on(t.organizationId, t.status),
    index("proposals_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("proposals_closes_at_idx").on(t.closesAt),
  ]
);

/** One vote per signer per proposal, the same shape as batch approvals. */
export const proposalVotes = pgTable(
  "proposal_votes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    voterAddress: address("voter_address").notNull(),
    voterUserId: uuid("voter_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    voterName: text("voter_name").notNull(),
    choice: voteChoice("choice").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Counts are derived from these rows, never stored on the proposal, so a
    // tally can never drift from the votes behind it.
    uniqueIndex("proposal_votes_proposal_voter_key").on(t.proposalId, t.voterAddress),
    index("proposal_votes_proposal_idx").on(t.proposalId),
  ]
);

export const balances = pgTable(
  "balances",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    address: address("address").notNull(),
    tokenId: uuid("token_id")
      .notNull()
      .references(() => tokens.id, { onDelete: "cascade" }),
    raw: tokenAmount("raw").notNull().default("0"),
    decimals: integer("decimals").notNull(),
    blockNumber: integer("block_number"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("balances_address_token_key").on(t.address, t.tokenId),
    index("balances_fetched_at_idx").on(t.fetchedAt),
  ]
);

export const indexerCursors = pgTable("indexer_cursors", {
  key: text("key").primaryKey(),
  chainId: integer("chain_id").notNull(),
  contractAddress: address("contract_address").notNull(),
  eventName: text("event_name").notNull(),
  lastIndexedBlock: integer("last_indexed_block").notNull().default(0),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
});

export const pendingTransactions = pgTable(
  "pending_transactions",
  {
    txHash: txHash("tx_hash").primaryKey(),
    submittedBy: address("submitted_by").notNull(),
    attempts: integer("attempts").notNull().default(0),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  },
  (t) => [index("pending_transactions_submitted_at_idx").on(t.submittedAt)]
);

export const authChallenges = pgTable("auth_challenges", {
  address: address("address").primaryKey(),
  nonce: varchar("nonce", { length: 64 }).notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

/**
 * Raw webhook payloads. Genuinely schemaless, so this one stays a document,
 * just in a jsonb column.
 */
export const onchainEvents = pgTable(
  "onchain_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventKey: text("event_key").notNull(),
    webhookId: text("webhook_id"),
    webhookEventId: text("webhook_event_id"),
    chainId: integer("chain_id"),
    blockNumber: integer("block_number"),
    txHash: txHash("tx_hash"),
    logIndex: integer("log_index"),
    address: address("address"),
    topic0: varchar("topic0", { length: 66 }),
    topics: jsonb("topics").$type<string[]>(),
    data: text("data"),
    payload: jsonb("payload").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("onchain_events_key_key").on(t.eventKey),
    index("onchain_events_tx_idx").on(t.txHash, t.logIndex),
  ]
);

export const employeeAuditLogs = pgTable(
  "employee_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    employeeUserId: uuid("employee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    employeeUsername: varchar("employee_username", { length: 40 }),
    employeeWalletAddress: address("employee_wallet_address"),
    action: auditAction("action").notNull(),
    performedByUserId: uuid("performed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    performedByUsername: varchar("performed_by_username", { length: 40 }),
    performedByWalletAddress: address("performed_by_wallet_address"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("employee_audit_logs_org_time_idx").on(t.organizationId, t.createdAt.desc()),
    index("employee_audit_logs_employee_idx").on(t.employeeUserId),
  ]
);

export const organizationsRelations = relations(organizations, ({ many }) => ({
  members: many(organizationMembers),
  batches: many(batchPayrolls),
  proposals: many(proposals),
}));

export const proposalsRelations = relations(proposals, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [proposals.organizationId],
    references: [organizations.id],
  }),
  votes: many(proposalVotes),
}));

export const proposalVotesRelations = relations(proposalVotes, ({ one }) => ({
  proposal: one(proposals, {
    fields: [proposalVotes.proposalId],
    references: [proposals.id],
  }),
}));

export const organizationMembersRelations = relations(organizationMembers, ({ one }) => ({
  organization: one(organizations, {
    fields: [organizationMembers.organizationId],
    references: [organizations.id],
  }),
  user: one(users, {
    fields: [organizationMembers.userId],
    references: [users.id],
  }),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(organizationMembers),
}));

/**
 * Every meta transaction this deployment has paid gas for.
 *
 * The relayer key buys gas and nothing else, so this is a cost ledger rather
 * than an authorization record: authority is the user's EIP-712 signature,
 * which the forwarder checks on chain. It exists so sponsored gas can be shown
 * back to an organization and settled at payroll, instead of quietly becoming
 * someone's unbudgeted expense.
 */
export const relayedTransactions = pgTable(
  "relayed_transactions",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** The address that signed the request, never the relayer. */
    fromAddress: address("from_address").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),

    targetAddress: address("target_address").notNull(),
    /** First four bytes of calldata, so charges can be grouped by action. */
    selector: varchar("selector", { length: 10 }).notNull(),
    functionName: text("function_name"),

    txHash: txHash("tx_hash").notNull(),
    status: relayStatus("status").notNull().default("submitted"),

    gasUsed: numeric("gas_used", { precision: 78, scale: 0 }),
    gasPriceWei: numeric("gas_price_wei", { precision: 78, scale: 0 }),
    /** gasUsed * gasPrice, in wei. Converted to token units when billed. */
    feeWei: numeric("fee_wei", { precision: 78, scale: 0 }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("relayed_transactions_tx_hash_key").on(t.txHash),
    index("relayed_transactions_from_idx").on(t.fromAddress, t.createdAt),
    index("relayed_transactions_org_idx").on(t.organizationId, t.status),
  ]
);

/**
 * One send-by-link.
 *
 * The escrow contract is the record of the money. This row is what the escrow
 * cannot hold: the sender's narration, who eventually claimed it as a Dizburza
 * account rather than an address, and the lease that keeps two people from
 * racing the same link.
 *
 * There is no claim secret here, and there must never be one. The link's
 * private key lives in the URL fragment and nowhere else, so a copy of this
 * table is worth nothing to whoever takes it.
 */
export const cashLinks = pgTable(
  "cash_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),

    /** Address of the link's throwaway keypair. Its id on chain and here. */
    claimAddress: address("claim_address").notNull(),

    senderAddress: address("sender_address").notNull(),
    senderUserId: uuid("sender_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    amount: tokenAmount("amount").notNull(),
    /** Charged at creation, so a refunded link still paid for its own gas. */
    feeAmount: tokenAmount("fee_amount").notNull().default("0"),
    tokenId: uuid("token_id").references(() => tokens.id, { onDelete: "set null" }),

    /**
     * Narration for the sender's own history and receipts.
     *
     * Never rendered on the claim page. The link is bearer, so showing free text
     * to whoever holds it makes the link a messaging channel and a phishing
     * surface, and the text can carry a third party's data.
     */
    description: text("description"),

    status: cashLinkStatus("status").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),

    /** How long the in-flight claim holds the link. Null when nobody is trying. */
    claimingUntil: timestamp("claiming_until", { withTimezone: true }),

    claimedByAddress: address("claimed_by_address"),
    claimedByUserId: uuid("claimed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),

    createTxHash: txHash("create_tx_hash"),
    /** The claim, the cancel or the reclaim. Whichever ended the link. */
    settleTxHash: txHash("settle_tx_hash"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("cash_links_claim_address_key").on(t.claimAddress),
    index("cash_links_sender_idx").on(t.senderAddress, t.createdAt.desc()),
    // What the sweeper reads every time it runs.
    index("cash_links_sweep_idx").on(t.status, t.expiresAt),
  ]
);

export const batchPayrollsRelations = relations(batchPayrolls, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [batchPayrolls.organizationId],
    references: [organizations.id],
  }),
  recipients: many(batchPayrollRecipients),
  approvals: many(batchPayrollApprovals),
}));

export const signerChangeProposalsRelations = relations(
  signerChangeProposals,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [signerChangeProposals.organizationId],
      references: [organizations.id],
    }),
    approvals: many(signerChangeApprovals),
  })
);

export const signerChangeApprovalsRelations = relations(signerChangeApprovals, ({ one }) => ({
  signerChange: one(signerChangeProposals, {
    fields: [signerChangeApprovals.signerChangeId],
    references: [signerChangeProposals.id],
  }),
}));

export const batchPayrollRecipientsRelations = relations(
  batchPayrollRecipients,
  ({ one }) => ({
    batch: one(batchPayrolls, {
      fields: [batchPayrollRecipients.batchId],
      references: [batchPayrolls.id],
    }),
  })
);

export const batchPayrollApprovalsRelations = relations(
  batchPayrollApprovals,
  ({ one }) => ({
    batch: one(batchPayrolls, {
      fields: [batchPayrollApprovals.batchId],
      references: [batchPayrolls.id],
    }),
  })
);
