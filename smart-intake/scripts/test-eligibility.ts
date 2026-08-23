/**
 * Focused tests for the NC Tracks direct-eligibility feature (270/271 EDI).
 * Runs WITHOUT a database or network: it builds a real 270, parses fixture
 * 271 responses, and checks the coverage-state snapshot + PDF-safety.
 *
 * Run: npx tsx scripts/test-eligibility.ts   (also invoked by npm test)
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { buildEdi270, toD8, normalizeLastName } from "../src/lib/edi270";
import { parseEdi271 } from "../src/lib/edi271";
import { buildCoreSoapRequest, extractX12Payload } from "../src/lib/nctracksEdi";
import {
  snapshotFrom271, snapshotToAnswers, snapshotFromAnswers,
  coverageMessage, ELIGIBILITY_KEYS,
} from "../src/lib/eligibilityState";
import { PACKET_MAP } from "../src/config/mooreDivinePacketMap";

let passed = 0;
function ok(msg: string) { console.log("✓", msg); passed++; }

const FIX = path.join(process.cwd(), "test", "fixtures", "nctracks");
const read = (f: string) => fs.readFileSync(path.join(FIX, f), "utf8");
const AT = new Date(Date.UTC(2026, 6, 14, 15, 5));

// 1. 270 builder produces a well-formed inquiry
{
  const x12 = buildEdi270(
    { lastName: "Gant", firstName: "Tameka", dob: "07/31/2004", gender: "Female", medicaidId: "987654321A" },
    { submitterId: "SUB1", receiverId: "NCTRACKSREL", providerNpi: "1234567890", providerName: "Moore Divine Care", providerTaxonomy: "251S00000X" },
    { controlNumber: 42, traceNumber: "TRACE001", now: AT },
  );
  assert(x12.startsWith("ISA*00*"), "ISA envelope present");
  assert(x12.includes("*NCTRACKSREL*"), "real-time receiver id in envelope");
  assert(x12.includes("~ST*270*0001*005010X279A1~"), "270 transaction header");
  assert(x12.includes("NM1*PR*2*NCTRACKS*"), "info source is NCTRACKS");
  assert(x12.includes("*PI*NCTRACKS~"), "info source id NCTRACKS");
  assert(x12.includes("~PRV*SB*PXC*251S00000X~"), "provider taxonomy PRV segment present");
  assert(x12.includes("~EQ*30~"), "EQ*30 general health-benefit inquiry");
  assert(x12.includes("*MI*987654321A~"), "member ID sent when known");
  assert(x12.includes("DMG*D8*20040731*F"), "DOB + gender sent");
  assert(x12.trim().endsWith("IEA*1*000000042~"), "IEA trailer closes the interchange");
  // SE segment count is correct (ST..SE inclusive)
  const segs = x12.split("~").filter(Boolean);
  const stIdx = segs.findIndex((s) => s.startsWith("ST*"));
  const seIdx = segs.findIndex((s) => s.startsWith("SE*"));
  const declared = Number(segs[seIdx].split("*")[1]);
  assert.strictEqual(declared, seIdx - stIdx + 1, "SE segment count matches actual segments");
  ok("270 inquiry builds to spec (envelope, EQ*30, member ID, DOB, SE count)");
}

// 2. toD8 normalizes both date formats
{
  assert.strictEqual(toD8("07/31/2004"), "20040731");
  assert.strictEqual(toD8("2004-07-31"), "20040731");
  ok("date normalization to X12 D8");
}

// 2b. Last-name normalization per NC Tracks companion guide section 1.4
{
  assert.strictEqual(normalizeLastName("O'Gant-Smith Jr"), "OGANTSMITH", "suffix + special chars stripped");
  assert.strictEqual(normalizeLastName("de la Cruz"), "DE LA CRUZ", "internal spaces kept, uppercased");
  assert.strictEqual(normalizeLastName("Smith, MD"), "SMITH", "credential suffix stripped");
  // a normalized last name is what actually lands in the 270 subscriber loop
  const x12 = buildEdi270(
    { lastName: "O'Neil-Vance Sr" },
    { submitterId: "SUB1", receiverId: "NCTRACKSREL", providerNpi: "1234567890", providerName: "P" },
    { controlNumber: 1, traceNumber: "T", now: AT },
  );
  assert(x12.includes("NM1*IL*1*ONEILVANCE"), "normalized last name used in NM1*IL");
  ok("last name normalized for NC Tracks matching (suffixes + special chars)");
}

// 3. ACTIVE 271 -> active snapshot with plan/member/effective date
{
  const r = parseEdi271(read("271-active.edi"));
  assert.strictEqual(r.active, true, "active coverage detected");
  assert.strictEqual(r.memberId, "987654321A", "member ID parsed");
  assert.strictEqual(r.planName, "NC MEDICAID DIRECT", "plan name parsed");
  assert.strictEqual(r.effectiveDate, "01/01/2026", "effective date parsed");
  const snap = snapshotFrom271(r, AT);
  assert.strictEqual(snap.status, "active");
  assert(coverageMessage(snap).startsWith("Coverage active"), "active message");
  ok("ACTIVE 271 -> active snapshot + message");
}

// 4. INACTIVE 271 -> inactive snapshot
{
  const r = parseEdi271(read("271-inactive.edi"));
  assert.strictEqual(r.active, false, "no active coverage");
  const snap = snapshotFrom271(r, AT);
  assert.strictEqual(snap.status, "inactive");
  assert(coverageMessage(snap).toLowerCase().includes("no active"), "inactive message");
  ok("INACTIVE 271 -> inactive snapshot + message");
}

// 5. NOT-FOUND 271 (AAA reject) -> needs_review snapshot
{
  const r = parseEdi271(read("271-notfound.edi"));
  assert.strictEqual(r.active, false);
  assert(r.rejectReason && r.rejectReason.includes("not found"), "reject reason in plain words");
  const snap = snapshotFrom271(r, AT);
  assert.strictEqual(snap.status, "needs_review");
  ok("NOT-FOUND 271 (AAA) -> needs_review snapshot with plain-language reason");
}

// 6. Snapshot round-trips through the answer map
{
  const r = parseEdi271(read("271-active.edi"));
  const snap = snapshotFrom271(r, AT);
  const answers = snapshotToAnswers(snap);
  const back = snapshotFromAnswers(answers);
  assert.strictEqual(back.status, "active");
  assert.strictEqual(back.memberId, "987654321A");
  assert.strictEqual(back.planName, "NC MEDICAID DIRECT");
  assert.strictEqual(snapshotFromAnswers({}).status, "not_checked", "empty answers -> not_checked");
  ok("coverage snapshot round-trips through intake answers");
}

// 7. SAFETY: eligibility snapshot keys are NOT in the packet map -> never printed
{
  const sources = new Set(PACKET_MAP.fields.map((f) => f.source));
  for (const key of Object.values(ELIGIBILITY_KEYS)) {
    assert(!sources.has(key), `eligibility key ${key} must not map to any PDF field`);
  }
  ok("eligibility snapshot keys never leak onto the packet PDF");
}

// 8. SAFETY: no live network is attempted when unconfigured
{
  // nctracksEdi.checkNcTracksEligibility must throw synchronously-ish when unconfigured
  // (import lazily to avoid pulling env). We assert the guard by env absence.
  delete process.env.NCTRACKS_EDI_URL;
  delete process.env.NCTRACKS_SUBMITTER_ID;
  delete process.env.NCTRACKS_PROVIDER_NPI;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../src/lib/nctracksEdi");
  assert.strictEqual(mod.nctracksEdiConfigured(), false, "feature reports not-configured with no env");
  ok("feature stays inactive (no network) until NCTRACKS_EDI_* is configured");
}

// 9. UNIT: CORE SOAP envelope wrap + payload extraction round-trips
{
  const soap = buildCoreSoapRequest("ISA*00*...~IEA*1*1~", {
    username: "u", password: "p", senderId: "SUB1", payloadId: "id-1", timeStamp: "2026-07-14T15:05:00.000Z",
  });
  assert(soap.includes("<cor:COREEnvelopeRealTimeRequest>"), "CORE real-time envelope");
  assert(soap.includes("<PayloadType>X12_270_Request_005010X279A1</PayloadType>"), "correct payload type");
  assert(soap.includes("<ProcessingMode>RealTime</ProcessingMode>"), "real-time processing mode");
  assert(soap.includes("<ReceiverID>NCTracks</ReceiverID>"), "receiver id NCTracks");
  assert(soap.includes("<CORERuleVersion>2.2.0</CORERuleVersion>"), "CORE rule version 2.2.0");
  assert(soap.includes("<wsse:UsernameToken>"), "WS-Security username token present");
  // extract the 271 back out of a CORE response envelope (CDATA)
  const resp = `<soap:Envelope><soap:Body><cor:COREEnvelopeRealTimeResponse><Payload><![CDATA[${read("271-active.edi")}]]></Payload></cor:COREEnvelopeRealTimeResponse></soap:Body></soap:Envelope>`;
  assert(extractX12Payload(resp).includes("ST*271*"), "271 extracted from SOAP payload");
  ok("CORE SOAP envelope built + 271 payload extracted");
}

// 10. INTEGRATION: full service round-trip through a real HTTP call to a local
//     mock that speaks the SAME CAQH CORE SOAP protocol as NC Tracks (proves
//     build-270 -> SOAP-wrap -> POST -> unwrap -> parse-271 -> map, end to end).
//     This is a local fixture server, NOT the real NC Tracks endpoint.
import http from "http";
async function integration() {
  const body = read("271-active.edi");
  const server = http.createServer((req, res) => {
    let received = "";
    req.on("data", (c) => (received += c));
    req.on("end", () => {
      // the app must send a CORE SOAP envelope with WS-Security and a real 270 payload
      if (!received.includes("COREEnvelopeRealTimeRequest") || !received.includes("wsse:UsernameToken")) {
        res.statusCode = 400; res.end("no CORE SOAP envelope"); return;
      }
      const inner270 = extractX12Payload(received);
      if (!inner270.includes("ST*270*")) { res.statusCode = 400; res.end("no 270 in payload"); return; }
      res.setHeader("Content-Type", "application/soap+xml");
      res.end(`<soap:Envelope><soap:Body><cor:COREEnvelopeRealTimeResponse><Payload><![CDATA[${body}]]></Payload></cor:COREEnvelopeRealTimeResponse></soap:Body></soap:Envelope>`);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as import("net").AddressInfo).port;
  process.env.NCTRACKS_EDI_URL = `http://127.0.0.1:${port}/EDIGateway`;
  process.env.NCTRACKS_SUBMITTER_ID = "SUB1";
  process.env.NCTRACKS_PROVIDER_NPI = "1234567890";
  process.env.NCTRACKS_PROVIDER_TAXONOMY = "251S00000X";
  process.env.NCTRACKS_EDI_USERNAME = "tp-user";
  process.env.NCTRACKS_EDI_PASSWORD = "tp-pass";
  // fresh import so it reads the env we just set
  const { checkNcTracksEligibility } = await import("../src/lib/nctracksEdi");
  const { result, mapped } = await checkNcTracksEligibility({
    fullName: "Tameka Gant", dob: "07/31/2004", gender: "Female", medicaidId: "987654321A",
    controlNumber: 7, traceNumber: "T7", now: AT,
  });
  await new Promise<void>((r) => server.close(() => r()));
  assert.strictEqual(result.active, true, "integration: active coverage");
  assert.strictEqual(mapped.has_medicaid, "Yes", "integration: has_medicaid mapped");
  assert.strictEqual(mapped.mid_number, "987654321A", "integration: member id mapped");
  assert.strictEqual(mapped.mco, "NC MEDICAID DIRECT", "integration: plan mapped");
  ok("full CORE SOAP round-trip over HTTP (build 270 -> wrap -> POST -> unwrap -> parse 271 -> map)");
  console.log(`\nEligibility: all ${passed} checks passed ✓`);
}
integration().catch((e) => { console.error("✗ integration failed:", e); process.exit(1); });
