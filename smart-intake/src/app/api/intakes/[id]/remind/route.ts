import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { appBaseUrl, isLocalWorkspace } from "@/lib/baseUrl";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import {
  captureNotifyResult,
  sendClientLinkEmail,
  sendClientLinkSms,
  type NotifyResult,
} from "@/lib/notify";
import { clientLinkRenewalData } from "@/lib/tokens";
import {
  CLIENT_LINK_REMINDER_COOLDOWN_MS,
  clientLinkExpired,
  clientLinkMessagingFinished,
  reminderCooldownSeconds,
} from "@/lib/clientLinkState";
import { clientDeliveryContacts } from "@/lib/clientDeliveryContacts";
import { loadAnswers } from "@/lib/intakeData";

function sentLabel(r: NotifyResult): string {
  return `${r.channel.toUpperCase()} to ${r.to}: ${r.detail}`;
}

function failedLabel(r: NotifyResult): string {
  return `${r.channel} to ${r.to}: ${r.detail}`;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  let intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    include: { client: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (isLocalWorkspace()) {
    return NextResponse.json({
      error: "This intake is stored in the local workspace. Create it from the live Render dashboard before sending it to a client.",
    }, { status: 409 });
  }
  if (clientLinkMessagingFinished(intake.status)) {
    return NextResponse.json({
      error: "The client or guardian already signed this intake. No intake reminder was sent.",
    }, { status: 409 });
  }
  const contacts = clientDeliveryContacts(intake.client, await loadAnswers(intake.id));
  if (!contacts.phone && !contacts.email) {
    await audit("link_reminder_failed", {
      providerId: provider!.id,
      intakeId: intake.id,
      userId: user!.id,
      detail: "no phone or email saved",
    });
    return NextResponse.json({
      ok: false,
      error: "No client or guardian phone or email is saved. Add a contact method before sending the link.",
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
      include: { client: true },
    });
  }
  const base = appBaseUrl(req);
  const link = `${base}/intake/${intake.token}`;
  const attempts: NotifyResult[] = [];
  if (contacts.email) {
    const recipientName = contacts.email.role === "guardian"
      ? intake.client.guardianName || "Parent or guardian"
      : intake.client.fullName;
    attempts.push(await captureNotifyResult("email", contacts.email.value, () => (
      sendClientLinkEmail(contacts.email!.value, recipientName, link, provider!.name, provider!.phone)
    )));
  }
  if (contacts.phone) {
    attempts.push(await captureNotifyResult("sms", contacts.phone.value, () => (
      sendClientLinkSms(contacts.phone!.value, link, provider!.name, provider!.phone)
    )));
  }
  const sent = attempts.filter((r) => r.ok).map(sentLabel);
  const failed = attempts.filter((r) => !r.ok).map(failedLabel);
  if (!sent.length) {
    await prisma.intake.updateMany({
      where: { id: intake.id, linkSentAt: attemptStartedAt },
      data: { linkSentAt: previousLinkSentAt },
    });
  }
  await audit(sent.length ? "link_reminder_sent" : "link_reminder_failed", {
    providerId: provider!.id,
    intakeId: intake.id,
    userId: user!.id,
    detail: [
      sent.length ? `sent ${sent.join(", ")}` : "",
      failed.length ? `failed ${failed.join(", ")}` : "",
    ].filter(Boolean).join("; ") || "no contact info",
  });
  return NextResponse.json(
    {
      ok: sent.length > 0,
      error: sent.length ? undefined : "No delivery channel accepted the reminder. Review the channel details and try again.",
      sent,
      failed,
      demo: attempts.some((r) => r.demo),
      renewed,
      expiresAt: intake.tokenExpiresAt,
    },
    { status: sent.length ? 200 : 502 },
  );
}
