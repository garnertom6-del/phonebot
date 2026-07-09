import crypto from "crypto";
import { cookies } from "next/headers";
import { prisma } from "./prisma";

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

export function createSessionValue(userId: string): string {
  const exp = Date.now() + 12 * 60 * 60 * 1000; // 12h
  const payload = `${userId}.${exp}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, exp, sig] = parts;
  if (sign(`${userId}.${exp}`) !== sig) return null;
  if (Date.now() > parseInt(exp, 10)) return null;
  return userId;
}

export async function currentUser() {
  const userId = verifySessionValue(cookies().get(COOKIE)?.value);
  if (!userId) return null;
  return prisma.user.findUnique({ where: { id: userId } });
}

export const SESSION_COOKIE = COOKIE;
