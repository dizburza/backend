import type { User } from "../db/types.js";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      userId?: string;
      walletAddress?: string;
    }
  }
}
