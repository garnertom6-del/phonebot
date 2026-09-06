import { NextResponse } from "next/server";
import { z } from "zod";
import { requireStaff } from "@/lib/staffGuard";
import { prisma } from "@/lib/prisma";
import { normalizeDateInput } from "@/lib/normalizeDateInput";

const inputSchema = z.object({ providerId: z.string().trim().min(1).max(100), query: z.string().trim().min(2).max(120) }).strict();
const headers = { "Cache-Control": "private, no-store, max-age=0" };

/** Names stay in the request body, never browser history or query-string logs. */
export async function POST(request: Request) {
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter at least two characters of the client name or record number." }, { status: 400, headers });
  const { provider, deny } = await requireStaff({ providerId: parsed.data.providerId });
  if (deny) { deny.headers.set("Cache-Control", "private, no-store, max-age=0"); return deny; }
  const matches = await prisma.intake.findMany({
    where: { providerId: provider!.id, archived: false, client: { OR: [{ fullName: { contains: parsed.data.query } }, { recordNumber: { contains: parsed.data.query } }] } },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: 51,
    select: { id: true, client: { select: { fullName: true, dob: true, midNumber: true } } },
  });
  return NextResponse.json({
    intakes: matches.slice(0, 50).map(({ id, client }) => ({ id, fullName: client.fullName, dob: normalizeDateInput(client.dob) || client.dob, midNumber: client.midNumber })),
    hasMore: matches.length > 50,
  }, { headers });
}
