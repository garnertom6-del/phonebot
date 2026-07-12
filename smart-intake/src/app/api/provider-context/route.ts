import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { isMasterUser, SELECTED_PROVIDER_COOKIE } from "@/lib/staffGuard";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
  if (!providerId) return NextResponse.json({ error: "Choose a provider first." }, { status: 400 });

  const provider = isMasterUser(user)
    ? await prisma.provider.findFirst({ where: { id: providerId, status: "ACTIVE" } })
    : (await prisma.userMembership.findFirst({
        where: {
          userId: user.id,
          providerId,
          active: true,
          provider: { status: "ACTIVE" },
        },
        include: { provider: true },
      }))?.provider || null;

  if (!provider) return NextResponse.json({ error: "You do not have access to that provider." }, { status: 403 });

  const response = NextResponse.json({
    provider: { id: provider.id, name: provider.name, slug: provider.slug },
  });
  response.cookies.set(SELECTED_PROVIDER_COOKIE, provider.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 12 * 60 * 60,
  });
  return response;
}
