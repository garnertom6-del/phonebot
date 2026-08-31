import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isMasterUser, requireProviderAdmin } from "@/lib/staffGuard";
import {
  providerPacketFileAvailable,
  providerPacketReadinessFromTemplates,
} from "@/lib/providerPacketTemplates";
import { packetDisplayStatus } from "@/lib/packetDisplayStatus";

export async function GET(req: NextRequest) {
  const requestedProviderId = req.nextUrl.searchParams.get("providerId");
  const { user, provider, membership, deny } = await requireProviderAdmin({
    providerId: requestedProviderId,
  });
  if (deny) return deny;

  const isMaster = isMasterUser(user!);
  if (!provider) {
    return NextResponse.json(
      { error: isMaster ? "Choose a provider first." : "No provider workspace is assigned to this account." },
      { status: isMaster ? 400 : 403 },
    );
  }

  const row = await prisma.provider.findUnique({
    where: { id: provider.id },
    include: {
      memberships: {
        include: { user: { select: { id: true, email: true, name: true, role: true } } },
        orderBy: { createdAt: "asc" },
      },
      pdfTemplates: {
        orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }, { createdAt: "desc" }],
        take: 8,
        select: {
          id: true,
          providerId: true,
          filePath: true,
          name: true,
          originalFileName: true,
          pageCount: true,
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
  });
  if (!row) return NextResponse.json({ error: "Provider not found" }, { status: 404 });

  const packetReadiness = providerPacketReadinessFromTemplates(
    row.id,
    row.pdfTemplates.map((template) => ({
      ...template,
      fileAvailable: providerPacketFileAvailable(template.filePath),
    })),
  );
  const activeTemplate = row.pdfTemplates.find((template) => template.isActive) || row.pdfTemplates[0] || null;
  const packetDisplay = packetDisplayStatus(activeTemplate, row.name);

  return NextResponse.json({
    settingsPath: "/provider/settings",
    isMaster,
    membershipRole: membership?.role || (isMaster ? "MASTER" : null),
    provider: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      contactName: row.contactName,
      email: row.email,
      phone: row.phone,
    },
    packetReadiness,
    packetDisplay,
    pdfTemplates: row.pdfTemplates.map(({ filePath: _filePath, ...template }) => template),
    memberships: row.memberships.map((item) => ({
      id: item.id,
      role: item.role,
      active: item.active,
      user: item.user,
    })),
  });
}
