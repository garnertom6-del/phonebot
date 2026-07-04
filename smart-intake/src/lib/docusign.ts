/**
 * Optional DocuSign integration (JWT grant). The app is fully functional
 * without DocuSign - in-app signature capture is the default. When the
 * DOCUSIGN_* env vars are configured (see README_DOCUSIGN.md), staff can send
 * the completed packet out for a certified DocuSign signing ceremony.
 */
import crypto from "crypto";

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

export async function createDocuSignEnvelope(
  completedPdf: Buffer, clientEmail: string, clientName: string,
): Promise<{ envelopeId: string }> {
  if (!docusignConfigured()) throw new Error("DocuSign not configured");
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
            tabs: { signHereTabs: [{ documentId: "1", pageNumber: "10", xPosition: "40", yPosition: "640" }] },
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
