import { NextResponse } from "next/server";
import { providerPacketReadiness } from "@/lib/providerPacketTemplates";
import { requireStaff } from "@/lib/staffGuard";

function cleanPacketLabel(value: string): string {
  return value.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
}

function packetDisplayName(providerName: string, packetName: string | null): string {
  const original = cleanPacketLabel(packetName || "");
  if (original && !/^provider intake packet$/i.test(original)) return original;
  return `${providerName} Client Intake Package`;
}

export async function GET() {
  const { provider, deny } = await requireStaff();
  if (deny) return deny;

  const packet = await providerPacketReadiness(provider!.id);
  return NextResponse.json({
    provider: {
      id: provider!.id,
      name: provider!.name,
      phone: provider!.phone,
      slug: provider!.slug,
    },
    packet: {
      name: packetDisplayName(provider!.name, packet.templateName),
      pageCount: packet.pageCount,
      providerSpecific: packet.ready,
      ready: packet.ready,
      state: packet.state,
      message: packet.message,
    },
  });
}
