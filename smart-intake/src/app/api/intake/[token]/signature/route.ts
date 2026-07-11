import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { signatureSchema } from "@/lib/validation";
import { providerPhone } from "@/lib/providerBranding";

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
    include: { client: true, provider: true },
  });
  if (!intake || intake.tokenExpiresAt < new Date() || (intake.provider && intake.provider.status !== "ACTIVE")) {
    return NextResponse.json({ error: "Link not valid" }, { status: 404 });
  }
  const parsed = signatureSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid signature data" }, { status: 400 });
  const { dobCheck, ...d } = parsed.data;
  if (!["client", "guardian"].includes(d.role)) {
    return NextResponse.json({ error: "Clients may only sign as client or guardian" }, { status: 403 });
  }
  // identity check: the signer must know the client's date of birth
  const dobVerified = dobMatches(dobCheck || "", intake.client.dob);
  if (dobCheck && !dobVerified) {
    return NextResponse.json(
      { error: `That birthday does not match what we have on file. Please check it and try again, or call ${providerPhone(intake.provider?.phone, intake.provider?.name)}.` },
      { status: 400 },
    );
  }
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const userAgent = req.headers.get("user-agent")?.slice(0, 250) || null;
  await prisma.signature.upsert({
    where: { intakeId_role: { intakeId: intake.id, role: d.role } },
    create: { intakeId: intake.id, ...d, dobVerified, ip, userAgent },
    update: { imageData: d.imageData, printedName: d.printedName, signedDate: d.signedDate, relationship: d.relationship, dobVerified, ip, userAgent },
  });
  await audit("signature_captured", {
    providerId: intake.providerId || undefined,
    intakeId: intake.id, detail: `${d.role} / ${d.relationship || "client"}`,
    ip: req.headers.get("x-forwarded-for") ?? undefined,
  });
  // a client/guardian signature moves the intake to SIGNED once submitted
  if (["SUBMITTED", "NEEDS_REVIEW"].includes(intake.status)) {
    await prisma.intake.update({ where: { id: intake.id }, data: { status: "SIGNED" } });
  }
  return NextResponse.json({ ok: true });
}
