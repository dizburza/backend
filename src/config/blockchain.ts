import { ethers } from "ethers";
import { ENV } from "./environment";
import { ERC20_ABI } from "./abi/ERC20ABI.js";
import { FACTORY_ABI } from "./abi/factoryABI.js";
// import { DIZBURZA_ABI } from "./abi/dizburzaABI.js";

export const cNGNContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
  new ethers.Contract(ENV.cNGN_ADDRESS, ERC20_ABI, providerOrSigner);

export const factoryContract = (providerOrSigner: ethers.Provider | ethers.Signer) =>
  new ethers.Contract(ENV.FACTORY_ADDRESS, FACTORY_ABI, providerOrSigner);
