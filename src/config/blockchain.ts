import { ethers } from "ethers";
import { ENV } from "./environment.js";
import { ERC20_ABI } from "./abi/erc20ABI.js";
import { FACTORY_ABI } from "./abi/factoryABI.js";

/**
 * The chain is pinned rather than detected.
 *
 * Left to detect, ethers probes on first use and retries every second forever
 * when the node is unreachable, so a bad RPC_URL hangs instead of erroring. We
 * already know the chain id, and pinning it also drops a round trip from every
 * reconnect.
 */
export const provider = new ethers.JsonRpcProvider(ENV.RPC_URL, ENV.CHAIN_ID, {
  staticNetwork: true,
});

/**
 * Handle on the configured payroll token.
 *
 * Built from ENV so it exists before the database is reachable, which the
 * indexer needs for log decoding at boot. Anything that cares about decimals or
 * symbol goes through TokenService instead, since those come from the chain.
 */
export const tokenContract = new ethers.Contract(
  ENV.PAYROLL_TOKEN_ADDRESS,
  ERC20_ABI,
  provider
);
export const factoryContract = new ethers.Contract(
  ENV.FACTORY_ADDRESS,
  FACTORY_ABI,
  provider
);
