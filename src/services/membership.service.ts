import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizationMembers, organizations, users } from "../db/schema.js";
import type { MembershipRole, OrganizationMember } from "../db/types.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { isUniqueViolation } from "../utils/pgError.util.js";

export type MembershipWithOrganization = OrganizationMember & {
  organizationSlug: string;
  organizationName: string;
};

/**
 * The one place membership is read and written.
 *
 * Employment and signing have different rules, so both go through here rather
 * than being open-coded in each service: employment is capped at one and the
 * database enforces it, signing is uncapped and only deduplicated per
 * organization.
 */
export class MembershipService {
  private static readonly withOrganization = {
    id: organizationMembers.id,
    organizationId: organizationMembers.organizationId,
    userId: organizationMembers.userId,
    address: organizationMembers.address,
    email: organizationMembers.email,
    phone: organizationMembers.phone,
    status: organizationMembers.status,
    name: organizationMembers.name,
    role: organizationMembers.role,
    jobRole: organizationMembers.jobRole,
    salary: organizationMembers.salary,
    department: organizationMembers.department,
    employeeId: organizationMembers.employeeId,
    salaryIsGross: organizationMembers.salaryIsGross,
    isActive: organizationMembers.isActive,
    joinedAt: organizationMembers.joinedAt,
    removedAt: organizationMembers.removedAt,
    organizationSlug: organizations.slug,
    organizationName: organizations.name,
  };

