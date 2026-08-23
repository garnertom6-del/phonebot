/**
 * NC Tracks direct eligibility via the Trading Partner / EDI channel.
 *
 * Sends an X12 270 to the NC Tracks real-time endpoint and parses the 271 into
 * a result the app already knows how to apply (reuses applyNcTracksResult from
 * ncTracksLookup.ts). Dormant until the NCTRACKS_EDI_* credentials are set -
 * see README_NCTRACKS_EDI.md.
 *
 * NC Tracks' real-time door is CAQH CORE Phase II connectivity: the X12 270 is
 * wrapped in a SOAP 1.2 COREEnvelopeRealTimeRequest, authenticated with a
 * WS-Security UsernameToken, and POSTed to https://edi.nctracks.nc.gov/EDIGateway.
 * The 271 comes back inside a COREEnvelopeRealTimeResponse <Payload>. This is
 * the method documented in the NC Tracks Trading Partner Connectivity Guide
 * (section 4.2.5). A "raw" mode (plain X12 body) is kept for local testing.
 *
 * No portal login, no password storage, no 2FA. This is NC Tracks' own
 * machine-to-machine door.
 */
import crypto from "crypto";
import { buildEdi270, type Edi270Config, type Edi270Member } from "./edi270";
import { parseEdi271, type Edi271Result } from "./edi271";
import type { NcTracksLookupResult } from "./ncTracksLookup";

type EdiMode = "soap" | "raw";
function ediMode(): EdiMode {
  return (process.env.NCTRACKS_EDI_MODE || "soap").toLowerCase() === "raw" ? "raw" : "soap";
}

export function nctracksEdiConfigured(): boolean {
  const base = !!(process.env.NCTRACKS_EDI_URL && process.env.NCTRACKS_SUBMITTER_ID &&
    process.env.NCTRACKS_PROVIDER_NPI);
  if (!base) return false;
  // SOAP (the real NC Tracks door) also needs the WS-Security username/password
  if (ediMode() === "soap") {
    return !!(process.env.NCTRACKS_EDI_USERNAME && process.env.NCTRACKS_EDI_PASSWORD);
  }
  return true;
}

function config(): Edi270Config {
  return {
    submitterId: process.env.NCTRACKS_SUBMITTER_ID as string,
    // ISA08/GS03: NCTRACKSREL for real-time, NCTRACKSBAT for batch
    receiverId: process.env.NCTRACKS_RECEIVER_ID || "NCTRACKSREL",
    providerNpi: process.env.NCTRACKS_PROVIDER_NPI as string,
    providerName: process.env.NCTRACKS_PROVIDER_NAME || "PROVIDER",
    providerTaxonomy: process.env.NCTRACKS_PROVIDER_TAXONOMY,
    providerIdCode: process.env.NCTRACKS_PROVIDER_ID_CODE,
    interchangeSenderQualifier: process.env.NCTRACKS_ISA_SENDER_QUALIFIER,
    interchangeReceiverQualifier: process.env.NCTRACKS_ISA_RECEIVER_QUALIFIER,
  };
}

export interface EligibilityCheck {
  result: Edi271Result;
  mapped: NcTracksLookupResult;
}

/** Split a full name into last/first for the 270 subscriber loop. */
function splitName(full: string): { lastName: string; firstName?: string } {
  const parts = (full || "").trim().split(/\s+/);
  if (parts.length <= 1) return { lastName: parts[0] || "" };
  return { lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(" ") };
}

function toMapped(r: Edi271Result): NcTracksLookupResult {
  const mapped: NcTracksLookupResult = {};
  mapped.has_medicaid = r.active ? "Yes" : "No";
  if (r.memberId) mapped.mid_number = r.memberId;
  if (r.planName) mapped.mco = r.planName;
  if (r.effectiveDate) mapped.medicaid_effective_date = r.effectiveDate;
  return mapped;
}

