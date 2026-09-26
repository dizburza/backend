import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  batchPayrollRecipients,
  batchPayrolls,
  organizationMembers,
  organizations,
  payrollTaxLines,
  taxAuthorities,
  taxBands,
  taxRegimes,
} from "../db/schema.js";
import type {
  PayrollTaxLine,
  TaxAuthority,
  TaxBand,
  TaxRegime,
} from "../db/types.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import { TokenService } from "./token.service.js";

/**
 * Percentages are stored with three decimal places. Scaling by 100_000 lets a
 * rate like 7.500% be applied with integer arithmetic, so nothing ever touches
 * a float.
 */
const PERCENT_SCALE = 100_000n;

const percentToScaled = (value: string): bigint => {
  const [whole, fraction = ""] = value.split(".");
  const padded = (fraction + "000").slice(0, 3);
  return BigInt(whole) * 1000n + BigInt(padded || "0");
};

/** value * percent, rounded down. Rounding down never over-charges the employee. */
const applyPercent = (amount: bigint, percent: string): bigint =>
  (amount * percentToScaled(percent)) / PERCENT_SCALE;

export type TaxBandWorking = {
  position: number;
  from: string;
  to: string | null;
  ratePercent: string;
  taxableInBand: string;
  taxInBand: string;
};

export type TaxComputation = {
  grossMinor: string;
  reliefMinor: string;
  taxableMinor: string;
  taxMinor: string;
  netMinor: string;
  minimumTaxApplied: boolean;
  regimeId: string;
  regimeName: string;
  bands: TaxBandWorking[];
};

export class TaxService {
  /**
   * The regime in force on a given date. Historic dates resolve to the rules
   * that applied then, so reissuing an old receipt reproduces the old figure.
   */
  static async resolveRegime(
    jurisdiction: string,
    on: Date = new Date()
  ): Promise<{ regime: TaxRegime; bands: TaxBand[] }> {
    const [regime] = await db
      .select()
      .from(taxRegimes)
      .where(
        and(
          eq(taxRegimes.jurisdiction, jurisdiction),
          lte(taxRegimes.effectiveFrom, on),
          or(isNull(taxRegimes.effectiveTo), gte(taxRegimes.effectiveTo, on))
        )
      )
      .orderBy(desc(taxRegimes.effectiveFrom))
      .limit(1);

    if (!regime) {
      throw new AppError(
        `No tax regime configured for ${jurisdiction} on ${on.toISOString().slice(0, 10)}`,
        409
      );
    }

    const bands = await db
      .select()
      .from(taxBands)
      .where(eq(taxBands.regimeId, regime.id))
      .orderBy(asc(taxBands.position));

    if (bands.length === 0) {
      throw new AppError(`Tax regime ${regime.name} has no bands configured`, 409);
    }

    return { regime, bands };
  }

  static async resolveAuthority(stateCode: string): Promise<TaxAuthority> {
    const [authority] = await db
      .select()
      .from(taxAuthorities)
      .where(
        and(
          eq(taxAuthorities.stateCode, stateCode.toUpperCase()),
          eq(taxAuthorities.isActive, true)
        )
      )
      .limit(1);

    if (!authority) {
      throw new AppError(`No tax authority configured for state ${stateCode}`, 409);
    }

    return authority;
  }

