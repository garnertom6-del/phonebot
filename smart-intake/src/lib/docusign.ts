/**
 * Optional DocuSign integration (JWT grant). The app is fully functional
 * without DocuSign - in-app signature capture is the default. When the
 * DOCUSIGN_* env vars are configured (see README_DOCUSIGN.md), staff can send
 * the completed packet out for a certified DocuSign signing ceremony.
 */
import crypto from "crypto";
import { PDFDocument } from "pdf-lib";
import { PACKET_MAP, type FieldMapping } from "@/config/mooreDivinePacketMap";
import type { Answers } from "./fillPdf";
import type { DocuSignConnection } from "./docuSignConnectionTypes";

export function docusignConfigured(): boolean {
  return ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY"]
    .every(key => !!process.env[key]?.trim());
}

/** Configuration presence is deliberately separate from a successful connection. */
export function docuSignConnectionConfiguration(): DocuSignConnection {
  const missing = ["DOCUSIGN_INTEGRATION_KEY", "DOCUSIGN_USER_ID", "DOCUSIGN_ACCOUNT_ID", "DOCUSIGN_PRIVATE_KEY"]
    .filter(key => !process.env[key]?.trim());
  const base = process.env.DOCUSIGN_BASE_PATH?.trim();
  return {
    configured: missing.length === 0,
    environment: !base ? "automatic" : base.toLowerCase().includes("demo") ? "sandbox" : "production",
    status: missing.length ? "needs_setup" : "not_checked",
    missing,
    message: missing.length ? "DocuSign setup is incomplete. Add the missing server settings." : "Settings saved. Check the connection to verify account access.",
  };
}

class DocuSignAuthError extends Error {}

/** An uncertain create response must not invite another envelope/email. */
export class DocuSignEnvelopeError extends Error {
  constructor(message: string, readonly mayHaveSent: boolean) { super(message); }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function authServerCandidates(): string[] {
  const configuredBase = (process.env.DOCUSIGN_BASE_PATH || "").trim().toLowerCase();
  if (configuredBase.includes("demo")) return ["account-d.docusign.com"];
  if (configuredBase) return ["account.docusign.com"];
  // Prefer production first, then fall back to demo when the base path was not set.
  return ["account.docusign.com", "account-d.docusign.com"];
}

/** OAuth JWT grant - exchanges a signed JWT for an access token. */
async function requestAccessToken(authServer: string): Promise<string> {
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
    signal: AbortSignal.timeout(15000),
    redirect: "error",
  });
  if (!res.ok) {
    const problem = await res.json().catch(() => null) as { error?: string; error_description?: string } | null;
    // Never return raw OAuth responses, tokens, key material or upstream HTML.
    if (problem?.error === "consent_required") throw new DocuSignAuthError("DocuSign consent is required for the configured integration and user in this environment.");
    if (problem?.error_description === "issuer_not_found") throw new DocuSignAuthError("The integration key is not available in this DocuSign environment. Check the key and production go-live status.");
    if (problem?.error_description === "user_not_found") throw new DocuSignAuthError("The configured user was not found in this DocuSign environment.");
    throw new DocuSignAuthError(`DocuSign authentication failed (HTTP ${res.status}). Check the integration key, user, RSA key and consent.`);
  }
  const token: unknown = (await res.json()).access_token;
  if (typeof token !== "string" || !token.trim()) throw new Error("DocuSign auth returned no access token");
  return token;
}

