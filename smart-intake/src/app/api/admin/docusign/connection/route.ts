import { NextRequest, NextResponse } from "next/server";
import { requireMaster } from "@/lib/staffGuard";
import { checkDocuSignConnection, docuSignConnectionConfiguration } from "@/lib/docusign";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const { deny } = await requireMaster();
  if (deny) return deny;
  return NextResponse.json(docuSignConnectionConfiguration(), { headers });
}

export async function POST(request: NextRequest) {
  const { deny } = await requireMaster();
  if (deny) return deny;
  const origin = request.headers.get("origin");
  if (origin) {
    let sameHost = false;
    try {
      const caller = new URL(origin);
      // Render terminates HTTPS before forwarding to Next's internal listener.
      sameHost = ["http:", "https:"].includes(caller.protocol) && caller.host === (request.headers.get("host") || request.nextUrl.host);
    } catch { /* Invalid or opaque origins are not accepted. */ }
    if (!sameHost) return NextResponse.json({ error: "Open this check from Smart Intake." }, { status: 403, headers });
  }
  return NextResponse.json(await checkDocuSignConnection(), { headers });
}
