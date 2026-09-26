/**
 * Point one state's authority at a real wallet, so its PAYE is paid on chain
 * with the batch rather than recorded as owed.
 *
 * This is the switch the whole tax-on-chain path hangs off: every authority
 * ships as a placeholder, and nothing transfers to a placeholder. Run this only
 * for an address that genuinely belongs to that authority, or for a wallet you
 * control and are demonstrating with. Money sent here is not recoverable.
 *
 * Note what a batch currently routes: PAYE is owed to the state each employee
 * lives in, but the membership records no state, so a batch pays it all to the
 * employer's default state. Arming a real wallet here while staff live in other
 * states sends their PAYE to the wrong revenue service.
 *
 *   npx tsx src/db/set-tax-authority-wallet.ts LA 0xYourWallet
 *
 * Pass --placeholder to put a state back, which stops it being paid.
 */
import { eq } from "drizzle-orm";
import { ethers } from "ethers";
import { db } from "./client.js";
import { taxAuthorities } from "./schema.js";

const [, , stateCodeArg, walletArg, ...flags] = process.argv;
const revert = flags.includes("--placeholder");

if (!stateCodeArg || (!walletArg && !revert)) {
  console.error("usage: set-tax-authority-wallet.ts <stateCode> <wallet> [--placeholder]");
  process.exit(1);
}

const stateCode = stateCodeArg.toUpperCase();

if (walletArg && !ethers.isAddress(walletArg)) {
  console.error(`Not a valid address: ${walletArg}`);
  process.exit(1);
}

const [authority] = await db
  .select()
  .from(taxAuthorities)
  .where(eq(taxAuthorities.stateCode, stateCode))
  .limit(1);

if (!authority) {
  console.error(`No authority seeded for ${stateCode}. Run npm run db:seed:tax first.`);
  process.exit(1);
}

const [updated] = await db
  .update(taxAuthorities)
  .set({
    walletAddress: revert ? authority.walletAddress : walletArg.toLowerCase(),
    isPlaceholder: revert,
  })
  .where(eq(taxAuthorities.id, authority.id))
  .returning();

console.log(
  revert
    ? `${updated.name} is a placeholder again. Its PAYE will be recorded, not paid.`
    : `${updated.name} now receives PAYE at ${updated.walletAddress} in the payroll batch.`
);

process.exit(0);