  /**
   * Compute tax on a gross amount.
   *
   * Pure given its inputs: it takes the regime and bands rather than reading
   * them, so a receipt can be recomputed from the rules stored against it.
   */
  static compute(
    grossMinor: bigint,
    regime: TaxRegime,
    bands: TaxBand[]
  ): TaxComputation {
    if (grossMinor < 0n) throw new AppError("Gross amount cannot be negative", 400);

    // Relief is the greater of a fixed floor or a percentage of gross, plus a
    // further percentage of gross.
    const percentRelief = applyPercent(grossMinor, regime.reliefPercentOfGross);
    const fixedRelief = BigInt(regime.reliefFixedMinor);
    const baseRelief = percentRelief > fixedRelief ? percentRelief : fixedRelief;
    const additional = applyPercent(grossMinor, regime.reliefAdditionalPercentOfGross);

    let relief = baseRelief + additional;
    if (relief > grossMinor) relief = grossMinor;

    const taxable = grossMinor - relief;

    const working: TaxBandWorking[] = [];
    let tax = 0n;

    for (const band of bands) {
      const from = BigInt(band.lowerBoundMinor);
      if (taxable <= from) break;

      const to = band.upperBoundMinor === null ? null : BigInt(band.upperBoundMinor);
      const ceiling = to === null || taxable < to ? taxable : to;
      const inBand = ceiling - from;
      if (inBand <= 0n) continue;

      const bandTax = applyPercent(inBand, band.ratePercent);
      tax += bandTax;

      working.push({
        position: band.position,
        from: from.toString(),
        to: to === null ? null : to.toString(),
        ratePercent: band.ratePercent,
        taxableInBand: inBand.toString(),
        taxInBand: bandTax.toString(),
      });
    }

    // A floor on total tax, expressed against gross rather than taxable income.
    const minimumTax = applyPercent(grossMinor, regime.minimumTaxPercent);
    const minimumTaxApplied = grossMinor > 0n && minimumTax > tax;
    if (minimumTaxApplied) tax = minimumTax;

    if (tax > grossMinor) tax = grossMinor;

    return {
      grossMinor: grossMinor.toString(),
      reliefMinor: relief.toString(),
      taxableMinor: taxable.toString(),
      taxMinor: tax.toString(),
      netMinor: (grossMinor - tax).toString(),
      minimumTaxApplied,
      regimeId: regime.id,
      regimeName: regime.name,
      bands: working,
    };
  }

  /**
   * Gross up from a take-home figure.
   *
   * Tax is a step function of gross, so there is no closed form to invert.
   * Binary search converges on the smallest gross whose net covers the target,
   * which keeps the employee whole rather than a rupee short.
   */
  static solveGrossForNet(
    targetNetMinor: bigint,
    regime: TaxRegime,
    bands: TaxBand[]
  ): TaxComputation {
    if (targetNetMinor <= 0n) return TaxService.compute(0n, regime, bands);

    let low = targetNetMinor;
    // Tax can never exceed gross, so double until the net clears the target.
    let high = targetNetMinor * 2n;
    while (BigInt(TaxService.compute(high, regime, bands).netMinor) < targetNetMinor) {
      high *= 2n;
    }

    while (low < high) {
      const mid = (low + high) / 2n;
      if (BigInt(TaxService.compute(mid, regime, bands).netMinor) >= targetNetMinor) {
        high = mid;
      } else {
        low = mid + 1n;
      }
    }

    return TaxService.compute(low, regime, bands);
  }

  /**
   * Compute for one employee, resolving the regime and authority for them.
   * Handles both directions depending on whether the stored salary is gross.
   */
  static async computeForEmployee(params: {
    salaryMinor: bigint;
    salaryIsGross: boolean;
    stateCode: string;
    jurisdiction?: string;
    on?: Date;
  }): Promise<TaxComputation & { authority: TaxAuthority }> {
    const on = params.on ?? new Date();
    const { regime, bands } = await TaxService.resolveRegime(
      params.jurisdiction ?? "NG",
      on
    );
    const authority = await TaxService.resolveAuthority(params.stateCode);

    const computation = params.salaryIsGross
      ? TaxService.compute(params.salaryMinor, regime, bands)
      : TaxService.solveGrossForNet(params.salaryMinor, regime, bands);

    return { ...computation, authority };
  }