function xmlEscape(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/**
 * Wrap an X12 270 in a CAQH CORE Phase II SOAP 1.2 real-time request envelope
 * with a WS-Security UsernameToken. Matches the NC Tracks Connectivity Guide
 * (Appendix C.2 - 270 SOAP Real-Time Sample).
 */
export function buildCoreSoapRequest(x12: string, opts: {
  username: string; password: string; senderId: string; payloadId: string; timeStamp: string;
}): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope" xmlns:cor="http://www.caqh.org/SOAP/WSDL/CORERule2.2.0.xsd">
 <soap:Header>
   <wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" soap:mustUnderstand="true">
    <wsse:UsernameToken>
       <wsse:Username>${xmlEscape(opts.username)}</wsse:Username>
       <wsse:Password>${xmlEscape(opts.password)}</wsse:Password>
    </wsse:UsernameToken>
   </wsse:Security>
  </soap:Header>
  <soap:Body>
    <cor:COREEnvelopeRealTimeRequest>
      <PayloadType>X12_270_Request_005010X279A1</PayloadType>
      <ProcessingMode>RealTime</ProcessingMode>
      <PayloadID>${xmlEscape(opts.payloadId)}</PayloadID>
      <TimeStamp>${xmlEscape(opts.timeStamp)}</TimeStamp>
      <SenderID>${xmlEscape(opts.senderId)}</SenderID>
      <ReceiverID>NCTracks</ReceiverID>
      <CORERuleVersion>2.2.0</CORERuleVersion>
      <Payload><![CDATA[${x12}]]></Payload>
    </cor:COREEnvelopeRealTimeRequest>
  </soap:Body>
</soap:Envelope>`;
}

/**
 * Pull the X12 271 out of a CORE real-time SOAP response's <Payload> element.
 * Tolerates CDATA and entity-escaped payloads; falls back to the raw text if
 * there is no envelope (raw mode / a bare 271).
 */
export function extractX12Payload(responseText: string): string {
  const m = /<(?:\w+:)?Payload[^>]*>([\s\S]*?)<\/(?:\w+:)?Payload>/i.exec(responseText || "");
  let p = m ? m[1] : (responseText || "");
  p = p.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "");
  p = p.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
       .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  return p.trim();
}

export interface CheckInput {
  fullName: string;
  dob?: string;
  gender?: string;
  medicaidId?: string;
  controlNumber: number;
  traceNumber: string;
  now: Date;
}

export async function checkNcTracksEligibility(input: CheckInput): Promise<EligibilityCheck> {
  if (!nctracksEdiConfigured()) {
    throw new Error("NC Tracks EDI is not connected yet. Enroll as a Trading Partner (see README_NCTRACKS_EDI.md).");
  }
  const { lastName, firstName } = splitName(input.fullName);
  const member: Edi270Member = {
    lastName, firstName, dob: input.dob, gender: input.gender, medicaidId: input.medicaidId,
  };
  const x12 = buildEdi270(member, config(), {
    controlNumber: input.controlNumber, traceNumber: input.traceNumber, now: input.now,
  });

  const mode = ediMode();
  let contentType = "application/edi-x12";
  let body = x12;
  const headers: Record<string, string> = {};

  if (mode === "soap") {
    const username = process.env.NCTRACKS_EDI_USERNAME || "";
    const password = process.env.NCTRACKS_EDI_PASSWORD || "";
    if (!username || !password) {
      throw new Error("NC Tracks SOAP mode needs NCTRACKS_EDI_USERNAME and NCTRACKS_EDI_PASSWORD (WS-Security). Set them or use NCTRACKS_EDI_MODE=raw for testing.");
    }
    body = buildCoreSoapRequest(x12, {
      username, password,
      senderId: (process.env.NCTRACKS_SENDER_ID || process.env.NCTRACKS_SUBMITTER_ID || "").replace(/\s+/g, ""),
      payloadId: crypto.randomUUID(),
      timeStamp: input.now.toISOString(),
    });
    contentType = "application/soap+xml; charset=utf-8";
  } else if (process.env.NCTRACKS_EDI_SECRET) {
    // raw mode optional bearer auth (used by local mocks/testing)
    headers.Authorization = `Bearer ${process.env.NCTRACKS_EDI_SECRET}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const res = await fetch(process.env.NCTRACKS_EDI_URL as string, {
      method: "POST",
      headers: { "Content-Type": contentType, ...headers },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`NC Tracks EDI returned ${res.status}`);
    const result = parseEdi271(extractX12Payload(text));
    return { result, mapped: toMapped(result) };
  } finally {
    clearTimeout(timer);
  }
}
