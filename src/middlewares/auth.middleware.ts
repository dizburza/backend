import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { ENV } from "../config/environment";
import { User } from "../models/User.model";
import { ApiResponse } from "../utils/response.util";
import logger from "../utils/logger.util";

export interface JWTPayload {
  userId: string;
  walletAddress: string;
  role: string;
  organizationId?: string;
  organizationSlug?: string;
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (!token) {
       ApiResponse.error(res, "Authentication required", 401);
       return;
    }

    const decoded = jwt.verify(token, ENV.JWT_SECRET) as JWTPayload;

    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
        ApiResponse.error(res, "User not found or inactive", 401);
        return;
    }

    req.user = user;
    req.userId = user._id.toString();
    req.walletAddress = user.walletAddress;

    next();
  } catch (error) {
    logger.error("Authentication error:", error);
    ApiResponse.error(res, "Invalid or expired token", 401);
    return;
  }
};

export const requireRole = (...roles: string[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      ApiResponse.error(res, "Authentication required", 401);
      return;
    }

    if (!roles.includes(req.user.role)) {
      ApiResponse.error(res, "Insufficient permissions", 403);
      return;
    }

    next();
  };
};

export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
) => {
  try {
    const token = req.headers.authorization?.replace("Bearer ", "");

    if (token) {
      const decoded = jwt.verify(token, ENV.JWT_SECRET) as JWTPayload;
      const user = await User.findById(decoded.userId);

      if (user && user.isActive) {
        req.user = user;
        req.userId = user._id.toString();
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

    next(error);
  }
};