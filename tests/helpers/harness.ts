import { ethers } from "ethers";
import postgres from "postgres";
import type { Express } from "express";

/**
 * Test harness.
 *
 * Runs against a real Postgres, because most of what these tests assert is
 * enforced by the database: the single-employment index, the one-vote-per-signer
 * index, the unique identifiers. A mocked store would pass while the constraint
 * that actually protects the rule was missing.
 *
 * Point TEST_DATABASE_URL at a scratch database and run `npm run test:setup`
 * once to migrate it.
 */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://localhost:5432/dizburza_test";

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-secret";
process.env.AUTH_DOMAIN = process.env.AUTH_DOMAIN ?? "localhost";
process.env.INDEXER_ENABLED = "false";
/**
 * Nothing in this suite may reach a chain.
 *
 * Forced rather than defaulted, because dotenv fills RPC_URL in from .env and a
 * developer's own file points at a real network. A relayer or CashLink test that
 * got as far as sending would then broadcast a transaction and spend real gas.
 */
process.env.RPC_URL = process.env.TEST_RPC_URL ?? "http://127.0.0.1:9";
/**
 * Nor may it reach the price API.
 *
 * Same reasoning as the chain, and it was not theoretical: the first run of the
 * FX tests called CoinGecko for real. A suite that depends on a rate limited
 * third party is flaky by construction, and the interesting case here is how
 * pricing degrades when the rate cannot be read at all.
 */
process.env.COINGECKO_URL = "http://127.0.0.1:9";
// Every test registers users from one IP, which trips the app-wide limiter long
// before anything interesting happens. The lookup limiter is hardcoded at 20 and
// is deliberately left alone, since one test asserts on it.
process.env.RATE_LIMIT_MAX = "100000";
// Enough for CashLink to consider sends configured. Nothing here reaches a
// chain, so the key is never used to sign anything.
process.env.RELAYER_PRIVATE_KEY =
  process.env.RELAYER_PRIVATE_KEY ?? ("0x" + "11".repeat(32));
// Enough for the CashLink routes to consider themselves configured. Nothing is
// deployed there, so a claim gets as far as the send and no further, which is
// exactly what the lease tests need to observe.
process.env.CASHLINK_ADDRESS =
  process.env.CASHLINK_ADDRESS ?? "0x00000000000000000000000000000000000ca54c";
process.env.FACTORY_ADDRESS =
  process.env.FACTORY_ADDRESS ?? "0x00000000000000000000000000000000000fac00";
// Reads decimals off chain on first use, so keep it to one known token.
process.env.PAYROLL_TOKEN_ADDRESS =
  process.env.PAYROLL_TOKEN_ADDRESS ?? "0xa1F8BD1892C85746AE71B97C31B1965C4641f1F0";

export const sql = postgres(TEST_DATABASE_URL);

let cached: { app: Express; baseUrl: string; close: () => Promise<void> } | null = null;

/** Boots the API once per test process on an ephemeral port. */
export async function server() {
  if (cached) return cached;

  const { default: app } = await import("../../src/app.js");

  const listener = await new Promise<import("node:http").Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });

  const address = listener.address();
  const port = typeof address === "object" && address ? address.port : 0;

  cached = {
    app,
    baseUrl: `http://127.0.0.1:${port}/api`,
    close: async () => {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    },
  };

  return cached;
}

export type Client = {
  address: string;
  wallet: ethers.HDNodeWallet;
  call: (path: string, init?: RequestInit) => Promise<{ status: number; body: any }>;
  /** For responses that are not JSON, which `call` would fail to parse. */
  cookie: () => string;
};

/** An anonymous request, with no cookie jar at all. */
export async function anon(path: string, init: RequestInit = {}) {
  const { baseUrl } = await server();
  const res = await fetch(baseUrl + path, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

/** A registered user holding its own session cookie. */
export async function user(firstname = "Test"): Promise<Client> {
  const { baseUrl } = await server();
  const wallet = ethers.Wallet.createRandom();
  const jar: string[] = [];

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(baseUrl + path, {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie: jar.map((c) => c.split(";")[0]).join("; "),
        ...(init.headers ?? {}),
      },
    });
    for (const c of res.headers.getSetCookie?.() ?? []) jar.push(c);
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };

  const message = (await call(`/auth/message/${wallet.address}`)).body.data.message;

  const registered = await call("/auth/register", {
    method: "POST",
    body: JSON.stringify({
      walletAddress: wallet.address,
      signature: await wallet.signMessage(message),
      surname: "Tester",
      firstname,
      email: `${firstname.toLowerCase()}.${crypto.randomUUID()}@example.test`,
    }),
  });

  if (jar.length === 0) {
    throw new Error(`register failed: ${registered.status} ${JSON.stringify(registered.body)}`);
  }

  return {
    address: wallet.address.toLowerCase(),
    wallet,
    call,
    cookie: () => jar.map((c) => c.split(";")[0]).join("; "),
  };
}

/**
 * An organization with its members, seeded directly.
 *
 * Creating one through the API needs a deployed contract, which these tests are
 * not about. The rows are what authorization reads.
 */
export async function organization(options: {
  owner: string;
  quorum?: number;
  signers?: string[];
  employees?: Array<{ address: string; name?: string; salary?: string }>;
}) {
  const treasury = ethers.Wallet.createRandom().address.toLowerCase();
  const slug = `org-${crypto.randomUUID().slice(0, 8)}`;

  const [org] = await sql`
    insert into organizations
      (name, slug, contract_address, organization_hash, creator_address, business_email,
       quorum, registration_number, tax_identification_number)
    values ('Test Ltd', ${slug}, ${treasury}, ${ethers.hexlify(ethers.randomBytes(32))},
            ${options.owner}, ${`ops-${slug}@example.test`}, ${options.quorum ?? 2},
            ${`RC${Date.now()}${Math.floor(Math.random() * 1000)}`},
            ${`TIN${Date.now()}${Math.floor(Math.random() * 1000)}`})
    returning id`;

  await sql`insert into organization_members (organization_id, address, name, role)
            values (${org.id}, ${options.owner}, 'Owner', 'owner')`;

  for (const signer of options.signers ?? []) {
    await sql`insert into organization_members (organization_id, address, name, role)
              values (${org.id}, ${signer}, 'Signer', 'signer')`;
  }

  for (const employee of options.employees ?? []) {
    await sql`
      insert into organization_members
        (organization_id, address, name, role, job_role, salary)
      values (${org.id}, ${employee.address}, ${employee.name ?? "Employee"}, 'employee',
              'Engineer', ${employee.salary ?? "450000000000"})`;
  }

  return { id: org.id as string, slug, treasury };
}

export const inAWeek = () => new Date(Date.now() + 7 * 864e5).toISOString();
