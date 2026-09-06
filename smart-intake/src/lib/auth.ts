import crypto from "crypto";
import { prisma } from "./prisma";
import { readRequestCookie } from "./requestCookies";

const SECRET = () => {
  const secret = process.env.SESSION_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET must be set in production.");
  }
  return secret || "dev-secret-change-me";
};
const COOKIE = "mdc_session";

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET()).update(payload).digest("base64url");
}

export function createSessionValue(userId: string, sessionVersion = 0): string {
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12h
  const payload = `${userId}.${exp}.${sessionVersion}`;
  return `${payload}.${sign(payload)}`;
}

function verifiedSession(value: string | undefined): { userId: string; sessionVersion: number } | null {
  if (!value) return null;
  const parts = value.split(".");
  // Previously issued cookies are version zero, so deploys preserve sessions
  // until the account's first password reset explicitly revokes them.
  if (parts.length !== 3 && parts.length !== 4) return null;
  const [userId, exp] = parts;
  const sessionVersion = parts.length === 4 ? Number(parts[2]) : 0;
  if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) return null;
  if (!/^\d+$/.test(exp) || !Number.isSafeInteger(Number(exp)) || Date.now() > Number(exp)) return null;
  const signature = parts.at(-1)!;
  const expected = sign(parts.slice(0, -1).join("."));
  const received = Buffer.from(signature), valid = Buffer.from(expected);
  if (received.length !== valid.length || !crypto.timingSafeEqual(received, valid)) return null;
  return { userId, sessionVersion };
}

export function verifySessionValue(value: string | undefined): string | null {
  return verifiedSession(value)?.userId ?? null;
}

export async function currentUser() {
  const session = verifiedSession(await readRequestCookie(COOKIE));
  if (!session) return null;
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  return user?.sessionVersion === session.sessionVersion ? user : null;
}

export const SESSION_COOKIE = COOKIE;
