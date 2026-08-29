import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { currentUser } from "./auth";
import { isMasterUser, resolveStaffProvider, resolveStaffProviderForIntake } from "./staffProviderScope";

export { isMasterUser } from "./staffProviderScope";
export const SELECTED_PROVIDER_COOKIE = "mdc_provider";

const PROVIDER_COOKIE = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 12 * 60 * 60,
};

export function attachSelectedProviderCookie(response: NextResponse, providerId: string) {
  response.cookies.set(SELECTED_PROVIDER_COOKIE, providerId, PROVIDER_COOKIE);
  return response;
}

export async function requireStaff(opts?: {
  providerId?: string | null;
  providerSlug?: string | null;
  intakeId?: string | null;
  write?: boolean;
}) {
  const user = await currentUser();
  if (!user) {
    return { user: null, provider: null, membership: null, deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }) };
  }

  const scoped = opts?.intakeId
    ? await resolveStaffProviderForIntake(user, opts.intakeId)
    : await resolveStaffProvider(user, {
      providerId: opts?.providerId,
      providerSlug: opts?.providerSlug,
      fallbackProviderId: cookies().get(SELECTED_PROVIDER_COOKIE)?.value,
    });

  if (!scoped.ok) {
    return {
      user,
      provider: null,
      membership: null,
      deny: NextResponse.json({ error: scoped.error }, { status: scoped.status }),
    };
  }

  if (opts?.write && scoped.membership?.role === "REVIEWER") {
    return {
      user,
      provider: scoped.provider,
      membership: scoped.membership,
      deny: NextResponse.json({ error: "Reviewer accounts are read-only." }, { status: 403 }),
    };
  }
  return { user, provider: scoped.provider, membership: scoped.membership, deny: null };
}

export async function requireWritableStaff() {
  return requireStaff({ write: true });
}

export async function requireStaffForIntake(intakeId: string, opts?: { write?: boolean }) {
  return requireStaff({ ...opts, intakeId });
}

export async function requireWritableStaffForIntake(intakeId: string) {
  return requireStaff({ write: true, intakeId });
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
  const user = await currentUser();
  if (!user) {
    return {
      user: null,
      provider: null,
      membership: null,
      deny: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  if (isMasterUser(user)) {
    return { user, provider: null, membership: null, deny: null };
  }

  const ctx = await requireStaff();
  if (ctx.deny) return ctx;
  if (ctx.membership?.role === "PROVIDER_ADMIN") {
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
