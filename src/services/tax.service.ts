import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  batchPayrollRecipients,
  batchPayrolls,
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
   * Nothing is remitted here. Lines land as `computed`, and the money is still
   * the employer's until a remittance sets `remittanceTxHash`. The authorities
   * cannot receive on chain yet, which is what `isPlaceholder` records, and
   * inventing a transfer to a placeholder address would lose real money.
   *
   * Idempotent by `(batchId, walletAddress)`, so a replayed execution webhook
   * cannot double-count someone's PAYE.
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

    const recipients = await db
      .select()
      .from(batchPayrollRecipients)
      .where(eq(batchPayrollRecipients.batchId, batchId));

    if (recipients.length === 0) return 0;

    const { regime, bands } = await TaxService.resolveRegime("NG", on);
    const authority = await TaxService.resolveAuthority(organization.defaultTaxStateCode);

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

  /** Lines for one batch, for a payslip run or a remittance schedule. */
  static async linesForBatch(batchId: string): Promise<PayrollTaxLine[]> {
    return db
      .select()
      .from(payrollTaxLines)
      .where(eq(payrollTaxLines.batchId, batchId))
      .orderBy(asc(payrollTaxLines.walletAddress));
  }

  /** One person's PAYE history, which is what a year end statement is built from. */
  static async linesForUser(userId: string): Promise<PayrollTaxLine[]> {
    return db
      .select()
      .from(payrollTaxLines)
      .where(eq(payrollTaxLines.userId, userId))
      .orderBy(desc(payrollTaxLines.createdAt));
  }
}
