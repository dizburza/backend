import axios from "axios";
import { ENV } from "../config/environment.js";
import logger from "../utils/logger.util.js";

/**
 * Anything outside this is a bad response, not a market move.
 *
 * Wide enough to survive a real crash or rally, narrow enough to catch the
 * failure that actually happens: an endpoint returning a USD figure, a zero, or
 * a rate-limit body that parses as a number. Pricing off a wrong rate by two
 * orders of magnitude either gives the product away or charges someone a
 * month's salary to send a link.
 */
const MIN_RATE = 100_000;
const MAX_RATE = 100_000_000;

export type FxRate = {
  ngnPerEth: number;
  /** When it was fetched. */
  at: Date;
  /** True when the live fetch failed and this is a cached or configured value. */
  stale: boolean;
  source: "coingecko" | "cache" | "fallback";
};

export class FxService {
  private static cached: { rate: number; at: number } | null = null;
  private static inFlight: Promise<FxRate> | null = null;

  /**
   * ETH priced in naira.
   *
   * Off chain on purpose. Chainlink has ETH/USD on Base but no NGN, so an
   * on-chain feed would leave the naira leg, the one that actually moves,
   * uncovered. The fee is computed server side, so nothing here needs to be a
   * contract.
   *
   * Degrades rather than fails. A sender should not be unable to create a link
   * because a price API is down, so a failed fetch falls back to the last good
   * rate and then to a configured one, and says which it used.
   */
  static async ngnPerEth(): Promise<FxRate> {
    const fresh = FxService.fromCache(ENV.FX_CACHE_TTL_MS);
    if (fresh) return fresh;

    // One fetch at a time. Without this, a burst of quotes on a cold cache
    // becomes a burst of identical calls into a rate limited free tier.
    FxService.inFlight ??= FxService.fetch().finally(() => {
      FxService.inFlight = null;
    });

    return FxService.inFlight;
  }

  private static fromCache(maxAgeMs: number): FxRate | null {
    if (!FxService.cached) return null;
    if (Date.now() - FxService.cached.at > maxAgeMs) return null;

    return {
      ngnPerEth: FxService.cached.rate,
      at: new Date(FxService.cached.at),
      stale: false,
      source: "cache",
    };
  }

  private static async fetch(): Promise<FxRate> {
    try {
      const { data } = await axios.get(ENV.COINGECKO_URL, {
        params: { ids: "ethereum", vs_currencies: "ngn" },
        timeout: 4000,
        headers: ENV.COINGECKO_API_KEY
          ? { "x-cg-demo-api-key": ENV.COINGECKO_API_KEY }
          : undefined,
      });

      const rate = Number(data?.ethereum?.ngn);

      if (!Number.isFinite(rate) || rate < MIN_RATE || rate > MAX_RATE) {
        throw new Error(`Implausible ETH/NGN rate: ${String(data?.ethereum?.ngn)}`);
      }

      FxService.cached = { rate, at: Date.now() };
      return { ngnPerEth: rate, at: new Date(), stale: false, source: "coingecko" };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      logger.warn(`Could not read ETH/NGN, falling back: ${detail}`);

      // Any cached rate, however old, beats a number nobody has looked at since
      // it was typed. That is the failure the configured value exists for.
      const stale = FxService.cached;
      if (stale) {
        return {
          ngnPerEth: stale.rate,
          at: new Date(stale.at),
          stale: true,
          source: "cache",
        };
      }

      return {
        ngnPerEth: ENV.ETH_PRICE_NGN_FALLBACK,
        at: new Date(),
        stale: true,
        source: "fallback",
      };
    }
  }

  /** Test seam, and a way to force a refresh after a config change. */
  static reset(): void {
    FxService.cached = null;
    FxService.inFlight = null;
  }
}
