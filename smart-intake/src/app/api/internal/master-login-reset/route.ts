import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";

const RESET_TOKEN_SHA256 = "773ed3bb4cfbd301f94fe89ee0b2e64ab77c05ab2caf43a21d5d62d7b1af09cf";
const ADMIN_EMAIL = "admin@mooredivinecare.local";

function isAuthorized(token: string | null) {
  if (!token) return false;
  const digest = crypto.createHash("sha256").update(token).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest, "hex"), Buffer.from(RESET_TOKEN_SHA256, "hex"));
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req.headers.get("x-reset-token"))) {
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
