import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/staffGuard";
import { NcTracksJobError } from "@/lib/ncTracksJobs";
export const privateHeaders = { "Cache-Control": "private, no-store, max-age=0" };
export async function respond(operation: () => Promise<unknown>) {
  try {
    const data = await operation();
    if (data instanceof Response) { data.headers.set("Cache-Control", privateHeaders["Cache-Control"]); return data; }
    return NextResponse.json(data, { headers: privateHeaders });
  } catch (error) {
    return NextResponse.json({ error: error instanceof NcTracksJobError ? error.message : "The lookup request could not be completed. Try again." },
      { status: error instanceof NcTracksJobError ? error.status : 500, headers: privateHeaders });
  }
}
export function providerQuery(req: Request) {
  const providerId = new URL(req.url).searchParams.get("providerId")?.trim();
  if (!providerId || providerId.length > 100) throw new NcTracksJobError("Select a provider workspace.", 400);
  return providerId;
}
export const bearer = (req: Request) => /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.get("authorization") || "")?.[1] || "";
export async function scopedStaff(req: Request, write = false) {
  const context = await requireStaff({ providerId: providerQuery(req), write });
  if (context.deny) return context;
  if (!context.provider) throw new NcTracksJobError("Select a provider workspace.", 400);
  return context;
}