  /**
   * Record what PAYE was due on a batch that has just paid out.
   *
   * **The amount transferred on chain is what the employee received, so it is
   * the net figure and gross is solved back from it.** That is true whatever the
   * membership has stored, which is the point: a receipt should describe the
   * payment that happened, not the configuration that was meant to produce it.
   * `salaryIsGross` governs how a batch is built, not how it is accounted for
   * afterwards.
   *
   * Where the batch carried a tax authority as a recipient, the withheld total
   * left the treasury in the same transaction as the salaries, so those lines
   * land `remitted` against the batch's own hash. Where it did not, they land
   * `computed` and the money is still the employer's until someone records a
   * settlement. A placeholder authority never receives a transfer, so a batch
   * built against one leaves its lines `computed` like before.
   *
   * Idempotent by `(batchId, walletAddress)`, so a replayed execution webhook
   * cannot double-count someone's PAYE.
   *
   * **Single state, and that is a limitation rather than a decision.** PAYE is
   * owed to the state the employee resides in, but the membership records no
   * state, so every line here is attributed to the employer's
   * `defaultTaxStateCode`. For staff living elsewhere that is the wrong
   * authority. It costs nothing while authorities are placeholders and the
   * lines are only records; once one has a real wallet it is money sent to a
   * revenue service that is not owed it. Give the membership a state before
   * relying on this for anyone who does not live where their employer does.
   */
  static async recordLinesForBatch(batchId: string, on: Date = new Date()): Promise<number> {
    const [batch] = await db
      .select()
      .from(batchPayrolls)
      .where(eq(batchPayrolls.id, batchId))
      .limit(1);

    if (!batch) return 0;

    const [organization] = await db
      .select({
        id: organizations.id,
        taxEnabled: organizations.taxEnabled,
        defaultTaxStateCode: organizations.defaultTaxStateCode,
      })
      .from(organizations)
      .where(eq(organizations.id, batch.organizationId))
      .limit(1);

    // Opt in. An organization that has not configured PAYE gets no lines rather
    // than lines computed against a guessed jurisdiction.
    if (!organization?.taxEnabled) return 0;

    if (!organization.defaultTaxStateCode) {
      throw new AppError(
        "This organization has tax enabled but no default state of residence",
        409
      );
    }

    // Employees only. The authority rides in the same batch as a recipient, and
    // computing PAYE on the PAYE payment would inflate every batch's liability
    // with a figure that looks plausible.
    const recipients = await db
      .select()
      .from(batchPayrollRecipients)
      .where(
        and(
          eq(batchPayrollRecipients.batchId, batchId),
          eq(batchPayrollRecipients.kind, "employee")
        )
      );

    if (recipients.length === 0) return 0;

    const { regime, bands } = await TaxService.resolveRegime("NG", on);
    const authority = await TaxService.resolveAuthority(organization.defaultTaxStateCode);

    // The batch settles its own PAYE when it carried the authority as a
    // recipient. Matched on the address actually paid rather than on the
    // authority's current address, which may since have been rotated.
    const [authorityLeg] = await db
      .select({ id: batchPayrollRecipients.id })
      .from(batchPayrollRecipients)
      .where(
        and(
          eq(batchPayrollRecipients.batchId, batchId),
          eq(batchPayrollRecipients.kind, "tax_authority"),
          eq(batchPayrollRecipients.walletAddress, authority.walletAddress.toLowerCase())
        )
      )
      .limit(1);

    const settledByBatch = Boolean(authorityLeg && batch.txHash);

    const rows = recipients.map((recipient) => {
      const computation = TaxService.solveGrossForNet(
        BigInt(recipient.amount),
        regime,
        bands
      );

      return {
        batchId,
        organizationId: batch.organizationId,
        userId: recipient.userId ?? null,
        walletAddress: recipient.walletAddress.toLowerCase(),
        grossMinor: computation.grossMinor,
        taxMinor: computation.taxMinor,
        netMinor: computation.netMinor,
        regimeId: regime.id,
        taxAuthorityId: authority.id,
        status: settledByBatch ? ("remitted" as const) : ("computed" as const),
        remittanceTxHash: settledByBatch ? batch.txHash : null,
        remittedAt: settledByBatch ? new Date() : null,
        breakdown: {
          regimeName: computation.regimeName,
          // Carried onto the line rather than looked up later, so a receipt
          // printed from an unchecked band table says so on its face.
          regimeVerified: regime.verified,
          reliefMinor: computation.reliefMinor,
          taxableMinor: computation.taxableMinor,
          minimumTaxApplied: computation.minimumTaxApplied,
          bands: computation.bands,
        } as Record<string, unknown>,
      };
    });

    const inserted = await db
      .insert(payrollTaxLines)
      .values(rows)
      .onConflictDoNothing({
        target: [payrollTaxLines.batchId, payrollTaxLines.walletAddress],
      })
      .returning({ id: payrollTaxLines.id });

    return inserted.length;
  }

