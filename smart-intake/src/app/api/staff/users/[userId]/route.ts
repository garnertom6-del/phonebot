import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireStaff, isMasterUser } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

async function requireProviderAdmin() {
  const ctx = await requireStaff();
  if (ctx.deny) return ctx;
  if (isMasterUser(ctx.user!) || ctx.membership?.role === "PROVIDER_ADMIN") return { ...ctx, deny: null };
  return {
    ...ctx,
    deny: NextResponse.json({ error: "Only the provider admin can manage staff logins." }, { status: 403 }),
  };
}

const patchSchema = z.object({
  name: z.string().min(1).optional(),
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
  role: z.enum(["PROVIDER_ADMIN", "STAFF", "REVIEWER"]).optional(),
  active: z.boolean().optional(),
});

/** Update a staff member: rename, reset password, change role, enable/disable. */
export async function PATCH(req: NextRequest, { params }: { params: { userId: string } }) {
  const { user, provider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid input" }, { status: 400 });
  }
  const d = parsed.data;
  const membership = await prisma.userMembership.findUnique({
    where: { userId_providerId: { userId: params.userId, providerId: provider!.id } },
    include: { user: true },
  });
  if (!membership) return NextResponse.json({ error: "That staff member is not on this provider." }, { status: 404 });

  // never let the last active admin lock everyone out
  const demotingOrDisabling = (d.role && d.role !== "PROVIDER_ADMIN" && membership.role === "PROVIDER_ADMIN") ||
    (d.active === false && membership.role === "PROVIDER_ADMIN");
  if (demotingOrDisabling) {
    const admins = await prisma.userMembership.count({
      where: { providerId: provider!.id, role: "PROVIDER_ADMIN", active: true },
    });
    if (admins <= 1) {
      return NextResponse.json({ error: "You can't remove the last admin - make someone else an admin first." }, { status: 400 });
    }
  }

  if (d.name || d.password) {
    await prisma.user.update({
      where: { id: membership.userId },
      data: {
        ...(d.name ? { name: d.name } : {}),
        ...(d.password ? { passwordHash: await bcrypt.hash(d.password, 10) } : {}),
      },
    });
  }
  if (d.role !== undefined || d.active !== undefined) {
    await prisma.userMembership.update({
      where: { id: membership.id },
      data: { ...(d.role ? { role: d.role } : {}), ...(d.active !== undefined ? { active: d.active } : {}) },
    });
  }
  await audit("staff_user_updated", {
    providerId: provider!.id, userId: user!.id,
    detail: `${membership.user.email}: ${Object.keys(d).join(", ")}`,
  });
  return NextResponse.json({ ok: true });
}
