import { Organization, IOrganization } from "../models/Organization.model";
import { BatchPayroll, IBatchPayroll } from "../models/BatchPayroll.model";
import { User } from "../models/User.model";
import { CryptoUtil } from "../utils/crypto.util";
import mongoose from "mongoose";
import {
  CreateOrganizationInput,
  CreateBatchInput,
} from "../types/payroll.types";

export class PayrollService {
  /**
   * Create organization record in database
   * Frontend should call DizburzaFactory.createOrganization() first
   * Then call this endpoint to store the record
   */
  static async createOrganization(
    data: CreateOrganizationInput
  ): Promise<IOrganization> {
    const slug = await CryptoUtil.generateUniqueSlug(data.name);

    const organizationHash = CryptoUtil.generateOrganizationHash({
      name: data.name,
      creatorAddress: data.creatorAddress,
      signers: data.signers.map((s) => s.address),
      timestamp: Date.now(),
    });

    const organization = await Organization.create({
      name: data.name,
      slug,
      contractAddress: data.contractAddress.toLowerCase(),
      organizationHash,
      creatorAddress: data.creatorAddress.toLowerCase(),
      businessEmail: data.businessEmail,
      businessInfo: data.businessInfo,
      signers: data.signers.map((s) => ({
        address: s.address.toLowerCase(),
        name: s.name,
        role: s.role,
        addedAt: new Date(),
        isActive: true,
      })),
      quorum: data.quorum,
      employees: [],
      metadata: data.metadata || {},
      settings: data.settings || {
        payrollCurrency: "cNGN",
      },
    });

    // Update all signers
    for (const signer of data.signers) {
      await User.findOneAndUpdate(
        { walletAddress: signer.address.toLowerCase() },
        {
          role: "signer",
          organizationId: organization._id,
          organizationSlug: slug,
        }
      );
    }

    return organization;
  }

  /**
   * Get organization by slug
   */
  static async getOrganizationBySlug(
    slug: string
  ): Promise<IOrganization | null> {
    return await Organization.findOne({ slug, isActive: true }).populate(
      "employees",
      "username fullName walletAddress avatar"
    );
  }

  /**
   * Get organization for signer
   */
  static async getOrganizationForSigner(
    signerAddress: string
  ): Promise<IOrganization | null> {
    return await Organization.findOne({
      "signers.address": signerAddress.toLowerCase(),
      "signers.isActive": true,
      isActive: true,
    });
  }