  /** Every active membership for an address, across all organizations. */
  static async forAddress(walletAddress: string): Promise<MembershipWithOrganization[]> {
    return db
      .select(this.withOrganization)
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          eq(organizationMembers.isActive, true),
          eq(organizations.isActive, true)
        )
      )
      .orderBy(desc(organizationMembers.joinedAt));
  }

  /** The single employment, if the address has one. */
  static async employmentFor(
    walletAddress: string
  ): Promise<MembershipWithOrganization | null> {
    const [row] = await db
      .select(this.withOrganization)
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          eq(organizationMembers.role, "employee"),
          eq(organizationMembers.isActive, true),
          eq(organizations.isActive, true)
        )
      )
      .limit(1);

    return row ?? null;
  }

  /** Organizations the address signs for, which may be more than one. */
  static async signingFor(walletAddress: string): Promise<MembershipWithOrganization[]> {
    return db
      .select(this.withOrganization)
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          inArray(organizationMembers.role, ["owner", "signer"]),
          eq(organizationMembers.isActive, true),
          eq(organizations.isActive, true)
        )
      )
      .orderBy(desc(organizationMembers.joinedAt));
  }

  /**
   * Every address this person may read financial history for: their own wallet,
   * and the treasury of each organization they sign for.
   *
   * Employment is deliberately not included. An employee's own wallet shows
   * their pay; the treasury would show everyone else's, plus the bank details
   * on each line.
   */
  static async readableAddresses(walletAddress: string): Promise<Set<string>> {
    const self = walletAddress.toLowerCase();

    const rows = await db
      .select({ contractAddress: organizations.contractAddress })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(
        and(
          eq(organizationMembers.address, self),
          inArray(organizationMembers.role, ["owner", "signer"]),
          eq(organizationMembers.isActive, true),
          eq(organizations.isActive, true)
        )
      );

    return new Set([self, ...rows.map((r) => r.contractAddress.toLowerCase())]);
  }

  static async isSignerOf(organizationId: string, walletAddress: string): Promise<boolean> {
    const [row] = await db
      .select({ id: organizationMembers.id })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          inArray(organizationMembers.role, ["owner", "signer"]),
          eq(organizationMembers.isActive, true)
        )
      )
      .limit(1);

    return Boolean(row);
  }

  static async listByOrganization(
    organizationId: string,
    role?: MembershipRole | MembershipRole[]
  ): Promise<OrganizationMember[]> {
    const roles = role === undefined ? undefined : [role].flat();

    return db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.isActive, true),
          roles ? inArray(organizationMembers.role, roles) : undefined
        )
      )
      .orderBy(desc(organizationMembers.joinedAt));
  }

  /** Signers of an organization, in the shape the session payload expects. */
  static async signersOf(organizationId: string): Promise<OrganizationMember[]> {
    return this.listByOrganization(organizationId, ["owner", "signer"]);
  }

  /**
   * Add or reactivate a membership.
   *
   * Reactivation rather than a second row, so a person rehired by the same
   * organization keeps one membership record instead of accumulating them.
   */
  static async upsert(
    values: {
      organizationId: string;
      address: string;
      name: string;
      role: MembershipRole;
      userId?: string | null;
      email?: string | null;
      jobRole?: string | null;
      salary?: string | null;
      department?: string | null;
      employeeId?: string | null;
      salaryIsGross?: boolean;
    },
    tx: Pick<typeof db, "insert"> = db
  ): Promise<OrganizationMember> {
    const address = values.address.toLowerCase();

    try {
      const [row] = await tx
        .insert(organizationMembers)
        .values({ ...values, address })
        .onConflictDoUpdate({
          target: [
            organizationMembers.organizationId,
            organizationMembers.address,
            organizationMembers.role,
          ],
          set: {
            name: values.name,
            userId: values.userId ?? null,
            email: values.email ?? null,
            jobRole: values.jobRole ?? null,
            salary: values.salary ?? null,
            department: values.department ?? null,
            employeeId: values.employeeId ?? null,
            salaryIsGross: values.salaryIsGross ?? true,
            isActive: true,
            removedAt: null,
            joinedAt: new Date(),
          },
        })
        .returning();

      return row;
    } catch (err) {
      if (isUniqueViolation(err, "single_employment")) {
        throw new AppError(
          "This person is already employed by another organization",
          409
        );
      }
      throw err;
    }
  }

  /**
   * The founding signer set, written in the same transaction as the
   * organization so a half-created organization cannot exist.
   *
   * Bulk rather than repeated `upsert` because the caller has already collapsed
   * duplicates by address and the organization is new, so there is nothing to
   * conflict with.
   */
  static async insertMany(
    values: Array<{
      organizationId: string;
      address: string;
      name: string;
      role: MembershipRole;
      userId?: string | null;
      email?: string | null;
    }>,
    tx: Pick<typeof db, "insert"> = db
  ): Promise<void> {
    if (values.length === 0) return;

    await tx
      .insert(organizationMembers)
      .values(values.map((v) => ({ ...v, address: v.address.toLowerCase() })));
  }

  /** Employment terms, which live on the membership rather than the person. */
  static async updateEmployment(
    membershipId: string,
    updates: {
      jobRole?: string;
      department?: string;
      employeeId?: string;
      salary?: string;
    }
  ): Promise<OrganizationMember | null> {
    const [row] = await db
      .update(organizationMembers)
      .set(updates)
      .where(eq(organizationMembers.id, membershipId))
      .returning();

    return row ?? null;
  }

  /** Soft removal, so audit logs and past payroll still resolve the name. */
  static async deactivate(
    organizationId: string,
    walletAddress: string,
    role: MembershipRole
  ): Promise<OrganizationMember | null> {
    const [row] = await db
      .update(organizationMembers)
      .set({ isActive: false, removedAt: new Date() })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          eq(organizationMembers.role, role),
          eq(organizationMembers.isActive, true)
        )
      )
      .returning();

    return row ?? null;
  }

  /**
   * Undo a deactivation, restoring the terms that were already on the row.
   *
   * This is the reactivate path, not upsert: upsert overwrites job role,
   * salary, department and employee id with whatever the caller passes, which
   * is right for re-adding someone under new terms but wrong for undoing a
   * suspension, where the point is that nothing about their employment changed.
   */
  static async reactivate(
    organizationId: string,
    walletAddress: string,
    role: MembershipRole
  ): Promise<OrganizationMember | null> {
    const [row] = await db
      .update(organizationMembers)
      .set({ isActive: true, removedAt: null })
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.address, walletAddress.toLowerCase()),
          eq(organizationMembers.role, role),
          eq(organizationMembers.isActive, false)
        )
      )
      .returning();

    return row ?? null;
  }

  /**
   * Attach a newly registered user to memberships created before they signed up.
   *
   * Signers are named by address during setup, often before the person has an
   * account, so the link is made here rather than being lost. The email goes
   * on too: a signer's row otherwise never gets one, and without it someone
   * typing that signer's email into an invite link is told "not on the staff
   * list" instead of the truth, that the row exists and is already theirs.
   */
  static async linkUser(userId: string, walletAddress: string, email?: string | null): Promise<void> {
    const address = walletAddress.toLowerCase();

    await db
      .update(organizationMembers)
      .set({ userId })
      .where(and(eq(organizationMembers.address, address), sql`${organizationMembers.userId} is null`));

    // Separate from the update above: only a row with no email of its own
    // gets this one, so a signer's personal email never overwrites whatever
    // HR seeded an employee row with.
    if (email) {
      await db
        .update(organizationMembers)
        .set({ email })
        .where(
          and(
            eq(organizationMembers.address, address),
            eq(organizationMembers.userId, userId),
            sql`${organizationMembers.email} is null`
          )
        );
    }
  }

  /**
   * Members joined to their user rows, for lists that show people.
   *
   * `includeInactive` stays false everywhere but the employee roster: a
   * suspended employee has to be findable to be reactivated, but nothing else
   * that lists members, signer sets, payroll recipients, should start counting
   * someone who was removed.
   */
  static async listWithUsers(
    organizationId: string,
    role: MembershipRole,
    includeInactive = false
  ) {
    return db
      .select({
        member: organizationMembers,
        user: {
          id: users.id,
          username: users.username,
          fullName: users.fullName,
          firstname: users.firstname,
          surname: users.surname,
          avatar: users.avatar,
          email: users.email,
          phoneNumber: users.phoneNumber,
          walletAddress: users.walletAddress,
          taxStateCode: users.taxStateCode,
        },
      })
      .from(organizationMembers)
      .leftJoin(users, eq(users.id, organizationMembers.userId))
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, role),
          includeInactive ? undefined : eq(organizationMembers.isActive, true)
        )
      )
      .orderBy(desc(organizationMembers.joinedAt));
  }
}
