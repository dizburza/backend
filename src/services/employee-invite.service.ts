import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizationMembers, organizations } from "../db/schema.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { isUniqueViolation } from "../utils/pgError.util.js";
import logger from "../utils/logger.util.js";
import { InviteService } from "./invite.service.js";
import { TokenService } from "./token.service.js";

export interface EmployeeSeed {
  surname: string;
  firstname: string;
  email: string;
  phone?: string;
  jobRole: string;
  salary: string;
  department?: string;
  employeeId?: string;
}

export type SeedStatus = "added" | "skipped" | "error";

export interface SeedOutcome {
  row: number;
  surname: string;
  firstname: string;
  email: string;
  phone: string;
  jobRole: string;
  salary: string;
  status: SeedStatus;
  message?: string;
}

export interface SeedResults {
  added: number;
  skipped: number;
  failed: number;
  /** Whether the invitation emails went out, so the UI can say if they did not. */
  invitesSent: boolean;
  details: SeedOutcome[];
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPLOYEE_CSV_HEADERS = [
  "surname",
  "firstname",
  "email",
  "phone",
  "jobrole",
  "salary",
] as const;

/**
 * Adding staff by email rather than by wallet address.
 *
 * A signer knows who they are hiring long before that person has an account,
 * so the membership is seeded from a name, an email and the employment terms
 * and waits at `invited` with no address. The person attaches themselves to it
 * through the join link, which is the only path that may write an address.
 *
 * Nothing here creates a `users` row. Doing so would invent an account nobody
 * has signed into and hand it a wallet address it never controlled.
 */
export class EmployeeInviteService {
  static csvTemplate(): string {
    return [
      "surname,firstname,email,phone,jobRole,salary",
      "Adeoye,Adetola,adetola@example.com,+2348012345678,HR Manager,500000",
      "Balogun,Timi,timi@example.com,+2348098765432,Graphics Designer,420000",
    ].join("\n");
  }

  /**
   * Checks a batch without writing it, so the browser can show what will
   * happen before anyone commits to sending invitations.
   */
  static async review(organizationId: string, rows: EmployeeSeed[]): Promise<SeedResults> {
    const existing = await this.existingEmails(organizationId);
    const seenInFile = new Set<string>();
    const details: SeedOutcome[] = [];

    for (const [index, row] of rows.entries()) {
      const outcome = await this.check(row, index + 1, existing, seenInFile);
      if (outcome.status === "added") seenInFile.add(row.email.trim().toLowerCase());
      details.push(outcome);
    }

    return this.tally(details, false);
  }

  /**
   * Seeds every valid row, then mails the link once per person.
   *
   * A row that cannot be written is reported rather than thrown, because one
   * bad line in a file of twenty should not discard the other nineteen.
   */
  static async seed(
    organizationId: string,
    rows: EmployeeSeed[],
    requestedBy: string
  ): Promise<SeedResults> {
    const [organization] = await db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization) throw new AppError("Organization not found", 404);

    const existing = await this.existingEmails(organizationId);
    const seenInFile = new Set<string>();
    const details: SeedOutcome[] = [];
    const mailTo: Array<{ email: string; name: string }> = [];

    for (const [index, row] of rows.entries()) {
      const outcome = await this.check(row, index + 1, existing, seenInFile);

      if (outcome.status !== "added") {
        details.push(outcome);
        continue;
      }

      const email = row.email.trim().toLowerCase();

      try {
        await db.insert(organizationMembers).values({
          organizationId,
          email,
          phone: row.phone?.trim() || null,
          name: `${row.firstname.trim()} ${row.surname.trim()}`.trim(),
          role: "employee",
          status: "invited",
          jobRole: row.jobRole.trim(),
          salary: await TokenService.parse(row.salary.trim()).then((v) => v.toString()),
          department: row.department?.trim() || null,
          employeeId: row.employeeId?.trim() || null,
        });

        seenInFile.add(email);
        mailTo.push({ email, name: `${row.firstname.trim()} ${row.surname.trim()}`.trim() });
        details.push(outcome);
      } catch (error) {
        // The unique index on (organization, lower(email)) is the authority on
        // duplicates, not the check above: two uploads racing each other both
        // pass that check and only one can win here.
        details.push({
          ...outcome,
          status: isUniqueViolation(error) ? "skipped" : "error",
          message: isUniqueViolation(error)
            ? "Already invited to this organization"
            : "Could not be saved",
        });
      }
    }

    let invitesSent = false;
    if (mailTo.length > 0) {
      invitesSent = await this.mail(organizationId, organization.name, requestedBy, mailTo);
    }

