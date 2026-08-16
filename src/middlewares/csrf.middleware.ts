import { NextFunction, Request, Response } from "express";
import { ENV } from "../config/environment.js";
import { ApiResponse } from "../utils/response.util.js";
import logger from "../utils/logger.util.js";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const allowedOrigins = () =>
  [ENV.FRONTEND_URL, ENV.FRONTEND_URL_DEV].filter(Boolean) as string[];

/**
 * Origin check for cookie-authenticated writes.
 *
 * SameSite=Lax already blocks cross-site POSTs from carrying the session
 * cookie, but it is a browser-side control with historical gaps, and it does
 * nothing for a request that arrives without SameSite handling at all. Checking
 * Origin server-side is the belt to that braces.
 *
 * Requests authenticating by bearer token are exempt: they are not riding on an
 * ambient cookie, so they are not forgeable in the way CSRF describes.
 */
export const csrfGuard = (req: Request, res: Response, next: NextFunction) => {
  if (SAFE_METHODS.has(req.method)) return next();

  const usesBearer = req.headers.authorization?.startsWith("Bearer ");
  if (usesBearer) return next();

  // Webhooks are server-to-server and authenticated by signature instead.
  if (req.path.startsWith("/webhooks/")) return next();

  const origin = req.get("origin") ?? req.get("referer");

  // No Origin at all means a non-browser client, which cannot be a CSRF victim.
  if (!origin) return next();

  const permitted = allowedOrigins();
  const matches = permitted.some((allowed) => origin.startsWith(allowed));

  if (!matches) {
    logger.warn(`Rejected ${req.method} ${req.path} from origin ${origin}`);
    ApiResponse.error(res, "Cross-origin request rejected", 403);
    return;
  }

  next();
};
