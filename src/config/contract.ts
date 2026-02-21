import { ethers } from "ethers";
import { ENV } from "./environment.js";
import { ERC20_ABI } from "./abi/erc20ABI.js";
import { FACTORY_ABI } from "./abi/factoryABI.js";

export const cNGNContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
  new ethers.Contract(ENV.cNGN_ADDRESS, ERC20_ABI, providerOrSigner);

export const factoryContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
  new ethers.Contract(ENV.FACTORY_ADDRESS, FACTORY_ABI, providerOrSigner);
