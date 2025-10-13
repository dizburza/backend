import dotenv from "dotenv";

dotenv.config();

export const ENV = {
  NODE_ENV: process.env.NODE_ENV || "development",
  PORT: parseInt(process.env.PORT || "3000", 10),

  // MongoDB
  MONGODB_URI: process.env.MONGODB_URI || "mongodb://localhost:27017/payroll",

  // Blockchain
  RPC_URL: process.env.RPC_URL || "",
  CHAIN_ID: parseInt(process.env.CHAIN_ID || "1", 10),
  cNGN_ADDRESS:
    process.env.cNGN_ADDRESS || "0xa1F8BD1892C85746AE71B97C31B1965C4641f1F0",
  FACTORY_ADDRESS: process.env.FACTORY_ADDRESS || "",

  // JWT
  JWT_SECRET: process.env.JWT_SECRET || "your-secret-key",
  JWT_EXPIRY: process.env.JWT_EXPIRY || "24h",

  // API
  API_URL: process.env.API_URL || "http://localhost:3000",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:3001",

  // Rate Limiting
  RATE_LIMIT_WINDOW: parseInt(process.env.RATE_LIMIT_WINDOW || "900000", 10), // 15 mins
  RATE_LIMIT_MAX: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
};

export default ENV;