import { createHash, randomInt } from "node:crypto";
import axios from "axios";
import { desc, eq } from "drizzle-orm";
import { ENV } from "../config/environment.js";
import { db } from "../db/client.js";
import { organizationEmailVerifications } from "../db/schema.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import logger from "../utils/logger.util.js";

const hashCode = (code: string): string => createHash("sha256").update(code).digest("hex");

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/**
 * A 6-digit code proving control of the business email typed during
 * organization onboarding, before any organization row exists.
 *
 * Sending degrades to a thrown error rather than a silent no-op: unlike FX,
 * there is no stale-but-usable code to fall back to, so a broken provider must
 * surface as a failed request instead of a code nobody receives.
 */
export class EmailVerificationService {
  /** Sends a new code, replacing any still-pending one for this address. */
  static async send(email: string): Promise<void> {
    const normalized = normalizeEmail(email);
    const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
    const expiresAt = new Date(Date.now() + ENV.OTP_EXPIRY_SECONDS * 1000);

    await db.insert(organizationEmailVerifications).values({
      email: normalized,
      codeHash: hashCode(code),
      expiresAt,
    });

    await EmailVerificationService.deliver(normalized, code);
  }

  private static async deliver(email: string, code: string): Promise<void> {
    if (!ENV.RESEND_API_KEY) {
      throw new AppError("Email verification is not configured", 503);
    }

    try {
      await axios.post(
        ENV.RESEND_API_URL,
        {
          from: ENV.EMAIL_FROM_ADDRESS,
          to: [email],
          subject: "Verify your organization email",
          text: `Your Dizburza verification code is ${code}. It expires in ${Math.round(ENV.OTP_EXPIRY_SECONDS / 60)} minutes.`,
        },
        {
          headers: { Authorization: `Bearer ${ENV.RESEND_API_KEY}` },
          timeout: 8000,
        }
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.error(`Could not send verification email: ${detail}`);
      throw new AppError("Could not send verification email", 502);
    }
  }

  /**
   * Checks a code against the most recent one sent to this address.
   *
   * Attempts are counted on the row itself so a code cannot be brute forced
   * once it exists, independent of the per-IP rate limit on the route.
   */
  static async verify(email: string, code: string): Promise<void> {
    const normalized = normalizeEmail(email);

    const [latest] = await db
      .select()
      .from(organizationEmailVerifications)
      .where(eq(organizationEmailVerifications.email, normalized))
      .orderBy(desc(organizationEmailVerifications.createdAt))
      .limit(1);

    if (!latest || latest.verifiedAt) {
      throw new AppError("Request a new verification code", 400);
    }

    if (latest.expiresAt.getTime() < Date.now()) {
      throw new AppError("This code has expired. Request a new one.", 400);
    }

    if (latest.attempts >= ENV.OTP_MAX_ATTEMPTS) {
      throw new AppError("Too many incorrect attempts. Request a new code.", 429);
    }

    if (latest.codeHash !== hashCode(code.trim())) {
      await db
        .update(organizationEmailVerifications)
        .set({ attempts: latest.attempts + 1 })
        .where(eq(organizationEmailVerifications.id, latest.id));
      throw new AppError("Incorrect or expired code", 400);
    }

    await db
      .update(organizationEmailVerifications)
      .set({ verifiedAt: new Date() })
      .where(eq(organizationEmailVerifications.id, latest.id));
  }

  /**
   * Whether this address has a still-valid verification, checked right before
   * the organization is created since a code confirmed minutes ago should not
   * silently expire between the two requests.
   */
  static async isVerified(email: string): Promise<boolean> {
    const normalized = normalizeEmail(email);

    const [latest] = await db
      .select()
      .from(organizationEmailVerifications)
      .where(eq(organizationEmailVerifications.email, normalized))
      .orderBy(desc(organizationEmailVerifications.createdAt))
      .limit(1);

    return Boolean(latest?.verifiedAt);
  }
}
