import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";

const updateProviderSchema = z.object({
  name: z.string().trim().min(2).optional(),
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  contactName: z.string().trim().optional().nullable(),
  email: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  adminName: z.string().trim().optional(),
  adminEmail: z.string().trim().email().optional(),
  adminPassword: z.string().min(8).optional(),
}).superRefine((data, ctx) => {
  if (!!data.adminEmail !== !!data.adminPassword) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provider admin email and password are both required",
      path: [data.adminEmail ? "adminPassword" : "adminEmail"],
    });
  }
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
  const exists = await prisma.provider.findUnique({ where: { id: params.id }, select: { id: true } });
  if (!exists) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  const passwordHash = data.adminPassword ? await bcrypt.hash(data.adminPassword, 10) : null;
  const provider = await prisma.$transaction(async (tx) => {
    const updated = await tx.provider.update({
      where: { id: params.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.contactName !== undefined ? { contactName: nullableText(data.contactName) } : {}),
        ...(data.email !== undefined ? { email: nullableText(data.email) } : {}),
        ...(data.phone !== undefined ? { phone: nullableText(data.phone) } : {}),
      },
    });
    if (data.adminEmail && passwordHash) {
      const adminEmail = data.adminEmail.toLowerCase();
      const user = await tx.user.upsert({
        where: { email: adminEmail },
        create: {
          email: adminEmail,
          passwordHash,
          name: data.adminName || updated.name,
          role: "staff",
        },
        update: { passwordHash, name: data.adminName || updated.name },
      });
      await tx.userMembership.upsert({
        where: { userId_providerId: { userId: user.id, providerId: updated.id } },
        create: { userId: user.id, providerId: updated.id, role: "PROVIDER_ADMIN", active: true },
        update: { role: "PROVIDER_ADMIN", active: true },
      });
    }
    return updated;
  });

  return NextResponse.json({ provider, adminUpdated: !!data.adminEmail });
}
