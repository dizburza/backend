import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { anon, server, sql, user } from "./helpers/harness.js";

/**
 * Send by link.
 *
 * The link is a bearer credential, so the tests that matter are about what the
 * claim page discloses to whoever holds it, and about the recipient being taken
 * from the session rather than the request. Everything on chain is covered by
 * `test/CashLink.t.sol`; nothing here needs a node.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

const linkAddress = () => ethers.Wallet.createRandom().address.toLowerCase();

/** A link seeded straight into the table, as if the escrow already held it. */
const seedLink = async (options: {
  sender: string;
  senderUserId?: string | null;
  amount?: string;
  description?: string | null;
  status?: string;
  expiresAt?: Date;
  claimingUntil?: Date | null;
}) => {
  const claimAddress = linkAddress();

  await sql`
    insert into cash_links
      (claim_address, sender_address, amount, description, status, expires_at, claiming_until)
    values (${claimAddress}, ${options.sender}, ${options.amount ?? "2000000000"},
            ${options.description ?? null}, ${options.status ?? "open"},
            ${options.expiresAt ?? new Date(Date.now() + 12 * 3600_000)},
            ${options.claimingUntil ?? null})`;

  return claimAddress;
};

describe("cashlink config", () => {
  it("is public, so a claim page can load before anyone signs in", async () => {
    const res = await anon("/cashlinks/config");

    assert.equal(res.status, 200);
    assert.equal(typeof res.body.data.enabled, "boolean");
    assert.equal(res.body.data.name, "Dizburza CashLink");
  });
});

describe("the claim page's view of a link", () => {
  it("is readable without a session, because a claimer has no account yet", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({ sender: sender.address });

    const res = await anon(`/cashlinks/${claimAddress}`);

    assert.equal(res.status, 200);
    assert.equal(res.body.data.state, "claimable");
    assert.equal(res.body.data.amount, "2000000000");
  });

  it("shows an amount and an expiry, and nothing about the sender", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({
      sender: sender.address,
      description: "rent for october",
    });

    const { body } = await anon(`/cashlinks/${claimAddress}`);
    const serialised = JSON.stringify(body).toLowerCase();

    assert.ok(!serialised.includes("rent for october"), "the note must not reach a bearer");
    assert.ok(!serialised.includes(sender.address), "nor the sender's address");
    assert.ok(!serialised.includes("sender"), "nor anything naming one");
    assert.deepEqual(Object.keys(body.data).sort(), [
      "amount",
      "amountFormatted",
      "claimAddress",
      "expiresAt",
      "state",
      "symbol",
    ]);
  });

  it("says a lapsed link is expired rather than offering it", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({
      sender: sender.address,
      expiresAt: new Date(Date.now() - 60_000),
    });

    assert.equal((await anon(`/cashlinks/${claimAddress}`)).body.data.state, "expired");
  });

  it("says a link being claimed is in progress, so the second person is told", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({
      sender: sender.address,
      status: "claiming",
      claimingUntil: new Date(Date.now() + 60_000),
    });

    assert.equal((await anon(`/cashlinks/${claimAddress}`)).body.data.state, "claiming");
  });

  it("offers a link again once a stalled claim's lease has run out", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({
      sender: sender.address,
      status: "claiming",
      claimingUntil: new Date(Date.now() - 60_000),
    });

    assert.equal(
      (await anon(`/cashlinks/${claimAddress}`)).body.data.state,
      "claimable",
      "a claim that died must not strand the link"
    );
  });

  it("does not answer for a link that does not exist", async () => {
    assert.equal((await anon(`/cashlinks/${linkAddress()}`)).status, 404);
  });
});

describe("the sender's own links", () => {
  it("need a session", async () => {
    assert.equal((await anon("/cashlinks")).status, 401);
  });

  it("carry the note, which lives here and nowhere a claimer can reach", async () => {
    const sender = await user("Sender");
    await seedLink({ sender: sender.address, description: "school fees" });

    const res = await sender.call("/cashlinks");

    assert.equal(res.status, 200);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].description, "school fees");
  });

  it("are the caller's, never someone else's", async () => {
    const sender = await user("Sender");
    const stranger = await user("Stranger");
    await seedLink({ sender: sender.address, description: "private" });

    assert.equal((await stranger.call("/cashlinks")).body.data.length, 0);
  });
});

