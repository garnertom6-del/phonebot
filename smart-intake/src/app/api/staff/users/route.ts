import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireStaff, isMasterUser } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

/** Provider-admin gate: master users and PROVIDER_ADMIN members manage staff. */
async function requireProviderAdmin() {
  const ctx = await requireStaff();
  if (ctx.deny) return ctx;
  if (isMasterUser(ctx.user!) || ctx.membership?.role === "PROVIDER_ADMIN") return { ...ctx, deny: null };
  return {
    ...ctx,
    deny: NextResponse.json({ error: "Only the provider admin can manage staff logins." }, { status: 403 }),
  };
}

/** List this provider's staff logins (no password hashes leave the server). */
export async function GET() {
  const { provider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  const memberships = await prisma.userMembership.findMany({
    where: { providerId: provider!.id },
    include: { user: { select: { id: true, email: true, name: true, createdAt: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({
    users: memberships.map((m) => ({
      membershipId: m.id, userId: m.user.id, email: m.user.email, name: m.user.name,
      role: m.role, active: m.active, createdAt: m.user.createdAt,
    })),
  });
}

const newUserSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("A valid email is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  role: z.enum(["PROVIDER_ADMIN", "STAFF", "REVIEWER"]).default("STAFF"),
});

/** Create a staff login for this provider (or attach an existing user). */
export async function POST(req: NextRequest) {
  const { user, provider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  const parsed = newUserSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const d = parsed.data;
  const email = d.email.toLowerCase();
  const passwordHash = await bcrypt.hash(d.password, 10);
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { email } });
    const staffUser = existing
      ? await tx.user.update({ where: { id: existing.id }, data: { name: d.name, passwordHash } })
      : await tx.user.create({ data: { email, name: d.name, passwordHash, role: "staff" } });
    const membership = await tx.userMembership.upsert({
      where: { userId_providerId: { userId: staffUser.id, providerId: provider!.id } },
      create: { userId: staffUser.id, providerId: provider!.id, role: d.role, active: true },
      update: { role: d.role, active: true },
    });
    return { staffUser, membership };
  });
  await audit("staff_user_created", {
    providerId: provider!.id, userId: user!.id, detail: `${d.role}: ${email}`,
  });
  return NextResponse.json({
    ok: true,
    user: { userId: result.staffUser.id, email, name: result.staffUser.name, role: result.membership.role, active: true },
  });
}
