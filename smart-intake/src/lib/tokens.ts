import crypto from "crypto";

/** Cryptographically random URL-safe token for client intake links. */
export function newIntakeToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function tokenExpiry(): Date {
  const days = parseInt(process.env.CLIENT_LINK_EXPIRY_DAYS || "7", 10);
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