describe("claiming", () => {
  it("needs a session, because the money lands in a Dizburza account", async () => {
    const sender = await user("Sender");
    const claimAddress = await seedLink({ sender: sender.address });

    const res = await anon(`/cashlinks/${claimAddress}/claim`, {
      method: "POST",
      body: JSON.stringify({ signature: "0x" + "11".repeat(65) }),
    });

    assert.equal(res.status, 401);
  });

  it("refuses a link someone else is already claiming", async () => {
    const sender = await user("Sender");
    const claimer = await user("Claimer");
    const claimAddress = await seedLink({
      sender: sender.address,
      status: "claiming",
      claimingUntil: new Date(Date.now() + 60_000),
    });

    const res = await claimer.call(`/cashlinks/${claimAddress}/claim`, {
      method: "POST",
      body: JSON.stringify({ signature: "0x" + "11".repeat(65) }),
    });

    assert.equal(res.status, 409);
    assert.match(res.body.message ?? res.body.error, /already claiming/i);
  });

  it("refuses a lapsed link before it reaches the chain", async () => {
    const sender = await user("Sender");
    const claimer = await user("Claimer");
    const claimAddress = await seedLink({
      sender: sender.address,
      expiresAt: new Date(Date.now() - 60_000),
    });

    const res = await claimer.call(`/cashlinks/${claimAddress}/claim`, {
      method: "POST",
      body: JSON.stringify({ signature: "0x" + "11".repeat(65) }),
    });

    assert.equal(res.status, 409);
  });

  it("refuses a signature that is not 65 bytes", async () => {
    const sender = await user("Sender");
    const claimer = await user("Claimer");
    const claimAddress = await seedLink({ sender: sender.address });

    const res = await claimer.call(`/cashlinks/${claimAddress}/claim`, {
      method: "POST",
      body: JSON.stringify({ signature: "0xdeadbeef" }),
    });

    assert.equal(res.status, 400);
  });

  /**
   * The one that matters. On chain a claim pays whoever the link's key signed
   * for, so if the recipient were read from the body a bearer link could be
   * claimed straight out to an address that never registered.
   */
  it("takes the recipient from the session and never from the request", async () => {
    const claimer = await user("Claimer");
    const claimAddress = await seedLink({ sender: (await user("Sender")).address });

    const planted = ethers.Wallet.createRandom().address.toLowerCase();

    await claimer.call(`/cashlinks/${claimAddress}/claim`, {
      method: "POST",
      body: JSON.stringify({ signature: "0x" + "11".repeat(65), recipient: planted }),
    });

    const [row] = await sql`
      select status, claimed_by_address from cash_links where claim_address = ${claimAddress}`;

    assert.notEqual(row.claimed_by_address, planted, "the body must not choose the payee");

    // No chain here, so the claim fails at the send. The lease has to come back
    // with it: a claim that died must never strand the link.
    assert.equal(row.claimed_by_address, null);
    assert.equal(row.status, "open", "a failed claim must leave the link claimable");
  });
});

describe("recording a link", () => {
  it("needs a session", async () => {
    const res = await anon("/cashlinks", {
      method: "POST",
      body: JSON.stringify({
        claimAddress: linkAddress(),
        txHash: "0x" + "ab".repeat(32),
      }),
    });

    assert.equal(res.status, 401);
  });

  it("refuses a note longer than the field allows", async () => {
    const sender = await user("Sender");

    const res = await sender.call("/cashlinks", {
      method: "POST",
      body: JSON.stringify({
        claimAddress: linkAddress(),
        txHash: "0x" + "ab".repeat(32),
        description: "x".repeat(201),
      }),
    });

    assert.equal(res.status, 400);
  });
});
