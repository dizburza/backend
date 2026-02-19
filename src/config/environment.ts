import dotenv from "dotenv";

dotenv.config();

const cleanEnvValue = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  return value.split("#")[0].trim();
};

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: Number.parseInt(process.env.PORT || "5000", 10),

  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI,

  // Blockchain
  RPC_URL: process.env.RPC_URL,
  CHAIN_ID: Number.parseInt(process.env.CHAIN_ID!, 10),
  cNGN_ADDRESS:
    process.env.cNGN_ADDRESS || "0xa1F8BD1892C85746AE71B97C31B1965C4641f1F0",
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || "",

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "your-secret-key",
  JWT_EXPIRY: cleanEnvValue(process.env.JWT_EXPIRY) || "24h",

  // API
  API_URL: process.env.API_URL || "http://localhost:5000",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3000",

  // Rate Limiting
  RATE_LIMIT_WINDOW: Number.parseInt(process.env.RATE_LIMIT_WINDOW || "900000", 10), // 15 mins
  RATE_LIMIT_MAX: Number.parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
};

export default ENV;