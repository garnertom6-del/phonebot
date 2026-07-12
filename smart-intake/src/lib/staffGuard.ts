import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "./auth";
import { prisma } from "./prisma";

export const SELECTED_PROVIDER_COOKIE = "mdc_provider";

export function isMasterUser(user: { role?: string | null }) {
  const role = String(user.role || "").trim().toLowerCase();
  return role === "master" || role === "admin" || role === "master_admin";
}

export async function requireStaff() {
  const user = await currentUser();
  if (!user) {
    return { user: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }
  const selectedProviderId = cookies().get(SELECTED_PROVIDER_COOKIE)?.value;

  // Master users can work across providers; the selected cookie scopes their
  // intake routes without granting access to an inactive or unknown provider.
  if (selectedProviderId && isMasterUser(user)) {
    const selectedProvider = await prisma.provider.findFirst({
      where: { id: selectedProviderId, status: "ACTIVE" },
    });
    if (selectedProvider) {
      return { user, provider: selectedProvider, membership: null, deny: null };
    }
  }

  const membership = await prisma.userMembership.findFirst({
    where: {
      userId: user.id,
      active: true,
      ...(selectedProviderId ? { providerId: selectedProviderId } : {}),
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
