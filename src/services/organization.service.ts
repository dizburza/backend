import { and, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";
import type { Organization, OrganizationMember } from "../db/types.js";
import { MembershipService } from "./membership.service.js";

export type OrganizationEmployee = {
  id: string | null;
  /**
   * Read from the joined user row, not stored on the membership, so a person
   * changing their own profile is reflected here rather than leaving the
   * roster showing whatever was true the day they joined.
   */
  username: string | null;
  phoneNumber: string | null;
  fullName: string;
  /** Null until the invitation is claimed, which is what "Not Connected" means. */
  walletAddress: string | null;
  email: string | null;
  status: "invited" | "joined";
  avatar: string | null;
};

export type OrganizationDetail = Organization & {
  signers: OrganizationMember[];
  employees: OrganizationEmployee[];
};

/**
 * Loads organizations with the pieces callers used to get from embedded arrays.
 *
 * Both signers and employees are membership rows now, which is what lets one
 * address sign for several organizations while still being employed by one.
 */
export class OrganizationService {
  private static async attach(
    organization: Organization
  ): Promise<OrganizationDetail> {
    const [signers, employees] = await Promise.all([
      MembershipService.signersOf(organization.id),
      MembershipService.listWithUsers(organization.id, "employee"),
    ]);

    return {
      ...organization,
      signers,
      // The user row is missing for anyone added by address before registering,
      // so the membership carries the fallback name.
      employees: employees.map(({ member, user }) => ({
        id: user?.id ?? null,
        username: user?.username ?? null,
        phoneNumber: user?.phoneNumber ?? null,
        fullName: user?.fullName ?? member.name,
        walletAddress: member.address,
        // The address HR invited them at, which exists before the person does.
        email: member.email,
        status: member.status,
        avatar: user?.avatar ?? null,
      })),
    };
  }

  static async findById(id: string): Promise<OrganizationDetail | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    return row ? this.attach(row) : null;
  }

  static async findBySlug(slug: string): Promise<OrganizationDetail | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.slug, slug.toLowerCase()))
      .limit(1);

    return row ? this.attach(row) : null;
  }

  static async findByCreator(address: string): Promise<OrganizationDetail | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(
        and(
          eq(organizations.creatorAddress, address.toLowerCase()),
          eq(organizations.isActive, true)
        )
      )
      .limit(1);

    return row ? this.attach(row) : null;
  }

  static async findByContract(address: string): Promise<Organization | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.contractAddress, address.toLowerCase()))
      .limit(1);

    return row ?? null;
  }
}
