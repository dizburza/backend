import mongoose, { Schema, Document } from "mongoose";

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  walletAddress: string;
  username?: string;
  surname: string;
  firstname: string;
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  avatar?: string;
  role: "employee" | "signer" | "admin";
  organizationId?: mongoose.Types.ObjectId;
  organizationSlug?: string;

  jobDetails?: {
    jobRole?: string;
    salary?: string;
    department?: string;
    joinedAt?: Date;
    employeeId?: string;
  };

  profile: {
    dateOfBirth?: Date;
    address?: string;
    city?: string;
    country?: string;
  };

  settings: {
    currency: string;
    notifications: boolean;
    language: string;
    timezone: string;
  };

  authNonce?: string;
  lastLoginAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

const UserSchema = new Schema<IUser>(
  {
    walletAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    surname: { type: String, required: true },
    firstname: { type: String, required: true },
    fullName: { type: String, required: true },
    email: { type: String, lowercase: true },
    phoneNumber: { type: String },
    avatar: { type: String },
    role: {
      type: String,
      enum: ["employee", "signer", "admin"],
      default: "employee",
      index: true,
    },
    organizationId: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      index: true,
    },
    organizationSlug: { type: String, index: true },
    jobDetails: {
      jobRole: String,
      salary: String,
      department: String,
      joinedAt: Date,
      employeeId: String,
    },
    profile: {
      dateOfBirth: Date,
      address: String,
      city: String,
      country: { type: String, default: "Nigeria" },
    },
    settings: {
      currency: { type: String, default: "cNGN" },
      notifications: { type: Boolean, default: true },
      language: { type: String, default: "en" },
      timezone: { type: String, default: "Africa/Lagos" },
    },
    authNonce: String,
    lastLoginAt: Date,
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

UserSchema.index({ walletAddress: 1, isActive: 1 });
UserSchema.index({ email: 1 });
UserSchema.index({ organizationId: 1, "jobDetails.jobRole": 1 });

export const User = mongoose.model<IUser>("User", UserSchema);
