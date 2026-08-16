import { ethers } from "ethers";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db, type DbTransaction } from "../db/client.js";
import {
  batchPayrollApprovals,
  batchPayrollRecipients,
  batchPayrolls,
  employeeAuditLogs,
  organizationMembers,
  organizations,
  proposals,
  users,
} from "../db/schema.js";
import type {
  BatchPayroll,
  BatchPayrollApproval,
  BatchPayrollRecipient,
  Organization,
  OrganizationMember,
  User,
} from "../db/types.js";

/** A batch with the rows that used to be embedded arrays on the document. */
export type BatchDetail = BatchPayroll & {
  recipients: BatchPayrollRecipient[];
  approvals: BatchPayrollApproval[];
  approvalCount: number;
};
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { MembershipService } from "./membership.service.js";
import { TokenService } from "./token.service.js";
import { OrganizationService } from "./organization.service.js";
import { CryptoUtil } from "../utils/crypto.util.js";
import { TaxService } from "./tax.service.js";
import logger from "../utils/logger.util.js";
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
  existingWallets: Set<string>;
  existingUsernames: Set<string>;
  generatedUsernames: Set<string>;
  rowIndex: number;
};

export class PayrollService {
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
  ): Promise<{ user: User; source: "username" | "wallet" }> {
    const rawUsername = (data.username || "").trim();
    const rawWallet = (data.walletAddress || "").trim();

    if (rawUsername) {
      const [existingByUsername] = await db
        .select()
        .from(users)
        .where(and(eq(users.username, rawUsername.toLowerCase()), eq(users.isActive, true)))
        .limit(1);

      if (!existingByUsername) {
        throw new Error(`User with username "${rawUsername}" not found`);
      }

      return { user: existingByUsername, source: "username" };
    }

    if (!rawWallet) {
      throw new Error("Wallet address is required when username is not provided");
    }
    if (!data.firstname || !data.surname) {
      throw new Error("Firstname and surname are required when username is not provided");
    }

    const [existingByWallet] = await db
      .select()
      .from(users)
      .where(and(eq(users.walletAddress, rawWallet.toLowerCase()), eq(users.isActive, true)))
      .limit(1);

    if (existingByWallet) {
      return { user: existingByWallet, source: "wallet" };
    }

    const generatedUsername = await this.generateUnregisteredUsername(rawWallet);
    const [created] = await db
      .insert(users)
      .values({
        username: generatedUsername,
        surname: data.surname,
        firstname: data.firstname,
        walletAddress: rawWallet.toLowerCase(),
        fullName: `${data.firstname} ${data.surname}`,
      })
      .returning();

    return { user: created, source: "wallet" };
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

    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

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

  /**
   * Salaries arrive as human amounts and are scaled by the token's decimals.
   *
   * This used to guess: anything at or above 1e10 was assumed to be already
   * scaled, anything below was multiplied by 1e6. That existed because the edit
   * screen scaled client side and the add screen did not, and it only produced
   * the right answer because the token happens to have 6 decimals. Both callers
   * now send the human figure and the conversion happens here.
   */
  private static async normalizeSalaryToChainUnits(salary: string): Promise<string> {
    const trimmed = salary.trim();
    if (!trimmed) return "0";

    try {
      return (await TokenService.parse(trimmed)).toString();
    } catch {
      throw new AppError(`Invalid salary amount: ${salary}`, 400);
    }
  }

  private static async generateUnregisteredUsername(_walletAddress: string): Promise<string> {
    const base = "unregistered";

    let candidate = base;
    let counter = 1;

    // Must be unique across all users, not just this organization.
    while (
      (
        await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.username, candidate))
          .limit(1)
      ).length > 0
    ) {
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

  private static async createNewUser(row: CsvRow, generatedUsername: string) {
    const [created] = await db
      .insert(users)
      .values({
        username: generatedUsername,
        surname: row.surname,
        firstname: row.firstname,
        walletAddress: row.walletAddress,
        fullName: `${row.firstname} ${row.surname}`,
      })
      .returning();

    return created;
  }

  /** Refresh the person's own details from a CSV row, not their employment. */
  private static async updateExistingUser(user: User, row: CsvRow) {
    const surname = row.surname || user.surname;
    const firstname = row.firstname || user.firstname;

    const [updated] = await db
      .update(users)
      .set({
        surname,
        firstname,
        fullName: `${firstname} ${surname}`,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return updated;
  }

  private static async getExistingEmployees(organizationId: string): Promise<{
    existingWallets: Set<string>;
    existingUsernames: Set<string>;
  }> {
    const existing = await MembershipService.listWithUsers(organizationId, "employee");

    return {
      existingWallets: new Set(existing.map((e) => e.member.address)),
      existingUsernames: new Set(
        existing.map((e) => e.user?.username).filter((u): u is string => Boolean(u))
      ),
    };
  }

  private static async processEmployeeRow(
    ctx: ProcessEmployeeRowContext,
    row: CsvRow,
    results: BulkResults
  ): Promise<void> {
    const {
      organizationId,
      existingWallets,
      existingUsernames,
      generatedUsernames,
      rowIndex,
    } = ctx;
    const { walletAddress, surname, firstname } = row;

    try {
      const [found] = await db
        .select()
        .from(users)
        .where(and(eq(users.walletAddress, walletAddress), eq(users.isActive, true)))
        .limit(1);

      let user = found;
      let isNewUser = false;

      if (user) {
        user = await this.updateExistingUser(user, row);
      } else {
        isNewUser = true;

        const walletSuffix = walletAddress.startsWith("0x")
          ? walletAddress.slice(2, 10)
          : walletAddress.slice(0, 8);

        const generatedUsername = this.generateUniqueUsername(
          firstname,
          surname,
          existingUsernames,
          generatedUsernames,
          `unregistered_${walletSuffix}`
        );
        generatedUsernames.add(generatedUsername);
        existingUsernames.add(generatedUsername);

        user = await this.createNewUser(row, generatedUsername);
      }

      // Rejected here if the person already works somewhere else: the unique
      // index on employment raises, and upsert turns it into a 409.
      await MembershipService.upsert({
        organizationId,
        userId: user.id,
        address: walletAddress,
        name: user.fullName,
        role: "employee",
        jobRole: row.jobRole,
        salary: await this.normalizeSalaryToChainUnits(row.salary),
        department: row.department,
        employeeId: row.employeeId,
      });

      existingWallets.add(walletAddress);
      this.recordSuccess(results, walletAddress, isNewUser ? "" : user.username, isNewUser);
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
  ): Promise<Organization> {
    const [existing] = await db
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.contractAddress, data.contractAddress.toLowerCase()),
          eq(organizations.isActive, true)
        )
      )
      .limit(1);

    if (existing) {
      return existing;
    }

    const registrationNumber = this.normalizeIdentifier(
      data.businessInfo?.registrationNumber
    );
    const taxIdentificationNumber = this.normalizeIdentifier(
      data.businessInfo?.taxIdentificationNumber
    );

    await this.assertIdentifiersUnclaimed(registrationNumber, taxIdentificationNumber);

    const slug = await CryptoUtil.generateUniqueSlug(data.name);

    const organizationHash =
      data.organizationHash ||
      CryptoUtil.generateOrganizationHash({
        name: data.name,
        creatorAddress: data.creatorAddress,
        signers: data.signers.map((s) => s.address),
        timestamp: Date.now(),
      });

    // One transaction so a failure part-way cannot leave an organization with
    // no signers, or signers pointing at an organization that does not exist.
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({
          name: data.name,
          slug,
          contractAddress: data.contractAddress.toLowerCase(),
          organizationHash,
          creatorAddress: data.creatorAddress.toLowerCase(),
          businessEmail: data.businessEmail,
          registrationNumber,
          taxIdentificationNumber,
          registrationType: data.businessInfo?.registrationType,
          certificateFileUrl: data.businessInfo?.certificate?.fileUrl,
          certificateFileName: data.businessInfo?.certificate?.fileName,
          certificateUploadedAt: data.businessInfo?.certificate?.uploadedAt,
          quorum: data.quorum,
          industry: data.metadata?.industry,
          size: data.metadata?.size,
          description: data.metadata?.description,
          payrollCurrency: data.settings?.payrollCurrency || "cNGN",
          defaultPaymentDay: data.settings?.defaultPaymentDay,
          timeZone: data.settings?.timeZone || "Africa/Lagos",
        })
        .returning();

      const creatorAddress = data.creatorAddress.toLowerCase();

      // The creator is the owner, everyone else named here is a plain signer.
      // Signing elsewhere is not a reason to reject anyone: one address can be
      // a signer of any number of organizations, on chain and here.
      const byAddress = new Map<string, { name: string; role: "owner" | "signer" }>();
      for (const signer of data.signers) {
        const signerAddress = signer.address.toLowerCase();
        byAddress.set(signerAddress, {
          name: signer.name,
          role: signerAddress === creatorAddress ? "owner" : "signer",
        });
      }

      const accounts = await tx
        .select({
          id: users.id,
          walletAddress: users.walletAddress,
          fullName: users.fullName,
        })
        .from(users)
        .where(inArray(users.walletAddress, [...byAddress.keys(), creatorAddress]));

      const accountByAddress = new Map(accounts.map((a) => [a.walletAddress, a]));

      if (!byAddress.has(creatorAddress)) {
        byAddress.set(creatorAddress, {
          name: accountByAddress.get(creatorAddress)?.fullName ?? "Creator",
          role: "owner",
        });
      }

      await MembershipService.insertMany(
        [...byAddress].map(([memberAddress, member]) => ({
          organizationId: organization.id,
          userId: accountByAddress.get(memberAddress)?.id ?? null,
          address: memberAddress,
          name: member.name,
          role: member.role,
        })),
        tx
      );

      return organization;
    });
  }

  /**
   * Strip punctuation and case so "RC 123456" and "rc-123456" collide.
   * Without this the unique index would happily accept both.
   */
  private static normalizeIdentifier(value?: string): string | null {
    const cleaned = (value ?? "").replaceAll(/[^a-zA-Z0-9]/g, "").toUpperCase();
    return cleaned || null;
  }

  /**
   * A company registration and a TIN each identify one real company, so they
   * are claimed once and never reused, by anyone including the same creator.
   * The unique indexes are the real guard; this exists to name which field
   * clashed instead of surfacing a constraint error.
   */
  private static async assertIdentifiersUnclaimed(
    registrationNumber: string | null,
    taxIdentificationNumber: string | null
  ): Promise<void> {
    const availability = await this.checkIdentifiers({
      registrationNumber: registrationNumber ?? undefined,
      taxIdentificationNumber: taxIdentificationNumber ?? undefined,
    });

    if (!availability.registrationNumberAvailable) {
      throw new AppError(
        "This registration number is already registered to another organization",
        409
      );
    }

    if (!availability.taxIdentificationNumberAvailable) {
      throw new AppError(
        "This tax identification number is already registered to another organization",
        409
      );
    }
  }

  /**
   * Checked live during onboarding so a clash surfaces on the field rather
   * than after the organization has already been created on chain.
   */
  static async checkIdentifiers(input: {
    registrationNumber?: string;
    taxIdentificationNumber?: string;
  }): Promise<{
    registrationNumberAvailable: boolean;
    taxIdentificationNumberAvailable: boolean;
  }> {
    const registrationNumber = this.normalizeIdentifier(input.registrationNumber);
    const taxIdentificationNumber = this.normalizeIdentifier(
      input.taxIdentificationNumber
    );

    const isTaken = async (column: PgColumn, value: string) => {
      const [row] = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(column, value))
        .limit(1);
      return Boolean(row);
    };

    return {
      registrationNumberAvailable: registrationNumber
        ? !(await isTaken(organizations.registrationNumber, registrationNumber))
        : true,
      taxIdentificationNumberAvailable: taxIdentificationNumber
        ? !(await isTaken(organizations.taxIdentificationNumber, taxIdentificationNumber))
        : true,
    };
  }

  /**
   * Get organization by slug
   */
  static async getOrganizationBySlug(slug: string) {
    const organization = await OrganizationService.findBySlug(slug);
    return organization?.isActive ? organization : null;
  }

  /**
   * Organizations an address signs for.
   *
   * A list rather than one row: signing is uncapped, so a founder can hold a
   * seat in more than one organization.
   */
  static async getOrganizationsForSigner(
    signerAddress: string
  ): Promise<Organization[]> {
    const memberships = await MembershipService.signingFor(signerAddress);
    if (memberships.length === 0) return [];

    return db
      .select()
      .from(organizations)
      .where(
        inArray(
          organizations.id,
          memberships.map((m) => m.organizationId)
        )
      )
      .orderBy(desc(organizations.createdAt));
  }

  /**
   * Add employee to organization with role and salary
   */
  static async addEmployee(
    organizationId: string,
    data: AddEmployeeData,
    performedBy?: { userId?: string; username?: string; walletAddress?: string }
  ) {
    const { user, source } = await this.resolveEmployeeUser(data);

    const existing = await MembershipService.employmentFor(user.walletAddress);
    if (existing?.organizationId === organizationId) {
      throw new AppError("User is already an employee of this organization", 409);
    }
    if (existing) {
      throw new AppError("User is already an employee of another organization", 409);
    }

    const [organization] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization) {
      throw new AppError("Organization not found", 404);
    }

    const membership = await MembershipService.upsert({
      organizationId,
      userId: user.id,
      address: user.walletAddress,
      name: user.fullName,
      role: "employee",
      jobRole: data.jobRole,
      salary: await this.normalizeSalaryToChainUnits(data.salary),
      department: data.department,
      employeeId: data.employeeId,
    });

    await db.insert(employeeAuditLogs).values({
      organizationId,
      employeeUserId: user.id,
      employeeUsername: user.username,
      employeeWalletAddress: user.walletAddress,
      action: "ADD",
      performedByUserId: performedBy?.userId,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress?.toLowerCase(),
      changes: {
        jobRole: data.jobRole,
        salary: data.salary,
        department: data.department,
        employeeId: data.employeeId,
        source,
      },
    });

    return { ...user, membership };
  }

  /**
   * Update employment terms.
   *
   * These live on the membership, not the person, so changing a salary here
   * cannot leak into another organization's view of the same user.
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
    const { user, membership } = await this.findEmployee(organizationId, username);

    const updated = await MembershipService.updateEmployment(membership.id, {
      ...(updates.jobRole === undefined ? {} : { jobRole: updates.jobRole }),
      ...(updates.department === undefined ? {} : { department: updates.department }),
      ...(updates.employeeId === undefined ? {} : { employeeId: updates.employeeId }),
      ...(updates.salary
        ? { salary: await this.normalizeSalaryToChainUnits(updates.salary) }
        : {}),
    });

    await db.insert(employeeAuditLogs).values({
      organizationId,
      employeeUserId: user.id,
      employeeUsername: user.username,
      employeeWalletAddress: user.walletAddress,
      action: "UPDATE",
      performedByUserId: performedBy?.userId,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress?.toLowerCase(),
      changes: updates,
    });

    return { ...user, membership: updated };
  }

  private static async findEmployee(
    organizationId: string,
    username: string
  ): Promise<{ user: User; membership: OrganizationMember }> {
    const [row] = await db
      .select({ user: users, membership: organizationMembers })
      .from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, "employee"),
          eq(organizationMembers.isActive, true),
          eq(users.username, username.toLowerCase()),
          eq(users.isActive, true)
        )
      )
      .limit(1);

    if (!row) throw new AppError("Employee not found in this organization", 404);
    return row;
  }

  /**
   * End someone's employment with an organization.
   *
   * Their signer seat, if they hold one, is untouched: the two are separate
   * memberships and losing a job does not remove a governance seat.
   */
  static async removeEmployee(
    organizationId: string,
    username: string,
    performedBy?: { userId?: string; username?: string; walletAddress?: string }
  ) {
    const { user } = await this.findEmployee(organizationId, username);

    const removed = await MembershipService.deactivate(
      organizationId,
      user.walletAddress,
      "employee"
    );

    // Logged with the pre-removal identity, since the membership no longer
    // resolves once the update above lands.
    await db.insert(employeeAuditLogs).values({
      organizationId,
      employeeUserId: user.id,
      employeeUsername: user.username,
      employeeWalletAddress: user.walletAddress,
      action: "REMOVE",
      performedByUserId: performedBy?.userId,
      performedByUsername: performedBy?.username,
      performedByWalletAddress: performedBy?.walletAddress?.toLowerCase(),
    });

    return { ...user, membership: removed };
  }

  /**
   * Employees of an organization, with their employment terms and last audit.
   *
   * `isSigner` is a real lookup rather than a constant: holding a signer seat
   * and being on payroll are separate memberships, and someone can have both.
   */
  static async getOrganizationEmployees(organizationId: string) {
    const organization = await OrganizationService.findById(organizationId);
    if (!organization) {
      throw new AppError("Organization not found", 404);
    }

    const employees = await MembershipService.listWithUsers(organizationId, "employee");
    const { decimals, symbol } = await TokenService.getDefault();
    const signerAddresses = new Set(
      (await MembershipService.signersOf(organizationId)).map((s) => s.address)
    );

    const employeeUserIds = employees
      .map((e) => e.user?.id)
      .filter((id): id is string => Boolean(id));

    // Latest audit entry per employee. DISTINCT ON replaces what was a
    // 100-line aggregation pipeline of $group, $lookup and $ifNull stages.
    // COALESCE fills the actor's username and wallet from the users table when
    // the log did not capture them at the time.
    const audits = employeeUserIds.length
      ? await db.execute<{
          employee_user_id: string;
          action: string;
          created_at: Date;
          performed_by_username: string | null;
          performed_by_wallet_address: string | null;
        }>(sql`
          select distinct on (l.employee_user_id)
            l.employee_user_id,
            l.action,
            l.created_at,
            coalesce(nullif(l.performed_by_username, ''), actor.username, by_wallet.username)
              as performed_by_username,
            coalesce(l.performed_by_wallet_address, actor.wallet_address)
              as performed_by_wallet_address
          from ${employeeAuditLogs} l
          left join ${users} actor on actor.id = l.performed_by_user_id
          left join ${users} by_wallet
            on by_wallet.wallet_address = l.performed_by_wallet_address
          where l.organization_id = ${organizationId}
            and l.employee_user_id in ${employeeUserIds}
          order by l.employee_user_id, l.created_at desc
        `)
      : [];

    const auditByEmployee = new Map(audits.map((a) => [a.employee_user_id, a]));

    return {
      organization: { name: organization.name, slug: organization.slug },
      employees: employees.map(({ member, user }) => {
        const audit = user ? auditByEmployee.get(user.id) : undefined;

        return {
          _id: user?.id ?? member.id,
          username: user?.username ?? "",
          displayUsername: this.getDisplayUsername(user?.username),
          surname: user?.surname ?? "",
          firstname: user?.firstname ?? "",
          fullName: user?.fullName ?? member.name,
          walletAddress: member.address,
          email: user?.email ?? undefined,
          role: "employee",
          isSigner: signerAddresses.has(member.address),
          jobDetails: {
            jobRole: member.jobRole ?? undefined,
            salary: member.salary ?? "0",
            // Formatted here so the browser never has to know the token's
            // precision to render a payslip figure.
            salaryFormatted: ethers.formatUnits(member.salary ?? "0", decimals),
            currency: symbol,
            department: member.department ?? undefined,
            employeeId: member.employeeId ?? undefined,
            joinedAt: member.joinedAt,
          },
          lastAudit: audit
            ? {
                action: audit.action,
                createdAt: audit.created_at,
                performedByUsername: audit.performed_by_username,
                performedByWalletAddress: audit.performed_by_wallet_address,
              }
            : null,
        };
      }),
      totalEmployees: employees.length,
      signersCount: signerAddresses.size,
    };
  }

  /**
   * Get all organizations
   */

  /**
   * Record batch payroll creation in database
   * Frontend calls Dizburza.createBatchPayroll() first
   * Then calls this endpoint to store the record
   */
  static async recordBatchCreation(data: CreateBatchInput): Promise<BatchDetail> {
    const existing = await this.getBatchByName(data.batchName);
    if (existing) return existing;

    const [organization] = await db
      .select({ quorum: organizations.quorum })
      .from(organizations)
      .where(eq(organizations.id, data.organizationId))
      .limit(1);

    if (!organization) {
      throw new Error("Organization not found");
    }

    const totalAmount = data.recipients
      .reduce((sum, recipient) => sum + BigInt(recipient.amount), BigInt(0))
      .toString();

    const submittedAt = new Date();
    // 30 days, matching the smart contract.
    const expiresAt = new Date(submittedAt.getTime() + 30 * 24 * 60 * 60 * 1000);

    await db.transaction(async (tx) => {
      const [batch] = await tx
        .insert(batchPayrolls)
        .values({
          batchName: data.batchName,
          organizationId: data.organizationId,
          organizationAddress: data.organizationAddress.toLowerCase(),
          creatorAddress: data.creatorAddress.toLowerCase(),
          totalAmount,
          quorumRequired: organization.quorum,
          submittedAt,
          expiresAt,
          status: "pending",
        })
        .returning();

      await tx.insert(batchPayrollRecipients).values(
        data.recipients.map((r) => ({
          batchId: batch.id,
          userId: r.userId,
          walletAddress: r.walletAddress.toLowerCase(),
          amount: r.amount,
          employeeName: r.employeeName,
        }))
      );

      if (data.proposalId) {
        await PayrollService.linkSettledProposal(tx, data.proposalId, batch);
      }
    });

    return (await this.getBatchByName(data.batchName))!;
  }

  /**
   * Point a passed proposal at the batch that settles it.
   *
   * Inside the batch's own transaction, so a claim that a proposal was settled
   * cannot outlive the batch it names.
   *
   * A proposal only records that signers agreed to something. Money moves through
   * the batch, which carries its own quorum on chain, so this link is a reference
   * and never an instruction: nothing here reads the proposal's amount or pays
   * anyone. The guards exist so the reference cannot lie.
   */
  private static async linkSettledProposal(
    tx: DbTransaction,
    proposalId: string,
    batch: BatchPayroll
  ): Promise<void> {
    const [proposal] = await tx
      .select({
        id: proposals.id,
        organizationId: proposals.organizationId,
        status: proposals.status,
        settledBatchId: proposals.settledBatchId,
      })
      .from(proposals)
      .where(eq(proposals.id, proposalId))
      .limit(1);

    // 403 rather than 404 for one belonging to another organization: proposal
    // ids are opaque, but answering differently for one that exists is still a
    // disclosure.
    if (!proposal || proposal.organizationId !== batch.organizationId) {
      throw new AppError("You cannot settle that proposal", 403);
    }

    if (proposal.status !== "passed") {
      throw new AppError("Only a proposal that passed can be settled", 409);
    }

    if (proposal.settledBatchId && proposal.settledBatchId !== batch.id) {
      throw new AppError("That proposal has already been settled", 409);
    }

    await tx
      .update(proposals)
      .set({ settledBatchId: batch.id, updatedAt: new Date() })
      .where(eq(proposals.id, proposalId));
  }

  /**
   * Load a batch with its recipients and approvals.
   *
   * approvalCount is a count of the approvals table rather than a stored
   * field, so it cannot drift away from the rows it is meant to describe.
   */
  static async getBatchByName(batchName: string): Promise<BatchDetail | null> {
    const [batch] = await db
      .select()
      .from(batchPayrolls)
      .where(eq(batchPayrolls.batchName, batchName))
      .limit(1);

    if (!batch) return null;
    return this.attachBatchChildren(batch);
  }

  private static async attachBatchChildren(batch: BatchPayroll): Promise<BatchDetail> {
    const [recipients, approvals] = await Promise.all([
      db
        .select()
        .from(batchPayrollRecipients)
        .where(eq(batchPayrollRecipients.batchId, batch.id)),
      db
        .select()
        .from(batchPayrollApprovals)
        .where(eq(batchPayrollApprovals.batchId, batch.id))
        .orderBy(asc(batchPayrollApprovals.approvedAt)),
    ]);

    return { ...batch, recipients, approvals, approvalCount: approvals.length };
  }

  /**
   * Recompute status from the approval count. Called after any approval change
   * so status and approvals can never disagree.
   */
  private static async syncBatchStatus(batchId: string): Promise<void> {
    await db.execute(sql`
      update ${batchPayrolls} b
      set status = case
        when (select count(*) from ${batchPayrollApprovals} a where a.batch_id = b.id)
             >= b.quorum_required then 'approved'::batch_status
        else 'pending'::batch_status
      end,
      updated_at = now()
      where b.id = ${batchId}
        and b.status in ('pending', 'approved')
    `);
  }

  private static async requireBatch(batchName: string): Promise<BatchPayroll> {
    const [batch] = await db
      .select()
      .from(batchPayrolls)
      .where(eq(batchPayrolls.batchName, batchName))
      .limit(1);

    if (!batch) throw new Error("Batch not found");
    return batch;
  }

  static async recordBatchApproval(
    batchName: string,
    signerAddress: string,
    signerName: string
  ): Promise<BatchDetail> {
    const batch = await this.requireBatch(batchName);

    // The unique (batch_id, signer_address) index makes double approval
    // impossible, so an empty result means this signer already approved.
    const inserted = await db
      .insert(batchPayrollApprovals)
      .values({
        batchId: batch.id,
        signerAddress: signerAddress.toLowerCase(),
        signerName,
      })
      .onConflictDoNothing()
      .returning({ id: batchPayrollApprovals.id });

    if (inserted.length === 0) {
      throw new Error("Signer has already approved this batch");
    }

    await this.syncBatchStatus(batch.id);
    return (await this.getBatchByName(batchName))!;
  }

  static async recordBatchApprovalRevocation(
    batchName: string,
    signerAddress: string
  ): Promise<BatchDetail> {
    const batch = await this.requireBatch(batchName);

    if (["executed", "cancelled", "expired"].includes(batch.status)) {
      throw new Error("Batch is finalized");
    }

    const removed = await db
      .delete(batchPayrollApprovals)
      .where(
        and(
          eq(batchPayrollApprovals.batchId, batch.id),
          eq(batchPayrollApprovals.signerAddress, signerAddress.toLowerCase())
        )
      )
      .returning({ id: batchPayrollApprovals.id });

    if (removed.length === 0) {
      throw new Error("Signer has not approved this batch");
    }

    await this.syncBatchStatus(batch.id);
    return (await this.getBatchByName(batchName))!;
  }

  static async recordBatchExecution(
    batchName: string,
    executorAddress: string,
    txHash: string
  ): Promise<BatchDetail> {
    const batch = await this.requireBatch(batchName);
    const executedAt = new Date();

    await db
      .update(batchPayrolls)
      .set({
        status: "executed",
        executedAt,
        executedBy: executorAddress.toLowerCase(),
        txHash,
        updatedAt: executedAt,
      })
      .where(eq(batchPayrolls.id, batch.id));

    // After the status, and outside it. A tax line is a record of a payment that
    // has already happened, so failing to write one must not leave the batch
    // looking unexecuted when the money has moved.
    await TaxService.recordLinesForBatch(batch.id, executedAt).catch((error) => {
      logger.error(`Could not record tax lines for batch ${batchName}:`, error);
    });

    return (await this.getBatchByName(batchName))!;
  }

  static async recordBatchCancellation(batchName: string): Promise<BatchDetail> {
    const batch = await this.requireBatch(batchName);

    await db
      .update(batchPayrolls)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(eq(batchPayrolls.id, batch.id));

    return (await this.getBatchByName(batchName))!;
  }

  static async getBatchesForOrganization(
    organizationId: string,
    status?: string
  ): Promise<Array<BatchDetail & { creatorJobRole: string | null }>> {
    const clauses = [eq(batchPayrolls.organizationId, organizationId)];
    if (status) {
      clauses.push(eq(batchPayrolls.status, status as BatchPayroll["status"]));
    }

    // The creator's title comes from their employment in this organization,
    // not from the person. Pinned to the employee row because someone can hold
    // both a signer seat and a job here, and two rows would duplicate batches.
    const rows = await db
      .select({ batch: batchPayrolls, creatorJobRole: organizationMembers.jobRole })
      .from(batchPayrolls)
      .leftJoin(
        organizationMembers,
        and(
          eq(organizationMembers.address, batchPayrolls.creatorAddress),
          eq(organizationMembers.organizationId, batchPayrolls.organizationId),
          eq(organizationMembers.role, "employee"),
          eq(organizationMembers.isActive, true)
        )
      )
      .where(and(...clauses))
      .orderBy(desc(batchPayrolls.submittedAt));

    const { decimals } = await TokenService.getDefault();

    return Promise.all(
      rows.map(async ({ batch, creatorJobRole }) => ({
        ...(await this.attachBatchChildren(batch)),
        totalAmountFormatted: ethers.formatUnits(batch.totalAmount, decimals),
        creatorJobRole,
      }))
    );
  }

  /**
   * Mark expired batches (cron job or manual trigger)
   */
  static async markExpiredBatches(): Promise<number> {
    const expired = await db
      .update(batchPayrolls)
      .set({ status: "expired", updatedAt: new Date() })
      .where(
        and(
          inArray(batchPayrolls.status, ["pending", "approved"]),
          lt(batchPayrolls.expiresAt, new Date())
        )
      )
      .returning({ id: batchPayrolls.id });

    return expired.length;
  }
}
