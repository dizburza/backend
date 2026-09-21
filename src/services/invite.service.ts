import crypto from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizationInvites, organizationMembers, organizations } from "../db/schema.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { isUniqueViolation } from "../utils/pgError.util.js";

/**
 * The link an organization sends so the staff it has already entered can attach
 * themselves to the rows waiting for them.
 *
 * The token is a bearer credential, so it is treated like one: 32 random bytes,
 * never derived from anything guessable, and one live token per organization so
 * a leaked link can be closed by issuing another.
 *
 * What keeps a leak cheap is that the token alone does nothing. Claiming needs
 * a session, and it only ever fills in an invitation that a signer created with
 * an email already on it. Someone holding the link who was never invited gets
 * an error, not a membership, so the link cannot manufacture staff or let
 * anyone write their own salary.
 */
export class InviteService {
  private static generateToken(): string {
    return crypto.randomBytes(32).toString("base64url");
  }

  /**
   * Issue a link, replacing whichever one is live.
   *
   * Replacing rather than adding is what makes revocation meaningful: with
   * several live tokens, closing one leaks nothing shut.
   */
  static async issue(organizationId: string, createdBy: string) {
    return db.transaction(async (tx) => {
      await tx
        .update(organizationInvites)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(organizationInvites.organizationId, organizationId),
            isNull(organizationInvites.revokedAt)
          )
        );

      const [invite] = await tx
        .insert(organizationInvites)
        .values({
          organizationId,
          token: this.generateToken(),
          createdBy: createdBy.toLowerCase(),
        })
        .returning();

      return invite;
    });
  }

  /** The live link, if one has been issued. */
  static async current(organizationId: string) {
    const [invite] = await db
      .select()
      .from(organizationInvites)
      .where(
        and(
          eq(organizationInvites.organizationId, organizationId),
          isNull(organizationInvites.revokedAt)
        )
      )
      .limit(1);

    return invite ?? null;
  }

  static async revoke(organizationId: string): Promise<void> {
    await db
      .update(organizationInvites)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(organizationInvites.organizationId, organizationId),
          isNull(organizationInvites.revokedAt)
        )
      );
  }

  /**
   * What the claim page may show before anyone has signed in.
   *
   * Deliberately thin: the organization's name and nothing else. A token is
   * held by whoever was forwarded the link, so this must not disclose the
   * staff list, the treasury or who was invited. A token that does not resolve
   * answers the same way whether it never existed or was revoked.
   */
  static async describe(token: string) {
    const [row] = await db
      .select({
        organizationId: organizationInvites.organizationId,
        expiresAt: organizationInvites.expiresAt,
        organizationName: organizations.name,
        organizationSlug: organizations.slug,
      })
      .from(organizationInvites)
      .innerJoin(organizations, eq(organizations.id, organizationInvites.organizationId))
      .where(and(eq(organizationInvites.token, token), isNull(organizationInvites.revokedAt)))
      .limit(1);

    if (!row) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;

    return {
      organizationName: row.organizationName,
      organizationSlug: row.organizationSlug,
    };
  }

  /**
   * Attach the person signing in to the invitation held for their email.
   *
   * The email is the session's, never the request's: letting a claimer name the
   * email would let anyone holding the link take any invitation, including a
   * signer's, and inherit the salary attached to it.
   *
   * Terms are not writable here. This fills in who, and only who.
   */
  static async claim(params: {
    token: string;
    userId: string;
    walletAddress: string;
    email: string | null;
    surname: string | null;
    firstname: string | null;
    phoneNumber: string | null;
  }) {
    const { token, userId, walletAddress, email } = params;

    // The roster shows a name, a phone number and a username against a salary,
    // so a membership claimed from a half filled profile leaves the employer
    // with a row they cannot act on. The same details are asked of whoever
    // creates an organization, for the same reason.
    if (!email || !params.surname || !params.firstname || !params.phoneNumber) {
      throw new AppError(
        "Complete your profile before accepting an invitation",
        400
      );
    }

    const [invite] = await db
      .select({
        organizationId: organizationInvites.organizationId,
        expiresAt: organizationInvites.expiresAt,
      })
      .from(organizationInvites)
      .where(and(eq(organizationInvites.token, token), isNull(organizationInvites.revokedAt)))
      .limit(1);

    // 410 rather than 404, so the caller can tell a dead link from a live link
    // with nobody waiting behind it. They need different answers: a new link
    // fixes one, only the employer fixes the other.
    if (!invite || (invite.expiresAt && invite.expiresAt.getTime() < Date.now())) {
      throw new AppError("This invitation link is no longer valid", 410);
    }

    const [pending] = await db
      .select()
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, invite.organizationId),
          sql`lower(${organizationMembers.email}) = ${email.toLowerCase()}`,
          eq(organizationMembers.isActive, true)
        )
      )
      .limit(1);

    // Nothing was seeded for this person, and the link cannot create one.
    // Telling them to talk to their employer is the whole recovery path.
    //
    // The message does not say the match was on email. Naming it invites
    // someone to work through addresses until one is accepted, which is the
    // guessing the match exists to prevent.
    if (!pending) {
      throw new AppError(
        "No invitation was found for you. Contact your organization to be added.",
        404
      );
    }

    if (pending.status === "joined") {
      return { organizationId: invite.organizationId, alreadyJoined: true };
    }

    try {
      await db
        .update(organizationMembers)
        .set({
          address: walletAddress.toLowerCase(),
          userId,
          status: "joined",
          // HR typed this off a spreadsheet before the person existed here.
          // Their own spelling wins now that there is one. Username and phone
          // are not copied: they are read from the user row, so a later change
          // reaches the roster instead of leaving a stale copy behind.
          name: `${params.firstname} ${params.surname}`,
        })
        .where(eq(organizationMembers.id, pending.id));
    } catch (error) {
      // The employment cap. They are already employed elsewhere, and PAYE needs
      // one employer of record, so this is a refusal rather than a second row.
      if (isUniqueViolation(error)) {
        throw new AppError(
          "This wallet is already employed by another organization",
          409
        );
      }
      throw error;
    }

    return { organizationId: invite.organizationId, alreadyJoined: false };
  }
}
