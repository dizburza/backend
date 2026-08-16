import PDFDocument from "pdfkit";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "../db/client.js";
import {
  batchPayrolls,
  organizationMembers,
  organizations,
  payrollTaxLines,
  taxAuthorities,
  users,
} from "../db/schema.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { MembershipService } from "./membership.service.js";
import { TokenService } from "./token.service.js";

type BandRow = {
  position: number;
  from: string;
  to: string | null;
  ratePercent: string;
  taxableInBand: string;
  taxInBand: string;
};

type Breakdown = {
  regimeName?: string;
  regimeVerified?: boolean;
  reliefMinor?: string;
  taxableMinor?: string;
  minimumTaxApplied?: boolean;
  bands?: BandRow[];
};

/** Everything one receipt needs, gathered before a byte is written. */
type ReceiptData = {
  line: typeof payrollTaxLines.$inferSelect;
  organizationName: string;
  organizationTin: string | null;
  employeeName: string;
  batchName: string;
  executedAt: Date | null;
  txHash: string | null;
  authorityName: string | null;
  decimals: number;
  symbol: string;
};

const A4_MARGIN = 50;

export class TaxDocumentService {
  /**
   * Who may read a tax line.
   *
   * The person it describes, or a signer of the organization that paid it. A
   * payslip is the employee's own record and the employer's remittance
   * evidence, and nobody else's business: it carries a salary, a name and a
   * wallet address together, which is the mapping the directory rate limit
   * exists to protect.
   */
  private static async authorize(
    line: typeof payrollTaxLines.$inferSelect,
    caller: { userId: string; walletAddress: string }
  ): Promise<void> {
    if (line.userId && line.userId === caller.userId) return;
    if (line.walletAddress.toLowerCase() === caller.walletAddress.toLowerCase()) return;

    if (await MembershipService.isSignerOf(line.organizationId, caller.walletAddress)) {
      return;
    }

    throw new AppError("You cannot read this tax record", 403);
  }

