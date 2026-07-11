import { NextResponse } from "next/server";
import { currentUser } from "./auth";
import { prisma } from "./prisma";

export function isMasterUser(user: { role?: string | null }) {
  const role = String(user.role || "").trim().toLowerCase();
  return role === "master" || role === "admin" || role === "master_admin";
}

export async function requireStaff() {
  const user = await currentUser();
  if (!user) {
    return { user: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  const membership = await prisma.userMembership.findFirst({
    where: {
      userId: user.id,
      active: true,
      provider: { status: "ACTIVE" },
    },
    include: { provider: true },
    orderBy: { createdAt: "asc" },
  });
  if (!membership) {
    return {
      user,
      provider: null,
      membership: null,
      deny: NextResponse.json(
        { error: "No active provider dashboard is assigned to this account." },
        { status: 403 },
      ),
    };
  }
  return { user, provider: membership.provider, membership, deny: null };
}

export async function requireMaster() {
  const user = await currentUser();
  if (!user) {
    return { user: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  if (!isMasterUser(user)) {
    return { user, deny: NextResponse.json({ error: "Master access required" }, { status: 403 }) };
  }
  return { user, deny: null };
}

export async function requireProviderAdmin() {
  const ctx = await requireStaff();
  if (ctx.deny) return ctx;
  if (isMasterUser(ctx.user!) || ctx.membership?.role === "PROVIDER_ADMIN") {
    return { ...ctx, deny: null };
  }
  return {
    ...ctx,
    deny: NextResponse.json(
      { error: "Only the provider admin can manage provider settings." },
      { status: 403 },
    ),
  };
}
