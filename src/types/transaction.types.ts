export type TransactionType =
  | "send"
  | "receive"
  | "payroll"
  | "qr_payment"
  | "bank_transfer"
  | "airtime"
  | "bills";
export type TransactionCategory =
  | "salary"
  | "food"
  | "transport"
  | "utilities"
  | "entertainment"
  | "shopping"
  | "health"
  | "other";
export type TransactionStatus = "pending" | "confirmed" | "failed";

export interface TransactionData {
  txHash: string;
  logIndex?: number;
  type: TransactionType;
  fromAddress: string;
  toAddress: string;
  fromUserId?: string;
  toUserId?: string;
  amount: string;
  currency?: string;
  description?: string;
  memo?: string;
  reference?: string;
  category?: TransactionCategory;
  qrCode?: string;
  merchantName?: string;
  batchId?: string;
  batchName?: string;
  organizationId?: string;
  blockNumber?: number;
  gasUsed?: string;
  fee?: string;
  status?: TransactionStatus;
  bankDetails?: {
    accountNumber?: string;
    bankName?: string;
    accountName?: string;
  };
}

export interface TransactionFilter {
  page?: number;
  limit?: number;
  type?: TransactionType;
  category?: TransactionCategory;
  startDate?: Date;
  endDate?: Date;
  status?: TransactionStatus;
}