  /**
   * What PAYE would be withheld if these people were paid now.
   *
   * Nothing is written. This exists so the signer raising a batch sees the same
   * figures the receipt will carry, computed from the organization's own regime
   * rather than a rate assumed in the browser. An organization without tax
   * enabled gets `taxEnabled: false` and no per-person lines, because the
   * alternative is quoting a deduction that will never be taken.
   */
  static async previewForAddresses(
    organizationId: string,
    addresses: string[],
    on: Date = new Date()
  ): Promise<{
    taxEnabled: boolean;
    regimeVerified: boolean;
    /**
     * Where the withheld total is paid, and whether that address is real.
     * A placeholder authority must not receive a transfer, so the browser is
     * told which it is rather than being left to assume.
     *
     * One authority for the whole batch, resolved from the organization's
     * default state. That is only right while everyone paid lives where their
     * employer does, since PAYE follows the employee's state of residence.
     */
    authority: { name: string; address: string; isPlaceholder: boolean } | null;
    lines: {
      address: string;
      grossFormatted: string;
      taxFormatted: string;
      netFormatted: string;
      /**
       * Base units, so the browser composes the payroll transaction from the
       * same figures the receipt will carry. Re-deriving a split in the
       * browser from formatted decimals is how the transferred amount and the
       * recorded amount drift apart.
       */
      grossMinor: string;
      taxMinor: string;
      netMinor: string;
    }[];
  }> {
    const [organization] = await db
      .select({
        taxEnabled: organizations.taxEnabled,
        defaultTaxStateCode: organizations.defaultTaxStateCode,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    if (!organization?.taxEnabled) {
      return { taxEnabled: false, regimeVerified: false, authority: null, lines: [] };
    }

    if (!organization.defaultTaxStateCode) {
      throw new AppError(
        "This organization has tax enabled but no default state of residence",
        409
      );
    }

    const wanted = new Set(addresses.map((a) => a.toLowerCase()));
    const members = await db
      .select({
        address: organizationMembers.address,
        salary: organizationMembers.salary,
        salaryIsGross: organizationMembers.salaryIsGross,
      })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.organizationId, organizationId),
          eq(organizationMembers.role, "employee"),
          eq(organizationMembers.isActive, true)
        )
      );

    const { regime } = await TaxService.resolveRegime("NG", on);

    const lines = [];
    for (const member of members) {
      if (!member.address || !wanted.has(member.address.toLowerCase())) continue;
      if (member.salary === null) continue;

      const computation = await TaxService.computeForEmployee({
        salaryMinor: BigInt(member.salary),
        salaryIsGross: member.salaryIsGross,
        stateCode: organization.defaultTaxStateCode,
        on,
      });

      lines.push({
        address: member.address,
        grossFormatted: await TokenService.format(computation.grossMinor),
        taxFormatted: await TokenService.format(computation.taxMinor),
        netFormatted: await TokenService.format(computation.netMinor),
        grossMinor: computation.grossMinor,
        taxMinor: computation.taxMinor,
        netMinor: computation.netMinor,
      });
    }