async function resolveRestBase(token: string, authServer: string): Promise<string> {
  const configured = (process.env.DOCUSIGN_BASE_PATH || "").trim();
  if (configured) return configured.replace(/\/+$/, "");

  const res = await fetch(`https://${authServer}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
  });
  if (!res.ok) throw new Error(`DocuSign userinfo failed (HTTP ${res.status})`);

  const info = await res.json() as {
    accounts?: Array<{ account_id?: string; base_uri?: string; is_default?: boolean }>;
  };
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const account = info.accounts?.find((item) => item.account_id === accountId);
  const baseUri = account?.base_uri?.trim();
  if (!baseUri) throw new Error("DocuSign userinfo did not include a REST base URI");
  return `${baseUri.replace(/\/+$/, "")}/restapi`;
}

function checkedDocuSignBase(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".docusign.net") || url.port ||
      url.username || url.password || url.search || url.hash || url.pathname.replace(/\/+$/, "") !== "/restapi") return null;
    return `${url.origin}/restapi`;
  } catch { return null; }
}

/** OAuth and account metadata only: no envelopes, documents, signatures or mail. */
export async function checkDocuSignConnection(): Promise<DocuSignConnection> {
  const config = docuSignConnectionConfiguration();
  const checkedAt = new Date().toISOString();
  if (!config.configured) return { ...config, checkedAt };
  const configuredBase = process.env.DOCUSIGN_BASE_PATH?.trim();
  if (configuredBase && !checkedDocuSignBase(configuredBase)) {
    return { ...config, checkedAt, status: "failed", message: "The server address must be a DocuSign HTTPS REST API address ending in /restapi." };
  }
  let message = "DocuSign could not be reached or the RSA key could not be read. Check the server settings and try again.";
  for (const host of authServerCandidates()) {
    try {
      const token = await requestAccessToken(host);
      const response = await fetch(`https://${host}/oauth/userinfo`, {
        headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000), redirect: "error", cache: "no-store",
      });
      if (!response.ok) throw new DocuSignAuthError(`DocuSign account verification failed (HTTP ${response.status}).`);
      const info = await response.json() as { sub?: string; accounts?: Array<{ account_id?: string; account_name?: string; base_uri?: string }> };
      if (info.sub !== process.env.DOCUSIGN_USER_ID) throw new DocuSignAuthError("The authenticated user does not match the configured DocuSign user.");
      const account = info.accounts?.find(item => item.account_id === process.env.DOCUSIGN_ACCOUNT_ID);
      if (!account) throw new DocuSignAuthError("The configured DocuSign account is not accessible to this user. Check the API account ID and membership.");
      const actualBase = account.base_uri && checkedDocuSignBase(`${account.base_uri.replace(/\/+$/, "")}/restapi`);
      const environment = host === "account-d.docusign.com" ? "sandbox" : "production";
      if (!actualBase || (new URL(actualBase).hostname === "demo.docusign.net") !== (environment === "sandbox")) {
        throw new DocuSignAuthError("DocuSign returned an unexpected account server address. Review the account configuration.");
      }
      if (configuredBase && checkedDocuSignBase(configuredBase) !== actualBase) throw new DocuSignAuthError("The saved server address does not match this DocuSign account. Update the account base URI in server settings.");
      return { ...config, environment, checkedAt, status: "connected", accountName: account.account_name?.slice(0, 120), message: environment === "sandbox"
        ? "Test account access verified. Live signing requires a production integration and account configuration."
        : "Live account access verified. Packet approval and signer requirements still apply." };
    } catch (error) {
      if (error instanceof DocuSignAuthError) message = error.message;
    }
  }
  return { ...config, checkedAt, status: "failed", message };
}

