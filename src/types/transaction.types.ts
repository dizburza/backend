export interface TransactionData {
  txHash: string;
  type:
    | "send"
    | "receive"
    | "payroll"
    | "qr_payment"
    | "bank_transfer"
    | "airtime"
    | "bills";
  fromAddress: string;
  toAddress: string;
  amount: string;
  description?: string;
  memo?: string;
  category?: string;
  qrCode?: string;
  batchId?: string;
  batchName?: string;
  organizationId?: string;
  blockNumber?: number;
}

export interface TransactionFilter {
  page?: number;
  limit?: number;
  type?: string;
  category?: string;
  startDate?: Date;
  endDate?: Date;
  status?: string;
}