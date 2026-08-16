import { ethers } from "ethers";
import crypto from "node:crypto";
import { getAddress } from "viem";
import { verifyMessage } from "viem/actions";
import logger from "./logger.util.js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { organizations } from "../db/schema.js";
import { verificationClient } from "../config/viem.js";
import { ENV } from "../config/environment.js";

export class CryptoUtil {
  /**
   * Generate unique username
   * Format: surname3_firstname3_address6
   */
  static generateUniqueUsername(
    surname: string,
    firstname: string,
    walletAddress: string
  ): string {
    const surnamePrefix = surname.toLowerCase().substring(0, 3);
    const firstnameLen = firstname.length;
    const firstnameSuffix = firstname
      .toLowerCase()
      .substring(Math.max(0, firstnameLen - 3));
    const addressPart = walletAddress.toLowerCase().substring(2, 8);

    return `${surnamePrefix}_${firstnameSuffix}_${addressPart}`;
  }

  /**
   * Generate organization slug from name
   */
  static generateSlug(name: string): string {
    return name
      .toLowerCase()
      .trim()
      .replaceAll(/[^\w\s-]/g, "")
      .replaceAll(/\s+/g, "-")
      .replaceAll(/-+/g, "-")
      .substring(0, 50);
  }

  /**
   * Check if slug is available
   */
  static async isSlugAvailable(slug: string): Promise<boolean> {
    const [existing] = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, slug))
      .limit(1);

    return !existing;
  }

  /**
   * Generate unique slug
   */
  static async generateUniqueSlug(name: string): Promise<string> {
    let slug = this.generateSlug(name);
    let counter = 1;

    while (!(await this.isSlugAvailable(slug))) {
      slug = `${this.generateSlug(name)}-${counter}`;
      counter++;
    }

    return slug;
  }

  /**
   * Generate organization hash
   */
  static generateOrganizationHash(data: {
    name: string;
    creatorAddress: string;
    signers: string[];
    timestamp: number;
  }): string {
    const dataString = JSON.stringify(data);
    return "0x" + crypto.createHash("sha256").update(dataString).digest("hex");
  }

  /**
   * Verify that `expectedAddress` produced this signature.
   *
   * Three signer shapes, checked in cost order:
   *
   * 1. A plain wallet, which is ecrecover and never leaves the process.
   * 2. A deployed smart account, which is ERC-1271, one `eth_call`.
   * 3. A smart account that has no code yet, which is ERC-6492: the signature
   *    carries the factory call that would deploy it, and the validator runs
   *    that deployment inside the call before asking the account.
   *
   * The third is not optional. A thirdweb smart account is counterfactual until
   * its first transaction, so at registration there is nothing on chain to ask.
   *
   * ecrecover runs here rather than being left to viem's `mode: "eoa"` so that
   * the wallet path is chain free by our own code and not by a library flag. It
   * cannot produce a false positive: recovering `expectedAddress` means that
   * address signed, whatever else it may also be.
   */
  static async verifySignature(
    message: string,
    signature: string,
    expectedAddress: string
  ): Promise<boolean> {
    const address = expectedAddress.toLowerCase();

    try {
      if (ethers.verifyMessage(message, signature).toLowerCase() === address) {
        logger.debug("Signed in as a plain wallet", { address, via: "ecrecover" });
        return true;
      }
    } catch {
      // Not an ECDSA signature at all, which a wrapped 6492 signature is not.
    }

    try {
      const valid = await verifyMessage(verificationClient, {
        address: getAddress(address),
        message,
        signature: signature as `0x${string}`,
      });

      if (!valid) {
        await this.reportContractSignatureRejection(address);
        return false;
      }

      // Worth an info line: it is the only evidence, from the backend's side,
      // that account abstraction is actually on. A wallet and a smart account
      // are indistinguishable otherwise, since both simply verify.
      logger.info("Signed in as a smart account", {
        address,
        via: signature.length > 400 ? "erc-6492 (counterfactual)" : "erc-1271 (deployed)",
      });
      return true;
    } catch (error) {
      logger.warn("Contract signature check errored", {
        address,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Say which of the two things a rejected contract signature actually was.
   *
   * viem reports an unreachable node and a bad signature identically, as a
   * failed verification, so without this an RPC outage refuses every smart
   * account sign-in and writes nothing anyone would notice. Refusing is right,
   * being silent about it is not. Costs one call, and only on the path that has
   * already been rejected.
   */
  private static async reportContractSignatureRejection(address: string): Promise<void> {
    try {
      await verificationClient.getChainId();
      logger.debug("Contract signature rejected", { address });
    } catch {
      logger.warn(
        "Signature verification is refusing smart accounts: RPC unreachable",
        { address, rpcUrl: ENV.RPC_URL }
      );
    }
  }

  /**
   * Build the exact text a wallet is asked to sign.
   *
   * The server rebuilds this from the stored challenge rather than trusting a
   * message supplied by the caller, so a captured signature cannot be replayed
   * once its nonce is consumed. The domain line binds the signature to this
   * app, so a signature harvested by another site will not verify here.
   */
  static generateAuthMessage(
    address: string,
    nonce: string,
    issuedAt: Date,
    domain: string
  ): string {
    return [
      `${domain} wants you to sign in with your Ethereum account:`,
      address.toLowerCase(),
      "",
      "Sign this message to authenticate. It will not trigger a transaction or cost gas.",
      "",
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
    ].join("\n");
  }
}
