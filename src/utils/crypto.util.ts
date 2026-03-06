import { ethers } from "ethers";
import crypto from "node:crypto";
import logger from "./logger.util.js";
import { Organization } from "../models/Organization.model.js";

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
    const existing = await Organization.findOne({ slug });
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
   * Verify wallet signature
   */
  static verifySignature(
    message: string,
    signature: string,
    expectedAddress: string
  ): boolean {
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature);
      return recoveredAddress.toLowerCase() === expectedAddress.toLowerCase();
    } catch (error) {
      logger.debug("Signature verification failed", {
        expectedAddress,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Generate authentication message
   */
  static generateAuthMessage(address: string, nonce: string): string {
    return `Welcome to Dizburza!\n\nSign this message to authenticate your wallet.\n\nWallet: ${address}\nNonce: ${nonce}\n\nThis signature will not trigger any blockchain transaction or cost any gas fees.`;
  }
}
