import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";
import { providerPhone } from "@/lib/providerBranding";
import {
  clientSubmissionFinished,
  lockOpenClientIntake,
} from "@/lib/clientSubmissionState";
import { normalizeIdentityName } from "@/lib/recordIntegrity";

class SignatureClosedError extends Error {}

class DobMismatchError extends Error {}

class SignerIdentityMismatchError extends Error {}

/** Compare dates by digits so 04/12/1987, 1987-04-12 and 4/12/1987 all match. */
function dobMatches(entered: string, onFile: string): boolean {
  const norm = (v: string) => {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
    const [mm, dd, yyyy] = m ? [m[2], m[3], m[1]]
      : (v.trim().split(/[\/\-.]/).length === 3 ? v.trim().split(/[\/\-.]/) : ["", "", ""]);
    if (!yyyy) return v.replace(/\D/g, "");
    return `${String(parseInt(mm, 10)).padStart(2, "0")}${String(parseInt(dd, 10)).padStart(2, "0")}${yyyy}`;
  };
  return !!entered && !!onFile && norm(entered) === norm(onFile);
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const intake = await prisma.intake.findUnique({
    where: { token: params.token },
    include: {
      client: true,
      provider: true,
      signatures: { select: { role: true, invalidatedAt: true } },
    },
  });
  if (!intake || intake.tokenExpiresAt < new Date() || (intake.provider && intake.provider.status !== "ACTIVE")) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  if (clientSubmissionFinished(intake)) {
    return NextResponse.json({
      error: "This signed intake has already been submitted. Contact your provider if a correction is needed.",
    }, { status: 409 });
  }
  const parsed = signatureSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature data" }, { status: 400 });
  const { dobCheck, ...d } = parsed.data;
  if (!["client", "guardian"].includes(d.role)) {
    return NextResponse.json({ error: "Clients may only sign as client or guardian" }, { status: 403 });
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 250) || null;
  try {
    await prisma.$transaction(async (tx) => {
      if (!await lockOpenClientIntake(tx, intake.id)) throw new SignatureClosedError();
      const current = await tx.intake.findUnique({
        where: { id: intake.id },
        include: { client: true },
      });
      if (!current) throw new SignatureClosedError();
      if (!dobCheck) throw new DobMismatchError();
      const dobVerified = dobMatches(dobCheck, current.client.dob);
      if (!dobVerified) throw new DobMismatchError();
      const expectedSignerName = d.role === "client"
        ? current.client.fullName
        : current.client.guardianName || "";
      if (expectedSignerName && normalizeIdentityName(d.printedName) !== normalizeIdentityName(expectedSignerName)) {
        throw new SignerIdentityMismatchError();
      }
      if (d.role === "client" && d.relationship && d.relationship !== "client") {
        throw new SignerIdentityMismatchError();
      }
      if (d.role === "guardian" && (!d.relationship || d.relationship === "client")) {
        throw new SignerIdentityMismatchError();
      }
      await tx.signature.upsert({
        where: { intakeId_role: { intakeId: intake.id, role: d.role } },
        create: {
          intakeId: intake.id,
          ...d,
          dobVerified,
          ip,
          userAgent,
          contentRevision: current.contentRevision,
          subjectNameSnapshot: expectedSignerName || d.printedName,
          subjectDobSnapshot: current.client.dob,
        },
        update: {
          imageData: d.imageData,
          printedName: d.printedName,
          signedDate: d.signedDate,
          relationship: d.relationship,
          dobVerified,
          ip,
          userAgent,
          contentRevision: current.contentRevision,
          subjectNameSnapshot: expectedSignerName || d.printedName,
          subjectDobSnapshot: current.client.dob,
          invalidatedAt: null,
          invalidatedReason: null,
        },
      });
      if (current.status === "SUBMITTED") {
        await tx.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
      }
    });
  } catch (error) {
    if (error instanceof SignatureClosedError) {
      return NextResponse.json({
        error: "This intake was submitted while the signature was being saved. The signed record was not changed.",
      }, { status: 409 });
    }
    if (error instanceof DobMismatchError) {
      return NextResponse.json(
        { error: `That birthday does not match what we have on file. Please check it and try again, or call ${providerPhone(intake.provider?.phone, intake.provider?.name)}.` },
        { status: 400 },
      );
    }
    if (error instanceof SignerIdentityMismatchError) {
      return NextResponse.json({
        code: "SIGNER_IDENTITY_MISMATCH",
        error: "The printed signer name or relationship does not match the current client/guardian record. Ask staff to correct the identity record before signing.",
      }, { status: 409 });
    }
    throw error;
  }
  await audit("signature_captured", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, detail: `${d.role} / ${d.relationship || "client"}`,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
