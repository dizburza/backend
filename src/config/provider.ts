import { ethers } from "ethers";

const RPC_URL = "https://rpc.sepolia-api.lisk.com";

// read only provider pointing to sepolia. It allows read only access to the sepolia blockchain
export const readOnlyProvider = new ethers.JsonRpcProvider(RPC_URL);

// read/write provider, that allows you to read data and also sign transaction on whatever chain it's pointing to
export const getProvider = (provider: ethers.Eip1193Provider) =>
  new ethers.BrowserProvider(provider);
