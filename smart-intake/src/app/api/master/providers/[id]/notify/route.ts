import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireMaster } from "@/lib/staffGuard";
import { appBaseUrl } from "@/lib/baseUrl";
import { audit } from "@/lib/auditLog";
import { sendProviderPortalEmail, sendProviderPortalSms } from "@/lib/notify";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireMaster();
  if (deny) return deny;
  const body = await req.json().catch(() => ({}));
  const channel = body?.channel === "sms" ? "sms" : body?.channel === "email" ? "email" : "";
  if (!channel) return NextResponse.json({ error: "Choose email or SMS." }, { status: 400 });

  const provider = await prisma.provider.findUnique({ where: { id: params.id } });
  if (!provider) return NextResponse.json({ error: "Provider not found." }, { status: 404 });
  const recipient = channel === "email" ? provider.email : provider.phone;
  if (!recipient) return NextResponse.json({ error: `This provider has no ${channel} contact saved.` }, { status: 400 });

  const link = `${appBaseUrl(req)}/login`;
  const result = channel === "email"
    ? await sendProviderPortalEmail(recipient, provider.name, link)
    : await sendProviderPortalSms(recipient, provider.name, link);
  if (result.ok) {
    await audit("provider_portal_notification_sent", {
      providerId: provider.id,
      userId: user!.id,
      detail: `${channel} to ${recipient}`,
    });
  }
  return NextResponse.json({ ...result, link }, { status: result.ok ? 200 : 502 });
}
