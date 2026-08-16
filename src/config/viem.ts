import { createPublicClient, http, type PublicClient } from "viem";
import { ENV } from "./environment.js";

/**
 * A second RPC client, viem's, used for one thing: verifying a signature that
 * ecrecover cannot.
 *
 * ethers has no equivalent. Its `verifyMessage` is ecrecover and nothing else,
 * so every smart account is refused at sign-in. viem carries ERC-1271 and
 * ERC-6492, and 6492 is the one that matters here: a thirdweb smart account has
 * no code until its first transaction, and signing in is what a user does
 * before that.
 *
 * No `chain` on purpose. With one, viem would look for a validator already
 * deployed at a well known address; without one it deploys the validator inside
 * the `eth_call` itself, which works on any node including a bare anvil.
 *
 * Short timeout and one retry: this sits in the sign-in path, so a slow node
 * should refuse quickly rather than hold the request open.
 *
 * Annotated rather than inferred because viem's inferred client type names
 * paths inside node_modules, which tsc refuses to emit.
 */
export const verificationClient: PublicClient = createPublicClient({
  transport: http(ENV.RPC_URL, { retryCount: 1, timeout: 5_000 }),
});
