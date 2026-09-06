import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { HostError, NcTracksHostWorker, runRunner, validateConfig, validateJob, validateRunnerResult } from "./worker";

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "nctracks-host-test-"));
  const requests: Array<{ url: string; body: any; authorization: string | undefined }> = [];
  let rejectLease = false;
  const job = { id: "synthetic-job", leaseToken: "synthetic-lease", leaseExpiresAt: new Date(Date.now() + 300000).toISOString(), attempt: 1,
    subject: { firstName: "Synthetic", lastName: "Test Person", dob: "1991-02-03", midNumber: null }, authorizedNpi: "1134943608", serviceDateFrom: "2026-09-01", serviceDateTo: "2026-09-06" };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push({ url: req.url!, body, authorization: req.headers.authorization });
    res.setHeader("Content-Type", "application/json");
    if (req.url?.endsWith("/heartbeat") && body.jobId && rejectLease) { res.statusCode = 409; res.end(JSON.stringify({ error: "synthetic cancellation" })); }
    else res.end(JSON.stringify(req.url?.endsWith("/claim") ? { job } : { ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const runner = path.join(root, "synthetic-runner.mjs");
  const responseFile = path.join(root, "response.json");
  const fixtureCode = `import fs from 'node:fs/promises'; import {spawn} from 'node:child_process';
let s=''; for await(const c of process.stdin)s+=c; const input=JSON.parse(s);
if(input.operation==='status'){process.stdout.write(JSON.stringify({protocolVersion:1,status:'READY'}));}
else { await fs.writeFile('captured.json',JSON.stringify({input,args:process.argv,hasHostToken:!!process.env.NCTRACKS_HOST_TOKEN}));
const response=JSON.parse(await fs.readFile('response.json','utf8'));
if(response.hang){spawn(process.execPath,['-e',"setInterval(()=>require('fs').appendFileSync('pulse.txt','x'),50)"],{stdio:'ignore'}); await new Promise(r=>setTimeout(r,30000));}
process.stdout.write(JSON.stringify(response)); }`;
  await fs.writeFile(runner, fixtureCode);
  const config = validateConfig({ appUrl: `http://127.0.0.1:${port}`, artifactRoot: root, runner: { executable: process.execPath, args: [runner], cwd: root }, heartbeatIntervalMs: 1000, runnerTimeoutMs: 10000 });
  async function proof(file: string, identityText = "Synthetic Test Person 02/03/1991 001234567A") {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage(); if (identityText) page.drawText(identityText, { x: 30, y: 600, size: 12, font });
    const bytes = await pdf.save(); const localPath = path.join(root, file); await fs.writeFile(localPath, bytes);
    return { localPath, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  try {
    const artifact = await proof("verified.pdf");
    const response = { protocolVersion: 1, status: "VERIFIED_LOCAL", coverage: "ACTIVE", provenance: { source: "NCTRACKS_PORTAL", observedAt: new Date().toISOString(), reference: "SYNTHETIC_REF" },
      observedSubject: { ...job.subject, midNumber: "001234567A" }, artifact, code: null,
      actualInquiryFrom: "2026-09-01", actualInquiryTo: "2026-09-30", selectedCoveragePeriod: "September 2026", sourceCarrierText: "Synthetic carrier", sourceProviderText: "NOT SHOWN ON NCTRACKS RESPONSE" };
    const result = await validateRunnerResult(response, validateJob(job), root);
    assert.equal(result.subject.midNumber, "001234567A");
    assert.equal(result.actualInquiryTo, "2026-09-30");
    assert.equal(result.serviceDateTo, "2026-09-06");
    assert.equal(result.artifactSha256, artifact.sha256);
    assert(!JSON.stringify(result).includes(root)); assert(!("artifact" in result));
    await assert.rejects(() => validateRunnerResult({ ...response, observedSubject: { ...response.observedSubject, dob: "1992-02-03" } }, job, root), /IDENTITY_MISMATCH/);
    await assert.rejects(() => validateRunnerResult(response, { ...job, subject: { ...job.subject, midNumber: "DIFFERENT" } }, root), /IDENTITY_MISMATCH/);
    await assert.rejects(() => validateRunnerResult({ ...response, artifact: { ...artifact, sha256: "0".repeat(64) } }, job, root), /INVALID_EVIDENCE/);
    await assert.rejects(async () => validateRunnerResult({ ...response, artifact: await proof("blank.pdf", "") }, job, root), /EVIDENCE_REQUIRES_REVIEW/);
    await assert.rejects(async () => validateRunnerResult({ ...response, artifact: await proof("other.pdf", "Other Person 02/03/1991 001234567A") }, job, root), /EVIDENCE_REQUIRES_REVIEW/);
    await assert.rejects(() => validateRunnerResult({ ...response, artifact: { localPath: artifact.localPath, sha256: artifact.sha256 }, localArtifactPath: artifact.localPath }, job, root), /INVALID_CONTRACT/);
    await assert.rejects(() => validateRunnerResult({ ...response, coverage: "UNKNOWN" }, job, root), /INVALID_RUNNER_RESULT/);
    const noMatch = await validateRunnerResult({ protocolVersion: 1, status: "NO_MATCH", coverage: "UNKNOWN", provenance: response.provenance }, job, root);
    assert.equal(noMatch.status, "NO_MATCH");
    await assert.rejects(() => validateRunnerResult({ ...noMatch, protocolVersion: 1, provenance: { ...response.provenance, source: "NOT_OBSERVED" } }, job, root));
    assert.throws(() => validateJob({ ...job, command: "do not run" }), HostError);
    assert.throws(() => validateJob({ ...job, subject: { ...job.subject, dob: "1991-02-30" } }), HostError);
    assert.throws(() => validateConfig({ ...config, appUrl: "http://example.com" }), HostError);
    assert.throws(() => validateConfig({ ...config, appUrl: "https://example.com/path" }), HostError);
    await fs.writeFile(responseFile, JSON.stringify(response));
    const previousToken = process.env.NCTRACKS_HOST_TOKEN;
    process.env.NCTRACKS_HOST_TOKEN = "synthetic-secret-never-forward";
    try {
      const worker = new NcTracksHostWorker(config, "synthetic-secret-never-forward");
      assert.equal(await worker.runOnce(), "VERIFIED_LOCAL");
      const captured = JSON.parse(await fs.readFile(path.join(root, "captured.json"), "utf8"));
      assert.equal(captured.hasHostToken, false); assert(!JSON.stringify(captured.args).includes("Synthetic"));
      assert(!("leaseToken" in captured.input.job)); assert(!("leaseExpiresAt" in captured.input.job));
      const uploaded = requests.find((request) => request.url.endsWith("/result"))!;
      assert.equal(uploaded.body.subject.midNumber, "001234567A");
      assert.equal(uploaded.authorization, "Bearer synthetic-secret-never-forward");
      assert(!JSON.stringify(uploaded.body).includes(root)); assert(!JSON.stringify(uploaded.body).includes("localPath"));
      // Actual executable entrypoint smoke tests: no token required for read-only runner check.
      const configPath = path.join(root, "config.json"); await fs.writeFile(configPath, JSON.stringify(config));
      async function cli(mode: string) {
        return new Promise<{ code: number | null; output: string }>((resolve) => {
          const child = spawn(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), path.resolve("scripts/nctracks-host/cli.ts"), "--config", configPath, mode], { env: { ...process.env, NCTRACKS_HOST_TOKEN: "" }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
          let output = ""; child.stdout.on("data", (v) => output += v); child.stderr.on("data", (v) => output += v);
          child.on("close", (code) => resolve({ code, output }));
        });
      }
      const status = await cli("--status"); assert.equal(status.code, 0); assert.equal(JSON.parse(status.output).code, "HOST_TOKEN_MISSING");
      const check = await cli("--check"); assert.equal(check.code, 0); assert.equal(JSON.parse(check.output).status, "ADAPTER_AVAILABLE");
      const before = requests.length;
      rejectLease = true;
      await fs.writeFile(responseFile, JSON.stringify({ hang: true }));
      const running = worker.runOnce();
      await assert.rejects(() => worker.runOnce(), /ALREADY_PROCESSING/);
      await assert.rejects(() => running, /LEASE_OR_HOST_STOPPED/);
      assert(!requests.slice(before).some((request) => request.url.endsWith("/result")), "cancelled lease must not upload a late result");
      const pulse = path.join(root, "pulse.txt");
      const length = (await fs.readFile(pulse)).length;
      await new Promise((resolve) => setTimeout(resolve, 250));
      assert.equal((await fs.readFile(pulse)).length, length, "owned grandchild must stop with cancelled runner");
      await assert.rejects(() => runRunner(config, { operation: "lookup" }, undefined, 100), /RUNNER_TIMEOUT/);
    } finally { if (previousToken === undefined) delete process.env.NCTRACKS_HOST_TOKEN; else process.env.NCTRACKS_HOST_TOKEN = previousToken; }
    console.log("NCTracks host contract tests passed (synthetic HTTP, runner, PDF and cancellation only)");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const resolved = path.resolve(root), temp = path.resolve(os.tmpdir());
    if (path.dirname(resolved) === temp && path.basename(resolved).startsWith("nctracks-host-test-")) await fs.rm(resolved, { recursive: true, force: true });
  }
}
main().catch(() => { console.error("NCTracks host contract tests failed"); process.exitCode = 1; });
