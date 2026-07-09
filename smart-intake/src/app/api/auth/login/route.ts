import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { createSessionValue, SESSION_COOKIE } from "@/lib/auth";
import { loginSchema } from "@/lib/validation";
import { audit } from "@/lib/auditLog";

// Simple in-memory lockout: 5 wrong tries per email+IP -> 15 minute wait.
// Resets on server restart, which is fine - it only needs to stop guessing.
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function attemptKey(email: string, req: NextRequest): string {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  return `${email.toLowerCase()}|${ip}`;
}

export async function POST(req: NextRequest) {
  const body = loginSchema.safeParse(await req.json());
  if (!body.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const key = attemptKey(body.data.email, req);
  const state = attempts.get(key);
  if (state && state.lockedUntil > Date.now()) {
    const minutes = Math.ceil((state.lockedUntil - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Too many wrong tries. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.` },
      { status: 429 },
    );
  }

  const user = await prisma.user.findUnique({ where: { email: body.data.email.toLowerCase() } });
  if (!user || !(await bcrypt.compare(body.data.password, user.passwordHash))) {
    const next = { count: (state?.count || 0) + 1, lockedUntil: 0 };
    if (next.count >= MAX_ATTEMPTS) {
      next.count = 0;
      next.lockedUntil = Date.now() + LOCKOUT_MS;
      await audit("login_locked_out", { detail: body.data.email.toLowerCase() });
    }
    attempts.set(key, next);
    return NextResponse.json({ error: "Wrong email or password" }, { status: 401 });
  }

  attempts.delete(key);
  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set(SESSION_COOKIE, createSessionValue(user.id), {
    httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production",
  });
  return res;
}