async function getApiContext(): Promise<{ token: string; base: string }> {
  let lastError: unknown;
  for (const authServer of authServerCandidates()) {
    try {
      const token = await requestAccessToken(authServer);
      const base = await resolveRestBase(token, authServer);
      return { token, base };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error("DocuSign authentication failed");
}

type DocuSignTab = {
  documentId: string;
  pageNumber: string;
  recipientId: string;
  tabLabel: string;
  xPosition: string;
  yPosition: string;
};

function keepTabInDocument(tab: DocuSignTab, pageCount: number): boolean {
  const page = Number(tab.pageNumber);
  return Number.isInteger(page) && page >= 1 && page <= pageCount;
}

function clampTabsToDocument(
  tabs: { signHereTabs: DocuSignTab[]; dateSignedTabs: DocuSignTab[] },
  pageCount: number,
) {
  const signHereTabs = tabs.signHereTabs.filter((tab) => keepTabInDocument(tab, pageCount));
  const dateSignedTabs = tabs.dateSignedTabs.filter((tab) => keepTabInDocument(tab, pageCount));
  if (signHereTabs.length !== tabs.signHereTabs.length || dateSignedTabs.length !== tabs.dateSignedTabs.length) {
    console.warn("DocuSign tabs outside the generated packet were skipped", {
      pageCount,
      droppedSignHereTabs: tabs.signHereTabs.length - signHereTabs.length,
      droppedDateSignedTabs: tabs.dateSignedTabs.length - dateSignedTabs.length,
    });
  }
  return { signHereTabs, dateSignedTabs };
}

export function appliesToDocuSignSigner(f: FieldMapping, answers: Answers, consents: Record<string, boolean>): boolean {
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

function toDocuSignTab(f: FieldMapping, kind: "sign" | "date", pageHeight: number, recipientId = "1"): DocuSignTab {
  return {
    documentId: "1",
    pageNumber: String(f.page),
    recipientId,
    tabLabel: `${kind}_${f.fieldKey}`,
    xPosition: String(Math.round(f.x)),
    yPosition: String(Math.round(pageHeight - f.y - f.height)),
  };
}

export type DocuSignSignerRole = "client" | "guardian";

function rolesForSigner(role: DocuSignSignerRole, solo: boolean): Array<"client" | "guardian" | "auto"> {
  if (solo) return ["client", "guardian", "auto"];
  return role === "guardian" ? ["guardian"] : ["client", "auto"];
}

export function docuSignTabsForRoles(
  answers: Answers,
  consents: Record<string, boolean>,
  fields: FieldMapping[],
  pageHeight: number,
  recipientId: string,
  roles: Array<"client" | "guardian" | "auto">,
): { signHereTabs: DocuSignTab[]; dateSignedTabs: DocuSignTab[] } {
  const allowed = new Set(roles);
  const applicable = (f: FieldMapping) => (
    appliesToDocuSignSigner(f, answers, consents) && allowed.has(f.role as "client" | "guardian" | "auto")
  );
  return {
    signHereTabs: fields
      .filter((f) => f.type === "signature" || f.type === "signature_small")
      .filter(applicable)
      .map((f) => toDocuSignTab(f, "sign", pageHeight, recipientId)),
    dateSignedTabs: fields
      .filter((f) => f.source === "sign_date")
      .filter(applicable)
      .map((f) => toDocuSignTab(f, "date", pageHeight, recipientId)),
  };
}

export function clientDocuSignTabs(
  answers: Answers, consents: Record<string, boolean>, fields: FieldMapping[] = PACKET_MAP.fields,
  pageHeight = PACKET_MAP.pageHeight, recipientId = "1",
): { signHereTabs: DocuSignTab[]; dateSignedTabs: DocuSignTab[] } {
  return docuSignTabsForRoles(answers, consents, fields, pageHeight, recipientId, ["client", "guardian", "auto"]);
}

export type DocuSignEnvelopeSigner = {
  email: string;
  name: string;
  role: DocuSignSignerRole;
  recipientId: string;
  routingOrder: string;
};

export async function createDocuSignEnvelope(
  completedPdf: Buffer,
  signers: DocuSignEnvelopeSigner[],
  answers: Answers = {},
  consents: Record<string, boolean> = {},
  fields: FieldMapping[] = PACKET_MAP.fields,
  providerName = "Moore Divine Care, Inc.",
  pageHeight = PACKET_MAP.pageHeight,
  transactionId?: string,
  documentName?: string,
): Promise<{ envelopeId: string }> {
  if (!docusignConfigured()) throw new Error("DocuSign not configured");
  if (!signers.length) throw new Error("No DocuSign recipients");
  const pageCount = (await PDFDocument.load(completedPdf)).getPageCount();
  const solo = signers.length === 1;
  const recipients = signers.map((signer) => {
    const tabs = clampTabsToDocument(
      docuSignTabsForRoles(answers, consents, fields, pageHeight, signer.recipientId, rolesForSigner(signer.role, solo)),
      pageCount,
    );
    return { ...signer, tabs };
  });
  if (!recipients.some((signer) => signer.tabs.signHereTabs.length > 0)) {
    throw new Error("No client DocuSign signature tabs found");
  }
  const { token, base } = await getApiContext();
  const packetName = documentName || signers[0]?.name || "Client";
  let res: Response;
  try { res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        emailSubject: `${providerName} - Client Intake Package for signature`,
        envelopeIdStamping: "false",
        status: "sent",
        ...(transactionId ? { transactionId } : {}),
        documents: [{
          documentId: "1", name: `Client Intake Package - ${packetName}`,
          fileExtension: "pdf", documentBase64: completedPdf.toString("base64"),
        }],
        recipients: {
          signers: recipients.map((signer) => ({
            email: signer.email, name: signer.name, recipientId: signer.recipientId, routingOrder: signer.routingOrder,
            tabs: signer.tabs,
          })),
        },
      }),
    },
  ); } catch { throw new DocuSignEnvelopeError("DocuSign did not confirm whether the envelope was sent", true); }
  if (!res.ok) throw new DocuSignEnvelopeError(`DocuSign envelope failed (HTTP ${res.status})`, res.status >= 500 || res.status === 408);
  try {
    const envelopeId: unknown = (await res.json()).envelopeId;
    if (typeof envelopeId !== "string" || !envelopeId.trim()) throw new Error("Missing envelope ID");
    return { envelopeId };
  } catch { throw new DocuSignEnvelopeError("DocuSign returned an unconfirmed envelope ID", true); }
}

