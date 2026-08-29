import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { attachSelectedProviderCookie } from "@/lib/staffGuard";
import { resolveStaffProvider } from "@/lib/staffProviderScope";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
  const providerSlug = typeof body.providerSlug === "string" ? body.providerSlug.trim() : "";
  if (!providerId && !providerSlug) return NextResponse.json({ error: "Choose a provider first." }, { status: 400 });

  const scoped = await resolveStaffProvider(user, { providerId, providerSlug });
  if (!scoped.ok) return NextResponse.json({ error: scoped.error }, { status: scoped.status });

  const response = NextResponse.json({
    provider: { id: scoped.provider.id, name: scoped.provider.name, slug: scoped.provider.slug },
  });
  return attachSelectedProviderCookie(response, scoped.provider.id);
}