    const authority = await TaxService.resolveAuthority(organization.defaultTaxStateCode);

    return {
      taxEnabled: true,
      regimeVerified: regime.verified,
      authority: {
        name: authority.name,
        address: authority.walletAddress,
        isPlaceholder: authority.isPlaceholder,
      },
      lines,
    };
  }

  /** Lines for one batch, for a payslip run or a remittance schedule. */
  static async linesForBatch(batchId: string): Promise<PayrollTaxLine[]> {
    return db
      .select()
      .from(payrollTaxLines)
      .where(eq(payrollTaxLines.batchId, batchId))
      .orderBy(asc(payrollTaxLines.walletAddress));
  }

  /**
   * A batch's lines with amounts formatted and a name attached, for the signer
   * view that decides what still needs remitting.
   *
   * The name comes from `batch_payroll_recipients`, snapshotted when the batch
   * was raised, rather than looked up again from current membership: a line
   * describes the payment that happened, and who it happened to should not
   * drift if that person is later renamed or leaves.
   */
  static async linesForBatchDisplay(batchId: string): Promise<
    (PayrollTaxLine & {
      grossFormatted: string;
      taxFormatted: string;
      netFormatted: string;
      employeeName: string;
    })[]
  > {
    const [lines, recipients] = await Promise.all([
      TaxService.linesForBatch(batchId),
      db
        .select({
          walletAddress: batchPayrollRecipients.walletAddress,
          employeeName: batchPayrollRecipients.employeeName,
        })
        .from(batchPayrollRecipients)
        .where(eq(batchPayrollRecipients.batchId, batchId)),
    ]);

    const nameByAddress = new Map(
      recipients.map((r) => [r.walletAddress.toLowerCase(), r.employeeName])
    );

    return Promise.all(
      lines.map(async (line) => ({
        ...line,
        grossFormatted: await TokenService.format(line.grossMinor),
        taxFormatted: await TokenService.format(line.taxMinor),
        netFormatted: await TokenService.format(line.netMinor),
        employeeName: nameByAddress.get(line.walletAddress.toLowerCase()) ?? line.walletAddress,
      }))
    );
  }

  /** One person's PAYE history, which is what a year end statement is built from. */
  static async linesForUser(userId: string): Promise<PayrollTaxLine[]> {
    return db
      .select()
      .from(payrollTaxLines)
      .where(eq(payrollTaxLines.userId, userId))
      .orderBy(desc(payrollTaxLines.createdAt));
  }

  /**
   * Records that PAYE already withheld has been sent to the state authority.
   *
   * No transaction happens here. No authority accepts on-chain settlement yet,
   * so the reference is whatever the bank transfer gave back, typed in by the
   * signer who sent it. This is the only thing that moves a line off
   * `computed`, and once it does, the receipt stops saying the money is still
   * the employer's.
   */
  static async markRemitted(
    lineId: string,
    params: { reference: string; remittedBy: string }
  ): Promise<PayrollTaxLine> {
    const reference = params.reference.trim();
    if (!reference) throw new AppError("A remittance reference is required", 400);

    const [line] = await db
      .select({ id: payrollTaxLines.id, status: payrollTaxLines.status })
      .from(payrollTaxLines)
      .where(eq(payrollTaxLines.id, lineId))
      .limit(1);

    if (!line) throw new AppError("Tax line not found", 404);
    if (line.status === "remitted") {
      throw new AppError("This line has already been marked as remitted", 409);
    }

    const [updated] = await db
      .update(payrollTaxLines)
      .set({
        status: "remitted",
        remittanceReference: reference,
        remittedAt: new Date(),
        remittedBy: params.remittedBy,
      })
      .where(eq(payrollTaxLines.id, lineId))
      .returning();

    return updated;
  }
}
