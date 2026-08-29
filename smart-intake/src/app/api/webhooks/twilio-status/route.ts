import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { appBaseUrl } from "@/lib/baseUrl";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { COPY_RECEIPT_ANSWER_DEFAULTS } from "@/lib/completedCopies";

export const runtime = "nodejs";

const FINAL_STATUSES = new Set(["delivered", "read", "failed", "undelivered", "canceled"]);
const DELIVERED_STATUSES = new Set(["delivered", "read"]);

function signedCallbackUrl(req: NextRequest): string {
  const incoming = new URL(req.url);
  const publicUrl = new URL("/api/webhooks/twilio-status", `${appBaseUrl().replace(/\/$/, "")}/`);
  publicUrl.search = incoming.search;
  return publicUrl.toString();
}

function validateTwilioSignature(
  url: string,
  params: URLSearchParams,
  signature: string,
  authToken: string,
): boolean {
  const sorted = Array.from(params.entries()).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  ));
  const payload = sorted.reduce((value, [key, item]) => `${value}${key}${item}`, url);
  const expected = createHmac("sha1", authToken).update(payload, "utf8").digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, "base64");
  } catch {
    return false;
  }
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function validMessageSid(value: string): boolean {
  return /^[A-Z]{2}[0-9a-f]{32}$/i.test(value);
}

export async function POST(req: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = req.headers.get("x-twilio-signature") || "";
  if (!authToken) {
    return NextResponse.json({ error: "Webhook validation is not configured" }, { status: 503 });
  }
  if (!req.headers.get("content-type")?.toLowerCase().includes("application/x-www-form-urlencoded")) {
    return NextResponse.json({ error: "Unsupported callback format" }, { status: 415 });
  }

  const params = new URLSearchParams(await req.text());
  if (!signature || !validateTwilioSignature(signedCallbackUrl(req), params, signature, authToken)) {
    return NextResponse.json({ error: "Invalid Twilio signature" }, { status: 403 });
  }
  if (params.get("AccountSid") !== process.env.TWILIO_ACCOUNT_SID) {
    return NextResponse.json({ error: "Unexpected Twilio account" }, { status: 403 });
  }

  const deliveryId = new URL(req.url).searchParams.get("deliveryId") || "";
  const messageSid = params.get("MessageSid") || params.get("SmsSid") || "";
  const status = (params.get("MessageStatus") || params.get("SmsStatus") || "").trim().toLowerCase();
  const errorCode = (params.get("ErrorCode") || "").trim().slice(0, 20) || null;
  if (!deliveryId || !validMessageSid(messageSid) || !/^[a-z_]{2,32}$/.test(status)) {
    return NextResponse.json({ error: "Invalid status callback" }, { status: 400 });
  }

  const now = new Date();
  const outcome = await prisma.$transaction(async (tx) => {
    const delivery = await tx.messageDelivery.findUnique({ where: { id: deliveryId } });
    if (!delivery) return null;
    if (delivery.messageSid && delivery.messageSid !== messageSid) {
      throw new Error("Twilio callback SID does not match its reserved delivery record.");
    }

    const advances = !delivery.isFinal
      || (delivery.status === "delivered" && status === "read");
    const delivered = DELIVERED_STATUSES.has(status);
    const newlyDelivered = advances && delivered && !delivery.deliveredAt;
    if (advances) {
      await tx.messageDelivery.update({
        where: { id: delivery.id },
        data: {
          messageSid,
          status,
          errorCode,
          errorMessage: null,
          isFinal: FINAL_STATUSES.has(status),
          deliveredAt: newlyDelivered ? now : delivery.deliveredAt,
          finalAt: FINAL_STATUSES.has(status) ? now : null,
          lastStatusAt: now,
        },
      });
    }

    if (newlyDelivered && delivery.purpose === "completed_copies" && delivery.intakeId) {
      for (const [key, value] of Object.entries(COPY_RECEIPT_ANSWER_DEFAULTS)) {
        await tx.intakeAnswer.upsert({
          where: { intakeId_key: { intakeId: delivery.intakeId, key } },
          create: { intakeId: delivery.intakeId, key, value: JSON.stringify(value) },
          update: { value: JSON.stringify(value) },
        });
      }
    }

    return {
      providerId: delivery.providerId || undefined,
      intakeId: delivery.intakeId || undefined,
      purpose: delivery.purpose,
      newlyDelivered,
    };
  });

  if (!outcome) {
    return NextResponse.json({ error: "Delivery reservation not found" }, { status: 404 });
  }
  await audit("sms_status_updated", {
    providerId: outcome.providerId,
    intakeId: outcome.intakeId,
    detail: `${outcome.purpose}; ${status}${errorCode ? `; Twilio error ${errorCode}` : ""}`,
  });
  if (outcome.newlyDelivered && outcome.purpose === "completed_copies") {
    await audit("copies_delivery_confirmed", {
      providerId: outcome.providerId,
      intakeId: outcome.intakeId,
      detail: "Twilio confirmed delivery of the completed-copies link",
    });
    await audit("copies_link_sent", {
      providerId: outcome.providerId,
      intakeId: outcome.intakeId,
      detail: "SMS delivery confirmed by Twilio",
    });
  }
  return new Response(null, { status: 204 });
}
