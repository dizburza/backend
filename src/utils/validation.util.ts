import { ethers } from "ethers";

export class ValidationUtil {
  static isValidAddress(address: string): boolean {
    return ethers.isAddress(address);
  }

  static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidUsername(username: string): boolean {
    const usernameRegex = /^\w{3,20}$/;
    return usernameRegex.test(username);
  }

  static isValidBatchName(batchName: string): boolean {
    const batchNameRegex = /^[a-zA-Z0-9_-]+$/;
    return batchNameRegex.test(batchName);
  }

  static isPositiveAmount(amount: string): boolean {
    try {
      const value = BigInt(amount);
      return value > BigInt(0);
    } catch {
      return false;
    }
  }
}