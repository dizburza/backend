import { Organization, IOrganization } from "../models/Organization.model";
import { User } from "../models/User.model";
import { CryptoUtil } from "../utils/crypto.util";
import {
  CreateOrganizationInput,
  OrganizationData,
} from "../types/payroll.types";

export class PayrollService {
  /**
   * Create organization
   */
  static async createOrganization(
    input: CreateOrganizationInput
  ): Promise<IOrganization> {
    const slug = await CryptoUtil.generateUniqueSlug(input.name);

    const organizationHash = CryptoUtil.generateOrganizationHash({
      name: input.name,
      creatorAddress: input.creatorAddress,
      signers: input.signers.map((s) => s.address),
      timestamp: Date.now(),
    });

    // Construct full data for storage
    const orgData: OrganizationData = {
      ...input,
      slug,
      organizationHash,
    };

    // Create organization with all fields
    const organization = await Organization.create({
      name: orgData.name,
      slug: orgData.slug,
      contractAddress: orgData.contractAddress.toLowerCase(),
      organizationHash: orgData.organizationHash,
      creatorAddress: orgData.creatorAddress.toLowerCase(),
      businessEmail: orgData.businessEmail,
      businessInfo: orgData.businessInfo,
      signers: orgData.signers.map((s) => ({
        address: s.address.toLowerCase(),
        name: s.name,
        role: s.role,
        addedAt: new Date(),
        isActive: true,
      })),
      quorum: orgData.quorum,
      employees: [],
      metadata: orgData.metadata || {},
      settings: orgData.settings || {
        payrollCurrency: "cNGN",
      },
    });

    // Update all signers
    for (const signer of orgData.signers) {
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

    user.organizationId = organizationId as any;
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
}
