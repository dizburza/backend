/**
 * Which register the organization's number comes from, not what it is
 * incorporated as. It pairs with `registrationNumber`, so "CAC" plus
 * RC1234567 reads as one fact.
 *
 * The strings are what the onboarding form submits, so the validator reads
 * this rather than keeping a second copy that can drift out of step.
 */
export const REGISTRATION_TYPES = [
  "CAC — Corporate Affairs Commission",
  "TIN — Tax Identification Number",
] as const;

export type RegistrationType = (typeof REGISTRATION_TYPES)[number];

export type Industry =
  | "Information Technology"
  | "Finance"
  | "Healthcare"
  | "Agriculture"
  | "Education"
  | "Media"
  | "Industrial Services"
  | "Transportation"
  | "Tourism"
  | "Legal Services"
  | "Life Sciences"
  | "Manufacturing"
  | "Entertainment"
  | "Hospitality"
  | "Social Impact"
  | "Logistics";

// ✅ INPUT TYPE - What the client sends
export interface CreateOrganizationInput {
  name: string;
  contractAddress: string;
  organizationHash?: string;
  creatorAddress: string;
  businessEmail: string;
  businessInfo?: {
    registrationNumber?: string;
    taxIdentificationNumber?: string;
    registrationType?: RegistrationType;
    certificate?: {
      fileUrl: string;
      fileName: string;
      uploadedAt: Date;
    };
  };
  signers: {
    address: string;
    name: string;
    role: string;
  }[];
  quorum: number;
  metadata?: {
    industry?: Industry;
    size?: string;
    description?: string;
  };
  settings?: {
    payrollCurrency?: string;
    defaultPaymentDay?: number;
    timeZone?: string;
  };
  /**
   * The creator's own employment, when they said they are on the payroll.
   * Signing and employment are separate memberships, so this writes a second
   * row rather than changing the signer seat.
   */
  creatorEmployment?: {
    jobRole: string;
    /** The human figure, scaled to base units here where decimals are known. */
    salary: string;
  };
}

// ✅ STORAGE TYPE - What goes into the database (includes backend-generated fields)
export interface OrganizationData {
  name: string;
  slug: string;
  contractAddress: string;
  organizationHash: string;
  creatorAddress: string;
  businessEmail: string;
  businessInfo?: {
    registrationNumber?: string;
    taxIdentificationNumber?: string;
    registrationType?: RegistrationType;
    certificate?: {
      fileUrl: string;
      fileName: string;
      uploadedAt: Date;
    };
  };
  signers: {
    address: string;
    name: string;
    role: string;
    addedAt?: Date;
    isActive?: boolean;
  }[];
  quorum: number;
  metadata?: {
    industry?: Industry;
    size?: string;
    description?: string;
  };
  settings?: {
    payrollCurrency?: string;
    defaultPaymentDay?: number;
    timeZone?: string;
  };
}

export interface CreateBatchInput {
  batchName: string;
  organizationId: string;
  organizationAddress: string;
  creatorAddress: string;
  recipients: {
    userId?: string;
    walletAddress: string;
    amount: string;
    employeeName: string;
  }[];
  /** The proposal this batch settles, if it settles one. */
  proposalId?: string | null;
}

export interface BatchPayrollData {
  batchName: string;
  organizationId: string;
  organizationAddress: string;
  creatorAddress: string;
  recipients: {
    userId?: string;
    walletAddress: string;
    amount: string;
    employeeName: string;
  }[];
  totalAmount: string;
  quorumRequired: number;
  submittedAt: Date;
  expiresAt: Date;
  status?: "pending" | "approved" | "executed" | "cancelled" | "expired";
  approvals?: {
    signerAddress: string;
    signerName: string;
    approvedAt: Date;
  }[];
  approvalCount?: number;
  executedAt?: Date;
  executedBy?: string;
  txHash?: string;
}

export interface AddEmployeeData {
  username?: string;
  walletAddress?: string;
  surname?: string;
  firstname?: string;
  jobRole: string;
  salary: string;
  department?: string;
  employeeId?: string;
}