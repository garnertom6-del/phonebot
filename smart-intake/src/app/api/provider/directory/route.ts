import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireProviderAdmin, requireStaff } from "@/lib/staffGuard";
import { DIRECTORY_RELEASE } from "@/lib/directoryCatalog";
import { directoryPermissions, directoryReviewState } from "@/lib/directoryStewardship";

const headers = { "Cache-Control": "private, no-store, max-age=0" };
const base = { providerId: z.string().min(1).max(100), version: z.literal(DIRECTORY_RELEASE.version) };
const command = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("assign"), ownerUserId: z.string().min(1).max(100) }).strict(),
  z.object({ ...base, action: z.literal("review"), note: z.string().trim().min(1).max(1000) }).strict(),
]);

export async function GET(req: NextRequest) {
  const { user, provider, membership, deny } = await requireStaff({ providerId: req.nextUrl.searchParams.get("providerId") });
  if (deny) return deny;
  if (!provider || !user) return NextResponse.json({ error: "Choose an authorized provider." }, { status: 403, headers });
  const where = { providerId: provider.id, directoryVersion: DIRECTORY_RELEASE.version };
  const [assignment, review, history, members] = await Promise.all([
    prisma.directoryStewardship.findFirst({ where: { ...where, action: "ASSIGN" }, orderBy: { id: "desc" } }),
    prisma.directoryStewardship.findFirst({ where: { ...where, action: "REVIEW" }, orderBy: { id: "desc" } }),
    prisma.directoryStewardship.findMany({ where, orderBy: { id: "desc" }, take: 25 }),
    prisma.userMembership.findMany({ where: { providerId: provider.id, active: true, role: { in: ["STAFF", "PROVIDER_ADMIN"] } }, include: { user: { select: { id: true, name: true } } } }),
  ]);
  const ownerActive = members.some((member) => member.userId === assignment?.ownerUserId);
  const permissions = directoryPermissions({ isAdmin: isMasterUser(user) || membership?.role === "PROVIDER_ADMIN", userId: user.id, membershipRole: membership?.role || null, ownerUserId: assignment?.ownerUserId || null, ownerActive });
  return NextResponse.json({
    provider: { id: provider.id, name: provider.name }, version: DIRECTORY_RELEASE.version,
    assignment, review, history, permissions,
    members: permissions.canAssign ? members.map((member) => ({ id: member.user.id, name: member.user.name })) : [],
    state: directoryReviewState(review?.createdAt.toISOString() || null, ownerActive, new Date().toISOString().slice(0, 10)),
  }, { headers });
}

export async function POST(req: NextRequest) {
  const parsed = command.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the review details and reload if the directory version changed." }, { status: 400, headers });
  const input = parsed.data;
  const ctx = input.action === "assign"
    ? await requireProviderAdmin({ providerId: input.providerId })
    : await requireStaff({ providerId: input.providerId, write: true });
  if (ctx.deny) return ctx.deny;
  const { user, provider, membership } = ctx;
  if (!provider || !user) return NextResponse.json({ error: "Choose an authorized provider." }, { status: 403, headers });
  const assignment = await prisma.directoryStewardship.findFirst({ where: { providerId: provider.id, directoryVersion: input.version, action: "ASSIGN" }, orderBy: { id: "desc" } });
  const ownerUserId = input.action === "assign" ? input.ownerUserId : assignment?.ownerUserId;
  const owner = ownerUserId ? await prisma.userMembership.findFirst({
    where: { providerId: provider.id, userId: ownerUserId, active: true, role: { in: ["STAFF", "PROVIDER_ADMIN"] } },
    include: { user: { select: { id: true, name: true } } },
  }) : null;
  if (!owner) return NextResponse.json({ error: "Assign an active staff member from this provider as the review owner." }, { status: 400, headers });
  const permissions = directoryPermissions({ isAdmin: isMasterUser(user) || membership?.role === "PROVIDER_ADMIN", userId: user.id, membershipRole: membership?.role || null, ownerUserId: owner.userId, ownerActive: true });
  if (input.action === "review" && !permissions.canReview) return NextResponse.json({ error: "Only the assigned owner or provider admin may record this review." }, { status: 403, headers });
  const event = await prisma.directoryStewardship.create({ data: {
    providerId: provider.id, directoryVersion: input.version, action: input.action === "assign" ? "ASSIGN" : "REVIEW",
    ownerUserId: owner.userId, ownerName: owner.user.name,
    actorUserId: user.id, actorName: user.name,
    note: input.action === "review" ? input.note : "Review owner assigned",
  } });
  return NextResponse.json({ ok: true, eventId: event.id }, { headers });
}
