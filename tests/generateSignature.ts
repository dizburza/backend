import { ethers } from "ethers";
import * as dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const API_URL = process.env.API_URL || "http://localhost:3000";

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

  return {
    message: authMessage,
    signature,
    walletAddress: wallet.address,
  };
}

// Run
const userAddress = process.env.USER_ADDRESS!;
generateSignature(userAddress)
  .then((result) => {
    console.log("\n📋 Use these for login:");
    console.log(JSON.stringify(result, null, 2));
  })
  .catch(console.error);
