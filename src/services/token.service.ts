import { ethers } from "ethers";
import { and, eq } from "drizzle-orm";
import { provider } from "../config/blockchain.js";
import { ENV } from "../config/environment.js";
import { ERC20_ABI } from "../config/abi/erc20ABI.js";
import { db } from "../db/client.js";
import { tokens } from "../db/schema.js";
import type { Token } from "../db/types.js";
import { AppError } from "../middlewares/errorHandler.middleware.js";
import logger from "../utils/logger.util.js";

/**
 * The payroll token, resolved once and cached for the process lifetime.
 *
 * Decimals used to be the literal 6 in four separate files. That is right for
 * cNGN and happens to be right for USDC too, which is the dangerous part: a
 * token with different precision would not have failed, it would have quietly
 * multiplied every amount by a thousand.
 */
export class TokenService {
  private static cached: Token | null = null;
  private static inflight: Promise<Token> | null = null;

  /** Contract handle for a token, for balanceOf and Transfer log decoding. */
  static contractFor(token: Token): ethers.Contract {
    return new ethers.Contract(token.address, ERC20_ABI, provider);
  }

  /**
   * The token this deployment pays in.
   *
   * Registered from ENV on first call if the table is empty, reading symbol and
   * decimals off the contract, so a fresh database needs no seed step.
   */
  static async getDefault(): Promise<Token> {
    if (TokenService.cached) return TokenService.cached;
    TokenService.inflight ??= TokenService.resolveDefault();

    try {
      const token = await TokenService.inflight;
      TokenService.cached = token;
      return token;
    } finally {
      TokenService.inflight = null;
    }
  }

  private static async resolveDefault(): Promise<Token> {
    const [existing] = await db
      .select()
      .from(tokens)
      .where(and(eq(tokens.chainId, ENV.CHAIN_ID), eq(tokens.isDefault, true), eq(tokens.isActive, true)))
      .limit(1);

    if (existing) return existing;

    if (!ENV.PAYROLL_TOKEN_ADDRESS) {
      throw new AppError("No payroll token configured. Set PAYROLL_TOKEN_ADDRESS.", 500);
    }

    return TokenService.register(ENV.PAYROLL_TOKEN_ADDRESS, { makeDefault: true });
  }

  /**
   * Add a token, taking symbol and decimals from the contract itself.
   *
   * Making it the default demotes whichever token held that place, which is the
   * whole swap: point the environment at a new address, restart, done.
   */
  static async register(
    tokenAddress: string,
    options: { makeDefault?: boolean; logoUrl?: string } = {}
  ): Promise<Token> {
    const normalized = tokenAddress.toLowerCase();
    const contract = new ethers.Contract(normalized, ERC20_ABI, provider);

    const [decimals, symbol, name] = await Promise.all([
      contract.decimals() as Promise<bigint>,
      contract.symbol().catch(() => "UNKNOWN") as Promise<string>,
      contract.name().catch(() => null) as Promise<string | null>,
    ]);

    return db.transaction(async (tx) => {
      if (options.makeDefault) {
        await tx
          .update(tokens)
          .set({ isDefault: false })
          .where(and(eq(tokens.chainId, ENV.CHAIN_ID), eq(tokens.isDefault, true)));
      }

      const values = {
        chainId: ENV.CHAIN_ID,
        address: normalized,
        symbol,
        name,
        decimals: Number(decimals),
        logoUrl: options.logoUrl ?? ENV.PAYROLL_TOKEN_LOGO_URL ?? null,
        isDefault: options.makeDefault ?? false,
        isActive: true,
      };

      const [row] = await tx
        .insert(tokens)
        .values(values)
        .onConflictDoUpdate({
          target: [tokens.chainId, tokens.address],
          set: {
            symbol: values.symbol,
            name: values.name,
            decimals: values.decimals,
            logoUrl: values.logoUrl,
            isDefault: values.isDefault,
            isActive: true,
          },
        })
        .returning();

      logger.info(
        `Payroll token: ${row.symbol} at ${row.address} with ${row.decimals} decimals`
      );

      return row;
    });
  }

  /** Clears the process cache. Call after changing which token is default. */
  static reset(): void {
    TokenService.cached = null;
  }

  /** Format a base-unit amount for display, using the token's real precision. */
  static async format(raw: string | bigint): Promise<string> {
    const token = await TokenService.getDefault();
    return ethers.formatUnits(raw, token.decimals);
  }

  /** Parse a human amount into base units. */
  static async parse(amount: string): Promise<bigint> {
    const token = await TokenService.getDefault();
    return ethers.parseUnits(amount, token.decimals);
  }
}
