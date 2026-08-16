import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { inAWeek, organization, server, sql, user } from "./helpers/harness.js";

/**
 * A proposal records that the signers agreed to something. It never moves
 * money, so there is nothing here about disbursement: settling one is a payroll
 * batch with its own quorum on chain.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

const raise = (client: Awaited<ReturnType<typeof user>>, organizationId: string, title = "Q4 move") =>
  client.call("/proposals", {
    method: "POST",
    body: JSON.stringify({ organizationId, title, amount: "1500", closesAt: inAWeek() }),
  });

const vote = (
  client: Awaited<ReturnType<typeof user>>,
  proposalId: string,
  choice: "for" | "against"
) =>
  client.call(`/proposals/${proposalId}/votes`, {
    method: "POST",
    body: JSON.stringify({ choice }),
  });

describe("raising", () => {
  it("snapshots the quorum it was raised under", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });

    const created = await raise(owner, org.id);

    assert.equal(created.status, 201);
    assert.equal(created.body.data.votesRequired, 2);
    assert.equal(created.body.data.signerCountAtCreation, 2);
  });

  it("scales the amount by the token's decimals", async () => {
    const owner = await user("Owner");
    const org = await organization({ owner: owner.address, quorum: 1 });

    const created = await raise(owner, org.id);

    assert.equal(created.body.data.amountFormatted, "1500.0");
    assert.notEqual(created.body.data.amount, "1500", "must be base units, not the input");
  });

  it("refuses a non-signer", async () => {
    const owner = await user("Owner");
    const stranger = await user("Stranger");
    const org = await organization({ owner: owner.address });

    assert.equal((await raise(stranger, org.id)).status, 403);
  });
});

describe("voting", () => {
  it("counts one vote per signer", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });
    const proposal = (await raise(owner, org.id)).body.data;

    assert.equal((await vote(owner, proposal.id, "for")).status, 200);

    const repeat = await vote(owner, proposal.id, "for");
    assert.equal(repeat.status, 409);
    assert.match(repeat.body.message ?? repeat.body.error, /already voted/i);
  });

  it("latches the outcome once quorum is reached", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });
    const proposal = (await raise(owner, org.id)).body.data;

    await vote(owner, proposal.id, "for");
    const decided = await vote(second, proposal.id, "for");

    assert.equal(decided.body.data.status, "passed");

    // Moving the bar afterwards must not unpick a decision already acted on.
    await sql`update organizations set quorum = 3 where id = ${org.id}`;

    const reread = await owner.call(`/proposals/${proposal.id}`);
    assert.equal(reread.body.data.status, "passed");
  });

  it("rejects early once quorum has become unreachable", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const third = await user("Third");
    const org = await organization({
      owner: owner.address,
      quorum: 3,
      signers: [second.address, third.address],
    });
    const proposal = (await raise(owner, org.id)).body.data;

    const after = await vote(owner, proposal.id, "against");

    assert.equal(
      after.body.data.status,
      "rejected",
      "3 of 3 cannot pass once one signer is against, so waiting out the clock helps nobody"
    );
  });

  it("refuses a signer of another organization", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const rival = await user("Rival");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });
    await organization({ owner: rival.address });

    const proposal = (await raise(owner, org.id)).body.data;

    assert.equal((await vote(rival, proposal.id, "for")).status, 403);
    assert.equal((await rival.call(`/proposals/${proposal.id}`)).status, 403);
  });
});

describe("withdrawing", () => {
  it("is only for the signer who raised it, and only while open", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });
    const proposal = (await raise(owner, org.id)).body.data;

    assert.equal(
      (await second.call(`/proposals/${proposal.id}/cancel`, { method: "POST" })).status,
      403
    );

    const cancelled = await owner.call(`/proposals/${proposal.id}/cancel`, { method: "POST" });
    assert.equal(cancelled.body.data.status, "cancelled");

    assert.equal(
      (await owner.call(`/proposals/${proposal.id}/cancel`, { method: "POST" })).status,
      409
    );
  });
});

describe("settling", () => {
  /**
   * A batch may name the proposal it settles. The link is a reference and never
   * an instruction: nothing reads the proposal's amount, and money still moves
   * only through the batch's own quorum on chain. These are the guards that stop
   * the reference lying.
   */
  const createBatch = (
    client: Awaited<ReturnType<typeof user>>,
    org: { id: string; treasury: string },
    batchName: string,
    proposalId: string | null
  ) =>
    client.call("/payroll/batches", {
      method: "POST",
      body: JSON.stringify({
        batchName,
        organizationId: org.id,
        organizationAddress: org.treasury,
        creatorAddress: client.address,
        recipients: [
          { walletAddress: client.address, amount: "1000000", employeeName: "Payee" },
        ],
        proposalId,
      }),
    });

  const passedProposal = async (
    owner: Awaited<ReturnType<typeof user>>,
    organizationId: string,
    title: string
  ) => {
    const proposal = (await raise(owner, organizationId, title)).body.data;
    await vote(owner, proposal.id, "for");
    return proposal.id as string;
  };

  it("points a passed proposal at the batch that settled it", async () => {
    const owner = await user("Owner");
    const org = await organization({ owner: owner.address, quorum: 1 });
    const proposalId = await passedProposal(owner, org.id, "Bonus round");

    const batch = await createBatch(owner, org, `settle-${Date.now()}`, proposalId);
    assert.equal(batch.status, 201);

    const [row] = await sql`
      select settled_batch_id from proposals where id = ${proposalId}`;
    assert.equal(row.settled_batch_id, batch.body.data.id);
  });

  it("refuses a proposal that has not passed", async () => {
    const owner = await user("Owner");
    const second = await user("Second");
    const org = await organization({
      owner: owner.address,
      quorum: 2,
      signers: [second.address],
    });

    // One vote of the two it needs, so it is still open.
    const proposal = (await raise(owner, org.id, "Premature")).body.data;
    await vote(owner, proposal.id, "for");

    const batch = await createBatch(owner, org, `early-${Date.now()}`, proposal.id);
    assert.equal(batch.status, 409);
  });

  it("refuses another organization's proposal", async () => {
    const owner = await user("Owner");
    const outsider = await user("Outsider");
    const mine = await organization({ owner: owner.address, quorum: 1 });
    const theirs = await organization({ owner: outsider.address, quorum: 1 });

    const proposalId = await passedProposal(outsider, theirs.id, "Not yours");

    const batch = await createBatch(owner, mine, `cross-${Date.now()}`, proposalId);
    assert.equal(batch.status, 403, "and 403 rather than 404, which would confirm it exists");
  });

  it("settles a proposal once", async () => {
    const owner = await user("Owner");
    const org = await organization({ owner: owner.address, quorum: 1 });
    const proposalId = await passedProposal(owner, org.id, "Only once");

    const first = await createBatch(owner, org, `once-a-${Date.now()}`, proposalId);
    assert.equal(first.status, 201);

    const second = await createBatch(owner, org, `once-b-${Date.now()}`, proposalId);
    assert.equal(second.status, 409);

    // The second batch must not exist either: the link is written inside the
    // batch's own transaction, so a refused link takes the batch with it.
    const [count] = await sql`
      select count(*)::int as n from batch_payrolls where organization_id = ${org.id}`;
    assert.equal(count.n, 1);
  });
});
