/**
 * Optional DocuSign integration (JWT grant). The app is fully functional
 * without DocuSign - in-app signature capture is the default. When the
 * DOCUSIGN_* env vars are configured (see README_DOCUSIGN.md), staff can send
 * the completed packet out for a certified DocuSign signing ceremony.
 */
import crypto from "crypto";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import type { Answers } from "./fillPdf";

export function docusignConfigured(): boolean {
  return !!(process.env.DOCUSIGN_INTEGRATION_KEY && process.env.DOCUSIGN_USER_ID &&
    process.env.DOCUSIGN_ACCOUNT_ID && process.env.DOCUSIGN_PRIVATE_KEY);
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/** OAuth JWT grant - exchanges a signed JWT for an access token. */
async function getAccessToken(): Promise<string> {
  const authServer = (process.env.DOCUSIGN_BASE_PATH || "").includes("demo")
    ? "account-d.docusign.com" : "account.docusign.com";
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({
    iss: process.env.DOCUSIGN_INTEGRATION_KEY,
    sub: process.env.DOCUSIGN_USER_ID,
    aud: authServer,
    iat: now, exp: now + 3600, scope: "signature impersonation",
  }));
  const key = (process.env.DOCUSIGN_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const signature = crypto.sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key);
  const jwt = `${header}.${body}.${b64url(signature)}`;
  const res = await fetch(`https://${authServer}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`DocuSign auth failed: ${await res.text()}`);
  return (await res.json()).access_token as string;
}

type DocuSignTab = {
  documentId: string;
  pageNumber: string;
  recipientId: string;
  tabLabel: string;
  xPosition: string;
  yPosition: string;
};

function appliesToClientSigner(f: FieldMapping, answers: Answers, consents: Record<string, boolean>): boolean {
  if (!["client", "guardian", "auto"].includes(f.role)) return false;
  if (f.consentKey && !consents[f.consentKey]) return false;

  const roi = /^roi([123])_sig$/.exec(f.fieldKey);
  if (roi) {
    const slot = roi[1];
    return !!answers[`roi${slot}_recipient`] && consents[`roi${slot}_agreed`] === true;
  }

  // Discharge and staff review signatures are not part of initial client DocuSign signing.
  if (f.fieldKey.startsWith("dis_")) return false;
  return true;
}

function toDocuSignTab(f: FieldMapping, kind: "sign" | "date"): DocuSignTab {
  return {
    documentId: "1",
    pageNumber: String(f.page),
    recipientId: "1",
    tabLabel: `${kind}_${f.fieldKey}`,
    xPosition: String(Math.round(f.x)),
    yPosition: String(Math.round(PACKET_MAP.pageHeight - f.y - f.height)),
  };
}

export function clientDocuSignTabs(
  answers: Answers, consents: Record<string, boolean>, fields: FieldMapping[] = PACKET_MAP.fields,
): { signHereTabs: DocuSignTab[]; dateSignedTabs: DocuSignTab[] } {
  const signatureFields = fields
    .filter((f) => f.type === "signature" || f.type === "signature_small")
    .filter((f) => appliesToClientSigner(f, answers, consents));

  const dateFields = fields
    .filter((f) => f.source === "sign_date")
    .filter((f) => appliesToClientSigner(f, answers, consents));

  return {
    signHereTabs: signatureFields.map((f) => toDocuSignTab(f, "sign")),
    dateSignedTabs: dateFields.map((f) => toDocuSignTab(f, "date")),
  };
}

export async function createDocuSignEnvelope(
  completedPdf: Buffer, clientEmail: string, clientName: string,
  answers: Answers = {}, consents: Record<string, boolean> = {},
  fields: FieldMapping[] = PACKET_MAP.fields,
): Promise<{ envelopeId: string }> {
  if (!docusignConfigured()) throw new Error("DocuSign not configured");
  const tabs = clientDocuSignTabs(answers, consents, fields);
  if (tabs.signHereTabs.length === 0) throw new Error("No client DocuSign signature tabs found");
  const token = await getAccessToken();
  const base = process.env.DOCUSIGN_BASE_PATH || "https://demo.docusign.net/restapi";
  const res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        emailSubject: "Moore Divine Care, Inc. - Client Intake Package for signature",
        status: "sent",
        documents: [{
          documentId: "1", name: `Client Intake Package - ${clientName}`,
          fileExtension: "pdf", documentBase64: completedPdf.toString("base64"),
        }],
        recipients: {
          signers: [{
            email: clientEmail, name: clientName, recipientId: "1", routingOrder: "1",
            tabs,
          }],
        },
      }),
    },
  );
  if (!res.ok) throw new Error(`DocuSign envelope failed: ${await res.text()}`);
  return { envelopeId: (await res.json()).envelopeId as string };
}

export async function sendCompletedPacketForSignature(intakeId: string): Promise<{ envelopeId: string }> {
  // Wired from /api/intakes/[id]/docusign, which generates the PDF first.
  throw new Error(`sendCompletedPacketForSignature: use the API route for intake ${intakeId}`);
}

export async function checkDocuSignStatus(envelopeId: string): Promise<string> {
  if (!docusignConfigured()) return "not_configured";
  const token = await getAccessToken();
  const base = process.env.DOCUSIGN_BASE_PATH || "https://demo.docusign.net/restapi";
  const res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).status as string;
}
