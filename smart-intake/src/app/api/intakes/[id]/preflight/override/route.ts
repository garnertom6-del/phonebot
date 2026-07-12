import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

const overrideSchema = z.object({
  findingKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(3, "Enter a reason for the override.").max(500),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const parsed = overrideSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Override reason is required." }, { status: 400 });
  }
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    select: { id: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await audit("preflight_overridden", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: JSON.stringify({
      findingKey: parsed.data.findingKey,
      title: parsed.data.title,
      reason: parsed.data.reason,
    }),
  });
  return NextResponse.json({ ok: true });
}
