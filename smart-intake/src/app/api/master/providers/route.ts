import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireMaster, requireProviderAdmin } from "@/lib/staffGuard";

const createProviderSchema = z.object({
  name: z.string().trim().min(2, "Provider name is required"),
  slug: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  adminName: z.string().trim().optional(),
  adminEmail: z.string().trim().email("Provider admin email is required"),
  adminPassword: z.string().min(8, "Provider admin password must be at least 8 characters"),
});

function nullableText(value?: string) {
  const text = value?.trim();
  return text ? text : null;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || `provider-${Date.now()}`;
}

async function availableSlug(input: string) {
  const base = slugify(input);
  let slug = base;
  let suffix = 2;
  while (await prisma.provider.findUnique({ where: { slug }, select: { id: true } })) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  return slug;
}

export async function GET() {
  const { user, provider, deny } = await requireProviderAdmin();
  if (deny) return deny;
  const isMaster = isMasterUser(user!);

  const providers = await prisma.provider.findMany({
    where: isMaster ? undefined : { id: provider!.id },
    include: {
      _count: { select: { clients: true, intakes: true, memberships: true } },
      memberships: {
        include: { user: { select: { id: true, email: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      pdfTemplates: {
        where: { isActive: true },
        orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        select: {
          id: true,
          name: true,
          originalFileName: true,
          pageCount: true,
          pageWidth: true,
          pageHeight: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    providers,
    isMaster,
    // Only expose availability, never the key itself. Provider staff use the
    // shared system service through their normal portal login.
    aiConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;

  const parsed = createProviderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid provider" }, { status: 400 });
  }

  const data = parsed.data;
  const adminEmail = data.adminEmail.toLowerCase();
  const passwordHash = await bcrypt.hash(data.adminPassword, 10);
  const slug = await availableSlug(data.slug || data.name);

  const result = await prisma.$transaction(async (tx) => {
    const provider = await tx.provider.create({
      data: {
        name: data.name,
        slug,
        status: "ACTIVE",
        contactName: nullableText(data.contactName),
        email: nullableText(data.email),
        phone: nullableText(data.phone),
      },
    });
    const user = await tx.user.upsert({
      where: { email: adminEmail },
      create: {
        email: adminEmail,
        passwordHash,
        name: data.adminName || data.contactName || data.name,
        role: "staff",
      },
      update: {
        passwordHash,
        name: data.adminName || data.contactName || data.name,
      },
    });
    const membership = await tx.userMembership.upsert({
      where: { userId_providerId: { userId: user.id, providerId: provider.id } },
      create: { userId: user.id, providerId: provider.id, role: "PROVIDER_ADMIN", active: true },
      update: { role: "PROVIDER_ADMIN", active: true },
    });
    return { provider, user: { id: user.id, email: user.email, name: user.name, role: user.role }, membership };
  });

  return NextResponse.json(result, { status: 201 });
}
