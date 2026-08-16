import { eq } from "drizzle-orm";
import { closeDb, db } from "./client.js";
import { taxAuthorities, taxBands, taxRegimes } from "./schema.js";
import logger from "../utils/logger.util.js";

/**
 * Starting figures for Nigerian PAYE.
 *
 * **Every regime here lands with `verified: false` and stays that way until a
 * human has checked it against the current law.** That flag is not decoration.
 * Nigeria's personal income tax changed with the Nigeria Tax Act, and a band
 * table that is a year stale does not fail loudly, it quietly under-withholds
 * every salary and leaves the employer owing the difference. Read the figures
 * off the Act, correct them here, then set the flag.
 *
 * Amounts are in token base units, so they scale by the payroll token's
 * decimals rather than being written with a hardcoded six.
 *
 * Run with `npm run db:seed:tax`. Idempotent by regime name and state code.
 */

const NAIRA = (whole: number, decimals: number): string =>
  (BigInt(whole) * 10n ** BigInt(decimals)).toString();

/** The graduated bands, as lower bound and rate. Upper bounds are derived. */
type BandSpec = { from: number; ratePercent: string };

type RegimeSpec = {
  name: string;
  jurisdiction: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reliefFixed: number;
  reliefPercentOfGross: string;
  reliefAdditionalPercentOfGross: string;
  minimumTaxPercent: string;
  notes: string;
  bands: BandSpec[];
};

const REGIMES: RegimeSpec[] = [
  {
    name: "Nigeria PITA (pre-2026)",
    jurisdiction: "NG",
    effectiveFrom: "2011-06-14",
    effectiveTo: "2025-12-31",
    // Consolidated relief allowance: the higher of N200,000 or 1% of gross,
    // plus 20% of gross.
    reliefFixed: 200_000,
    reliefPercentOfGross: "1.000",
    reliefAdditionalPercentOfGross: "20.000",
    minimumTaxPercent: "1.000",
    notes:
      "Personal Income Tax Act as amended by the Finance Acts. Kept so a receipt " +
      "reissued for a 2025 payroll reproduces the figure that was charged then.",
    bands: [
      { from: 0, ratePercent: "7.000" },
      { from: 300_000, ratePercent: "11.000" },
      { from: 600_000, ratePercent: "15.000" },
      { from: 1_100_000, ratePercent: "19.000" },
      { from: 1_600_000, ratePercent: "21.000" },
      { from: 3_200_000, ratePercent: "24.000" },
    ],
  },
  {
    name: "Nigeria Tax Act 2025",
    jurisdiction: "NG",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    // The consolidated relief allowance was replaced by a rent relief and a
    // zero-rated first band. Both figures below are placeholders.
    reliefFixed: 0,
    reliefPercentOfGross: "0.000",
    reliefAdditionalPercentOfGross: "20.000",
    minimumTaxPercent: "0.000",
    notes:
      "PLACEHOLDER. Bands and reliefs must be read off the Nigeria Tax Act before " +
      "this is marked verified. The first band is zero rated, which means an " +
      "unverified table under-withholds rather than over-withholds, and the " +
      "employer carries that shortfall.",
    bands: [
      { from: 0, ratePercent: "0.000" },
      { from: 800_000, ratePercent: "15.000" },
      { from: 3_000_000, ratePercent: "18.000" },
      { from: 12_000_000, ratePercent: "21.000" },
      { from: 25_000_000, ratePercent: "23.000" },
      { from: 50_000_000, ratePercent: "25.000" },
    ],
  },
];

/**
 * State revenue services, with placeholder wallets.
 *
 * `isPlaceholder` is true for all of them because no state IRS accepts on-chain
 * settlement today. A line stays `computed` until that changes, which is the
 * honest state: the tax is owed and calculated, and the money has not moved.
 */
const AUTHORITIES = [
  { stateCode: "LA", name: "Lagos State Internal Revenue Service" },
  { stateCode: "FC", name: "FCT Internal Revenue Service" },
  { stateCode: "RI", name: "Rivers State Internal Revenue Service" },
  { stateCode: "OG", name: "Ogun State Internal Revenue Service" },
  { stateCode: "KN", name: "Kano State Internal Revenue Service" },
  { stateCode: "OY", name: "Oyo State Internal Revenue Service" },
  { stateCode: "KD", name: "Kaduna State Internal Revenue Service" },
  { stateCode: "EN", name: "Enugu State Internal Revenue Service" },
  { stateCode: "AN", name: "Anambra State Internal Revenue Service" },
  { stateCode: "DE", name: "Delta State Internal Revenue Service" },
];

/** Distinct, obviously-not-real, and not the zero address, which burns. */
const placeholderWallet = (index: number): string =>
  "0x" + "fa17".repeat(9) + index.toString(16).padStart(4, "0");

async function seed(decimals: number): Promise<void> {
  for (const spec of REGIMES) {
    const [existing] = await db
      .select({ id: taxRegimes.id, verified: taxRegimes.verified })
      .from(taxRegimes)
      .where(eq(taxRegimes.name, spec.name))
      .limit(1);

    if (existing) {
      // Never overwrite a table someone has already checked.
      logger.info(
        `Regime "${spec.name}" already present (verified: ${existing.verified}), leaving it alone`
      );
      continue;
    }

    const [regime] = await db
      .insert(taxRegimes)
      .values({
        name: spec.name,
        jurisdiction: spec.jurisdiction,
        effectiveFrom: new Date(spec.effectiveFrom),
        effectiveTo: spec.effectiveTo ? new Date(spec.effectiveTo) : null,
        reliefFixedMinor: NAIRA(spec.reliefFixed, decimals),
        reliefPercentOfGross: spec.reliefPercentOfGross,
        reliefAdditionalPercentOfGross: spec.reliefAdditionalPercentOfGross,
        minimumTaxPercent: spec.minimumTaxPercent,
        verified: false,
        notes: spec.notes,
      })
      .returning({ id: taxRegimes.id });

    await db.insert(taxBands).values(
      spec.bands.map((band, position) => ({
        regimeId: regime.id,
        position,
        lowerBoundMinor: NAIRA(band.from, decimals),
        upperBoundMinor:
          position === spec.bands.length - 1
            ? null
            : NAIRA(spec.bands[position + 1].from, decimals),
        ratePercent: band.ratePercent,
      }))
    );

    logger.info(`Seeded regime "${spec.name}" with ${spec.bands.length} bands, unverified`);
  }

  for (const [index, authority] of AUTHORITIES.entries()) {
    await db
      .insert(taxAuthorities)
      .values({
        name: authority.name,
        stateCode: authority.stateCode,
        walletAddress: placeholderWallet(index),
        isPlaceholder: true,
      })
      .onConflictDoNothing({ target: taxAuthorities.stateCode });
  }

  logger.info(`Seeded ${AUTHORITIES.length} tax authorities, all with placeholder wallets`);
}

/**
 * Decimals come from the token, never a literal.
 *
 * Imported lazily so the seed can be pointed at a database without the chain
 * being reachable, in which case it refuses rather than assuming six.
 */
const resolveDecimals = async (): Promise<number> => {
  const { TokenService } = await import("../services/token.service.js");
  const token = await TokenService.getDefault();
  return token.decimals;
};

resolveDecimals()
  .then(seed)
  .then(() => {
    logger.warn(
      "Tax regimes are seeded UNVERIFIED. Check the bands against the current " +
        "Act and set tax_regimes.verified before running a real payroll."
    );
  })
  .catch((error) => {
    logger.error("Tax seed failed:", error);
    process.exitCode = 1;
  })
  .finally(closeDb);
