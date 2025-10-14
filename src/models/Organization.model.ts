import mongoose, { Schema, Document } from "mongoose";

export interface IOrganization extends Document {
  name: string;
  slug: string;
  contractAddress: string;
  organizationHash: string;
  creatorAddress: string;

  businessEmail: string;
  businessInfo: {
    registrationNumber?: string;
    registrationType?: string;
    certificate?: {
        fileUrl: string;
        fileName: string;
        uploadedAt: Date;
    }
  }

  signers: {
    address: string;
    name: string;
    role: string;
    addedAt: Date;
    isActive: boolean;
  }[];
  quorum: number;
  employees: mongoose.Types.ObjectId[];

  metadata: {
    industry?: string;
    size?: string;
    description?: string;
  };

  settings: {
    payrollCurrency: string;
    defaultPaymentDay?: number;
    timeZone?: string;
  };

  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

const OrganizationSchema = new Schema<IOrganization>(
  {
    name: { type: String, required: true },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    contractAddress: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      index: true,
    },
    organizationHash: {
      type: String,
      required: true,
      unique: true,
    },
    creatorAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    businessEmail: {
      type: String,
      required: true,
      lowercase: true,
    },
    businessInfo: {
      registrationNumber: String,
      registrationType: {
        type: String,
        enum: [
          "Sole Proprietorship",
          "Partnership",
          "Limited Liability Company (Ltd)",
          "Public Limited Company (PLC)",
          "Nonprofit / NGO",
          "Cooperative",
          "Government Owned",
          "Business Name",
        ],
      },
      certificate: {
        fileUrl: String,
        fileName: String,
        uploadedAt: Date,
      },
    },
    signers: [
      {
        address: { type: String, required: true, lowercase: true },
        name: { type: String, required: true },
        role: { type: String, required: true },
        addedAt: { type: Date, default: Date.now },
        isActive: { type: Boolean, default: true },
      },
    ],
    quorum: { type: Number, required: true },
    employees: [
      {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    metadata: {
      industry: {
        type: String,
        enum: [
            "Information Technology",
            "Finance",
            "Healthcare",
            "Agriculture",
            "Education",
            "Media",
            "Industrial Services",
            "Transportation",
            "Tourism",
            "Legal Services",
            "Life Sciences",
            "Manufacturing",
            "Entertainment",
            "Hospitality",
            "Social Impact",
            "Logistics",
        ],
      },
      size: String,
      description: String,
    },
    settings: {
      payrollCurrency: { type: String, default: "cNGN" },
      defaultPaymentDay: Number,
      timeZone: { type: String, default: "Africa/Lagos" },
    },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

OrganizationSchema.index({ "signers.address": 1, "signers.isActive": 1 });
OrganizationSchema.index({ slug: 1, isActive: 1 });

export const Organization = mongoose.model<IOrganization>(
  "Organization",
  OrganizationSchema
);
