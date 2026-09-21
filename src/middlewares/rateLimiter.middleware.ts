import rateLimit, { ipKeyGenerator, type Store } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { ENV } from "../config/environment.js";
import { sendRedisCommand } from "../config/redis.js";

/**
 * Counts live in Redis when it is configured, in process memory otherwise.
 *
 * This matters more than it looks. The default store is per process, so two
 * instances behind a load balancer each keep their own tally and every limit
 * here is silently doubled. For the lookup limiter that is not a performance
 * detail: it is the control that stops someone guessing usernames one at a
 * time to map names to wallet addresses.
 *
 * Each limiter gets its own prefix, or they would share a bucket.
 */
const storeFor = (prefix: string): Store | undefined =>
  sendRedisCommand
    ? new RedisStore({ sendCommand: sendRedisCommand, prefix: `dz:rl:${prefix}:` })
    : undefined;

/**
 * Reading x-forwarded-for by hand took the leftmost value, which the client
 * sets and can therefore forge to get a fresh bucket per request. `trust proxy`
 * is configured in app.ts, so req.ip already resolves the real client address.
 *
 * ipKeyGenerator collapses IPv6 to its /64 subnet. Without it a single IPv6
 * client can rotate addresses within its own prefix and never hit a limit.
 */
const keyGenerator = (req: { ip?: string }) => ipKeyGenerator(req.ip ?? "");

export const generalLimiter = rateLimit({
  store: storeFor("general"),
  windowMs: ENV.RATE_LIMIT_WINDOW,
  max: ENV.RATE_LIMIT_MAX,
  message: "Too many requests from this IP, please try again later",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator,
  // SSE holds one long-lived request open and EventSource reconnects on its
  // own. Counting those against a per-IP budget would throttle a client that
  // is deliberately making *fewer* requests than one that polls.
  skip: (req) => req.path.startsWith("/events/stream"),
});

export const authLimiter = rateLimit({
  store: storeFor("auth"),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 requests per window
  message: "Too many authentication attempts, please try again later",
  skipSuccessfulRequests: true,
  keyGenerator,
});

export const transactionLimiter = rateLimit({
  store: storeFor("tx"),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 transactions per minute
  message: "Too many transaction requests, please slow down",
  keyGenerator,
});

/**
 * Directory lookups are exact-match only, so nobody can walk the user list by
 * prefix. This is what stops the remaining attack: guessing likely usernames
 * one at a time. Keyed by session where there is one, since an authenticated
 * attacker behind a shared NAT should not spend everyone else's budget.
 *
 * Sized for a person typing a username, not for a script.
 */
export const lookupLimiter = rateLimit({
  store: storeFor("lookup"),
  windowMs: 60 * 1000,
  max: 20,
  message: "Too many lookups, please slow down",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: { ip?: string; userId?: string }) =>
    req.userId ? `user:${req.userId}` : keyGenerator(req),
});

/**
 * Sending an email costs money and a resend button invites hammering it.
 * Keyed by session like the lookup limiter, for the same reason: a shared NAT
 * should not spend everyone else's budget on one person's resend clicks.
 */
export const emailVerificationLimiter = rateLimit({
  store: storeFor("email-verify"),
  windowMs: 60 * 1000,
  max: 3,
  message: "Too many verification requests, please wait a moment",
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: { ip?: string; userId?: string }) =>
    req.userId ? `user:${req.userId}` : keyGenerator(req),
});