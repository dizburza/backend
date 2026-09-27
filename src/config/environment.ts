import dotenv from "dotenv";

dotenv.config();

const cleanEnvValue = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return value.split("#")[0].trim();
};

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number.parseInt(process.env.PORT || "5050", 10),

  DATABASE_URL: process.env.DATABASE_URL,
  // Unpooled endpoint, used only by migrations: some DDL does not survive
  // PgBouncer in transaction mode. Falls back to DATABASE_URL when unset.
  DIRECT_DATABASE_URL: process.env.DIRECT_DATABASE_URL,
  DATABASE_POOL_MAX: Number.parseInt(process.env.DATABASE_POOL_MAX || "10", 10),

  // Redis. Optional for a single instance, required once you run more than one:
  // it fans realtime events between instances, elects one indexer leader, and
  // holds the rate limit counters.
  REDIS_URL: process.env.REDIS_URL,
  // Set this wherever more than one process serves the API: several replicas,
  // PM2 cluster mode, `docker compose --scale`. It refuses to boot without
  // REDIS_URL, because the alternative is a failure nothing reports. See the
  // check in server.ts.
  EXPECT_MULTI_INSTANCE:
    (process.env.EXPECT_MULTI_INSTANCE || "false").toLowerCase() === "true",

  // Icon shown beside amounts in the UI. Optional, falls back to a generic one.
  PAYROLL_TOKEN_LOGO_URL: process.env.PAYROLL_TOKEN_LOGO_URL,

  // Blockchain
  RPC_URL: process.env.RPC_URL,
  CHAIN_ID: Number.parseInt(process.env.CHAIN_ID || "84532", 10),
  // The ERC-20 salaries are paid in. Registered in the tokens table on first
  // boot, with symbol and decimals read off the contract. Swapping the payroll
  // token is this line plus a restart. cNGN_ADDRESS is still read so existing
  // deployments do not break on the rename.
  PAYROLL_TOKEN_ADDRESS:
    process.env.PAYROLL_TOKEN_ADDRESS ||
    process.env.cNGN_ADDRESS ||
    "0xa1F8BD1892C85746AE71B97C31B1965C4641f1F0",
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || "",

  // ERC-2771. The forwarder verifies the user's EIP-712 signature on chain, so
  // the relayer key below buys gas and nothing else: it cannot forge authority,
  // only waste money.
  RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY || "",
  // Refuse to sponsor a request asking for more gas than any real call needs.

  // Send by link. Unset and the CashLink routes report themselves disabled.
  CASHLINK_ADDRESS: process.env.CASHLINK_ADDRESS || "",
  // Default life of a link. The contract bounds this between 1 hour and 7 days.
  CASHLINK_WINDOW_SECONDS: Number.parseInt(
    process.env.CASHLINK_WINDOW_SECONDS || "43200",
    10
  ),
  // How long one browser holds a link while its claim is in flight, so a second
  // person opening the same link is told rather than left to watch a revert.
  CASHLINK_CLAIM_LEASE_SECONDS: Number.parseInt(
    process.env.CASHLINK_CLAIM_LEASE_SECONDS || "120",
    10
  ),
  /** Warn below this, in wei. The sweeper is the only thing spending gas now. */
  SWEEPER_MIN_BALANCE_WEI: BigInt(
    process.env.SWEEPER_MIN_BALANCE_WEI || "5000000000000000"
  ),
  CASHLINK_SWEEP_INTERVAL_MS: Number.parseInt(
    process.env.CASHLINK_SWEEP_INTERVAL_MS || "300000",
    10
  ),
  /**
   * Only used when ETH/NGN cannot be read at all, live or cached.
   *
   * A last resort, not the pricing. Keep it roughly current anyway: the whole
   * reason the old configured rate was replaced is that a number nobody revises
   * drifts, and this one drifts in the dark.
   */
  ETH_PRICE_NGN_FALLBACK: Number.parseInt(
    process.env.ETH_PRICE_NGN_FALLBACK || "2500000",
    10
  ),
  /** Optional. Raises the free tier's rate limit. */
  COINGECKO_API_KEY: process.env.COINGECKO_API_KEY || "",
  COINGECKO_URL:
    process.env.COINGECKO_URL || "https://api.coingecko.com/api/v3/simple/price",
  FX_CACHE_TTL_MS: Number.parseInt(process.env.FX_CACHE_TTL_MS || "300000", 10),
  /** Covers rate movement between quote and settlement, and the paymaster's cut. */
  CASHLINK_FEE_MARGIN_PERCENT: Number.parseInt(
    process.env.CASHLINK_FEE_MARGIN_PERCENT || "25",
    10
  ),
  /** Quoted fees round up to a multiple of this, so they read as prices. */
  CASHLINK_FEE_ROUNDING_NGN: Number.parseInt(
    process.env.CASHLINK_FEE_ROUNDING_NGN || "10",
    10
  ),
  /** Never quote less than this, however cheap gas gets. */
  CASHLINK_FEE_MIN_NGN: Number.parseInt(process.env.CASHLINK_FEE_MIN_NGN || "10", 10),

  // Cursor-based log worker. Unlike the live listener it survives downtime,
  // because progress is persisted per block rather than per session.
  INDEXER_ENABLED: (process.env.INDEXER_ENABLED || "true").toLowerCase() !== "false",
  // Block to index from when no cursor exists yet. Set this to the block the
  // cNGN contract was deployed at so the first backfill isn't scanning genesis.
  INDEXER_START_BLOCK: Number.parseInt(process.env.INDEXER_START_BLOCK || "0", 10),
  // Blocks to stay behind the chain tip so reorgs resolve before we persist.
  INDEXER_CONFIRMATIONS: Number.parseInt(process.env.INDEXER_CONFIRMATIONS || "12", 10),
  // Base Sepolia caps eth_getLogs at 1000 blocks per request.
  /**
   * Alchemy's free tier refuses `eth_getLogs` over more than 10 blocks, and it
   * refuses with a 400 rather than truncating, so a larger window does not index
   * slowly, it indexes nothing. Raise this on a paid plan or a node that allows
   * it: backfilling a long gap 10 blocks at a time is many round trips.
   */
  INDEXER_BLOCK_RANGE: Number.parseInt(process.env.INDEXER_BLOCK_RANGE || "10", 10),
  INDEXER_POLL_INTERVAL_MS: Number.parseInt(
    process.env.INDEXER_POLL_INTERVAL_MS || "12000",
    10
  ),
  // Sweep for freshly submitted transactions. Runs faster than the block cursor
  // so a user watching their own send sees it confirm without waiting out the
  // reorg confirmation lag.
  INDEXER_PENDING_INTERVAL_MS: Number.parseInt(
    process.env.INDEXER_PENDING_INTERVAL_MS || "4000",
    10
  ),
  // Receipts give fee/gasUsed but cost one RPC call per transaction. Disable to
  // make a large first backfill cheap; the live listener fills these in later.
  INDEXER_FETCH_RECEIPTS:
    (process.env.INDEXER_FETCH_RECEIPTS || "true").toLowerCase() !== "false",

  // Shown in the sign-in message and checked on verify, so a signature
  // harvested by another site will not validate here. Must match the domain
  // users actually visit.
  AUTH_DOMAIN: process.env.AUTH_DOMAIN || "dizburza.app",

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "your-secret-key",
  JWT_EXPIRY: cleanEnvValue(process.env.JWT_EXPIRY) || "24h",

  // CORS origins
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",
  FRONTEND_URL_DEV: process.env.FRONTEND_URL_DEV,

  // Rate Limiting
  RATE_LIMIT_WINDOW: Number.parseInt(process.env.RATE_LIMIT_WINDOW || "900000", 10), // 15 mins
  RATE_LIMIT_MAX: Number.parseInt(process.env.RATE_LIMIT_MAX || "100", 10),

  // Organization email verification, sent through Resend's HTTP API. Unset and
  // the send route reports itself disabled rather than silently discarding the
  // code, the same convention as CASHLINK_ADDRESS.
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_API_URL: process.env.RESEND_API_URL || "https://api.resend.com/emails",
  EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS || "Dizburza <onboarding@dizburza.app>",
  OTP_EXPIRY_SECONDS: Number.parseInt(process.env.OTP_EXPIRY_SECONDS || "600", 10),
  OTP_MAX_ATTEMPTS: Number.parseInt(process.env.OTP_MAX_ATTEMPTS || "5", 10),
};

export default ENV;