import cors from "cors";
import { ENV } from "../config/environment.js";

const allowedOrigins = new Set([
  ENV.FRONTEND_URL,
  ENV.FRONTEND_URL_DEV,
  "http://localhost:3000",
  "http://localhost:3001",
]);

export const corsOptions = {
  origin: (origin: string | undefined, callback: Function) => {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);

    if (
      allowedOrigins.has(origin) ||
      ENV.NODE_ENV === "development"
    ) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
};

export const corsMiddleware = cors(corsOptions);