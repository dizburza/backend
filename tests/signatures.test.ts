import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";
import { anon, server, sql, user } from "./helpers/harness.js";
import { CryptoUtil } from "../src/utils/crypto.util.js";

/**
 * Sign-in accepts three signer shapes: a plain wallet, a deployed smart account
 * through ERC-1271, and one that has no code yet through ERC-6492.
 *
 * The harness points RPC_URL at a closed port, so only the wallet path can
 * actually be answered here. That is the point of the first group: the common
 * case must never depend on a chain being reachable, or every sign-in in the
 * product inherits the RPC's uptime. The contract paths are asserted on the
 * gate, which is what CLAUDE.md requires of anything that reads the chain.
 */

after(async () => {
  await (await server()).close();
  await sql.end();
});

const MESSAGE = "localhost wants you to sign in with your Ethereum account:";

describe("wallet signatures need no chain", () => {
  it("accept the address that signed, however it is cased", async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(MESSAGE);

    for (const address of [
      wallet.address,
      wallet.address.toLowerCase(),
      wallet.address.toUpperCase().replace("0X", "0x"),
    ]) {
      assert.equal(
        await CryptoUtil.verifySignature(MESSAGE, signature, address),
        true,
        `should verify for ${address}`
      );
    }
  });

  it("answer without waiting on the RPC", async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(MESSAGE);

    const started = Date.now();
    assert.equal(await CryptoUtil.verifySignature(MESSAGE, signature, wallet.address), true);

    // The closed port the harness configures takes milliseconds to refuse, but a
    // real unreachable host takes seconds. Anything that touched the transport
    // would not come back this fast.
    assert.ok(Date.now() - started < 250, "wallet verification must not make an RPC call");
  });

  it("refuse a signature over a different message", async () => {
    const wallet = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(MESSAGE);

    assert.equal(
      await CryptoUtil.verifySignature(MESSAGE + " (tampered)", signature, wallet.address),
      false
    );
  });

  it("refuse a valid signature presented for someone else", async () => {
    const wallet = ethers.Wallet.createRandom();
    const other = ethers.Wallet.createRandom();
    const signature = await wallet.signMessage(MESSAGE);

    assert.equal(
      await CryptoUtil.verifySignature(MESSAGE, signature, other.address),
      false
    );
  });

  it("refuse malformed input rather than throwing", async () => {
    const wallet = ethers.Wallet.createRandom();

    for (const signature of ["0x", "0x" + "00".repeat(65), "not a signature"]) {
      assert.equal(
        await CryptoUtil.verifySignature(MESSAGE, signature, wallet.address),
        false,
        `should refuse ${signature.slice(0, 20)}`
      );
    }

    assert.equal(
      await CryptoUtil.verifySignature(
        MESSAGE,
        await wallet.signMessage(MESSAGE),
        "not an address"
      ),
      false
    );
  });
});

describe("contract signatures are refused when they cannot be checked", () => {
  /**
   * An ERC-6492 signature is an ordinary one with the factory call and the magic
   * suffix appended. ecrecover cannot read it, so this exercises the path that
   * has to reach the chain, which the harness has made unreachable.
   */
  it("refuse a 6492 signature with no node to ask", async () => {
    const owner = ethers.Wallet.createRandom();
    const inner = await owner.signMessage(MESSAGE);
    const account = ethers.Wallet.createRandom().address;

    const wrapped = ethers.concat([
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes", "bytes"],
        [ethers.Wallet.createRandom().address, "0x", inner]
      ),
      "0x6492649264926492649264926492649264926492649264926492649264926492",
    ]);

    assert.equal(await CryptoUtil.verifySignature(MESSAGE, wrapped, account), false);
  });

  it("do not let a wrapped signature stand in for the wallet that signed it", async () => {
    const owner = ethers.Wallet.createRandom();
    const inner = await owner.signMessage(MESSAGE);

    const wrapped = ethers.concat([
      ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes", "bytes"],
        [ethers.Wallet.createRandom().address, "0x", inner]
      ),
      "0x6492649264926492649264926492649264926492649264926492649264926492",
    ]);

    // The owner really did sign this message, and the signature is in there, but
    // the claim is about the account and only the account can answer it.
    assert.equal(await CryptoUtil.verifySignature(MESSAGE, wrapped, owner.address), false);
  });
});

describe("the sign-in route", () => {
  it("admits a wallet that signs the challenge it was issued", async () => {
    // `user()` registers through /auth/message and /auth/register, so this
    // passing at all is the wallet path working end to end.
    const alice = await user("Alice");
    const me = await alice.call("/auth/me");

    assert.equal(me.status, 200);
    assert.equal(me.body.data.user.walletAddress, alice.address);
  });

  it("refuses a signature over a message the server did not issue", async () => {
    const wallet = ethers.Wallet.createRandom();

    await anon(`/auth/message/${wallet.address}`);

    const registered = await anon("/auth/register", {
      method: "POST",
      body: JSON.stringify({
        walletAddress: wallet.address,
        signature: await wallet.signMessage("let me in"),
        surname: "Forger",
        firstname: "Fred",
        email: `fred.${crypto.randomUUID()}@example.test`,
      }),
    });

    assert.equal(registered.status, 401);
  });

  it("burns the challenge on a failed attempt", async () => {
    const wallet = ethers.Wallet.createRandom();

    const message = (await anon(`/auth/message/${wallet.address}`)).body.data.message;

    const body = (signature: string) =>
      JSON.stringify({
        walletAddress: wallet.address,
        signature,
        surname: "Grinder",
        firstname: "Gina",
        email: `gina.${crypto.randomUUID()}@example.test`,
      });

    const wrong = await anon("/auth/register", {
      method: "POST",
      body: body(await ethers.Wallet.createRandom().signMessage(message)),
    });
    assert.equal(wrong.status, 401);

    // The correct signature for that same challenge is now worthless, so a
    // failed attempt cannot be used to hold a challenge open and grind at it.
    const right = await anon("/auth/register", {
      method: "POST",
      body: body(await wallet.signMessage(message)),
    });
    assert.equal(right.status, 401);
  });
});
