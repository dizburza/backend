import mongoose, { Schema, Document } from "mongoose";

export type EmployeeAuditAction = "ADD" | "UPDATE" | "REMOVE";

export interface IEmployeeAuditLog extends Document {
  organizationId: mongoose.Types.ObjectId;
  employeeUserId: mongoose.Types.ObjectId;
  employeeUsername?: string;
  employeeWalletAddress?: string;
  action: EmployeeAuditAction;
  performedByUserId?: mongoose.Types.ObjectId;
  performedByUsername?: string;
  performedByWalletAddress?: string;
  changes?: Record<string, unknown>;
  createdAt: Date;
}

const EmployeeAuditLogSchema = new Schema<IEmployeeAuditLog>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
      index: true,
    },
    employeeUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    employeeUsername: { type: String, index: true },
    employeeWalletAddress: { type: String, lowercase: true, index: true },
    action: {
      type: String,
      enum: ["ADD", "UPDATE", "REMOVE"],
      required: true,
      index: true,
    },
    performedByUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    performedByUsername: { type: String },
    performedByWalletAddress: { type: String, lowercase: true },
    changes: { type: Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

EmployeeAuditLogSchema.index({ organizationId: 1, createdAt: -1 });

export const EmployeeAuditLog = mongoose.model<IEmployeeAuditLog>(
  "EmployeeAuditLog",
  EmployeeAuditLogSchema
);
