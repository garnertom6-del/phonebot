import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const { provider, deny } = await requireStaff({ providerId: req.nextUrl.searchParams.get("providerId") });
  if (deny) return deny;
  const where = { status: "OPEN", review: { intake: { providerId: provider!.id, archived: false } } };
  const [corrections, total, members] = await Promise.all([
    prisma.documentCorrection.findMany({ where, orderBy: { createdAt: "asc" }, take: 25, select: { id: true, reviewId: true, page: true, assignedName: true, assignedUserId: true, createdAt: true, review: { select: { intakeId: true, intake: { select: { client: { select: { fullName: true } } } } } } } }),
    prisma.documentCorrection.count({ where }),
    prisma.userMembership.findMany({ where: { providerId: provider!.id, active: true, role: { in: ["STAFF", "PROVIDER_ADMIN"] } }, select: { userId: true } }),
  ]);
  return NextResponse.json({ total, corrections: corrections.map(c => ({ id: c.id, reviewId: c.reviewId, page: c.page, assignedName: c.assignedName, ownerActive: members.some(m => m.userId === c.assignedUserId), createdAt: c.createdAt, intakeId: c.review.intakeId, clientName: c.review.intake.client.fullName })) }, { headers: { "Cache-Control": "no-store" } });
}
