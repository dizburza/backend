import rateLimit from "express-rate-limit";
import { ENV } from "../config/environment";

export const generalLimiter = rateLimit({
  windowMs: ENV.RATE_LIMIT_WINDOW,
  max: ENV.RATE_LIMIT_MAX,
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
});

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later",
  skipSuccessfulRequests: true,
});

export const transactionLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 transactions per minute
  message: "Too many transaction requests, please slow down",
});