import crypto from "node:crypto";

export const isValidAlchemySignatureForStringBody = (
  body: string,
  signature: string | undefined,
  signingKey: string | undefined
): boolean => {
  if (!signature || !signingKey) return false;

  const hmac = crypto.createHmac("sha256", signingKey);
  hmac.update(body, "utf8");
  const digest = hmac.digest("hex");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, "utf8"),
      Buffer.from(digest, "utf8")
    );
  } catch {
    return false;
  }
};
