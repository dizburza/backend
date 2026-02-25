import jwt, { SignOptions } from "jsonwebtoken";
import { User, IUser } from "../models/User.model.js";
import { Organization } from "../models/Organization.model.js";
import { ENV } from "../config/environment.js";
import { CryptoUtil } from "../utils/crypto.util.js";
import crypto from "node:crypto";
import { UserRegistrationData, LoginData } from "../types/user.types.js";

export class AuthService {
  /**
   * Register a new user
   */
  static async register(data: UserRegistrationData): Promise<{
    user: IUser;
    token: string;
    redirectTo: string;
  }> {
    const existing = await User.findOne({
      walletAddress: data.walletAddress.toLowerCase(),
    });

    if (existing) {
      throw new Error("Wallet address already registered");
    }

    // Use username from data if provided, otherwise generate
    let username =
      data.username ||
      CryptoUtil.generateUniqueUsername(
        data.surname,
        data.firstname,
        data.walletAddress
      );

    username = username.toLowerCase();

    const usernameExists = await User.findOne({ username });
    if (usernameExists) {
      const randomSuffix = crypto.randomBytes(2).toString("hex");
      username = `${username}_${randomSuffix}`.toLowerCase();
    }

    const user = await User.create({
      walletAddress: data.walletAddress.toLowerCase(),
      username,
      surname: data.surname,
      firstname: data.firstname,
      fullName: data.fullName || `${data.firstname} ${data.surname}`,
      email: data.email,
      phoneNumber: data.phoneNumber,
      avatar: data.avatar,
      role: data.role || "employee",
      authNonce: this.generateNonce(),
    });

    const token = this.generateToken(user);

    return {
      user,
      token,
      redirectTo: "/wallet",
    };
  }

  /**
   * Login with wallet signature
   */
  static async login(data: LoginData): Promise<{
    user: IUser;
    token: string;
    redirectTo: string;
    organization?: any;
  }> {
    const user = await User.findOne({
      walletAddress: data.walletAddress.toLowerCase(),
    });

    if (!user || !user.isActive) {
      throw new Error("User not found or inactive. Please register first.");
    }

    const isValid = CryptoUtil.verifySignature(
      data.message,
      data.signature,
      data.walletAddress
    );

    if (!isValid) {
      throw new Error("Invalid signature");
    }

    user.lastLoginAt = new Date();
    user.authNonce = this.generateNonce();
    await user.save();

    const token = this.generateToken(user);

    let redirectTo = "/wallet";
    let organization = null;

    if (user.organizationId && user.organizationSlug) {
      organization = await Organization.findById(user.organizationId);
      redirectTo = `/enterprise/${user.organizationSlug}`;
    }

    return {
      user,
      token,
      redirectTo,
      organization,
    };
  }

  /**
   * Check user status
   */
  static async checkUserStatus(walletAddress: string): Promise<{
    isRegistered: boolean;
    user?: IUser;
    redirectTo?: string;
    organization?: any;
  }> {
    const user = await User.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    if (!user) {
      return {
        isRegistered: false,
        redirectTo: "/register",
      };
    }

    let redirectTo = "/wallet";
    let organization = null;
    let effectiveRole: IUser["role"] = user.role || "employee";

    if (user.organizationId && user.organizationSlug) {
      organization = await Organization.findById(user.organizationId);
      redirectTo = `/enterprise/${user.organizationSlug}`;

      const normalizedWallet = user.walletAddress.toLowerCase();
      const creator = organization?.creatorAddress?.toLowerCase();
      const isCreator = Boolean(creator && normalizedWallet === creator);
      const isActiveSigner = Boolean(
        organization?.signers?.some(
          (signer: { address?: string; isActive?: boolean }) =>
            Boolean(signer?.isActive) &&
            (signer?.address || "").toLowerCase() === normalizedWallet
        )
      );

      if (isCreator || isActiveSigner) {
        effectiveRole = "signer";
      } else {
        effectiveRole = "employee";
      }
    }

    user.role = effectiveRole;
    return {
      isRegistered: true,
      user,
      redirectTo,
      organization,
    };
  }

  /**
   * Get authentication message
   */
  static async getAuthMessage(walletAddress: string): Promise<string> {
    let user = await User.findOne({
      walletAddress: walletAddress.toLowerCase(),
    });

    let nonce: string;
    if (user) {
      nonce = user.authNonce || this.generateNonce();
      if (!user.authNonce) {
        user.authNonce = nonce;
        await user.save();
      }
    } else {
      nonce = this.generateNonce();
    }

    return CryptoUtil.generateAuthMessage(walletAddress, nonce);
  }

  private static generateToken(user: IUser): string {
    const payload = {
      userId: user._id.toString(),
      walletAddress: user.walletAddress,
      role: user.role,
      organizationId: user.organizationId?.toString(),
      organizationSlug: user.organizationSlug,
    };

    const rawExpiry = ENV.JWT_EXPIRY;
    const numericExpiry = Number(rawExpiry);

    const expiresIn: SignOptions["expiresIn"] =
      rawExpiry && !Number.isNaN(numericExpiry)
        ? numericExpiry
        : (rawExpiry as unknown as SignOptions["expiresIn"]);

    const options: SignOptions = {
      expiresIn,
    };

    return jwt.sign(payload, ENV.JWT_SECRET, options);
  }

  private static generateNonce(): string {
    return crypto.randomBytes(16).toString("hex");
  }
}