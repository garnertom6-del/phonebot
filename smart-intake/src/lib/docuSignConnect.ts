import { createHmac, timingSafeEqual } from "node:crypto";

export function docusignConnectConfigured(): boolean {
  return !!process.env.DOCUSIGN_CONNECT_SECRET?.trim();
}

function connectSecrets(): string[] {
  return (process.env.DOCUSIGN_CONNECT_SECRET || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function expectedSignature(rawBody: string, secret: string): Buffer {
  return Buffer.from(createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"));
}

function headerSignatures(headerValue: string | null): string[] {
  return (headerValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

/** DocuSign Connect HMAC-SHA256 over the raw body. Accepts X-DocuSign-Signature-1..N. */
export function verifyDocuSignConnectSignature(rawBody: string, getHeader: (name: string) => string | null): boolean {
  const secrets = connectSecrets();
  if (!secrets.length) return false;
  const provided: string[] = [];
  for (let index = 1; index <= 5; index += 1) {
    provided.push(...headerSignatures(getHeader(`x-docusign-signature-${index}`)));
  }
  if (!provided.length) return false;
  return secrets.some((secret) => {
    const expected = expectedSignature(rawBody, secret);
    return provided.some((signature) => {
      let received: Buffer;
      try {
        received = Buffer.from(signature);
      } catch {
        return false;
      }
      return received.length === expected.length && timingSafeEqual(received, expected);
    });
  });
}

function eventStatus(event: string): string | null {
  const normalized = event.trim().toLowerCase();
  if (normalized === "envelope-completed" || normalized === "completed") return "completed";
  if (normalized === "envelope-declined" || normalized === "declined") return "declined";
  if (normalized === "envelope-voided" || normalized === "voided") return "voided";
  if (normalized === "envelope-delivered" || normalized === "delivered") return "delivered";
  if (normalized === "envelope-sent" || normalized === "sent") return "sent";
  return null;
}

export function parseDocuSignConnectPayload(rawBody: string): { envelopeId: string; status: string; accountId?: string } | null {
  try {
    const json = JSON.parse(rawBody) as {
      event?: unknown;
      envelopeId?: unknown;
      status?: unknown;
      data?: {
        accountId?: unknown;
        envelopeId?: unknown;
        envelopeSummary?: { status?: unknown; envelopeId?: unknown; accountId?: unknown };
      };
    };
    const envelopeId = [json.data?.envelopeId, json.data?.envelopeSummary?.envelopeId, json.envelopeId]
      .find((value): value is string => typeof value === "string" && !!value.trim());
    const status = [
      typeof json.data?.envelopeSummary?.status === "string" ? json.data.envelopeSummary.status : null,
      typeof json.status === "string" ? json.status : null,
      typeof json.event === "string" ? eventStatus(json.event) : null,
    ].find((value): value is string => typeof value === "string" && !!value.trim());
    const accountId = [json.data?.accountId, json.data?.envelopeSummary?.accountId]
      .find((value): value is string => typeof value === "string" && !!value.trim());
    if (!envelopeId || !status) return null;
    return { envelopeId: envelopeId.trim(), status: status.trim().toLowerCase(), accountId };
  } catch {
    const envelopeId = /<EnvelopeID>([^<]+)<\/EnvelopeID>/i.exec(rawBody)?.[1]?.trim();
    const status = /<Status>([^<]+)<\/Status>/i.exec(rawBody)?.[1]?.trim();
    const accountId = /<AccountId>([^<]+)<\/AccountId>/i.exec(rawBody)?.[1]?.trim();
    if (!envelopeId || !status) return null;
    return { envelopeId, status: status.toLowerCase(), accountId };
  }
}

export function connectAccountMatches(accountId: string | undefined): boolean {
  const expected = (process.env.DOCUSIGN_ACCOUNT_ID || "").trim();
  if (!expected || !accountId) return true;
  return accountId === expected;
}
