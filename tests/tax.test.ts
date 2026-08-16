import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { server, sql, user, organization } from "./helpers/harness.js";
import { TaxService } from "../src/services/tax.service.js";
import type { TaxBand, TaxRegime } from "../src/db/types.js";

/**
 * PAYE arithmetic and the rule that decides which figure is which.
 *
 * The amount transferred on chain is what the employee received, so it is net
 * and gross is solved back from it. Getting that backwards under-withholds every
 * salary, and the employer carries the shortfall.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

// Two decimals keeps the arithmetic readable. Nothing here assumes six.
const D = 2;
const naira = (whole: number) => (BigInt(whole) * 10n ** BigInt(D)).toString();

const regime = {
  id: "00000000-0000-0000-0000-0000000000aa",
  name: "Test regime",
  reliefFixedMinor: naira(200_000),
  reliefPercentOfGross: "1.000",
  reliefAdditionalPercentOfGross: "20.000",
  minimumTaxPercent: "1.000",
  verified: false,
} as unknown as TaxRegime;

const bands = [
  { position: 0, lowerBoundMinor: naira(0), upperBoundMinor: naira(300_000), ratePercent: "7.000" },
  { position: 1, lowerBoundMinor: naira(300_000), upperBoundMinor: naira(600_000), ratePercent: "11.000" },
  { position: 2, lowerBoundMinor: naira(600_000), upperBoundMinor: null, ratePercent: "15.000" },
] as unknown as TaxBand[];

describe("computing PAYE", () => {
  it("takes relief as the greater of the floor or the percentage, plus the addition", () => {
    // Gross 1,000,000: 1% is 10,000, under the 200,000 floor, so relief is
    // 200,000 + 20% = 400,000, leaving 600,000 taxable.
    const result = TaxService.compute(BigInt(naira(1_000_000)), regime, bands);

    assert.equal(result.reliefMinor, naira(400_000));
    assert.equal(result.taxableMinor, naira(600_000));
    // 300,000 @ 7% = 21,000; 300,000 @ 11% = 33,000.
    assert.equal(result.taxMinor, naira(54_000));
    assert.equal(result.netMinor, naira(946_000));
  });

  it("switches to the percentage once it passes the floor", () => {
    // Gross 40,000,000: 1% is 400,000, now above the 200,000 floor.
    const result = TaxService.compute(BigInt(naira(40_000_000)), regime, bands);
    assert.equal(result.reliefMinor, naira(8_400_000));
  });

  it("applies the minimum tax when the bands yield less", () => {
    // Relief exceeds gross, so the bands produce nothing and the 1% floor bites.
    const result = TaxService.compute(BigInt(naira(100_000)), regime, bands);

    assert.equal(result.taxableMinor, "0");
    assert.equal(result.minimumTaxApplied, true);
    assert.equal(result.taxMinor, naira(1_000));
  });

  it("charges nothing on nothing", () => {
    const result = TaxService.compute(0n, regime, bands);
    assert.equal(result.taxMinor, "0");
    assert.equal(result.minimumTaxApplied, false, "a zero payroll is not a minimum tax case");
  });

  it("never charges more tax than there was gross", () => {
    for (const gross of [1, 10, 1_000, 250_000]) {
      const result = TaxService.compute(BigInt(naira(gross)), regime, bands);
      assert.ok(BigInt(result.taxMinor) <= BigInt(naira(gross)));
      assert.ok(BigInt(result.netMinor) >= 0n);
    }
  });
});

describe("grossing up from a take-home figure", () => {
  it("finds a gross whose net covers the target", () => {
    for (const target of [50_000, 946_000, 5_000_000]) {
      const result = TaxService.solveGrossForNet(BigInt(naira(target)), regime, bands);

      assert.ok(
        BigInt(result.netMinor) >= BigInt(naira(target)),
        `net ${result.netMinor} must cover ${naira(target)}`
      );
    }
  });

  it("finds the smallest such gross, so the employer is not overcharged", () => {
    const target = BigInt(naira(946_000));
    const result = TaxService.solveGrossForNet(target, regime, bands);

    const oneLess = TaxService.compute(BigInt(result.grossMinor) - 1n, regime, bands);
    assert.ok(
      BigInt(oneLess.netMinor) < target,
      "a smaller gross would still have covered the target, so this is not minimal"
    );
  });

  it("round trips against compute", () => {
    const gross = BigInt(naira(1_000_000));
    const forward = TaxService.compute(gross, regime, bands);
    const back = TaxService.solveGrossForNet(BigInt(forward.netMinor), regime, bands);

    assert.equal(back.grossMinor, gross.toString());
  });
});

describe("recording lines for a batch", () => {
  it("writes nothing for an organization that has not enabled tax", async () => {
    const owner = await user("TaxOff");
    const org = await organization({ owner: owner.address, quorum: 1 });

    const [batch] = await sql`
      insert into batch_payrolls
        (batch_name, organization_id, organization_address, creator_address,
         total_amount, quorum_required, expires_at)
      values (${`untaxed-${Date.now()}`}, ${org.id}, ${org.treasury}, ${owner.address},
              '1000000', 1, now() + interval '30 days')
      returning id`;

    assert.equal(await TaxService.recordLinesForBatch(batch.id), 0);

    const [count] = await sql`
      select count(*)::int as n from payroll_tax_lines where batch_id = ${batch.id}`;
    assert.equal(count.n, 0);
  });

  it("refuses when tax is on but no state of residence is set", async () => {
    const owner = await user("NoState");
    const org = await organization({ owner: owner.address, quorum: 1 });

    await sql`update organizations set tax_enabled = true where id = ${org.id}`;

    const [batch] = await sql`
      insert into batch_payrolls
        (batch_name, organization_id, organization_address, creator_address,
         total_amount, quorum_required, expires_at)
      values (${`nostate-${Date.now()}`}, ${org.id}, ${org.treasury}, ${owner.address},
              '1000000', 1, now() + interval '30 days')
      returning id`;

    await assert.rejects(
      () => TaxService.recordLinesForBatch(batch.id),
      /no default state of residence/
    );
  });
});
