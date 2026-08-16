import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ENV } from "../config/environment.js";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { ApiResponse } from "../utils/response.util.js";
import { SESSION_COOKIE } from "../utils/session.util.js";
import logger from "../utils/logger.util.js";

/**
 * Cookie first, Authorization header second. The header path stays for the
 * signature dev script and API tests, which have no cookie jar.
 */
const readToken = (req: Request): string | undefined =>
  req.cookies?.[SESSION_COOKIE] ||
  req.headers.authorization?.replace("Bearer ", "") ||
  undefined;

export interface JWTPayload {
  userId: string;
  walletAddress: string;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = readToken(req);

    if (!token) {
       ApiResponse.error(res, "Authentication required", 401);
       return;
    }

    const decoded = jwt.verify(token, ENV.JWT_SECRET) as JWTPayload;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, decoded.userId))
      .limit(1);

    if (!user || !user.isActive) {
        ApiResponse.error(res, "User not found or inactive", 401);
        return;
    }

    req.user = user;
    req.userId = user.id;
    req.walletAddress = user.walletAddress;

    next();
  } catch (error) {
    logger.error("Authentication error:", error);
    ApiResponse.error(res, "Invalid or expired token", 401);
    return;
  }
};

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const token = readToken(req);

    if (token) {
      const decoded = jwt.verify(token, ENV.JWT_SECRET) as JWTPayload;
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, decoded.userId))
        .limit(1);

      if (user?.isActive) {
        req.user = user;
        req.userId = user.id;
        req.walletAddress = user.walletAddress;
      }
    }

    next();
  } catch (error) {
    if (
      error instanceof jwt.JsonWebTokenError ||
      error instanceof jwt.TokenExpiredError ||
      error instanceof jwt.NotBeforeError
    ) {
      next();
      return;
    }

    // Anything else, a database timeout above all, means the caller could not be
    // identified. Continuing anonymous can only ever narrow what they are shown,
    // never widen it: `/events/stream` answers 401 itself without a user, and
    // `/organizations/slug/:slug` drops to the three public fields. Failing the
    // request instead turned a brief Neon outage into a 500 on the SSE stream,
    // which is the one connection the dashboard needs to stay live.
    logger.warn("Optional auth could not identify the caller, continuing anonymous", {
      path: req.path,
      error: error instanceof Error ? error.message : String(error),
    });
    next();
  }
};