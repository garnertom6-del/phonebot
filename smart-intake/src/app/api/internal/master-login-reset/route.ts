import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = "admin@mooredivinecare.local";

function resetToken(): string {
  return process.env.MASTER_LOGIN_RESET_TOKEN?.trim() || "";
}

function isAuthorized(headerToken: string | null) {
  const expected = resetToken();
  if (!expected || !headerToken) return false;
  const a = Buffer.from(headerToken);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Emergency master-password reset. Disabled unless MASTER_LOGIN_RESET_TOKEN
 * is set in the server environment. There is no default secret in git.
 * Rotate the production master password after any suspected leak.
 */
export async function POST(req: NextRequest) {
  if (!resetToken() || !isAuthorized(req.headers.get("x-reset-token"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const password = typeof body.password === "string" ? body.password : "";
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const provider = await tx.provider.upsert({
      where: { slug: "moore-divine-care" },
      create: {
        name: "Moore Divine Care, Inc.",
        slug: "moore-divine-care",
        status: "ACTIVE",
        email: ADMIN_EMAIL,
      },
      update: {
        name: "Moore Divine Care, Inc.",
        status: "ACTIVE",
        email: ADMIN_EMAIL,
      },
    });

    const user = await tx.user.upsert({
      where: { email: ADMIN_EMAIL },
      create: {
        email: ADMIN_EMAIL,
        passwordHash,
        name: "MDC Admin",
        role: "master",
      },
      update: {
        passwordHash,
        name: "MDC Admin",
        role: "master",
      },
    });

    await tx.userMembership.upsert({
      where: { userId_providerId: { userId: user.id, providerId: provider.id } },
      create: { userId: user.id, providerId: provider.id, role: "PROVIDER_ADMIN", active: true },
      update: { role: "PROVIDER_ADMIN", active: true },
    });

    return { userId: user.id, providerId: provider.id };
  });

  return NextResponse.json({ ok: true, email: ADMIN_EMAIL, ...result });
}
