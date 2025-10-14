import mongoose, { Schema, Document } from "mongoose";

export interface ITransaction extends Document {
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
  fromUserId?: mongoose.Types.ObjectId;
  toUserId?: mongoose.Types.ObjectId;
  amount: string;
  currency: string;
  fee?: string;
  description?: string;
  memo?: string;
  reference?: string;
  category?: string;
  qrCode?: string;
  merchantName?: string;
  batchId?: mongoose.Types.ObjectId;
  batchName?: string;
  organizationId?: mongoose.Types.ObjectId;
  blockNumber?: number;
  gasUsed?: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: Date;
  confirmedAt?: Date;
  bankDetails?: {
    accountNumber?: string;
    bankName?: string;
    accountName?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    txHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        "send",
        "receive",
        "payroll",
        "qr_payment",
        "bank_transfer",
        "airtime",
        "bills",
      ],
      required: true,
      index: true,
    },
    fromAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    toAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    fromUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    toUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    amount: { type: String, required: true },
    currency: { type: String, default: "cNGN" },
    fee: String,
    description: String,
    memo: String,
    reference: { type: String, index: true },
    category: {
      type: String,
      enum: [
        "salary",
        "food",
        "transport",
        "utilities",
        "entertainment",
        "shopping",
        "health",
        "other",
      ],
      index: true,
    },
    qrCode: String,
    merchantName: String,
    batchId: { type: Schema.Types.ObjectId, ref: "BatchPayroll" },
    batchName: String,
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization" },
    blockNumber: Number,
    gasUsed: String,
    status: {
      type: String,
      enum: ["pending", "confirmed", "failed"],
      default: "pending",
      index: true,
    },
    timestamp: { type: Date, default: Date.now, index: true },
    confirmedAt: Date,
    bankDetails: {
      accountNumber: String,
      bankName: String,
      accountName: String,
    },
  },
  {
    timestamps: true,
  }
);

// Compound indexes
TransactionSchema.index({ fromAddress: 1, timestamp: -1 });
TransactionSchema.index({ toAddress: 1, timestamp: -1 });
TransactionSchema.index({ fromUserId: 1, timestamp: -1 });
TransactionSchema.index({ toUserId: 1, timestamp: -1 });
TransactionSchema.index({ type: 1, status: 1, timestamp: -1 });
TransactionSchema.index({ status: 1, timestamp: -1 });

export const Transaction = mongoose.model<ITransaction>(
  "Transaction",
  TransactionSchema
);