  /**
   * Add employee to organization
   */
  static async addEmployee(organizationId: string, employeeAddress: string) {
    const user = await User.findOne({
      walletAddress: employeeAddress.toLowerCase(),
    });

    if (!user) {
      throw new Error("User not found");
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    user.organizationId = new mongoose.Types.ObjectId(organizationId);
    user.organizationSlug = organization.slug;
    await user.save();

    await Organization.findByIdAndUpdate(organizationId, {
      $addToSet: { employees: user._id },
    });

    return user;
  }

  /**
   * Get all organizations
   */
  static async getAllOrganizations() {
    return await Organization.find({ isActive: true })
      .select("name slug creatorAddress signers quorum createdAt")
      .sort({ createdAt: -1 });
  }

  /**
   * Record batch payroll creation in database
   * Frontend calls Dizburza.createBatchPayroll() first
   * Then calls this endpoint to store the record
   */
  static async recordBatchCreation(
    data: CreateBatchInput
  ): Promise<IBatchPayroll> {
    // Get organization to fetch quorum
    const organization = await Organization.findById(data.organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Calculate total amount
    const totalAmount = data.recipients
      .reduce((sum, recipient) => sum + BigInt(recipient.amount), BigInt(0))
      .toString();

    // Set expiry (30 days to match smart contract)
    const submittedAt = new Date();
    const expiresAt = new Date(
      submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000
    );

    // Create batch record
    const batch = await BatchPayroll.create({
      batchName: data.batchName,
      organizationId: new mongoose.Types.ObjectId(data.organizationId),
      organizationAddress: data.organizationAddress.toLowerCase(),
      creatorAddress: data.creatorAddress.toLowerCase(),
      recipients: data.recipients.map((r) => ({
        userId: r.userId ? new mongoose.Types.ObjectId(r.userId) : undefined,
        walletAddress: r.walletAddress.toLowerCase(),
        amount: r.amount,
        employeeName: r.employeeName,
      })),
      totalAmount,
      quorumRequired: organization.quorum,
      submittedAt,
      expiresAt,
      status: "pending",
      approvals: [],
      approvalCount: 0,
    });

    return batch;
  }

  /**
   * Record batch approval in database
   * Frontend calls Dizburza.approveBatch() first
   * Then calls this endpoint to update the record
   */
  static async recordBatchApproval(
    batchName: string,
    signerAddress: string,
    signerName: string
  ): Promise<IBatchPayroll> {
    const batch = await BatchPayroll.findOne({ batchName });
    if (!batch) {
      throw new Error("Batch not found");
    }

    // Check if already approved by this signer
    const alreadyApproved = batch.approvals.some(
      (approval) =>
        approval.signerAddress.toLowerCase() === signerAddress.toLowerCase()
    );

    if (alreadyApproved) {
      throw new Error("Signer has already approved this batch");
    }

    // Add approval
    batch.approvals.push({
      signerAddress: signerAddress.toLowerCase(),
      signerName,
      approvedAt: new Date(),
    });
    batch.approvalCount = batch.approvals.length;

    // Check if quorum is reached
    if (batch.approvalCount >= batch.quorumRequired) {
      batch.status = "approved";
    }

    await batch.save();
    return batch;
  }

  /**
   * Record batch execution in database
   * Frontend calls Dizburza.executeBatchPayroll() first
   * Then calls this endpoint to update the record
   */
  static async recordBatchExecution(
    batchName: string,
    executorAddress: string,
    txHash: string
  ): Promise<IBatchPayroll> {
    const batch = await BatchPayroll.findOne({ batchName });
    if (!batch) {
      throw new Error("Batch not found");
    }

    // Mark as executed
    batch.status = "executed";
    batch.executedAt = new Date();
    batch.executedBy = executorAddress.toLowerCase();
    batch.txHash = txHash;

    await batch.save();
    return batch;
  }

  /**
   * Get batches for organization (from database)
   */
  static async getBatchesForOrganization(
    organizationId: string,
    status?: string
  ): Promise<IBatchPayroll[]> {
    const query: any = {
      organizationId: new mongoose.Types.ObjectId(organizationId),
    };

    if (status) {
      query.status = status;
    }

    return (await BatchPayroll.find(query)
      .sort({ submittedAt: -1 })
      .lean()) as unknown as IBatchPayroll[];
  }

  /**
   * Get batch by name (from database)
   */
  static async getBatchByName(
    batchName: string
  ): Promise<IBatchPayroll | null> {
    return await BatchPayroll.findOne({ batchName });
  }

  /**
   * Record batch cancellation in database
   * Frontend calls Dizburza.cancelBatch() first
   * Then calls this endpoint to update the record
   */
  static async recordBatchCancellation(
    batchName: string
  ): Promise<IBatchPayroll> {
    const batch = await BatchPayroll.findOne({ batchName });
    if (!batch) {
      throw new Error("Batch not found");
    }

    batch.status = "cancelled";
    await batch.save();
    return batch;
  }

  /**
   * Mark expired batches (cron job or manual trigger)
   */
  static async markExpiredBatches(): Promise<number> {
    const result = await BatchPayroll.updateMany(
      {
        status: { $in: ["pending", "approved"] },
        expiresAt: { $lt: new Date() },
      },
      {
        $set: { status: "expired" },
      }
    );

    return result.modifiedCount;
  }
}