/** Look up an envelope created with a transactionId. DocuSign retains these IDs for seven days. */
export async function lookupEnvelopeByTransactionId(transactionId: string): Promise<{ envelopeId: string; status: string } | null> {
  if (!docusignConfigured()) throw new Error("DocuSign not configured");
  const { token, base } = await getApiContext();
  const query = new URLSearchParams({ transaction_ids: transactionId });
  const res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes?${query}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`DocuSign transaction lookup failed (HTTP ${res.status})`);
  const payload: unknown = await res.json();
  const envelopes = payload && typeof payload === "object" && "envelopes" in payload
    ? (payload as { envelopes?: unknown }).envelopes
    : undefined;
  const first = Array.isArray(envelopes) ? envelopes[0] : null;
  if (!first || typeof first !== "object") return null;
  const envelopeId = "envelopeId" in first ? (first as { envelopeId?: unknown }).envelopeId : undefined;
  const status = "status" in first ? (first as { status?: unknown }).status : undefined;
  if (typeof envelopeId !== "string" || !envelopeId.trim()) return null;
  return { envelopeId, status: typeof status === "string" && status.trim() ? status : "unknown" };
}

export async function sendCompletedPacketForSignature(intakeId: string): Promise<{ envelopeId: string }> {
  // Wired from /api/intakes/[id]/docusign, which generates the PDF first.
  throw new Error(`sendCompletedPacketForSignature: use the API route for intake ${intakeId}`);
}

export async function checkDocuSignStatus(envelopeId: string): Promise<string> {
  if (!docusignConfigured()) return "not_configured";
  const { token, base } = await getApiContext();
  const res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`DocuSign status failed (HTTP ${res.status})`);
  const status: unknown = (await res.json()).status;
  if (typeof status !== "string" || !status.trim()) throw new Error("DocuSign returned no envelope status");
  return status;
}

/** Download the signed packet (all documents combined) for a completed envelope. */
export async function downloadDocuSignDocument(envelopeId: string): Promise<Buffer> {
  const { token, base } = await getApiContext();
  const res = await fetch(
    `${base}/v2.1/accounts/${process.env.DOCUSIGN_ACCOUNT_ID}/envelopes/${envelopeId}/documents/combined`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) throw new Error(`DocuSign document download failed (HTTP ${res.status})`);
  const bytes = Buffer.from(await res.arrayBuffer());
  // A successful HTTP response may still be an error page or truncated file.
  // Do not persist that response as a signed, deliverable packet.
  if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("DocuSign did not return a PDF");
  const pdf = await PDFDocument.load(bytes);
  if (!pdf.getPageCount()) throw new Error("DocuSign returned an empty PDF");
  return bytes;
}