    return this.tally(details, invitesSent);
  }

  /**
   * One link for the whole batch, issued once rather than per recipient: a new
   * token revokes the last, so issuing per person would leave everyone but the
   * final recipient holding a dead link.
   */
  private static async mail(
    organizationId: string,
    organizationName: string,
    requestedBy: string,
    recipients: Array<{ email: string; name: string }>
  ): Promise<boolean> {
    let invite;
    try {
      invite =
        (await InviteService.current(organizationId)) ??
        (await InviteService.issue(organizationId, requestedBy));
    } catch (error) {
      logger.error(`Could not issue an invite link: ${String(error)}`);
      return false;
    }

    let sent = 0;
    for (const recipient of recipients) {
      try {
        await InviteService.sendInviteEmail({
          to: recipient.email,
          name: recipient.name,
          organizationName,
          token: invite.token,
        });
        sent++;
      } catch (error) {
        // The row is already written, so a failed send is a reminder waiting to
        // be pressed rather than a reason to undo the membership.
        logger.warn(`Invitation to ${recipient.email} was not sent: ${String(error)}`);
      }
    }

    return sent > 0;
  }

  private static async check(
    row: EmployeeSeed,
    rowNumber: number,
    existing: Set<string>,
    seenInFile: Set<string>
  ): Promise<SeedOutcome> {
    const surname = (row.surname || "").trim();
    const firstname = (row.firstname || "").trim();
    const email = (row.email || "").trim().toLowerCase();
    const phone = (row.phone || "").trim();
    const jobRole = (row.jobRole || "").trim();
    const salary = (row.salary || "").trim();

    const base = {
      row: rowNumber,
      surname,
      firstname,
      email,
      phone,
      jobRole,
      salary,
    };

    const missing: string[] = [];
    if (!surname) missing.push("surname");
    if (!firstname) missing.push("first name");
    if (!email) missing.push("email");
    if (!jobRole) missing.push("role");
    if (!salary) missing.push("salary");

    if (missing.length > 0) {
      return { ...base, status: "error", message: `Missing ${missing.join(", ")}` };
    }

    if (!EMAIL.test(email)) {
      return { ...base, status: "error", message: "Not a valid email address" };
    }

    try {
      // Rejected here rather than at insert, so a mistyped figure is reported
      // against its own row instead of failing the batch.
      await TokenService.parse(salary);
    } catch {
      return { ...base, status: "error", message: "Salary is not a valid amount" };
    }

    if (seenInFile.has(email)) {
      return { ...base, status: "skipped", message: "Repeated in this file" };
    }

    if (existing.has(email)) {
      return { ...base, status: "skipped", message: "Already invited to this organization" };
    }

    return { ...base, status: "added" };
  }

  private static async existingEmails(organizationId: string): Promise<Set<string>> {
    const rows = await db
      .select({ email: organizationMembers.email })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.isActive, true),
          sql`${organizationMembers.email} is not null`
        )
      );

    return new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
  }

  private static tally(details: SeedOutcome[], invitesSent: boolean): SeedResults {
    return {
      added: details.filter((d) => d.status === "added").length,
      skipped: details.filter((d) => d.status === "skipped").length,
      failed: details.filter((d) => d.status === "error").length,
      invitesSent,
      details,
    };
  }

  /**
   * Split on the header row's own spelling, so a file whose columns are in a
   * different order still lands in the right fields.
   */
  static parseCsv(csv: string): EmployeeSeed[] {
    const lines = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length < 2) {
      throw new AppError("The file needs a header row and at least one employee", 400);
    }

    const headers = this.splitRow(lines[0]).map((h) => h.toLowerCase().replaceAll(/[\s_]/g, ""));
    const required = ["surname", "firstname", "email"];
    const missing = required.filter((h) => !headers.includes(h));

    if (missing.length > 0) {
      throw new AppError(`The file is missing these columns: ${missing.join(", ")}`, 400);
    }

    return lines.slice(1).map((line) => {
      const values = this.splitRow(line);
      const at = (name: string) => values[headers.indexOf(name)] ?? "";

      return {
        surname: at("surname"),
        firstname: at("firstname"),
        email: at("email"),
        phone: at("phone") || at("phonenumber"),
        jobRole: at("jobrole") || at("role"),
        salary: at("salary"),
        department: at("department"),
        employeeId: at("employeeid"),
      };
    });
  }

  /** Quoted fields exist because a job title may contain a comma. */
  private static splitRow(line: string): string[] {
    const out: string[] = [];
    let current = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        if (quoted && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (char === "," && !quoted) {
        out.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }

    out.push(current.trim());
    return out;
  }
}
