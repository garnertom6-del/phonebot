import { NextResponse } from "next/server";
import { packetTemplateForProvider } from "@/lib/providerPacketTemplates";
import { requireStaff } from "@/lib/staffGuard";

function cleanPacketLabel(value: string): string {
  return value.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").trim();
}

function packetDisplayName(providerName: string, packet: Awaited<ReturnType<typeof packetTemplateForProvider>>): string {
  if (packet.providerSpecific) {
    const original = cleanPacketLabel(packet.originalFileName || "");
    if (original && !/^provider intake packet$/i.test(original)) return original;
    return `${providerName} Intake Packet`;
  }
  // The shared fallback PDF can still be used while a provider's custom
  // packet is awaiting upload or approval, but the client-facing label must
  // identify the active provider instead of the default owner's name.
  return `${providerName} Client Intake Package`;
}

export async function GET() {
  const { provider, deny } = await requireStaff();
  if (deny) return deny;

  const packet = await packetTemplateForProvider(provider!.id);
  return NextResponse.json({
    provider: {
      id: provider!.id,
      name: provider!.name,
      phone: provider!.phone,
      slug: provider!.slug,
    },
    packet: {
      name: packetDisplayName(provider!.name, packet),
      pageCount: packet.pageCount,
      providerSpecific: packet.providerSpecific,
    },
  });
}
