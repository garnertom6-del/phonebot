import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import type { NcTracksHostJob, NcTracksHostResult } from "../../src/lib/ncTracksJobTypes";
import { NCTRACKS_PROVIDER } from "../../src/lib/ncTracksProvider";

export class HostError extends Error {
  constructor(public code: string) { super(code); }
}
async function stopChild(child: ReturnType<typeof spawn>) {
  if (!child.pid || child.exitCode !== null) return;
  if (process.platform === "win32") {
    // Kill only this worker's child tree, including the runner's Codex child.
    await new Promise<void>((resolve) => {
      const killer = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "taskkill.exe"), ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, shell: false, stdio: "ignore" });
      killer.on("error", () => { child.kill(); resolve(); });
      killer.on("close", () => resolve());
    });
  } else { try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }
}
export interface HostConfig {
  appUrl: string;
  artifactRoot: string;
  runner: { executable: string; args: string[]; cwd: string };
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  requestTimeoutMs?: number;
  runnerTimeoutMs?: number;
}
type ObjectValue = Record<string, unknown>;
const object = (v: unknown): ObjectValue => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new HostError("INVALID_CONTRACT");
  return v as ObjectValue;
};
function only(v: ObjectValue, keys: string[]) {
  if (Object.keys(v).some((key) => !keys.includes(key))) throw new HostError("INVALID_CONTRACT");
}
function text(v: unknown, max = 180): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\x00-\x1f\x7f]/.test(v)) throw new HostError("INVALID_CONTRACT");
  return v;
}
function date(v: unknown): string {
  const value = text(v, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new HostError("INVALID_CONTRACT");
  return value;
}
function subject(v: unknown) {
  const s = object(v);
  only(s, ["firstName", "lastName", "dob", "midNumber"]);
  return { firstName: text(s.firstName, 100), lastName: text(s.lastName, 100), dob: date(s.dob), midNumber: s.midNumber === null ? null : text(s.midNumber, 40) };
}
const normalized = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();
const normalizedMid = (s: string) => s.replace(/\s+/g, "").toUpperCase();
function inRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return !!relative && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}
async function verifyPdfIdentity(bytes: Uint8Array, observed: ReturnType<typeof subject>) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: Uint8Array.from(bytes), useSystemFonts: true, verbosity: 0 }).promise;
  try {
    if (doc.numPages > 30) throw new HostError("EVIDENCE_REQUIRES_REVIEW");
    const parts: string[] = [];
    for (let page = 1; page <= doc.numPages; page++) {
      const content = await (await doc.getPage(page)).getTextContent();
      parts.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    const content = normalized(parts.join(" "));
    const contains = (value: string) => new RegExp(`(?<![\\p{L}\\p{N}])${normalized(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "u").test(content);
    const fullNames = [`${observed.firstName} ${observed.lastName}`, `${observed.lastName}, ${observed.firstName}`, `${observed.lastName} ${observed.firstName}`];
    const [year, month, day] = observed.dob.split("-");
    const dobForms = [observed.dob, `${month}/${day}/${year}`, `${Number(month)}/${Number(day)}/${year}`];
    if (!fullNames.some(contains) || !dobForms.some(contains) || !observed.midNumber || !contains(observed.midNumber)) throw new HostError("EVIDENCE_REQUIRES_REVIEW");
  } finally { await doc.destroy(); }
}
export function validateConfig(raw: unknown): HostConfig {
  const c = object(raw);
  only(c, ["appUrl", "artifactRoot", "runner", "pollIntervalMs", "heartbeatIntervalMs", "requestTimeoutMs", "runnerTimeoutMs"]);
  const url = new URL(text(c.appUrl, 400));
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new HostError("INVALID_APP_ORIGIN");
  const r = object(c.runner);
  only(r, ["executable", "args", "cwd"]);
  if (!Array.isArray(r.args) || r.args.length > 20 || r.args.some((arg) => typeof arg !== "string" || /[\x00\r\n]/.test(arg) || arg.length > 2048)) throw new HostError("INVALID_RUNNER_CONFIG");
  const executable = text(r.executable, 2048), cwd = text(r.cwd, 2048), artifactRoot = text(c.artifactRoot, 2048);
  if (![executable, cwd, artifactRoot].every(path.isAbsolute) || [cwd, artifactRoot].some((v) => v.startsWith("\\\\")) || (process.platform === "win32" && path.extname(executable).toLowerCase() !== ".exe")) throw new HostError("INVALID_RUNNER_CONFIG");
  const config: HostConfig = { appUrl: url.origin, artifactRoot, runner: { executable, cwd, args: r.args as string[] } };
  for (const [key, min, max, fallback] of [
    ["pollIntervalMs", 1000, 60000, 10000], ["heartbeatIntervalMs", 1000, 60000, 30000],
    ["requestTimeoutMs", 100, 60000, 15000], ["runnerTimeoutMs", 100, 600000, 240000],
  ] as const) {
    const value = c[key] ?? fallback;
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new HostError("INVALID_TIMEOUT");
    config[key] = value;
  }
  return config;
}
export function validateJob(raw: unknown): NcTracksHostJob {
  const j = object(raw);
  only(j, ["id", "leaseToken", "leaseExpiresAt", "attempt", "subject", "authorizedNpi", "serviceDateFrom", "serviceDateTo"]);
  const id = text(j.id, 80), leaseToken = text(j.leaseToken, 256), leaseExpiresAt = text(j.leaseExpiresAt, 40);
  if (!/^[a-zA-Z0-9_-]+$/.test(id) || !Number.isFinite(Date.parse(leaseExpiresAt)) || Date.parse(leaseExpiresAt) <= Date.now()) throw new HostError("INVALID_JOB_LEASE");
  if (typeof j.attempt !== "number" || !Number.isInteger(j.attempt) || j.attempt < 1 || j.authorizedNpi !== NCTRACKS_PROVIDER.npi) throw new HostError("INVALID_CONTRACT");
  const serviceDateFrom = date(j.serviceDateFrom), serviceDateTo = date(j.serviceDateTo);
  if (serviceDateFrom > serviceDateTo) throw new HostError("INVALID_CONTRACT");
  return { id, leaseToken, leaseExpiresAt, attempt: j.attempt, subject: subject(j.subject), authorizedNpi: j.authorizedNpi as string, serviceDateFrom, serviceDateTo };
}
export function safeRunnerEnvironment(): NodeJS.ProcessEnv {
  const names = ["SystemRoot", "WINDIR", "USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA", "TEMP", "TMP", "PATH", "PATHEXT", "PROGRAMDATA", "PROGRAMFILES"];
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => names.some((name) => name.toLowerCase() === key.toLowerCase()))), NODE_ENV: "production" };
}

/** Only configured, trusted executable/arguments are used; job data travels on stdin. */
export async function runRunner(config: HostConfig, input: unknown, signal?: AbortSignal, timeout = config.runnerTimeoutMs!): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let settled = false, size = 0;
    const chunks: Buffer[] = [];
    const child = spawn(config.runner.executable, config.runner.args, {
      cwd: config.runner.cwd, shell: false, windowsHide: true, detached: process.platform !== "win32",
      env: safeRunnerEnvironment(), stdio: ["pipe", "pipe", "pipe"],
    });
    const finish = (error?: HostError, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      if (error) { void stopChild(child).finally(() => reject(error)); } else resolve(value);
    };
    const abort = () => finish(new HostError("LEASE_OR_HOST_STOPPED"));
    const timer = setTimeout(() => finish(new HostError("RUNNER_TIMEOUT")), timeout);
    child.on("error", () => finish(new HostError("RUNNER_UNAVAILABLE")));
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 128 * 1024) finish(new HostError("RUNNER_OUTPUT_LIMIT"));
      else chunks.push(chunk);
    });
    // Runner diagnostics can contain patient data. Discard them, never forward them.
    child.stderr.resume();
    child.stdin.on("error", () => finish(new HostError("RUNNER_INPUT_FAILED")));
    child.on("close", (code) => {
      if (settled) return;
      if (code !== 0) return finish(new HostError("RUNNER_FAILED"));
      try { finish(undefined, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch { finish(new HostError("RUNNER_INVALID_JSON")); }
    });
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) return abort();
    child.stdin.end(JSON.stringify(input));
  });
}

export async function validateRunnerResult(raw: unknown, job: NcTracksHostJob, artifactRoot: string): Promise<NcTracksHostResult> {
  const r = object(raw);
  only(r, ["protocolVersion", "status", "coverage", "provenance", "observedSubject", "artifact", "code", "actualInquiryFrom", "actualInquiryTo", "selectedCoveragePeriod", "sourceCarrierText", "sourceProviderText", "sourceFacilityText", "sourcePhoneText", "sourceCountyText"]);
  if (r.protocolVersion !== 1 || !["VERIFIED_LOCAL", "NO_MATCH", "ACTION_REQUIRED", "REVIEW_REQUIRED", "FAILED"].includes(String(r.status)) || !["ACTIVE", "INACTIVE", "UNKNOWN", "CONFLICT"].includes(String(r.coverage))) throw new HostError("INVALID_RUNNER_RESULT");
  const p = object(r.provenance);
  only(p, ["source", "observedAt", "reference"]);
  const observedAt = text(p.observedAt, 40), reference = text(p.reference, 120);
  if (!["NCTRACKS_PORTAL", "NOT_OBSERVED"].includes(String(p.source)) || !/^[a-zA-Z0-9 _.:#-]+$/.test(reference) || !Number.isFinite(Date.parse(observedAt)) || Date.parse(observedAt) > Date.now() + 30000 || Date.parse(observedAt) < Date.now() - 15 * 60000 || (["VERIFIED_LOCAL", "NO_MATCH"].includes(String(r.status)) && (p.source !== "NCTRACKS_PORTAL" || reference === "NOT_OBSERVED"))) throw new HostError("INVALID_PROVENANCE");
  if (r.code != null && !/^[A-Z][A-Z0-9_]{0,79}$/.test(String(r.code))) throw new HostError("INVALID_RUNNER_RESULT");
  const result: NcTracksHostResult = {
    leaseToken: job.leaseToken, status: r.status as NcTracksHostResult["status"], coverage: r.coverage as NcTracksHostResult["coverage"],
    subject: { ...job.subject }, authorizedNpi: job.authorizedNpi, serviceDateFrom: job.serviceDateFrom, serviceDateTo: job.serviceDateTo,
    provenance: { source: p.source as NcTracksHostResult["provenance"]["source"], observedAt, reference }, ...(r.code ? { code: r.code as string } : {}),
  };
  if (r.actualInquiryFrom != null || r.actualInquiryTo != null) {
    result.actualInquiryFrom = date(r.actualInquiryFrom); result.actualInquiryTo = date(r.actualInquiryTo);
    if (result.actualInquiryFrom > result.actualInquiryTo) throw new HostError("INVALID_RUNNER_RESULT");
  }
  for (const key of ["selectedCoveragePeriod", "sourceCarrierText", "sourceProviderText", "sourceFacilityText", "sourcePhoneText", "sourceCountyText"] as const) {
    if (r[key] != null) result[key] = text(r[key], 500);
  }
  if (r.status === "VERIFIED_LOCAL") {
    if (!["ACTIVE", "INACTIVE"].includes(String(r.coverage)) || !result.actualInquiryFrom || !result.actualInquiryTo || !result.selectedCoveragePeriod) throw new HostError("INVALID_RUNNER_RESULT");
    const observed = subject(r.observedSubject);
    if (normalized(observed.firstName) !== normalized(job.subject.firstName) || normalized(observed.lastName) !== normalized(job.subject.lastName) || observed.dob !== job.subject.dob || !observed.midNumber || (job.subject.midNumber && normalizedMid(observed.midNumber) !== normalizedMid(job.subject.midNumber))) throw new HostError("IDENTITY_MISMATCH");
    result.subject = observed;
    const artifact = object(r.artifact);
    only(artifact, ["localPath", "sha256"]);
    const localPath = text(artifact.localPath, 2048), sha256 = text(artifact.sha256, 64);
    if (!path.isAbsolute(localPath) || path.extname(localPath).toLowerCase() !== ".pdf" || !/^[a-f0-9]{64}$/i.test(sha256)) throw new HostError("INVALID_EVIDENCE");
    const [root, file] = await Promise.all([fs.realpath(artifactRoot), fs.realpath(localPath)]);
    if (!inRoot(root, file)) throw new HostError("EVIDENCE_OUTSIDE_ROOT");
    const handle = await fs.open(file, "r");
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size < 100 || stat.size > 25 * 1024 * 1024) throw new HostError("INVALID_EVIDENCE");
      const bytes = await handle.readFile();
      if (!bytes.subarray(0, 8).toString("ascii").startsWith("%PDF-") || createHash("sha256").update(bytes).digest("hex") !== sha256.toLowerCase()) throw new HostError("INVALID_EVIDENCE");
      const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
      if (pdf.getPageCount() < 1) throw new HostError("INVALID_EVIDENCE");
      await verifyPdfIdentity(bytes, observed);
      result.artifactSha256 = sha256.toLowerCase();
    } finally { await handle.close(); }
  } else if ((r.status === "NO_MATCH" && r.coverage !== "UNKNOWN") || !["UNKNOWN", "CONFLICT"].includes(String(r.coverage))) {
    throw new HostError("INVALID_RUNNER_RESULT");
  }
  // Only reviewed result fields leave the host; local paths, tool output and PDF bytes stay local.
  return result;
}

async function pause(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) return;
  await new Promise<void>((resolve) => {
    const end = () => { clearTimeout(timer); signal?.removeEventListener("abort", end); resolve(); };
    const timer = setTimeout(end, ms);
    signal?.addEventListener("abort", end, { once: true });
  });
}
export class NcTracksHostWorker {
  private active = false;
  constructor(readonly config: HostConfig, private token: string, private log: (status: string) => void = () => {}) {
    if (!token || /\s/.test(token)) throw new HostError("NOT_CONFIGURED");
  }
  private async post(endpoint: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, this.config.requestTimeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      if (signal?.aborted) throw new HostError("HOST_STOPPED");
      const response = await fetch(`${this.config.appUrl}${endpoint}`, {
        method: "POST", headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body), cache: "no-store", redirect: "error", signal: controller.signal,
      });
      if (!response.ok) throw new HostError(response.status === 409 ? "LEASE_REJECTED" : response.status === 401 || response.status === 403 ? "HOST_UNAUTHORIZED" : "HOST_REQUEST_FAILED");
      const reader = response.body?.getReader();
      if (!reader) throw new HostError("INVALID_SERVER_RESPONSE");
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.length; if (size > 128 * 1024) { await reader.cancel(); throw new HostError("SERVER_RESPONSE_LIMIT"); }
        chunks.push(value);
      }
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch (error) { throw error instanceof HostError ? error : new HostError("HOST_CONNECTION_FAILED"); }
    finally { clearTimeout(timer); signal?.removeEventListener("abort", abort); }
  }
  async runOnce(signal?: AbortSignal): Promise<string> {
    if (this.active) throw new HostError("ALREADY_PROCESSING");
    this.active = true;
    try {
      const probe = object(await runRunner(this.config, { protocolVersion: 1, operation: "status" }, signal, 30000));
      const ready = probe.protocolVersion === 1 && probe.status === "READY";
      await this.post("/api/nctracks/host/heartbeat", { adapterReady: ready }, signal);
      if (!ready) return "NOT_CONFIGURED";
      const claimed = object(await this.post("/api/nctracks/host/claim", {}, signal));
      if (claimed.job === null) return "IDLE";
      const job = validateJob(claimed.job);
      const controller = new AbortController();
      const stop = () => controller.abort(); signal?.addEventListener("abort", stop, { once: true });
      let leaseLost = false;
      const heartbeat = (async () => {
        while (!controller.signal.aborted) {
          await pause(this.config.heartbeatIntervalMs!, controller.signal);
          if (controller.signal.aborted) return;
          try { await this.post("/api/nctracks/host/heartbeat", { adapterReady: true, jobId: job.id, leaseToken: job.leaseToken }, controller.signal); }
          catch { leaseLost = true; controller.abort(); }
        }
      })();
      try {
        const { leaseToken: _leaseToken, leaseExpiresAt: _leaseExpiresAt, ...runnerJob } = job;
        let result: NcTracksHostResult;
        try {
          const raw = await runRunner(this.config, { protocolVersion: 1, operation: "lookup", job: runnerJob, artifactRoot: this.config.artifactRoot }, controller.signal);
          result = await validateRunnerResult(raw, job, this.config.artifactRoot);
        } catch (error) {
          if (leaseLost || signal?.aborted) throw new HostError("LEASE_OR_HOST_STOPPED");
          const code = error instanceof HostError ? error.code : "EVIDENCE_VALIDATION_FAILED";
          result = { leaseToken: job.leaseToken, status: ["IDENTITY_MISMATCH", "EVIDENCE_REQUIRES_REVIEW"].includes(code) ? "REVIEW_REQUIRED" : "FAILED", coverage: "UNKNOWN", subject: job.subject,
            serviceDateFrom: job.serviceDateFrom, serviceDateTo: job.serviceDateTo, authorizedNpi: job.authorizedNpi,
            provenance: { source: "NOT_OBSERVED", observedAt: new Date().toISOString(), reference: "NOT_OBSERVED" }, code };
        }
        if (leaseLost || signal?.aborted) throw new HostError("LEASE_OR_HOST_STOPPED");
        await this.post(`/api/nctracks/host/jobs/${encodeURIComponent(job.id)}/result`, result, controller.signal);
        return result.status;
      } finally { controller.abort(); signal?.removeEventListener("abort", stop); await heartbeat; }
    } finally { this.active = false; }
  }
  async run(signal: AbortSignal) {
    while (!signal.aborted) {
      try { this.log(await this.runOnce(signal)); }
      catch (error) { this.log(error instanceof HostError ? error.code : "HOST_FAILED"); }
      await pause(this.config.pollIntervalMs!, signal);
    }
  }
}
