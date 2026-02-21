import { Organization, IOrganization } from "../models/Organization.model.js";
import { BatchPayroll, IBatchPayroll } from "../models/BatchPayroll.model.js";
import { User } from "../models/User.model.js";
import { CryptoUtil } from "../utils/crypto.util.js";
import mongoose from "mongoose";
import {
  CreateOrganizationInput,
  CreateBatchInput,
  AddEmployeeData,
} from "../types/payroll.types.js";

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
   * Add employee to organization with role and salary
   */
  static async addEmployee(organizationId: string, data: AddEmployeeData) {
    // Find user by username
    const user = await User.findOne({
      username: data.username.toLowerCase(),
      isActive: true,
    });

    if (!user) {
      throw new Error(`User with username "${data.username}" not found`);
    }

    // Check if user is already in another organization
    if (
      user.organizationId &&
      user.organizationId.toString() !== organizationId
    ) {
      throw new Error(`User is already an employee of another organization`);
    }

    // Check if user is already in this organization
    if (
      user.organizationId?.toString() === organizationId
    ) {
      throw new Error(`User is already an employee of this organization`);
    }

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    // Update user with organization and job details
    user.organizationId = new mongoose.Types.ObjectId(organizationId);
    user.organizationSlug = organization.slug;
    user.jobDetails = {
      jobRole: data.jobRole,
      salary: data.salary,
      department: data.department,
      employeeId: data.employeeId,
      joinedAt: new Date(),
    };
    await user.save();

    // Add to organization's employees array
    await Organization.findByIdAndUpdate(organizationId, {
      $addToSet: { employees: user._id },
    });

    return user;
  }

  /**
   * Update employee details
   */
  static async updateEmployee(
    organizationId: string,
    username: string,
    updates: {
      jobRole?: string;
      salary?: string;
      department?: string;
      employeeId?: string;
    }
  ) {
    const user = await User.findOne({
      username: username.toLowerCase(),
      organizationId: new mongoose.Types.ObjectId(organizationId),
      isActive: true,
    });

    if (!user) {
      throw new Error("Employee not found in this organization");
    }

    // Update job details
    user.jobDetails = {
      ...user.jobDetails,
      ...updates,
    };
    await user.save();

    return user;
  }

  /**
   * Remove employee from organization
   */
  static async removeEmployee(organizationId: string, username: string) {
    const user = await User.findOne({
      username: username.toLowerCase(),
      organizationId: new mongoose.Types.ObjectId(organizationId),
      isActive: true,
    });

    if (!user) {
      throw new Error("Employee not found in this organization");
    }

    // Check if user is a signer
    const organization = await Organization.findById(organizationId);
    if (organization) {
      const isSigner = organization.signers.some(
        (s) => s.address.toLowerCase() === user.walletAddress.toLowerCase()
      );
      if (isSigner) {
        throw new Error(
          "Cannot remove a signer as employee. Remove from signers first."
        );
      }
    }

    // Remove organization details from user
    user.organizationId = undefined;
    user.organizationSlug = undefined;
    user.jobDetails = undefined;
    user.role = "employee";
    await user.save();

    // Remove from organization's employees array
    await Organization.findByIdAndUpdate(organizationId, {
      $pull: { employees: user._id },
    });

    return user;
  }

  /**
   * Get organization employees with full details
   */
  static async getOrganizationEmployees(organizationId: string) {
    const organization = await Organization.findById(organizationId).populate({
      path: "employees",
      select:
        "username fullName surname firstname walletAddress email avatar jobDetails role createdAt",
    });

    if (!organization) {
      throw new Error("Organization not found");
    }

    return {
      organization: {
        name: organization.name,
        slug: organization.slug,
      },
      employees: organization.employees,
      totalEmployees: organization.employees.length,
    };
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
