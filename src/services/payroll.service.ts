import { Organization, IOrganization } from "../models/Organization.model.js";
import { BatchPayroll, IBatchPayroll } from "../models/BatchPayroll.model.js";
import { User } from "../models/User.model.js";
import { EmployeeAuditLog } from "../models/EmployeeAuditLog.model.js";
import { CryptoUtil } from "../utils/crypto.util.js";
import mongoose from "mongoose";
import {
  CreateOrganizationInput,
  CreateBatchInput,
  AddEmployeeData,
} from "../types/payroll.types.js";

// Types for CSV bulk upload processing
interface CsvRow {
  walletAddress: string;
  surname: string;
  firstname: string;
  jobRole: string;
  salary: string;
  department: string;
  employeeId?: string;
}

interface BulkResults {
  added: number;
  errors: Array<{ row: number; walletAddress: string; error: string }>;
  details: Array<{
    walletAddress: string;
    username: string;
    status: "added" | "skipped" | "error";
    isVerified: boolean;
    message?: string;
  }>;
}

type ProcessEmployeeRowContext = {
  organizationId: string;
  organizationSlug: string;
  existingWallets: Set<string>;
  existingUsernames: Set<string>;
  generatedUsernames: Set<string>;
  rowIndex: number;
};

export class PayrollService {
  private static toObjectId(id: unknown): mongoose.Types.ObjectId {
    return new mongoose.Types.ObjectId(String(id));
  }

  private static getDisplayUsername(username?: string): string | undefined {
    if (!username) return username;
    return username.startsWith("unregistered") ? "unregistered" : username;
  }

  private static validateBulkRow(
    row: CsvRow | null,
    rowIndex: number,
    results: BulkResults,
    existingWallets: Set<string>
  ): CsvRow | null {
    if (!row) return null;

    const { walletAddress } = row;

    const missingFields: string[] = [];
    if (!row.surname) missingFields.push("surname");
    if (!row.firstname) missingFields.push("firstname");
    if (!walletAddress) missingFields.push("walletAddress");
    if (!row.salary) missingFields.push("salary");

    if (missingFields.length > 0) {
      this.recordError(
        results,
        rowIndex,
        walletAddress || "",
        `Missing required fields: ${missingFields.join(", ")}`
      );
      return null;
    }

    if (!walletAddress) {
      this.recordError(results, rowIndex, "", "Wallet address is required");
      return null;
    }

    if (existingWallets.has(walletAddress)) {
      this.recordSkipped(
        results,
        walletAddress,
        "",
        "Employee with this wallet address already exists in organization"
      );
      return null;
    }

    return row;
  }

  private static async resolveEmployeeUser(
    data: AddEmployeeData
  ): Promise<{ user: any; isNewUser: boolean; source: "username" | "wallet" }> {
    const rawUsername = (data.username || "").trim();
    const rawWallet = (data.walletAddress || "").trim();

    if (rawUsername) {
      const existingByUsername = await User.findOne({
        username: rawUsername.toLowerCase(),
        isActive: true,
      });

      if (!existingByUsername) {
        throw new Error(`User with username "${rawUsername}" not found`);
      }

      return { user: existingByUsername, isNewUser: false, source: "username" };
    }

    if (!rawWallet) {
      throw new Error("Wallet address is required when username is not provided");
    }
    if (!data.firstname || !data.surname) {
      throw new Error("Firstname and surname are required when username is not provided");
    }

    const existingByWallet = await User.findOne({
      walletAddress: rawWallet.toLowerCase(),
      isActive: true,
    });

    if (existingByWallet) {
      return { user: existingByWallet, isNewUser: false, source: "wallet" };
    }

    const generatedUsername = await this.generateUnregisteredUsername(rawWallet);
    const created = await User.create({
      username: generatedUsername,
      surname: data.surname,
      firstname: data.firstname,
      walletAddress: rawWallet.toLowerCase(),
      fullName: `${data.firstname} ${data.surname}`,
      role: "employee",
      isActive: true,
    });

    return { user: created, isNewUser: true, source: "wallet" };
  }

