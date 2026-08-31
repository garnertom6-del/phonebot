import { NextResponse } from "next/server";
import { requireWritableStaffForIntake } from "@/lib/staffGuard";
import { sendCompletedCopiesLink } from "@/lib/sendCompletedCopies";
import { prisma } from "@/lib/prisma";
import {
  CLIENT_LINK_REMINDER_COOLDOWN_MS,
  reminderCooldownSeconds,
} from "@/lib/clientLinkState";

export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const { user, provider, deny } = await requireWritableStaffForIntake(params.id);
  if (deny) return deny;
  const intake = await prisma.intake.findFirst({
    where: { id: params.id, providerId: provider!.id },
    select: { id: true, linkSentAt: true },
  });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const retryAfterSeconds = reminderCooldownSeconds(intake.linkSentAt);
  if (retryAfterSeconds > 0) {
    return NextResponse.json({
      error: `A client link was just sent. Wait ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"} before sending completed copies.`,
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
      providerId: provider!.id,
      OR: [
        { linkSentAt: null },
        { linkSentAt: { lte: new Date(attemptStartedAt.getTime() - CLIENT_LINK_REMINDER_COOLDOWN_MS) } },
      ],
    },
    data: { linkSentAt: attemptStartedAt },
  });
  if (reserved.count !== 1) {
    return NextResponse.json({
      error: "Another client-link delivery is already in progress. Wait one minute before trying again.",
      retryAfterSeconds: 60,
    }, {
      status: 429,
      headers: { "Retry-After": "60" },
    });
  }

  let result;
  try {
    result = await sendCompletedCopiesLink({
      intakeId: params.id,
      providerId: provider!.id,
      userId: user!.id,
      req,
    });
  } catch (error) {
    await prisma.intake.updateMany({
      where: { id: intake.id, linkSentAt: attemptStartedAt },
      data: { linkSentAt: previousLinkSentAt },
    });
    throw error;
  }
  if (!result.body.ok) {
    await prisma.intake.updateMany({
      where: { id: intake.id, linkSentAt: attemptStartedAt },
      data: { linkSentAt: previousLinkSentAt },
    });
  }
  return NextResponse.json(result.body, { status: result.status });
}
