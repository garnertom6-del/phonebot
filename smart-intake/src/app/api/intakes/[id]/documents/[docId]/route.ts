import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { fileExists, readFile } from "@/lib/storage";

export const dynamic = "force-dynamic";

// only ever serve document types a client could legitimately upload
const SAFE_MIME = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic", "image/heif",
]);

/** Staff-only download of a client-uploaded document (insurance card, etc.). */
export async function GET(
  _req: Request, { params }: { params: { id: string; docId: string } },
) {
  const { user, provider, deny } = await requireStaff();
  if (deny) return deny;
  const doc = await prisma.uploadedDocument.findFirst({
    where: { id: params.docId, intakeId: params.id, intake: { providerId: provider!.id } },
  });
  if (!doc) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }
  if (!fileExists(doc.filePath)) {
    return NextResponse.json(
      { error: "The file is no longer on the server (it may have been uploaded before permanent storage was turned on). Ask the client to upload it again." },
      { status: 404 },
    );
  }
  const data = readFile(doc.filePath);
  await audit("document_downloaded", {
    providerId: provider!.id,
    intakeId: doc.intakeId,
    userId: user!.id,
    detail: `${doc.docType}: ${doc.fileName}`,
  });
  const mime = SAFE_MIME.has(doc.mimeType) ? doc.mimeType : "application/octet-stream";
  const safeName = doc.fileName.replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": mime,
      "Content-Disposition": `attachment; filename="${safeName}"`,
      "Cache-Control": "no-store",
    },
  });
}