  /**
   * Generate CSV template for employee bulk upload
   * Username is optional - will be auto-generated if not provided
   */
  static generateEmployeeCSVTemplate(): string {
    const headers = [
      "surname",
      "firstname",
      "walletAddress",
      "jobRole",
      "salary",
      "department",
      "employeeId"
    ].join(",");
    
    const sampleRow = [
      "Doe",
      "John",
      "0x1234567890abcdef1234567890abcdef12345678",
      "Software Engineer",
      "500000",
      "Engineering",
      "EMP001"
    ].join(",");
    
    return `${headers}\n${sampleRow}`;
  }

  /**
   * Bulk add employees from CSV data
   * Uses walletAddress as primary lookup key
   * Auto-generates username if user doesn't exist
   * Marks new users as "unverified" status
   */
  static async bulkAddEmployees(
    organizationId: string,
    csvData: string
  ): Promise<{
    added: number;
    errors: Array<{ row: number; walletAddress: string; error: string }>;
    details: Array<{ walletAddress: string; username: string; status: "added" | "skipped" | "error"; isVerified: boolean; message?: string }>;
  }> {
    const { headers, lines } = this.parseCsvData(csvData);
    this.validateCsvHeaders(headers);

    const results: BulkResults = {
      added: 0,
      errors: [],
      details: [],
    };

    const organization = await Organization.findById(organizationId);
    if (!organization) {
      throw new Error("Organization not found");
    }

    const { existingWallets, existingUsernames } = await this.getExistingEmployees(organizationId);
    const generatedUsernames = new Set<string>();

    for (let i = 1; i < lines.length; i++) {
      const row = this.validateBulkRow(this.parseCsvRow(lines[i], headers), i, results, existingWallets);
      if (!row) continue;

      await this.processEmployeeRow(
        {
          organizationId,
          organizationSlug: organization.slug,
          existingWallets,
          existingUsernames,
          generatedUsernames,
          rowIndex: i,
        },
        row,
        results
      );
    }

    return results;
  }

  // Private helper methods for CSV processing

  private static parseCsvData(csvData: string): { headers: string[]; lines: string[] } {
    const lines = csvData.trim().split("\n");
    if (lines.length < 2) {
      throw new Error("CSV must have at least a header row and one data row");
    }
    const headers = lines[0].toLowerCase().split(",").map((h) => h.trim());
    return { headers, lines };
  }

  private static validateCsvHeaders(headers: string[]): void {
    const requiredFields = ["surname", "firstname", "walletaddress"];
    const missingFields = requiredFields.filter((f) => !headers.includes(f));
    if (missingFields.length > 0) {
      throw new Error(`Missing required fields: ${missingFields.join(", ")}`);
    }
  }

