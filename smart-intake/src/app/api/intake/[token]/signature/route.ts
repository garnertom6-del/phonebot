import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";
import { providerPhone } from "@/lib/providerBranding";
import {
  clientSubmissionFinished,
  lockOpenClientIntake,
} from "@/lib/clientSubmissionState";

class SignatureClosedError extends Error {}

class DobMismatchError extends Error {}

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
      signatures: { select: { role: true } },
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
      // Identity is rechecked after acquiring the write lock so a concurrent
      // staff correction cannot validate a signature against stale details.
      const dobVerified = dobMatches(dobCheck || "", current.client.dob);
      if (dobCheck && !dobVerified) throw new DobMismatchError();
      await tx.signature.upsert({
        where: { intakeId_role: { intakeId: intake.id, role: d.role } },
        create: { intakeId: intake.id, ...d, dobVerified, ip, userAgent },
        update: {
          imageData: d.imageData,
          printedName: d.printedName,
          signedDate: d.signedDate,
          relationship: d.relationship,
          dobVerified,
          ip,
          userAgent,
        },
      });
      if (["SUBMITTED", "NEEDS_REVIEW"].includes(current.status)) {
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
    throw error;
  }
  await audit("signature_captured", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, detail: `${d.role} / ${d.relationship || "client"}`,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  return NextResponse.json({ ok: true });
}
