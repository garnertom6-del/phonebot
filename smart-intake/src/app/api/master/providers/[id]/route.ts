import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";

const updateProviderSchema = z.object({
  name: z.string().trim().min(2).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  contactName: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
});

function nullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text ? text : null;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { deny } = await requireMaster();
  if (deny) return deny;

  const parsed = updateProviderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid provider update" }, { status: 400 });
  }

  const data = parsed.data;
  const provider = await prisma.provider.update({
    where: { id: params.id },
    data: {
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.contactName !== undefined ? { contactName: nullableText(data.contactName) } : {}),
      ...(data.email !== undefined ? { email: nullableText(data.email) } : {}),
      ...(data.phone !== undefined ? { phone: nullableText(data.phone) } : {}),
    },
  }).catch(() => null);

  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  return NextResponse.json({ provider });
}