  private static parseCsvRow(line: string, headers: string[]): CsvRow | null {
    const trimmed = line.trim();
    if (!trimmed) return null;
    const values = trimmed.split(",").map((v) => v.trim());
    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = values[index] || "";
    });
    return {
      walletAddress: rowData.walletaddress?.toLowerCase() || "",
      surname: rowData.surname,
      firstname: rowData.firstname,
      jobRole: rowData.jobrole || "Employee",
      salary: rowData.salary || "0",
      department: rowData.department || "General",
      employeeId: rowData.employeeid,
    };
  }

  private static generateUniqueUsername(
    firstname: string,
    surname: string,
    existingUsernames: Set<string>,
    generatedUsernames: Set<string>,
    rowDataUsername?: string
  ): string {
    const baseUsername =
      rowDataUsername ||
      `${firstname.toLowerCase()}.${surname.toLowerCase()}`.replaceAll(/[^a-z0-9.]/g, "");
    let username = baseUsername;
    let counter = 1;
    while (existingUsernames.has(username) || generatedUsernames.has(username)) {
      username = `${baseUsername}${counter}`;
      counter++;
    }
    return username;
  }

  private static recordError(
    results: BulkResults,
    row: number,
    walletAddress: string,
    errorMsg: string
  ): void {
    results.errors.push({ row, walletAddress, error: errorMsg });
    results.details.push({
      walletAddress,
      username: "",
      status: "error",
      isVerified: false,
      message: errorMsg,
    });
  }

  private static recordSuccess(
    results: BulkResults,
    walletAddress: string,
    username: string,
    isNewUser: boolean
  ): void {
    results.added++;
    results.details.push({
      walletAddress,
      username: username || "",
      status: "added",
      isVerified: !isNewUser,
      message: isNewUser ? "User not registered (unverified)" : "Existing user added",
    });
  }

  private static normalizeSalaryToChainUnits(salary: string): string {
    const trimmed = salary.trim();
    if (!trimmed) return "0";

    const asBigInt = BigInt(trimmed);

    // Heuristic:
    // - If salary is already scaled for chain (>= 1e10), keep as-is.
    // - Otherwise multiply by 1e6 (human amount -> chain units).
    const CHAIN_THRESHOLD = 10_000_000_000n;
    if (asBigInt >= CHAIN_THRESHOLD) return asBigInt.toString();

    return (asBigInt * 1_000_000n).toString();
  }

  private static async generateUnregisteredUsername(_walletAddress: string): Promise<string> {
    const base = "unregistered";

    let candidate = base;
    let counter = 1;

    // Ensure uniqueness across the entire User collection
    while (await User.exists({ username: candidate })) {
      counter++;
      candidate = `${base}${counter}`;
    }

    return candidate;
  }

  private static recordSkipped(
    results: BulkResults,
    walletAddress: string,
    username: string,
    message: string
  ): void {
    results.details.push({
      walletAddress,
      username: username || "",
      status: "skipped",
      isVerified: true,
      message,
    });
  }

  private static async createNewUser(
    organizationId: string,
    organizationSlug: string,
    row: CsvRow,
    generatedUsername: string
  ) {
    return await User.create({
      username: generatedUsername,
      surname: row.surname,
      firstname: row.firstname,
      walletAddress: row.walletAddress,
      fullName: `${row.firstname} ${row.surname}`,
      role: "employee",
      organizationId: this.toObjectId(organizationId),
      organizationSlug,
      jobDetails: {
        jobRole: row.jobRole,
        salary: this.normalizeSalaryToChainUnits(row.salary),
        department: row.department,
        employeeId: row.employeeId,
        joinedAt: new Date(),
      },
    });
  }

  private static async updateExistingUser(
    user: any,
    organizationId: string,
    organizationSlug: string,
    row: CsvRow
  ) {
    user.organizationId = this.toObjectId(organizationId);
    user.organizationSlug = organizationSlug;
    user.surname = row.surname || user.surname;
    user.firstname = row.firstname || user.firstname;
    user.fullName = `${row.firstname || user.firstname} ${row.surname || user.surname}`;
    user.jobDetails = {
      jobRole: row.jobRole,
      salary: this.normalizeSalaryToChainUnits(row.salary),
      department: row.department,
      employeeId: row.employeeId,
      joinedAt: new Date(),
    };
    await user.save();
  }

  private static async addEmployeeToOrganization(
    organizationId: string,
    userId: mongoose.Types.ObjectId,
    walletAddress: string,
    existingWallets: Set<string>
  ): Promise<void> {
    await Organization.findByIdAndUpdate(this.toObjectId(organizationId), {
      $addToSet: { employees: userId },
    });
    existingWallets.add(walletAddress);
  }

  private static async getExistingEmployees(organizationId: string): Promise<{
    existingWallets: Set<string>;
    existingUsernames: Set<string>;
  }> {
    const existingEmployees = await User.find({
      organizationId: this.toObjectId(organizationId),
      isActive: true,
    }).select("walletAddress username");

    const existingWallets: Set<string> = new Set<string>(
      existingEmployees
        .map((e) => e.walletAddress?.toLowerCase())
        .filter((v): v is string => Boolean(v))
    );
    const existingUsernames: Set<string> = new Set<string>(
      existingEmployees
        .map((e) => e.username?.toLowerCase())
        .filter((v): v is string => Boolean(v))
    );

    return { existingWallets, existingUsernames };
  }

  private static async processEmployeeRow(
    ctx: ProcessEmployeeRowContext,
    row: CsvRow,
    results: BulkResults
  ): Promise<void> {
    const {
      organizationId,
      organizationSlug,
      existingWallets,
      existingUsernames,
      generatedUsernames,
      rowIndex,
    } = ctx;
    const { walletAddress, surname, firstname } = row;

    try {
      let user = await User.findOne({ walletAddress, isActive: true });
      let isNewUser = false;

      if (user) {
        if (user.organizationId && user.organizationId.toString() !== organizationId) {
          throw new Error("User is already an employee of another organization");
        }

        if (user.organizationId?.toString() === organizationId) {
          results.details.push({
            walletAddress,
            username: user.username || "",
            status: "skipped",
            isVerified: true,
            message: "User already in this organization",
          });
          return;
        }

        await this.updateExistingUser(user, organizationId, organizationSlug, row);
      } else {
        isNewUser = true;

        const walletSuffix = walletAddress.startsWith("0x")
          ? walletAddress.slice(2, 10)
          : walletAddress.slice(0, 8);

        const generatedUsername = this.generateUniqueUsername(
          firstname,
          surname,
          existingUsernames,
          generatedUsernames
          ,
          `unregistered_${walletSuffix}`
        );
        generatedUsernames.add(generatedUsername);
        existingUsernames.add(generatedUsername);

        user = await this.createNewUser(organizationId, organizationSlug, row, generatedUsername);
      }

      await this.addEmployeeToOrganization(organizationId, user._id, walletAddress, existingWallets);
      this.recordSuccess(results, walletAddress, isNewUser ? "" : (user.username || ""), isNewUser);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Unknown error";
      this.recordError(results, rowIndex, walletAddress, errorMsg);
    }
  }

  /**
   * Create organization record in database
   * Frontend should call DizburzaFactory.createOrganization() first
   * Then call this endpoint to store the record
   */
  static async createOrganization(
    data: CreateOrganizationInput
  ): Promise<IOrganization> {
    const existing = await Organization.findOne({
      contractAddress: data.contractAddress.toLowerCase(),
      isActive: true,
    });

    if (existing) {
      return existing;
    }

    const slug = await CryptoUtil.generateUniqueSlug(data.name);

    const organizationHash =
      data.organizationHash ||
      CryptoUtil.generateOrganizationHash({
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
  static async addEmployee(
    organizationId: string,
    data: AddEmployeeData,
    performedBy?: { userId?: string; username?: string; walletAddress?: string }
  ) {
    const { user, isNewUser, source } = await this.resolveEmployeeUser(data);

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
    user.organizationId = this.toObjectId(organizationId);
    user.organizationSlug = organization.slug;
    if (isNewUser) {
      user.role = "employee";
    }
    user.jobDetails = {
      jobRole: data.jobRole,
      salary: this.normalizeSalaryToChainUnits(data.salary),
      department: data.department,
      employeeId: data.employeeId,
      joinedAt: new Date(),
    };
    await user.save();

    // Add to organization's employees array
    await Organization.findByIdAndUpdate(organizationId, {
      $addToSet: { employees: user._id },
    });

    await EmployeeAuditLog.create({
      organizationId: this.toObjectId(organizationId),
      employeeUserId: user._id,
      employeeUsername: user.username,
      employeeWalletAddress: user.walletAddress,
      action: "ADD",
      performedByUserId: performedBy?.userId ? this.toObjectId(performedBy.userId) : undefined,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress,
      changes: {
        jobRole: data.jobRole,
        salary: data.salary,
        department: data.department,
        employeeId: data.employeeId,
        source,
      },
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
    },
    performedBy?: { userId?: string; username?: string; walletAddress?: string }
  ) {
    const user = await User.findOne({
      username: username.toLowerCase(),
      organizationId: this.toObjectId(organizationId),
      isActive: true,
    });

    if (!user) {
      throw new Error("Employee not found in this organization");
    }

    // Update job details
    user.jobDetails = {
      ...user.jobDetails,
      ...updates,
      ...(updates.salary ? { salary: this.normalizeSalaryToChainUnits(updates.salary) } : {}),
    };
    await user.save();

    await EmployeeAuditLog.create({
      organizationId: this.toObjectId(organizationId),
      employeeUserId: user._id,
      employeeUsername: user.username,
      employeeWalletAddress: user.walletAddress,
      action: "UPDATE",
      performedByUserId: performedBy?.userId ? this.toObjectId(performedBy.userId) : undefined,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress,
      changes: updates,
    });

    return user;
  }

  /**
   * Remove employee from organization
   */
  static async removeEmployee(
    organizationId: string,
    username: string,
    performedBy?: { userId?: string; username?: string; walletAddress?: string }
  ) {
    const user = await User.findOne({
      username: username.toLowerCase(),
      organizationId: this.toObjectId(organizationId),
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
    const prevUsername = user.username;
    const prevWallet = user.walletAddress;
    user.organizationId = undefined;
    user.organizationSlug = undefined;
    user.jobDetails = undefined;
    user.role = "employee";
    await user.save();

    // Remove from organization's employees array
    await Organization.findByIdAndUpdate(organizationId, {
      $pull: { employees: user._id },
    });

    await EmployeeAuditLog.create({
      organizationId: this.toObjectId(organizationId),
      employeeUserId: user._id,
      employeeUsername: prevUsername,
      employeeWalletAddress: prevWallet,
      action: "REMOVE",
      performedByUserId: performedBy?.userId ? this.toObjectId(performedBy.userId) : undefined,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress,
    });

    return user;
  }

  /**
   * Get organization employees with full details
   * Returns only regular employees (not signers)
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

    // Get active signers for reference (not included in employee list)
    const activeSigners = organization.signers.filter(s => s.isActive);

    // Return only regular employees (signers are managed separately)
    const baseEmployees = (organization.employees as any[]).map((e: any) => ({
      ...e.toObject?.() || e,
      isSigner: false,
    }));

    const employeeIds = baseEmployees
      .map((e: any) => e?._id)
      .filter(Boolean)
      .map((id: any) => this.toObjectId(id));

    const lastAudits = employeeIds.length
      ? await EmployeeAuditLog.aggregate([
          {
            $match: {
              organizationId: this.toObjectId(organizationId),
              employeeUserId: { $in: employeeIds },
            },
          },
          { $sort: { createdAt: -1 } },
          {
            $group: {
              _id: "$employeeUserId",
              action: { $first: "$action" },
              createdAt: { $first: "$createdAt" },
              performedByUserId: { $first: "$performedByUserId" },
              performedByUsername: { $first: "$performedByUsername" },
              performedByWalletAddress: { $first: "$performedByWalletAddress" },
            },
          },
          {
            $lookup: {
              from: "users",
              localField: "performedByUserId",
              foreignField: "_id",
              as: "performedByUser",
            },
          },
          {
            $addFields: {
              performedByUser: { $arrayElemAt: ["$performedByUser", 0] },
            },
          },
          {
            $addFields: {
              performedByWalletAddress: {
                $ifNull: ["$performedByWalletAddress", "$performedByUser.walletAddress"],
              },
            },
          },
          {
            $lookup: {
              from: "users",
              let: { performedByWallet: "$performedByWalletAddress" },
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $ne: ["$$performedByWallet", null] },
                        { $eq: ["$walletAddress", "$$performedByWallet"] },
                      ],
                    },
                  },
                },
                { $project: { username: 1, walletAddress: 1 } },
              ],
              as: "performedByWalletUser",
            },
          },
          {
            $addFields: {
              performedByWalletUser: { $arrayElemAt: ["$performedByWalletUser", 0] },
            },
          },
          {
            $addFields: {
              performedByUsername: {
                $ifNull: [
                  {
                    $cond: [
                      {
                        $or: [
                          { $eq: ["$performedByUsername", null] },
                          { $eq: ["$performedByUsername", ""] },
                        ],
                      },
                      null,
                      "$performedByUsername",
                    ],
                  },
                  {
                    $ifNull: ["$performedByUser.username", "$performedByWalletUser.username"],
                  },
                ],
              },
            },
          },
          {
            $project: {
              performedByUser: 0,
              performedByWalletUser: 0,
            },
          },
        ])
      : [];

    const auditByEmployeeId = new Map(
      lastAudits.map((a: any) => [String(a._id), a])
    );

    const employees = baseEmployees.map((e: any) => {
      const audit = auditByEmployeeId.get(String(e._id));
      return {
        ...e,
        displayUsername: this.getDisplayUsername(e.username),
        lastAudit: audit
          ? {
              action: audit.action,
              createdAt: audit.createdAt,
              performedByUsername: audit.performedByUsername,
              performedByWalletAddress: audit.performedByWalletAddress,
            }
          : null,
      };
    });

    return {
      organization: {
        name: organization.name,
        slug: organization.slug,
      },
      employees,
      totalEmployees: employees.length,
      signersCount: activeSigners.length,
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
    const existing = await BatchPayroll.findOne({ batchName: data.batchName });
    if (existing) {
      return existing;
    }

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
      organizationId: this.toObjectId(data.organizationId),
      organizationAddress: data.organizationAddress.toLowerCase(),
      creatorAddress: data.creatorAddress.toLowerCase(),
      recipients: data.recipients.map((r) => ({
        userId: r.userId ? this.toObjectId(r.userId) : undefined,
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
   * Record batch approval revocation in database
   * Frontend calls Dizburza.revokeBatchApproval() first
   * Then calls this endpoint to update the record
   */
  static async recordBatchApprovalRevocation(
    batchName: string,
    signerAddress: string
  ): Promise<IBatchPayroll> {
    const batch = await BatchPayroll.findOne({ batchName });
    if (!batch) {
      throw new Error("Batch not found");
    }

    if (batch.status === "executed" || batch.status === "cancelled" || batch.status === "expired") {
      throw new Error("Batch is finalized");
    }

    const normalizedSigner = signerAddress.toLowerCase();
    const beforeCount = batch.approvals.length;
    batch.approvals = batch.approvals.filter(
      (approval) => approval.signerAddress.toLowerCase() !== normalizedSigner
    );

    if (batch.approvals.length === beforeCount) {
      throw new Error("Signer has not approved this batch");
    }

    batch.approvalCount = batch.approvals.length;

    if (batch.approvalCount >= batch.quorumRequired) {
      batch.status = "approved";
    } else {
      batch.status = "pending";
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
      organizationId: this.toObjectId(organizationId),
    };

    if (status) {
      query.status = status;
    }

    const batches = await BatchPayroll.aggregate([
      { $match: query },
      { $sort: { submittedAt: -1 } },
      {
        $lookup: {
          from: "users",
          localField: "creatorAddress",
          foreignField: "walletAddress",
          as: "creatorUser",
        },
      },
      {
        $addFields: {
          creatorUser: { $arrayElemAt: ["$creatorUser", 0] },
        },
      },
      {
        $addFields: {
          creatorJobRole: "$creatorUser.jobDetails.jobRole",
        },
      },
      {
        $project: {
          creatorUser: 0,
        },
      },
    ]);

    return batches as unknown as IBatchPayroll[];
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
