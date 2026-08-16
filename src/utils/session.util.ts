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

export const setSessionCookies = (
  res: Response,
  token: string,
  walletAddress: string
) => {
  const maxAge = sessionMaxAgeMs();
  const isProduction = ENV.NODE_ENV === "production";

  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProduction,
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
    secure: isProduction,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
};

export const clearSessionCookies = (res: Response) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(SESSION_HINT_COOKIE, { path: "/" });
};