  private static async gather(lineId: string): Promise<ReceiptData> {
    const [row] = await db
      .select({
        line: payrollTaxLines,
        organizationName: organizations.name,
        organizationTin: organizations.taxIdentificationNumber,
        batchName: batchPayrolls.batchName,
        executedAt: batchPayrolls.executedAt,
        txHash: batchPayrolls.txHash,
        authorityName: taxAuthorities.name,
      })
      .from(payrollTaxLines)
      .innerJoin(organizations, eq(organizations.id, payrollTaxLines.organizationId))
      .innerJoin(batchPayrolls, eq(batchPayrolls.id, payrollTaxLines.batchId))
      .leftJoin(taxAuthorities, eq(taxAuthorities.id, payrollTaxLines.taxAuthorityId))
      .where(eq(payrollTaxLines.id, lineId))
      .limit(1);

    if (!row) throw new AppError("No such tax record", 404);

    // The employment record carries the name the employer knows them by, which
    // is what belongs on a payslip. Falls back to the account, then the address.
    const [member] = await db
      .select({ name: organizationMembers.name })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, row.line.organizationId),
          eq(organizationMembers.address, row.line.walletAddress),
          eq(organizationMembers.role, "employee")
        )
      )
      .limit(1);

    let employeeName = member?.name ?? "";

    if (!employeeName && row.line.userId) {
      const [account] = await db
        .select({ firstname: users.firstname, surname: users.surname })
        .from(users)
        .where(eq(users.id, row.line.userId))
        .limit(1);

      if (account) employeeName = `${account.firstname} ${account.surname}`.trim();
    }

    const token = await TokenService.getDefault();

    return {
      line: row.line,
      organizationName: row.organizationName,
      organizationTin: row.organizationTin,
      employeeName: employeeName || row.line.walletAddress,
      batchName: row.batchName,
      executedAt: row.executedAt,
      txHash: row.txHash,
      authorityName: row.authorityName,
      decimals: token.decimals,
      symbol: token.symbol,
    };
  }

  /** A PAYE receipt for one payment to one person. */
  static async receipt(
    lineId: string,
    caller: { userId: string; walletAddress: string }
  ): Promise<Buffer> {
    const data = await this.gather(lineId);
    await this.authorize(data.line, caller);

    const money = (minor: string) =>
      `${data.symbol} ${Number(ethers.formatUnits(minor, data.decimals)).toLocaleString(
        "en-NG",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      )}`;

    const breakdown = (data.line.breakdown ?? {}) as Breakdown;

    return this.render((doc) => {
      this.heading(doc, "Pay As You Earn deduction", data.organizationName);

      if (breakdown.regimeVerified === false) {
        // Said on the face of the document rather than in a footnote. A figure
        // from an unchecked band table is not evidence of anything.
        this.warning(
          doc,
          "Computed against a tax table that has not been verified against the " +
            "current Act. Not for filing."
        );
      }

      this.pairs(doc, [
        ["Employee", data.employeeName],
        ["Wallet", data.line.walletAddress],
        ["Employer", data.organizationName],
        ["Employer TIN", data.organizationTin ?? "Not recorded"],
        ["Payroll batch", data.batchName],
        [
          "Paid on",
          data.executedAt ? data.executedAt.toISOString().slice(0, 10) : "Not executed",
        ],
        ["Tax authority", data.authorityName ?? "Not assigned"],
        ["Tax regime", breakdown.regimeName ?? "Unrecorded"],
      ]);

      doc.moveDown(1);
      this.pairs(
        doc,
        [
          ["Gross pay", money(data.line.grossMinor)],
          ["Relief", breakdown.reliefMinor ? money(breakdown.reliefMinor) : "-"],
          ["Taxable pay", breakdown.taxableMinor ? money(breakdown.taxableMinor) : "-"],
          ["PAYE deducted", money(data.line.taxMinor)],
          ["Net paid", money(data.line.netMinor)],
        ],
        true
      );

      if (breakdown.bands?.length) {
        doc.moveDown(1);
        doc.font("Helvetica-Bold").fontSize(11).text("How the figure was reached");
        doc.moveDown(0.4);

        for (const band of breakdown.bands) {
          const upper = band.to ? money(band.to) : "above";
          doc
            .font("Helvetica")
            .fontSize(9)
            .fillColor("#444444")
            .text(
              `${money(band.from)} to ${upper} at ${band.ratePercent}%  ` +
                `on ${money(band.taxableInBand)}  =  ${money(band.taxInBand)}`
            );
        }
        doc.fillColor("black");
      }

      if (breakdown.minimumTaxApplied) {
        doc.moveDown(0.6);
        doc
          .font("Helvetica-Oblique")
          .fontSize(9)
          .text("Minimum tax applied: the bands produced less than the statutory floor.");
      }

      this.settlement(doc, data);
      this.footer(doc, data.txHash);
    });
  }

  /**
   * A year of PAYE for one person.
   *
   * Their own record only. An employer sees a batch, not a person's whole year,
   * because a year spans employers and this is the employee's document.
   */
  static async statement(userId: string, year: number): Promise<Buffer> {
    const from = new Date(Date.UTC(year, 0, 1));
    const to = new Date(Date.UTC(year + 1, 0, 1));

    const rows = await db
      .select({
        line: payrollTaxLines,
        organizationName: organizations.name,
        batchName: batchPayrolls.batchName,
        executedAt: batchPayrolls.executedAt,
      })
      .from(payrollTaxLines)
      .innerJoin(organizations, eq(organizations.id, payrollTaxLines.organizationId))
      .innerJoin(batchPayrolls, eq(batchPayrolls.id, payrollTaxLines.batchId))
      .where(
        and(
          eq(payrollTaxLines.userId, userId),
          gte(payrollTaxLines.createdAt, from),
          lt(payrollTaxLines.createdAt, to)
        )
      )
      .orderBy(desc(payrollTaxLines.createdAt));

    const [account] = await db
      .select({ firstname: users.firstname, surname: users.surname })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const token = await TokenService.getDefault();
    const money = (minor: string) =>
      `${token.symbol} ${Number(ethers.formatUnits(minor, token.decimals)).toLocaleString(
        "en-NG",
        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
      )}`;

    const totals = rows.reduce(
      (sum, r) => ({
        gross: sum.gross + BigInt(r.line.grossMinor),
        tax: sum.tax + BigInt(r.line.taxMinor),
        net: sum.net + BigInt(r.line.netMinor),
      }),
      { gross: 0n, tax: 0n, net: 0n }
    );

    const unverified = rows.some(
      (r) => ((r.line.breakdown ?? {}) as Breakdown).regimeVerified === false
    );

    return this.render((doc) => {
      this.heading(
        doc,
        `PAYE statement ${year}`,
        account ? `${account.firstname} ${account.surname}`.trim() : "Employee"
      );

      if (unverified) {
        this.warning(
          doc,
          "One or more entries were computed against an unverified tax table. " +
            "Not for filing."
        );
      }

      if (rows.length === 0) {
        doc.font("Helvetica").fontSize(11).text(`No payroll recorded in ${year}.`);
        this.footer(doc, null);
        return;
      }

      this.pairs(
        doc,
        [
          ["Total gross", money(totals.gross.toString())],
          ["Total PAYE", money(totals.tax.toString())],
          ["Total net", money(totals.net.toString())],
          ["Payments", String(rows.length)],
        ],
        true
      );

      doc.moveDown(1);
      doc.font("Helvetica-Bold").fontSize(11).text("Payments");
      doc.moveDown(0.4);

      for (const row of rows) {
        const when = row.executedAt
          ? row.executedAt.toISOString().slice(0, 10)
          : row.line.createdAt.toISOString().slice(0, 10);

        doc
          .font("Helvetica")
          .fontSize(9)
          .fillColor("#444444")
          .text(
            `${when}  ${row.organizationName}  ${row.batchName}  ` +
              `gross ${money(row.line.grossMinor)}  PAYE ${money(row.line.taxMinor)}  ` +
              `net ${money(row.line.netMinor)}`
          );
      }
      doc.fillColor("black");

      this.footer(doc, null);
    });
  }

  /**
   * Says plainly that the money has not moved.
   *
   * A receipt that showed only a deducted figure would read as evidence of
   * remittance. Nothing is remitted until `remittanceTxHash` is set, and no
   * state revenue service accepts on-chain settlement yet.
   */
  private static settlement(PDFKit: PDFKit.PDFDocument, data: ReceiptData): void {
    PDFKit.moveDown(1);

    if (data.line.remittanceTxHash) {
      PDFKit.font("Helvetica").fontSize(9).text(
        `Remitted ${data.line.remittedAt?.toISOString().slice(0, 10) ?? ""} ` +
          `in ${data.line.remittanceTxHash}`
      );
      return;
    }

    PDFKit.font("Helvetica-Oblique")
      .fontSize(9)
      .fillColor("#7a5b00")
      .text(
        "PAYE calculated and withheld by the employer. Not yet remitted to the " +
          "tax authority. This document records the deduction, not its settlement."
      )
      .fillColor("black");
  }

  private static render(body: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: A4_MARGIN });
      const chunks: Buffer[] = [];

      doc.on("data", (chunk: Buffer) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      try {
        body(doc);
        doc.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private static heading(doc: PDFKit.PDFDocument, title: string, subject: string): void {
    doc.font("Helvetica-Bold").fontSize(18).text(title);
    doc.font("Helvetica").fontSize(12).fillColor("#444444").text(subject);
    doc.fillColor("black").moveDown(1);
  }

  private static warning(doc: PDFKit.PDFDocument, text: string): void {
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor("#a33")
      .text(text, { width: 500 })
      .fillColor("black")
      .moveDown(0.8);
  }

  private static pairs(
    doc: PDFKit.PDFDocument,
    rows: Array<[string, string]>,
    bold = false
  ): void {
    for (const [label, value] of rows) {
      const y = doc.y;
      doc.font("Helvetica").fontSize(10).fillColor("#666666").text(label, A4_MARGIN, y, {
        width: 150,
      });
      doc
        .font(bold ? "Helvetica-Bold" : "Helvetica")
        .fontSize(10)
        .fillColor("black")
        .text(value, A4_MARGIN + 160, y, { width: 340 });
    }
  }

  private static footer(doc: PDFKit.PDFDocument, txHash: string | null): void {
    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(8).fillColor("#888888");
    doc.text(`Generated ${new Date().toISOString().slice(0, 19).replace("T", " ")} UTC`);
    if (txHash) doc.text(`Payroll transaction ${txHash}`);
    doc.fillColor("black");
  }
}
