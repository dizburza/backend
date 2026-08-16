import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { organization, server, sql, user } from "./helpers/harness.js";
import { TaxDocumentService } from "../src/services/taxDocument.service.js";

/**
 * A tax line pairs a salary with a name and a wallet address, which is the
 * mapping the directory rate limit exists to protect. These assert who may read
 * one, and that the documents actually render.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

const isPdf = (buffer: Buffer) => buffer.subarray(0, 5).toString() === "%PDF-";

/** A batch that has paid out, with one tax line against it. */
async function paidBatch(options: {
  owner: string;
  employee: { address: string; userId?: string | null };
  organizationId: string;
  treasury: string;
  verified?: boolean;
}) {
  const [batch] = await sql`
    insert into batch_payrolls
      (batch_name, organization_id, organization_address, creator_address,
       total_amount, quorum_required, expires_at, status, executed_at, tx_hash)
    values (${`paid-${crypto.randomUUID().slice(0, 8)}`}, ${options.organizationId},
            ${options.treasury}, ${options.owner}, '946000000000', 1,
            now() + interval '30 days', 'executed', now(), ${"0x" + "ab".repeat(32)})
    returning id`;

  const [line] = await sql`
    insert into payroll_tax_lines
      (batch_id, organization_id, user_id, wallet_address,
       gross_minor, tax_minor, net_minor, breakdown)
    values (${batch.id}, ${options.organizationId}, ${options.employee.userId ?? null},
            ${options.employee.address}, '1000000000000', '54000000000', '946000000000',
            ${sql.json({
              regimeName: "Test regime",
              regimeVerified: options.verified ?? false,
              reliefMinor: "400000000000",
              taxableMinor: "600000000000",
              minimumTaxApplied: false,
              bands: [
                {
                  position: 0,
                  from: "0",
                  to: "300000000000",
                  ratePercent: "7.000",
                  taxableInBand: "300000000000",
                  taxInBand: "21000000000",
                },
              ],
            })})
    returning id`;

  return { batchId: batch.id as string, lineId: line.id as string };
}

describe("PAYE receipts", () => {
  it("render a PDF for the employee they describe", async () => {
    const owner = await user("Boss");
    const employee = await user("Worker");
    const org = await organization({
      owner: owner.address,
      quorum: 1,
      employees: [{ address: employee.address, name: "Worker Tester" }],
    });

    const [account] = await sql`
      select id from users where wallet_address = ${employee.address}`;

    const { lineId } = await paidBatch({
      owner: owner.address,
      employee: { address: employee.address, userId: account.id },
      organizationId: org.id,
      treasury: org.treasury,
    });

    const pdf = await TaxDocumentService.receipt(lineId, {
      userId: account.id,
      walletAddress: employee.address,
    });

    assert.ok(isPdf(pdf), "must be a PDF");
    assert.ok(pdf.length > 1000, "and not an empty one");
  });

  it("render for a signer of the organization that paid it", async () => {
    const owner = await user("Boss");
    const employee = await user("Worker");
    const org = await organization({
      owner: owner.address,
      quorum: 1,
      employees: [{ address: employee.address }],
    });

    const [ownerAccount] = await sql`
      select id from users where wallet_address = ${owner.address}`;

    const { lineId } = await paidBatch({
      owner: owner.address,
      employee: { address: employee.address },
      organizationId: org.id,
      treasury: org.treasury,
    });

    const pdf = await TaxDocumentService.receipt(lineId, {
      userId: ownerAccount.id,
      walletAddress: owner.address,
    });

    assert.ok(isPdf(pdf));
  });

  it("refuse a stranger", async () => {
    const owner = await user("Boss");
    const employee = await user("Worker");
    const mallory = await user("Mallory");
    const org = await organization({
      owner: owner.address,
      quorum: 1,
      employees: [{ address: employee.address }],
    });

    const [malloryAccount] = await sql`
      select id from users where wallet_address = ${mallory.address}`;

    const { lineId } = await paidBatch({
      owner: owner.address,
      employee: { address: employee.address },
      organizationId: org.id,
      treasury: org.treasury,
    });

    await assert.rejects(
      () =>
        TaxDocumentService.receipt(lineId, {
          userId: malloryAccount.id,
          walletAddress: mallory.address,
        }),
      /cannot read this tax record/
    );
  });

  it("refuse a signer of a different organization", async () => {
    const owner = await user("Boss");
    const employee = await user("Worker");
    const rival = await user("Rival");
    const org = await organization({
      owner: owner.address,
      quorum: 1,
      employees: [{ address: employee.address }],
    });
    await organization({ owner: rival.address, quorum: 1 });

    const [rivalAccount] = await sql`
      select id from users where wallet_address = ${rival.address}`;

    const { lineId } = await paidBatch({
      owner: owner.address,
      employee: { address: employee.address },
      organizationId: org.id,
      treasury: org.treasury,
    });

    await assert.rejects(
      () =>
        TaxDocumentService.receipt(lineId, {
          userId: rivalAccount.id,
          walletAddress: rival.address,
        }),
      /cannot read this tax record/
    );
  });

  it("refuse a line that does not exist, without saying so differently", async () => {
    const someone = await user("Someone");
    const [account] = await sql`
      select id from users where wallet_address = ${someone.address}`;

    await assert.rejects(
      () =>
        TaxDocumentService.receipt(crypto.randomUUID(), {
          userId: account.id,
          walletAddress: someone.address,
        }),
      /No such tax record/
    );
  });
});

describe("PAYE statements", () => {
  it("render a year for the person it belongs to", async () => {
    const owner = await user("Boss");
    const employee = await user("Worker");
    const org = await organization({
      owner: owner.address,
      quorum: 1,
      employees: [{ address: employee.address }],
    });

    const [account] = await sql`
      select id from users where wallet_address = ${employee.address}`;

    await paidBatch({
      owner: owner.address,
      employee: { address: employee.address, userId: account.id },
      organizationId: org.id,
      treasury: org.treasury,
    });

    const pdf = await TaxDocumentService.statement(
      account.id,
      new Date().getUTCFullYear()
    );

    assert.ok(isPdf(pdf));
    assert.ok(pdf.length > 1000);
  });

  it("render an empty year rather than failing", async () => {
    const someone = await user("Quiet");
    const [account] = await sql`
      select id from users where wallet_address = ${someone.address}`;

    const pdf = await TaxDocumentService.statement(account.id, 2001);

    assert.ok(isPdf(pdf), "a year with no payroll is still a valid statement");
  });
});

describe("the routes", () => {
  it("refuse an anonymous caller", async () => {
    const { anon } = await import("./helpers/harness.js");

    for (const path of ["/tax/me", "/tax/me/statement.pdf"]) {
      const res = await anon(path);
      assert.equal(res.status, 401, `${path} must need a session`);
    }
  });

  it("serve a statement as a PDF attachment", async () => {
    const someone = await user("Downloader");
    const { baseUrl } = await server();

    // Fetched directly because the helper parses JSON, and this is not JSON.
    const res = await fetch(`${baseUrl}/tax/me/statement.pdf?year=2001`, {
      headers: { cookie: someone.cookie() },
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/pdf");
    assert.match(
      res.headers.get("content-disposition") ?? "",
      /attachment; filename="paye-statement-2001\.pdf"/
    );

    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(isPdf(body), "and the body is a real PDF");
  });

  it("refuse a year outside any plausible range", async () => {
    const someone = await user("Ranger");
    const res = await someone.call("/tax/me/statement.pdf?year=1200");
    assert.equal(res.status, 400);
  });
});
