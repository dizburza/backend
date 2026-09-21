import { ethers } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

// 5000 is the API. 3000 is the frontend, which was the old default and sent
// every challenge request to the wrong process.
const API_URL = process.env.API_URL || "http://localhost:5050";

function validateEnv() {
  const requiredVars = ["USER_PRIVATE_KEY", "USER_ADDRESS"];
  const missingVars = requiredVars.filter((varName) => !process.env[varName]);
  if (missingVars.length > 0) {
    throw new Error(`Missing environment variables: ${missingVars.join(", ")}`);
  }
}

async function generateSignature(userAddress: string) {
  validateEnv();

  const userPrivateKey = process.env.USER_PRIVATE_KEY!;
  const wallet = new ethers.Wallet(userPrivateKey);

  if (wallet.address.toLowerCase() !== userAddress.toLowerCase()) {
    throw new Error(
      `Wallet address (${wallet.address}) does not match userAddress (${userAddress})`
    );
  }

  // Step 1: Get the auth message from backend (includes nonce)
  console.log("Fetching auth message from backend...");
  const messageResponse = await axios.get(
    `${API_URL}/api/auth/message/${userAddress}`
  );
  const authMessage = messageResponse.data.data.message;

  console.log("Message to sign:", authMessage);

  // Step 2: Sign the message
  const signature = await wallet.signMessage(authMessage);

  console.log("\n✅ Signature Generated:");
  console.log("Message:", authMessage);
  console.log("Signature:", signature);
  console.log("Signer Address:", wallet.address);

  // The login endpoint takes the signature only. The message is printed above
  // for eyeballing, but the server rebuilds it from its own stored challenge.
  return {
    signature,
    walletAddress: wallet.address,
  };
}

// Run
const userAddress = process.env.USER_ADDRESS!;

try {
  const result = await generateSignature(userAddress);
  console.log("\n📋 Use these for login:");
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error);
}
