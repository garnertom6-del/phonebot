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
import { buildEdi270, toD8 } from "../src/lib/edi270";
import { parseEdi271 } from "../src/lib/edi271";
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
    { submitterId: "SUB123", receiverId: "NCTRACKS", providerNpi: "1234567890", providerName: "Moore Divine Care" },
    { controlNumber: 42, traceNumber: "TRACE001", now: AT },
  );
  assert(x12.startsWith("ISA*00*"), "ISA envelope present");
  assert(x12.includes("~ST*270*0001*005010X279A1~"), "270 transaction header");
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

// 9. INTEGRATION: full service round-trip through a real HTTP call to a local
//    mock endpoint (proves build-270 -> POST -> parse-271 -> map, end to end).
//    This is a local fixture server, NOT the real NC Tracks endpoint.
import http from "http";
async function integration() {
  const body = read("271-active.edi");
  const server = http.createServer((req, res) => {
    let received = "";
    req.on("data", (c) => (received += c));
    req.on("end", () => {
      // sanity: the app actually sent a 270 inquiry
      if (!received.includes("ST*270*")) { res.statusCode = 400; res.end("no 270"); return; }
      res.setHeader("Content-Type", "application/edi-x12");
      res.end(body);
    });
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as import("net").AddressInfo).port;
  process.env.NCTRACKS_EDI_URL = `http://127.0.0.1:${port}/edi`;
  process.env.NCTRACKS_SUBMITTER_ID = "SUB123";
  process.env.NCTRACKS_PROVIDER_NPI = "1234567890";
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
  ok("full service round-trip over HTTP (build 270 -> POST -> parse 271 -> map)");
  console.log(`\nEligibility: all ${passed} checks passed ✓`);
}
integration().catch((e) => { console.error("✗ integration failed:", e); process.exit(1); });
