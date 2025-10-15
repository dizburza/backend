import { ethers } from "ethers";
import { ENV } from "./environment";
import { ERC20_ABI } from "./abi/erc20ABI";
import { FACTORY_ABI } from "./abi/factoryABI";

export const provider = new ethers.JsonRpcProvider(ENV.RPC_URL);

export const cNGNContract = new ethers.Contract(
  ENV.cNGN_ADDRESS,
  ERC20_ABI,
  provider
);
export const factoryContract = new ethers.Contract(
  ENV.FACTORY_ADDRESS,
  FACTORY_ABI,
  provider
);
