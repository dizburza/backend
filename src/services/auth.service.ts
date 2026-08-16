import jwt, { SignOptions } from "jsonwebtoken";
import { eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { authChallenges, organizations, users } from "../db/schema.js";
import type { Organization, OrganizationWithSigners, User } from "../db/types.js";
import { ENV } from "../config/environment.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { CryptoUtil } from "../utils/crypto.util.js";
import crypto from "node:crypto";
import { UserRegistrationData, LoginData } from "../types/user.types.js";
import { MembershipService } from "./membership.service.js";

/**
 * What the caller is right now, derived from memberships on every check rather
 * than stored. `users` deliberately carries no role column: a role that lives on
 * the person rather than the relationship is how a signer of one organization
 * ends up admitted to another.
 */
export type SessionRole = "user" | "employee" | "signer";

/** A user row with the derived role attached, which is what clients receive. */
export type SessionUser = User & { role: SessionRole };

/** One line per organization the session can act in. */
export type SessionMembership = {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  role: "owner" | "signer" | "employee";
};

// A signed challenge is only good for a few minutes, and only once.
const CHALLENGE_TTL_MS = 5 * 60_000;

export class AuthService {
  /**
   * Verify a signature against the challenge this server issued, then consume
   * it so the same signature cannot be presented twice.
   *
   * The caller never supplies the message. It is rebuilt here from the stored
   * nonce, which is what makes replay impossible: previously the message came
   * straight from the request body and was only checked for "does this recover
   * to this address", so any captured signature worked forever.
   */
  private static async consumeChallenge(
    walletAddress: string,
    signature: string
  ): Promise<void> {
    const address = walletAddress.toLowerCase();

    // Deleting on read makes the challenge single-use even under concurrent
    // attempts: only one caller can get the row back.
    const [challenge] = await db
      .delete(authChallenges)
      .where(eq(authChallenges.address, address))
      .returning();

    if (!challenge) {
      throw new AppError("No pending sign-in challenge. Request a new message.", 401);
    }

    if (challenge.expiresAt.getTime() < Date.now()) {
      throw new AppError("Sign-in challenge expired. Request a new message.", 401);
    }

    const expected = CryptoUtil.generateAuthMessage(
      address,
      challenge.nonce,
      challenge.issuedAt,
      ENV.AUTH_DOMAIN
    );

    // Already consumed above, so a failed attempt burns the nonce too and an
    // attacker cannot grind signatures against a challenge that stays valid.
    if (!(await CryptoUtil.verifySignature(expected, signature, address))) {
      throw new AppError("Invalid signature", 401);
    }
  }

  /**
   * Register a new user
   */
  static async register(data: UserRegistrationData): Promise<{
    user: SessionUser;
    token: string;
    redirectTo: string;
  }> {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, data.walletAddress.toLowerCase()))
      .limit(1);

    if (existing) {
      throw new AppError("Wallet address already registered", 409);
    }

    // Without this anyone could claim an address they do not control and be
    // handed a working session for it.
    await this.consumeChallenge(data.walletAddress, data.signature);

    // Use username from data if provided, otherwise generate
    let username =
      data.username ||
      CryptoUtil.generateUniqueUsername(
        data.surname,
        data.firstname,
        data.walletAddress
      );

    username = username.toLowerCase();

    const [usernameExists] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (usernameExists) {
      const randomSuffix = crypto.randomBytes(2).toString("hex");
      username = `${username}_${randomSuffix}`.toLowerCase();
    }

    const [user] = await db
      .insert(users)
      .values({
        walletAddress: data.walletAddress.toLowerCase(),
        username,
        surname: data.surname,
        firstname: data.firstname,
        fullName: data.fullName || `${data.firstname} ${data.surname}`,
        email: data.email,
        phoneNumber: data.phoneNumber,
        avatar: data.avatar,
      })
      .returning();

    // An organization may have named this address as a signer or employee
    // before the person registered. Claim those rows now.
    await MembershipService.linkUser(user.id, user.walletAddress);

    const context = await this.resolveContext(user);
    const token = this.generateToken(user);

    return {
      user: { ...user, role: context.role },
      token,
      redirectTo: context.redirectTo,
    };
  }

  /**
   * Where a session lands and what it may do, worked out from memberships.
   *
   * Signing wins over employment when someone is both, since the enterprise
   * view is the more capable one and an employee view would hide it. Nothing is
   * stored: a signer removed on chain stops being one here on the next check,
   * with no backfill.
   */
  private static async resolveContext(user: User): Promise<{
    role: SessionRole;
    redirectTo: string;
    organization: OrganizationWithSigners | null;
    memberships: SessionMembership[];
  }> {
    const rows = await MembershipService.forAddress(user.walletAddress);

    const memberships: SessionMembership[] = rows.map((m) => ({
      organizationId: m.organizationId,
      organizationSlug: m.organizationSlug,
      organizationName: m.organizationName,
      role: m.role,
    }));

    if (memberships.length === 0) {
      return { role: "user", redirectTo: "/wallet", organization: null, memberships };
    }

    const signing = memberships.filter((m) => m.role !== "employee");
    const primary = signing[0] ?? memberships[0];
    const organization = await this.findOrganizationWithSigners(primary.organizationId);

    return {
      role: signing.length > 0 ? "signer" : "employee",
      redirectTo: `/enterprise/${primary.organizationSlug}`,
      organization,
      memberships,
    };
  }

  /**
   * Login with wallet signature
   */
  static async login(data: LoginData): Promise<{
    user: SessionUser;
    token: string;
    redirectTo: string;
    organization?: Organization | OrganizationWithSigners | null;
    memberships: SessionMembership[];
  }> {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.walletAddress, data.walletAddress.toLowerCase()))
      .limit(1);

    if (!existing || !existing.isActive) {
      throw new AppError("User not found or inactive. Please register first.", 404);
    }

    await this.consumeChallenge(data.walletAddress, data.signature);

    const [user] = await db
      .update(users)
      .set({ lastLoginAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning();

    const token = this.generateToken(user);
    const context = await this.resolveContext(user);

    return {
      user: { ...user, role: context.role },
      token,
      redirectTo: context.redirectTo,
      organization: context.organization,
      memberships: context.memberships,
    };
  }

  /**
   * Has this wallet registered yet.
   *
   * Public, because it runs after wallet connect and before any session exists,
   * which is the whole point: it decides register or sign in. So it answers
   * exactly that and nothing else.
   *
   * It used to return the full user row, the employer with its signer list and
   * staff roster, and the memberships, to anyone who passed an address. That is
   * identity, employer and roster in one unauthenticated call, keyed by a wallet
   * address, which is the disclosure the directory lookups are rate limited to
   * prevent. Everything else moved to GET /auth/me, behind the session.
   */
  static async checkUserStatus(walletAddress: string): Promise<{
    isRegistered: boolean;
  }> {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.walletAddress, walletAddress.toLowerCase()))
      .limit(1);

    return { isRegistered: Boolean(user) };
  }

  /**
   * The session's own view of itself, for GET /auth/me.
   *
   * `organizationSlug` and `jobRole` are flattened onto the user because that is
   * where the frontend reads them. They were read off /auth/check before, where
   * nothing ever set them, so the post-connect redirect for a signer silently
   * fell through to the profile setup page.
   */
  static async sessionFor(user: User): Promise<{
    user: SessionUser & { organizationSlug: string | null; jobRole: string | null };
    redirectTo: string;
    organization: OrganizationWithSigners | null;
    memberships: SessionMembership[];
  }> {
    const context = await this.resolveContext(user);
    const primary =
      context.memberships.find((m) => m.role !== "employee") ?? context.memberships[0];

    const employment = await MembershipService.employmentFor(user.walletAddress);

    return {
      user: {
        ...user,
        role: context.role,
        organizationSlug: primary?.organizationSlug ?? null,
        jobRole: employment?.jobRole ?? null,
      },
      redirectTo: context.redirectTo,
      organization: context.organization,
      memberships: context.memberships,
    };
  }

  private static async findOrganization(id: string): Promise<Organization | null> {
    const [row] = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, id))
      .limit(1);

    return row ?? null;
  }

  private static async findOrganizationWithSigners(
    id: string
  ): Promise<OrganizationWithSigners | null> {
    const organization = await this.findOrganization(id);
    if (!organization) return null;

    return { ...organization, signers: await MembershipService.signersOf(id) };
  }

  /**
   * Get authentication message
   */
  static async getAuthMessage(walletAddress: string): Promise<string> {
    const address = walletAddress.toLowerCase();
    const nonce = this.generateNonce();
    const issuedAt = new Date();

    // Issuing a fresh challenge replaces any pending one, so a stale tab cannot
    // hold a second valid nonce open.
    const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);

    // Postgres has no TTL index, so abandoned challenges are swept here. One
    // extra delete per issue keeps the table bounded without a cron job.
    await db.delete(authChallenges).where(lt(authChallenges.expiresAt, new Date()));

    await db
      .insert(authChallenges)
      .values({ address, nonce, issuedAt, expiresAt })
      .onConflictDoUpdate({
        target: authChallenges.address,
        set: { nonce, issuedAt, expiresAt },
      });

    return CryptoUtil.generateAuthMessage(address, nonce, issuedAt, ENV.AUTH_DOMAIN);
  }

  private static generateToken(user: User): string {
    // No organization is baked into the token. Someone can sign for several,
    // and membership changes without the session being reissued, so it is
    // resolved per request instead.
    const payload = {
      userId: user.id,
      walletAddress: user.walletAddress,
    };

    const rawExpiry = ENV.JWT_EXPIRY;
    const numericExpiry = Number(rawExpiry);

    const expiresIn: SignOptions["expiresIn"] =
      rawExpiry && !Number.isNaN(numericExpiry)
        ? numericExpiry
        : (rawExpiry as unknown as SignOptions["expiresIn"]);

    const options: SignOptions = {
      expiresIn,
    };

    return jwt.sign(payload, ENV.JWT_SECRET, options);
  }

  private static generateNonce(): string {
    return crypto.randomBytes(16).toString("hex");
  }
}