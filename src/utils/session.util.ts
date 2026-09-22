import { Response } from "express";
import { ENV } from "../config/environment.js";

/** The credential. httpOnly, so page scripts cannot read or exfiltrate it. */
export const SESSION_COOKIE = "dz_session";

/**
 * Readable companion carrying only the wallet address and expiry.
 *
 * The client needs to know whether it already has a session before deciding to
 * prompt for a wallet signature. It cannot read the httpOnly cookie, and an
 * extra round trip on every load would reintroduce the "blank then populate"
 * flash. This carries no secret, so it is safe to expose.
 */
export const SESSION_HINT_COOKIE = "dz_session_hint";

const parseExpiry = (value: string): number => {
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber)) return asNumber * 1000;

  const match = /^(\d+)([smhd])$/.exec(value.trim());
  if (!match) return 24 * 60 * 60 * 1000;

  const amount = Number(match[1]);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]]!;
  return amount * unit;
};

export const sessionMaxAgeMs = () => parseExpiry(ENV.JWT_EXPIRY);

/**
 * Whether the browser will accept a Secure cookie, which is a question about
 * the scheme the app is served over and not about NODE_ENV.
 *
 * Reading the environment instead is a quiet way to break sign-in: a
 * production build served over plain http, which is what running the container
 * locally is, sets Secure on both cookies and the browser discards them. The
 * session then exists on the server, no cookie comes back, and the client waits
 * forever for a sign-in that already succeeded.
 */
const cookiesMustBeSecure = () =>
  (ENV.FRONTEND_URL || "").trim().toLowerCase().startsWith("https://");

export const setSessionCookies = (
  res: Response,
  token: string,
  walletAddress: string
) => {
  const maxAge = sessionMaxAgeMs();
  const secure = cookiesMustBeSecure();

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    // Lax rather than Strict: the app is reached by ordinary top-level
    // navigation, and Strict would drop the cookie on the first click in from
    // an external link.
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  res.cookie(SESSION_HINT_COOKIE, JSON.stringify({
    walletAddress: walletAddress.toLowerCase(),
    expiresAt: Date.now() + maxAge,
  }), {
    httpOnly: false,
    secure,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
};

export const clearSessionCookies = (res: Response) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(SESSION_HINT_COOKIE, { path: "/" });
};
