import { createHash, randomBytes } from "node:crypto";
import type { NcTracksJob, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "./prisma";
import { eligibilityIdentityFingerprint } from "./eligibilityIdentity";
import { normalizeDateInput } from "./normalizeDateInput";
import { validNpi } from "./npi";
import { NCTRACKS_PROVIDER } from "./ncTracksProvider";
import type { NcTracksContext, NcTracksHostJob, NcTracksHostResult, NcTracksJobView, NcTracksSubject } from "./ncTracksJobTypes";

const LEASE_MS = 5 * 60_000;
const ONLINE_MS = 90_000;
const ACTIVE = ["QUEUED", "WAITING_FOR_HOST", "RUNNING", "NOT_CONFIGURED"];
const RETRYABLE = ["NOT_CONFIGURED", "ACTION_REQUIRED", "REVIEW_REQUIRED", "NO_MATCH", "FAILED", "CANCELLED"];
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const normalizedName = (value: string) => value.trim().replace(/\s+/g, " ").toUpperCase();
const normalizedMid = (value: string | null) => value?.replace(/\s+/g, "").toUpperCase() || null;
const lookupKey = (intakeId: string, subject: NcTracksSubject, npi: string, from: string, to: string) => digest(JSON.stringify([
  intakeId, normalizedName(subject.firstName), normalizedName(subject.lastName), subject.dob, normalizedMid(subject.midNumber), npi, from, to,
]));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => normalizeDateInput(value) === value, "Enter a valid calendar date.");
export class NcTracksJobError extends Error { constructor(message: string, public status = 409) { super(message); } }
const requestSchema = z.object({
  intakeId: z.string().min(1).max(100), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  dob: isoDate, serviceDateFrom: isoDate, serviceDateTo: isoDate,
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,100}$/),
}).strict().refine((value) => value.serviceDateFrom <= value.serviceDateTo, "Service end must not precede service start.");
const subjectSchema = z.object({ firstName: z.string().max(100), lastName: z.string().max(100), dob: isoDate, midNumber: z.string().max(100).nullable() }).strict();
const sourceText = z.string().trim().min(1).max(500).refine((value) => !/^(?:file:|[a-z]:[\\/]|\\\\)/i.test(value), "Local paths are not accepted.");
const resultSchema = z.object({
  leaseToken: z.string().min(30).max(150), status: z.enum(["VERIFIED_LOCAL", "NO_MATCH", "ACTION_REQUIRED", "REVIEW_REQUIRED", "FAILED"]),
  coverage: z.enum(["ACTIVE", "INACTIVE", "UNKNOWN", "CONFLICT"]), subject: subjectSchema,
  serviceDateFrom: isoDate, serviceDateTo: isoDate, authorizedNpi: z.string().regex(/^\d{10}$/),
  provenance: z.object({ source: z.enum(["NCTRACKS_PORTAL", "NOT_OBSERVED"]), observedAt: z.string().datetime(), reference: z.string().min(1).max(120).regex(/^[A-Za-z0-9 _.:#-]+$/) }).strict(),
  actualInquiryFrom: isoDate.optional(), actualInquiryTo: isoDate.optional(), selectedCoveragePeriod: sourceText.optional(),
  sourceCarrierText: sourceText.optional(), sourceProviderText: sourceText.optional(), sourceFacilityText: sourceText.optional(), sourcePhoneText: sourceText.optional(), sourceCountyText: sourceText.optional(),
  artifactSha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(), code: z.string().regex(/^[A-Z0-9_]{1,80}$/).optional(),
}).strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new NcTracksJobError(parsed.error.issues[0]?.message || "Invalid request.", 400);
  return parsed.data;
}
export function ncTracksJobView(job: NcTracksJob): NcTracksJobView {
  return { id: job.id, intakeId: job.intakeId, status: job.status as NcTracksJobView["status"], coverage: job.coverage as NcTracksJobView["coverage"],
    subject: JSON.parse(job.subjectJson), serviceDateFrom: job.serviceDateFrom, serviceDateTo: job.serviceDateTo,
    createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), attempt: job.attempt, code: job.code,
    result: job.resultJson ? JSON.parse(job.resultJson) : null };
}
async function lockProvider(tx: Prisma.TransactionClient, providerId: string) {
  await tx.$executeRaw`UPDATE "Provider" SET "id" = "id" WHERE "id" = ${providerId}`;
  const provider = await tx.provider.findUnique({ where: { id: providerId } });
  if (!provider || provider.status !== "ACTIVE") throw new NcTracksJobError("Provider is unavailable.", 403);
}
async function settings(db: Prisma.TransactionClient | typeof prisma, providerId: string) {
  const [configuration, host] = await Promise.all([
    db.ncTracksConfiguration.findUnique({ where: { providerId } }), db.ncTracksHost.findUnique({ where: { providerId } }),
  ]);
  const hostLive = !!host && !host.revokedAt && host.expiresAt.getTime() > Date.now();
  const configured = configuration?.authorizedNpi === NCTRACKS_PROVIDER.npi && hostLive && !!host?.adapterReady;
  const online = configured && !!host?.lastSeenAt && host.lastSeenAt.getTime() > Date.now() - ONLINE_MS;
  return { configuration, host, configured, online, status: !configured ? "NOT_CONFIGURED" : online ? "QUEUED" : "WAITING_FOR_HOST" };
}
async function auditJob(tx: Prisma.TransactionClient, job: { providerId: string; intakeId?: string; id?: string }, event: string, userId?: string) {
  await tx.auditLog.create({ data: { providerId: job.providerId, intakeId: job.intakeId, userId, event, detail: job.id ? `job:${job.id}` : "NCTracks host configuration" } });
}
async function identityCurrent(tx: Prisma.TransactionClient, job: NcTracksJob) {
  const intake = await tx.intake.findFirst({ where: { id: job.intakeId, providerId: job.providerId, archived: false }, include: { client: true } });
  return !!intake && eligibilityIdentityFingerprint(intake.client) === job.identityFingerprint;
}
export async function ncTracksContext(providerId: string, canManage: boolean): Promise<NcTracksContext> {
  const [config, intakes, jobs] = await Promise.all([settings(prisma, providerId),
    prisma.intake.findMany({ where: { providerId, archived: false }, orderBy: { createdAt: "desc" }, take: 150, include: { client: true } }),
    prisma.ncTracksJob.findMany({ where: { providerId }, orderBy: { createdAt: "desc" }, take: 100 }),
  ]);
  return { providerId, configuration: { authorizedNpi: config.configuration?.authorizedNpi || null, configured: config.configured, hostOnline: config.online, canManage,
    reason: !config.configuration?.authorizedNpi ? "A provider admin must configure the authorized NPI." : !config.configured ? "A provider admin must connect a host with its local adapter ready." : !config.online ? "The home host is offline. Requests will wait safely." : "The home host is available." },
    intakes: intakes.map((item) => ({ id: item.id, fullName: item.client.fullName, dob: normalizeDateInput(item.client.dob) || item.client.dob, midNumber: item.client.midNumber })), jobs: jobs.map(ncTracksJobView) };
}
export async function requestNcTracksJob(providerId: string, userId: string, body: unknown) {
  const input = parse(requestSchema, body);
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, providerId);
    const intake = await tx.intake.findFirst({ where: { id: input.intakeId, providerId, archived: false }, include: { client: true } });
    if (!intake) throw new NcTracksJobError("Intake not found.", 404);
    if (normalizedName(`${input.firstName} ${input.lastName}`) !== normalizedName(intake.client.fullName) || normalizeDateInput(intake.client.dob) !== input.dob) {
      throw new NcTracksJobError("Entered first/last name and birthday must match the saved client identity. Correct the intake first if needed.");
    }
    const config = await settings(tx, providerId);
    const subject: NcTracksSubject = { firstName: input.firstName, lastName: input.lastName, dob: input.dob, midNumber: normalizedMid(intake.client.midNumber) };
    if (subject.midNumber && !/^[A-Z0-9-]{1,40}$/.test(subject.midNumber)) throw new NcTracksJobError("Correct the saved MID format before requesting a lookup.", 400);
    const npi = config.configuration?.authorizedNpi || "";
    const dedupKey = lookupKey(intake.id, subject, npi, input.serviceDateFrom, input.serviceDateTo);
    const previous = await tx.ncTracksJob.findUnique({ where: { providerId_idempotencyKey: { providerId, idempotencyKey: input.idempotencyKey } } });
    if (previous) {
      if (previous.dedupKey !== dedupKey) throw new NcTracksJobError("This request key was used for different details.");
      return ncTracksJobView(previous);
    }
    const active = await tx.ncTracksJob.findFirst({ where: { providerId, dedupKey, status: { in: ACTIVE } } });
    if (active) return ncTracksJobView(active);
    const job = await tx.ncTracksJob.create({ data: { providerId, intakeId: intake.id, requestedByUserId: userId, idempotencyKey: input.idempotencyKey, dedupKey,
      identityFingerprint: eligibilityIdentityFingerprint(intake.client), subjectJson: JSON.stringify(subject), authorizedNpi: npi,
      serviceDateFrom: input.serviceDateFrom, serviceDateTo: input.serviceDateTo, status: config.status } });
    await auditJob(tx, job, "nctracks_job_requested", userId);
    return ncTracksJobView(job);
  });
}
export async function changeNcTracksJob(providerId: string, userId: string, id: string, action: "cancel" | "retry") {
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, providerId);
    const job = await tx.ncTracksJob.findFirst({ where: { id, providerId } });
    if (!job) throw new NcTracksJobError("Job not found.", 404);
    if (action === "cancel") {
      if (["VERIFIED_LOCAL", "NO_MATCH", "CANCELLED"].includes(job.status)) throw new NcTracksJobError("This job can no longer be cancelled.");
      const updated = await tx.ncTracksJob.update({ where: { id }, data: { status: "CANCELLED", code: "CANCELLED_BY_STAFF", leaseHash: null, leaseExpiresAt: null } });
      await auditJob(tx, job, "nctracks_job_cancelled", userId); return ncTracksJobView(updated);
    }
    if (!RETRYABLE.includes(job.status)) throw new NcTracksJobError("This job cannot be retried in its current state.");
    if (!(await identityCurrent(tx, job))) throw new NcTracksJobError("Client identity changed. Create a new request after reviewing the current identity.");
    const config = await settings(tx, providerId);
    const npi = config.configuration?.authorizedNpi || "";
    const dedupKey = lookupKey(job.intakeId, JSON.parse(job.subjectJson), npi, job.serviceDateFrom, job.serviceDateTo);
    const active = await tx.ncTracksJob.findFirst({ where: { providerId, dedupKey, id: { not: id }, status: { in: ACTIVE } } });
    if (active) return ncTracksJobView(active);
    const updated = await tx.ncTracksJob.update({ where: { id }, data: { status: config.status, authorizedNpi: npi, dedupKey, coverage: "UNKNOWN", resultJson: null, code: null, hostId: null, leaseHash: null, leaseExpiresAt: null } });
    await auditJob(tx, job, "nctracks_job_retried", userId); return ncTracksJobView(updated);
  });
}
export async function ncTracksConfiguration(providerId: string) {
  const config = await settings(prisma, providerId);
  return { authorizedNpi: config.configuration?.authorizedNpi || null, host: config.host ? { id: config.host.id, name: config.host.name,
    lastSeenAt: config.host.lastSeenAt?.toISOString() || null, revokedAt: config.host.revokedAt?.toISOString() || null,
    expiresAt: config.host.expiresAt.toISOString(), adapterReady: config.host.adapterReady } : null };
}
export async function configureNcTracks(providerId: string, userId: string, raw: unknown) {
  const input = parse(z.discriminatedUnion("action", [
    z.object({ action: z.literal("configure"), authorizedNpi: z.string().refine((value) => validNpi(value) && value === NCTRACKS_PROVIDER.npi, "NCTracks lookups must use WELLIANCE CARE INC — NPI 1134943608.") }).strict(),
    z.object({ action: z.literal("provision_host"), hostName: z.string().trim().min(1).max(80) }).strict(),
    z.object({ action: z.literal("revoke_host") }).strict(),
  ]), raw);
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, providerId);
    if (input.action === "configure") {
      await tx.ncTracksJob.updateMany({ where: { providerId, status: { in: ACTIVE }, authorizedNpi: { not: input.authorizedNpi } }, data: { status: "REVIEW_REQUIRED", code: "AUTHORIZED_NPI_CHANGED", leaseHash: null, leaseExpiresAt: null } });
      await tx.ncTracksConfiguration.upsert({ where: { providerId }, create: { providerId, authorizedNpi: input.authorizedNpi }, update: { authorizedNpi: input.authorizedNpi } });
      await auditJob(tx, { providerId }, "nctracks_host_configured", userId); return { ok: true };
    }
    await tx.ncTracksJob.updateMany({ where: { providerId, status: "RUNNING" }, data: { status: "CANCELLED", code: "HOST_CREDENTIAL_REVOKED", leaseHash: null, leaseExpiresAt: null } });
    if (input.action === "revoke_host") {
      await tx.ncTracksHost.updateMany({ where: { providerId }, data: { revokedAt: new Date(), adapterReady: false } });
      await auditJob(tx, { providerId }, "nctracks_host_revoked", userId); return { ok: true };
    }
    const hostToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + 30 * 86_400_000);
    const host = await tx.ncTracksHost.upsert({ where: { providerId },
      create: { providerId, name: input.hostName, credentialHash: digest(hostToken), expiresAt },
      update: { name: input.hostName, credentialHash: digest(hostToken), expiresAt, revokedAt: null, adapterReady: false, lastSeenAt: null } });
    await auditJob(tx, { providerId }, "nctracks_host_provisioned", userId);
    return { hostId: host.id, hostToken, expiresAt: expiresAt.toISOString() };
  });
}
export async function withNcTracksHost<T>(bearer: string, operation: (tx: Prisma.TransactionClient, host: NonNullable<Awaited<ReturnType<typeof prisma.ncTracksHost.findUnique>>>) => Promise<T>): Promise<T> {
  if (!/^[A-Za-z0-9_-]{40,150}$/.test(bearer)) throw new NcTracksJobError("Host authentication required.", 401);
  const hash = digest(bearer);
  const known = await prisma.ncTracksHost.findUnique({ where: { credentialHash: hash } });
  if (!known) throw new NcTracksJobError("Host authentication required.", 401);
  return prisma.$transaction(async (tx) => {
    await lockProvider(tx, known.providerId);
    const host = await tx.ncTracksHost.findUnique({ where: { id: known.id } });
    if (!host || host.credentialHash !== hash || host.revokedAt || host.expiresAt.getTime() <= Date.now()) throw new NcTracksJobError("Host credential expired or revoked.", 401);
    return operation(tx, host);
  });
}
async function liveLease(tx: Prisma.TransactionClient, hostId: string, providerId: string, id: string, token: string) {
  const job = await tx.ncTracksJob.findFirst({ where: { id, providerId, hostId, status: "RUNNING", leaseHash: digest(token), leaseExpiresAt: { gt: new Date() } } });
  if (!job) throw new NcTracksJobError("Lease expired, cancelled, or replaced.");
  return job;
}
export async function heartbeatNcTracks(bearer: string, body: unknown) {
  const input = parse(z.object({ adapterReady: z.boolean(), jobId: z.string().optional(), leaseToken: z.string().min(30).max(150).optional() }).strict()
    .refine((value) => !!value.jobId === !!value.leaseToken, "A job lease requires both jobId and leaseToken."), body);
  return withNcTracksHost(bearer, async (tx, host) => {
    if (input.jobId && input.leaseToken) {
      const job = await liveLease(tx, host.id, host.providerId, input.jobId, input.leaseToken);
      const config = await tx.ncTracksConfiguration.findUnique({ where: { providerId: host.providerId } });
      if (!(await identityCurrent(tx, job)) || config?.authorizedNpi !== job.authorizedNpi) throw new NcTracksJobError("Identity or authorized provider configuration changed. Stop the local lookup.");
      await tx.ncTracksJob.update({ where: { id: job.id }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } });
    }
    await tx.ncTracksHost.update({ where: { id: host.id }, data: { lastSeenAt: new Date(), adapterReady: input.adapterReady } });
    return { ok: true };
  });
}
export async function claimNcTracks(bearer: string): Promise<{ job: NcTracksHostJob | null }> {
  return withNcTracksHost(bearer, async (tx, host) => {
    const config = await settings(tx, host.providerId);
    if (!config.configured || !host.adapterReady) return { job: null };
    await tx.ncTracksJob.updateMany({ where: { providerId: host.providerId, status: "RUNNING", attempt: { gte: 3 }, leaseExpiresAt: { lte: new Date() } }, data: { status: "ACTION_REQUIRED", code: "HOST_RETRY_LIMIT", leaseHash: null, leaseExpiresAt: null } });
    await tx.ncTracksJob.updateMany({ where: { providerId: host.providerId, status: "RUNNING", leaseExpiresAt: { lte: new Date() } }, data: { status: "WAITING_FOR_HOST", code: "LEASE_EXPIRED", leaseHash: null, leaseExpiresAt: null } });
    if (await tx.ncTracksJob.findFirst({ where: { hostId: host.id, status: "RUNNING" } })) return { job: null };
    const job = await tx.ncTracksJob.findFirst({ where: { providerId: host.providerId, status: { in: ["QUEUED", "WAITING_FOR_HOST"] } }, orderBy: { createdAt: "asc" } });
    if (!job) return { job: null };
    if (!(await identityCurrent(tx, job)) || job.authorizedNpi !== config.configuration?.authorizedNpi) {
      await tx.ncTracksJob.update({ where: { id: job.id }, data: { status: "REVIEW_REQUIRED", code: "IDENTITY_OR_CONFIGURATION_CHANGED" } }); return { job: null };
    }
    const leaseToken = randomBytes(32).toString("base64url");
    const leaseExpiresAt = new Date(Date.now() + LEASE_MS);
    const leased = await tx.ncTracksJob.update({ where: { id: job.id }, data: { status: "RUNNING", hostId: host.id, leaseHash: digest(leaseToken), leaseStartedAt: new Date(), leaseExpiresAt, attempt: { increment: 1 }, code: null } });
    await auditJob(tx, job, "nctracks_job_claimed");
    return { job: { id: job.id, leaseToken, leaseExpiresAt: leaseExpiresAt.toISOString(), attempt: leased.attempt,
      subject: JSON.parse(job.subjectJson), authorizedNpi: job.authorizedNpi, serviceDateFrom: job.serviceDateFrom, serviceDateTo: job.serviceDateTo } };
  });
}
export async function resultNcTracks(bearer: string, id: string, body: unknown) {
  const input = parse(resultSchema, body);
  return withNcTracksHost(bearer, async (tx, host) => {
    const job = await liveLease(tx, host.id, host.providerId, id, input.leaseToken);
    const config = await tx.ncTracksConfiguration.findUnique({ where: { providerId: host.providerId } });
    const observedAt = Date.parse(input.provenance.observedAt);
    const subject = JSON.parse(job.subjectJson) as NcTracksSubject;
    const matches = normalizedName(input.subject.firstName) === normalizedName(subject.firstName) && normalizedName(input.subject.lastName) === normalizedName(subject.lastName)
      && input.subject.dob === subject.dob && (!subject.midNumber || normalizedMid(input.subject.midNumber) === normalizedMid(subject.midNumber));
    if (!matches || !(await identityCurrent(tx, job)) || config?.authorizedNpi !== job.authorizedNpi
      || input.authorizedNpi !== job.authorizedNpi || input.serviceDateFrom !== job.serviceDateFrom || input.serviceDateTo !== job.serviceDateTo
      || observedAt > Date.now() + 30_000 || observedAt < (job.leaseStartedAt?.getTime() || 0) - 5_000) {
      const rejected = await tx.ncTracksJob.update({ where: { id }, data: { status: "REVIEW_REQUIRED", coverage: "CONFLICT", code: "RESULT_IDENTITY_OR_PROVENANCE_MISMATCH", leaseHash: null, leaseExpiresAt: null } });
      await auditJob(tx, job, "nctracks_result_rejected"); return ncTracksJobView(rejected);
    }
    if (input.status === "VERIFIED_LOCAL" && (!normalizedMid(input.subject.midNumber) || !input.artifactSha256 || !input.actualInquiryFrom || !input.actualInquiryTo || !input.selectedCoveragePeriod || !["ACTIVE", "INACTIVE"].includes(input.coverage) || input.provenance.source !== "NCTRACKS_PORTAL" || input.provenance.reference === "NOT_OBSERVED")) throw new NcTracksJobError("Verified results require matching portal identity including MID, inquiry dates, coverage period, known coverage, and an artifact hash.", 400);
    if ((input.actualInquiryFrom && !input.actualInquiryTo) || (!input.actualInquiryFrom && input.actualInquiryTo) || (input.actualInquiryFrom && input.actualInquiryTo && input.actualInquiryFrom > input.actualInquiryTo)) throw new NcTracksJobError("Actual inquiry dates require a valid from/to pair.", 400);
    if (input.status === "NO_MATCH" && (input.coverage !== "UNKNOWN" || input.provenance.source !== "NCTRACKS_PORTAL" || input.provenance.reference === "NOT_OBSERVED")) throw new NcTracksJobError("No match requires an actual portal no-match observation.", 400);
    if (!["VERIFIED_LOCAL", "NO_MATCH"].includes(input.status) && !["UNKNOWN", "CONFLICT"].includes(input.coverage)) throw new NcTracksJobError("Unverified results cannot claim active or inactive coverage.", 400);
    const { leaseToken: _secret, ...result } = input;
    const updated = await tx.ncTracksJob.update({ where: { id }, data: { status: input.status, coverage: input.coverage, code: input.code || null, resultJson: JSON.stringify(result), leaseHash: null, leaseExpiresAt: null } });
    await auditJob(tx, job, "nctracks_job_result_received");
    return ncTracksJobView(updated);
  });
}
