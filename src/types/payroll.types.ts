export type RegistrationType =
  | "Sole Proprietorship"
  | "Partnership"
  | "Limited Liability Company (Ltd)"
  | "Public Limited Company (PLC)"
  | "Nonprofit / NGO"
  | "Cooperative"
  | "Government Owned"
  | "Business Name";

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

export interface OrganizationData {
  name: string;
  slug: string;
  contractAddress: string;
  organizationHash: string;
  creatorAddress: string;
  businessEmail: string;
  businessInfo?: {
    registrationNumber?: string;
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