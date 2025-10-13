import mongoose, { Schema, Document } from "mongoose";

export interface IBatchPayroll extends Document {
  batchName: string;
  organizationId: mongoose.Types.ObjectId;
  organizationAddress: string;
  creatorAddress: string;
  recipients: {
    userId?: mongoose.Types.ObjectId;
    walletAddress: string;
    amount: string;
    employeeName: string;
  }[];
  totalAmount: string;
  status: "pending" | "approved" | "executed" | "cancelled" | "expired";
  approvals: {
    signerAddress: string;
    signerName: string;
    approvedAt: Date;
  }[];
  approvalCount: number;
  quorumRequired: number;
  submittedAt: Date;
  expiresAt: Date;
  executedAt?: Date;
  executedBy?: string;
  txHash?: string;
  createdAt: Date;
  updatedAt: Date;
}

const BatchPayrollSchema = new Schema<IBatchPayroll>(
  {
    batchName: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    organizationAddress: {
      type: String,
      required: true,
      lowercase: true,
    },
    creatorAddress: {
      type: String,
      required: true,
      lowercase: true,
    },
    recipients: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        walletAddress: { type: String, required: true, lowercase: true },
        amount: { type: String, required: true },
        employeeName: { type: String, required: true },
      },
    ],
    totalAmount: { type: String, required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "executed", "cancelled", "expired"],
      default: "pending",
      index: true,
    },
    approvals: [
      {
        signerAddress: { type: String, required: true, lowercase: true },
        signerName: { type: String, required: true },
        approvedAt: { type: Date, default: Date.now },
      },
    ],
    approvalCount: { type: Number, default: 0 },
    quorumRequired: { type: Number, required: true },
    submittedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    executedAt: Date,
    executedBy: { type: String, lowercase: true },
    txHash: String,
  },
  {
    timestamps: true,
  }
);

// Indexes
BatchPayrollSchema.index({ organizationId: 1, status: 1, submittedAt: -1 });
BatchPayrollSchema.index({ status: 1, expiresAt: 1 });

export const BatchPayroll = mongoose.model<IBatchPayroll>(
  "BatchPayroll",
  BatchPayrollSchema
);
