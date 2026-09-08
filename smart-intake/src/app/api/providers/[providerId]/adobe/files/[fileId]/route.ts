import { NextRequest, NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { readPreparationFile } from "@/lib/adobePreparation";
import { adobeErrorResponse } from "@/lib/adobePreparationResponse";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest, props: { params: Promise<{ providerId: string; fileId: string }> }) {
  const { providerId, fileId } = await props.params;
  const { user, deny } = await requireStaff({ providerId }); if (deny) return deny;
  try {
    const { file, bytes } = await readPreparationFile({ providerId, userId: user!.id }, fileId);
    // Reports/Office outputs are attachments; never render returned HTML in the application origin.
    const workingCopy = req.nextUrl.searchParams.get("workingCopy") === "1";
    const inline = !workingCopy && req.nextUrl.searchParams.get("download") !== "1" && file.mimeType === "application/pdf";
    const name = workingCopy ? file.name.replace(/\.pdf$/i, "-acrobat-working-copy.pdf") : file.name;
    return new NextResponse(new Uint8Array(bytes), { headers: { "Content-Type": file.mimeType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^a-zA-Z0-9._ -]/g, "-")}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": inline ? "sandbox" : "sandbox allow-downloads" } });
  } catch (error) { return adobeErrorResponse(error); }
}
