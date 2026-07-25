import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireMaster, requireProviderAdmin } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";

const optionalEmailSchema = z.union([
  z.string().trim().email("Enter a valid provider contact email"),
  z.literal(""),
]).optional();

const createProviderSchema = z.object({
  name: z.string().trim().min(2, "Provider name is required"),
  slug: z.string().trim().optional(),
  contactName: z.string().trim().optional(),
  email: optionalEmailSchema,
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

async function providerAdminConflict(email: string) {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: {
      role: true,
      memberships: { select: { providerId: true } },
    },
  });
  if (!existing) return null;
  if (isMasterUser(existing)) {
    return "Use a different provider administrator email. A master login cannot be reused or have its password changed here.";
  }
  if (existing.memberships.length > 0) {
    return "That email already belongs to another provider account. Use a unique administrator email for this provider.";
  }
  return null;
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
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 10,
        select: {
          id: true,
          name: true,
          originalFileName: true,
          pageCount: true,
          pageWidth: true,
          pageHeight: true,
          isActive: true,
          mappingStatus: true,
          mappingScore: true,
          mappingIssues: true,
          approvedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });

  const intakeStatusRows = await prisma.intake.groupBy({
    by: ["providerId", "status", "archived"],
    where: isMaster ? { providerId: { not: null } } : { providerId: provider!.id },
    _count: { _all: true },
  });
  const intakeSummaryByProvider = new Map<string, Record<string, number>>();
  const archivedIntakeCountByProvider = new Map<string, number>();
  for (const row of intakeStatusRows) {
    if (!row.providerId) continue;
    if (row.archived) {
      archivedIntakeCountByProvider.set(
        row.providerId,
        (archivedIntakeCountByProvider.get(row.providerId) || 0) + row._count._all,
      );
      continue;
    }
    const summary = intakeSummaryByProvider.get(row.providerId) || {};
    summary[row.status] = row._count._all;
    intakeSummaryByProvider.set(row.providerId, summary);
  }

  return NextResponse.json({
    providers: providers.map((item) => {
      const intakeSummary = intakeSummaryByProvider.get(item.id) || {};
      return {
        ...item,
        intakeSummary,
        currentIntakeCount: Object.values(intakeSummary).reduce((sum, count) => sum + count, 0),
        archivedIntakeCount: archivedIntakeCountByProvider.get(item.id) || 0,
      };
    }),
    isMaster,
    // Only expose availability, never the key itself. Provider staff use the
    // shared system service through their normal portal login.
    aiConfigured: !!process.env.ANTHROPIC_API_KEY,
  });
}

export async function POST(req: NextRequest) {
  const { user: masterUser, deny } = await requireMaster();
  if (deny) return deny;

  const parsed = createProviderSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "Invalid provider" }, { status: 400 });
  }

  const data = parsed.data;
  const adminEmail = data.adminEmail.toLowerCase();
  const adminConflict = await providerAdminConflict(adminEmail);
  if (adminConflict) {
    return NextResponse.json({ error: adminConflict }, { status: 409 });
  }
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

  await audit("provider_created", {
    providerId: result.provider.id,
    userId: masterUser!.id,
    detail: `${result.provider.name}: administrator ${result.user.email}`,
  });

  return NextResponse.json(result, { status: 201 });
}
