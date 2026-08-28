import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl } from "@/lib/baseUrl";
import { requireWritableStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import {
  captureNotifyResult,
  sendClientLinkEmail,
  sendClientLinkSms,
  type NotifyResult,
} from "@/lib/notify";
import { clientLinkRenewalData } from "@/lib/tokens";
import { buildSignatureStatuses } from "@/lib/signatureStatus";
import {
  CLIENT_LINK_REMINDER_COOLDOWN_MS,
  clientLinkExpired,
  clientLinkMessagingFinished,
  reminderCooldownSeconds,
} from "@/lib/clientLinkState";
import { clientDeliveryContacts } from "@/lib/clientDeliveryContacts";

function sentLabel(result: NotifyResult): string {
  return `${result.channel.toUpperCase()} to ${result.to}: ${result.detail}`;
}

function failedLabel(result: NotifyResult): string {
  return `${result.channel} to ${result.to}: ${result.detail}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireWritableStaff();
  if (deny) return deny;

  let intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: {
      client: true,
      signatures: { select: { role: true, printedName: true, signedDate: true } },
    },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (clientLinkMessagingFinished(intake.status)) {
    return NextResponse.json({
      error: "This intake is already signed or completed. No signature reminder was sent.",
    }, { status: 409 });
  }

  const statuses = buildSignatureStatuses(intake.signatures);
  const clientStatus = statuses.find((status) => status.key === "client_guardian");
  if (clientStatus?.state === "captured") {
    return NextResponse.json({
      ok: true,
      alreadySigned: true,
      missing: [],
      message: "The client or guardian signature is already saved. No reminder was sent.",
    });
  }
  const contacts = clientDeliveryContacts(intake.client);
  if (!contacts.phone && !contacts.email) {
    await audit("signature_reminder_failed", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: "client/guardian signature missing; no phone or email saved",
    });
    return NextResponse.json({
      ok: false,
      alreadySigned: false,
      missing: [clientStatus?.label || "Client / guardian"],
      error: "No client or guardian phone or email is saved. Add a contact method before sending a signature reminder.",
      sent: [],
      failed: [],
      renewed: false,
      expiresAt: intake.tokenExpiresAt,
    }, { status: 422 });
  }

  const retryAfterSeconds = reminderCooldownSeconds(intake.linkSentAt);
  if (retryAfterSeconds > 0) {
    return NextResponse.json({
      error: `A secure link was just sent. Wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} before sending another reminder.`,
      retryAfterSeconds,
    }, {
      status: 429,
      headers: { "Retry-After": String(retryAfterSeconds) },
    });
  }
  const previousLinkSentAt = intake.linkSentAt;
  const attemptStartedAt = new Date();
  const reserved = await prisma.intake.updateMany({
    where: {
      id: intake.id,
      OR: [
        { linkSentAt: null },
        { linkSentAt: { lte: new Date(attemptStartedAt.getTime() - CLIENT_LINK_REMINDER_COOLDOWN_MS) } },
      ],
    },
    data: { linkSentAt: attemptStartedAt },
  });
  if (reserved.count !== 1) {
    return NextResponse.json({
      error: "Another secure-link delivery is already in progress. Wait one minute before trying again.",
      retryAfterSeconds: 60,
    }, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  const renewed = clientLinkExpired(intake.tokenExpiresAt);
  if (renewed) {
    intake = await prisma.intake.update({
      where: { id: intake.id },
      data: clientLinkRenewalData(intake.tokenExpiresAt),
      include: {
        client: true,
        signatures: { select: { role: true, printedName: true, signedDate: true } },
      },
    });
  }

  const link = `${appBaseUrl(req)}/intake/${intake.token}`;
  const attempts: NotifyResult[] = [];
  if (contacts.email) {
    const recipientName = contacts.email.role === "guardian"
      ? intake.client.guardianName || "Parent or guardian"
      : intake.client.fullName;
    attempts.push(await captureNotifyResult("email", contacts.email.value, () => (
      sendClientLinkEmail(
        contacts.email!.value,
        recipientName,
        link,
        provider!.name,
        provider!.phone,
        "signature",
      )
    )));
  }
  if (contacts.phone) {
    attempts.push(await captureNotifyResult("sms", contacts.phone.value, () => (
      sendClientLinkSms(
        contacts.phone!.value,
        link,
        provider!.name,
        provider!.phone,
        "signature",
      )
    )));
  }

  const sent = attempts.filter((result) => result.ok).map(sentLabel);
  const failed = attempts.filter((result) => !result.ok).map(failedLabel);
  if (!sent.length) {
    await prisma.intake.updateMany({
      where: { id: intake.id, linkSentAt: attemptStartedAt },
      data: { linkSentAt: previousLinkSentAt },
    });
  }
  await audit(sent.length ? "signature_reminder_sent" : "signature_reminder_failed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: [
      "client/guardian signature missing",
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no contact info",
  });

  return NextResponse.json(
    {
      ok: sent.length > 0,
      alreadySigned: false,
      missing: [clientStatus?.label || "Client / guardian"],
      sent,
      failed,
      demo: attempts.some((result) => result.demo),
      renewed,
      expiresAt: intake.tokenExpiresAt,
      error: sent.length ? undefined : "No delivery channel accepted the signature reminder. Review the channel details and try again.",
    },
    { status: sent.length ? 200 : 502 },
  );
}
