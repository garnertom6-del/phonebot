import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { acceptableOverrideReason } from "@/lib/overrideReason";

const overrideSchema = z.object({
  findingKey: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(12, "Enter a specific reason with at least 12 characters.").max(500)
    .refine(acceptableOverrideReason, "Enter a meaningful reason; placeholders such as test, override, or repeated letters are not accepted."),
});

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
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
