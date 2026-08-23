/**
 * Live, human-readable demo of the "Check NC Tracks now" flow.
 *
 * Spins up a mock NC Tracks real-time endpoint on localhost, points the app's
 * EDI config at it, then runs a real coverage check for a sample client -
 * building the actual X12 270, POSTing it over HTTP, and parsing the 271 that
 * comes back. Nothing here talks to the real NC Tracks; it proves the wiring
 * end-to-end so you can watch it work.
 *
 * Run: npx tsx scripts/demo-eligibility.ts
 */
import http from "http";
import { readFileSync } from "fs";
import { join } from "path";

const FIX = join(process.cwd(), "test", "fixtures", "nctracks");

// A mock NC Tracks door: reads the incoming 270 and answers with a canned 271
// chosen by which sample client is being looked up.
function mockNcTracks(): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        // Pick a canned response by the name that appears in the 270 we received.
        let file = "271-active.edi";
        if (/DOE/i.test(body)) file = "271-inactive.edi";
        if (/NOMATCH/i.test(body)) file = "271-notfound.edi";
        const edi = readFileSync(join(FIX, file), "utf8");
        res.writeHead(200, { "Content-Type": "application/edi-x12" });
        res.end(edi);
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

async function main() {
  const mock = await mockNcTracks();

  // Point the app's dormant EDI feature at the mock endpoint. In production
  // these come from the NC Tracks Trading Partner enrollment (see
  // README_NCTRACKS_EDI.md) and live in Render env vars, never in code.
  process.env.NCTRACKS_EDI_URL = mock.url;
  process.env.NCTRACKS_SUBMITTER_ID = "DEMOSUBMIT";
  process.env.NCTRACKS_PROVIDER_NPI = "1234567893";
  process.env.NCTRACKS_PROVIDER_NAME = "MOORE DIVINE CARE INC";

  // Import AFTER env is set so nctracksEdiConfigured() sees the config.
  const { checkNcTracksEligibility } = await import("../src/lib/nctracksEdi");
  const { snapshotFrom271, coverageMessage } = await import("../src/lib/eligibilityState");

  const now = new Date("2026-08-23T12:00:00Z");
  const clients = [
    { fullName: "Maria Sanchez", dob: "1990-04-15", note: "active Medicaid" },
    { fullName: "John Doe", dob: "1985-11-02", note: "coverage ended" },
    { fullName: "Pat Nomatch", dob: "2000-01-01", note: "not found in NC Tracks" },
  ];

  console.log("\n=== Live 'Check NC Tracks now' demo (mock endpoint) ===");
  console.log(`Mock NC Tracks listening at ${mock.url}\n`);

  let i = 0;
  for (const c of clients) {
    i++;
    const { result } = await checkNcTracksEligibility({
      fullName: c.fullName,
      dob: c.dob,
      controlNumber: 1000 + i,
      traceNumber: `DEMO${i}`,
      now,
    });
    const snap = snapshotFrom271(result, now);
    console.log(`Client: ${c.fullName}  (DOB ${c.dob})  [expected: ${c.note}]`);
    console.log(`  status     : ${snap.status}`);
    if (snap.planName) console.log(`  plan       : ${snap.planName}`);
    if (snap.memberId) console.log(`  member id  : ${snap.memberId}`);
    if (snap.effectiveDate) console.log(`  effective  : ${snap.effectiveDate}`);
    if (snap.rejectReason) console.log(`  reason     : ${snap.rejectReason}`);
    console.log(`  what staff sees: "${coverageMessage(snap)}"`);
    console.log("");
  }

  mock.close();
  console.log("=== Demo complete: 270 built -> POSTed -> 271 parsed -> coverage shown ===\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
