import { prisma } from "./prisma";

export type StaffUser = { id: string; role?: string | null };

export function isMasterUser(user: { role?: string | null }) {
  const role = String(user.role || "").trim().toLowerCase();
  return role === "master" || role === "admin" || role === "master_admin";
}

export type ResolvedStaffProvider =
  | {
      ok: true;
      provider: {
        id: string;
        name: string;
        slug: string;
        status: string;
        phone: string | null;
        email: string | null;
      };
      membership: { role: string } | null;
    }
  | { ok: false; status: 403 | 404; error: string };

function requestedRef(opts: { providerId?: string | null; providerSlug?: string | null }) {
  const providerId = opts.providerId?.trim() || "";
  const providerSlug = opts.providerSlug?.trim() || "";
  return { providerId, providerSlug, explicit: !!(providerId || providerSlug) };
}

export async function resolveStaffProvider(
  user: StaffUser,
  opts: {
    providerId?: string | null;
    providerSlug?: string | null;
    fallbackProviderId?: string | null;
  } = {},
): Promise<ResolvedStaffProvider> {
  const requested = requestedRef(opts);
  const fallbackProviderId = opts.fallbackProviderId?.trim() || "";
  const lookupId = requested.providerId || (!requested.explicit ? fallbackProviderId : "");
  const lookupSlug = requested.providerSlug;

  if (lookupId || lookupSlug) {
    const provider = await prisma.provider.findFirst({
      where: {
        status: "ACTIVE",
        ...(lookupId && lookupSlug
          ? { AND: [{ id: lookupId }, { slug: lookupSlug }] }
          : lookupId
            ? { id: lookupId }
            : { slug: lookupSlug }),
      },
      select: { id: true, name: true, slug: true, status: true, phone: true, email: true },
    });
    if (!provider) {
      if (requested.explicit) {
        return { ok: false, status: 404, error: "Provider not found." };
      }
    } else if (isMasterUser(user)) {
      return { ok: true, provider, membership: null };
    } else {
      const membership = await prisma.userMembership.findFirst({
        where: { userId: user.id, providerId: provider.id, active: true },
        select: { role: true },
      });
      if (membership) return { ok: true, provider, membership };
      if (requested.explicit) {
        return { ok: false, status: 403, error: "You do not have access to that provider." };
      }
    }
  }

  if (isMasterUser(user)) {
    const membership = await prisma.userMembership.findFirst({
      where: { userId: user.id, active: true, provider: { status: "ACTIVE" } },
      include: { provider: { select: { id: true, name: true, slug: true, status: true, phone: true, email: true } } },
      orderBy: { createdAt: "asc" },
    });
    if (membership?.provider) {
      return { ok: true, provider: membership.provider, membership: { role: membership.role } };
    }
    const firstProvider = await prisma.provider.findFirst({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, slug: true, status: true, phone: true, email: true },
    });
    if (!firstProvider) {
      return { ok: false, status: 403, error: "No active provider dashboard is assigned to this account." };
    }
    return { ok: true, provider: firstProvider, membership: null };
  }

  const membership = await prisma.userMembership.findFirst({
    where: { userId: user.id, active: true, provider: { status: "ACTIVE" } },
    include: { provider: { select: { id: true, name: true, slug: true, status: true, phone: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (!membership?.provider) {
    return { ok: false, status: 403, error: "No active provider dashboard is assigned to this account." };
  }
  return { ok: true, provider: membership.provider, membership: { role: membership.role } };
}

export async function resolveStaffProviderForIntake(
  user: StaffUser,
  intakeId: string,
): Promise<ResolvedStaffProvider> {
  const intake = await prisma.intake.findUnique({
    where: { id: intakeId },
    select: { providerId: true },
  });
  if (!intake?.providerId) {
    return { ok: false, status: 404, error: "Not found" };
  }
  const scoped = await resolveStaffProvider(user, { providerId: intake.providerId });
  if (!scoped.ok) {
    return { ok: false, status: 404, error: "Not found" };
  }
  return scoped;
}
