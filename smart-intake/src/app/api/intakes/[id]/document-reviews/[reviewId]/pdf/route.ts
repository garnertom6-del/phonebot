import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireStaffForIntake } from "@/lib/staffGuard";
import { prisma } from "@/lib/prisma";
import { readFile, fileExists } from "@/lib/storage";
import { audit } from "@/lib/auditLog";

export async function GET(req: NextRequest, props: { params: Promise<{ id: string; reviewId: string }> }) {
  const { id, reviewId } = await props.params;
  const { user, provider, deny } = await requireStaffForIntake(id);
  if (deny) return deny;
  const review = await prisma.documentReview.findFirst({ where: { id: reviewId, intakeId: id, intake: { providerId: provider!.id } } });
  if (!review || !fileExists(review.filePath)) return NextResponse.json({ error: "This review file is unavailable." }, { status: 404 });
  const bytes = readFile(review.filePath);
  if (createHash("sha256").update(bytes).digest("hex") !== review.sha256) return NextResponse.json({ error: "The review file no longer matches its saved fingerprint. Create a new review copy." }, { status: 409 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  await audit(download ? "document_review_downloaded" : "document_review_viewed", { providerId: provider!.id, intakeId: id, userId: user!.id, detail: JSON.stringify({ reviewId }) });
  return new NextResponse(new Uint8Array(bytes), { headers: {
    "Content-Type": "application/pdf", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${review.source === "DRAFT" ? "DRAFT" : "REVIEW"}-${review.id}.pdf"`,
    "X-Smart-Intake-Document-State": review.source === "DRAFT" ? "DRAFT_PREVIEW" : "REVIEW_COPY",
  } });
}
