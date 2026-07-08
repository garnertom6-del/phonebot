import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireStaff } from "@/lib/staffGuard";
import { audit } from "@/lib/auditLog";
import { loadAnswers, saveAnswers, syncStructuredRows } from "@/lib/intakeData";
import { applyOperationalDefaults } from "@/lib/answerDefaults";

const FIELD_KEYS = new Set([
  "record_number", "mid_number", "pcp_name", "pcp_phone", "pcp_address",
  "preferred_emergency_facility", "height", "weight", "hair_color", "eye_color",
  "ec1_name", "ec1_cell_phone", "ec1_street", "ec1_city", "ec1_state",
  "staff_receiving_intake", "qp_referred_to", "clinician_name", "c_clinician",
  "c_practice", "c_secure_fax", "c_secure_email", "c_agency_secure_fax",
  "referral_source", "social_agency_name", "services_other",
]);

const NOTE_LABELS: Array<[RegExp, string]> = [
  [/^mid(?:#| number)?$/i, "mid_number"],
  [/^record(?:#| number)?$/i, "record_number"],
  [/^pcp(?: name| doctor)?$/i, "pcp_name"],
  [/^pcp phone$/i, "pcp_phone"],
  [/^pcp address$/i, "pcp_address"],
  [/^(hospital|emergency facility|local hospital)$/i, "preferred_emergency_facility"],
  [/^height$/i, "height"],
  [/^weight$/i, "weight"],
  [/^hair(?: color)?$/i, "hair_color"],
  [/^eye(?: color)?$/i, "eye_color"],
  [/^(emergency contact|ec1 name)$/i, "ec1_name"],
  [/^(emergency phone|ec1 phone|ec1 cell)$/i, "ec1_cell_phone"],
  [/^staff$/i, "staff_receiving_intake"],
  [/^qp$/i, "qp_referred_to"],
  [/^clinician$/i, "clinician_name"],
];

function clean(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function parseHelperNotes(notes: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of notes.split(/\r?\n/)) {
    const m = /^\s*([^:=-]{2,40})\s*[:=-]\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const label = m[1].trim();
    const value = m[2].trim();
    for (const [re, key] of NOTE_LABELS) {
      if (re.test(label)) {
        out[key] = value;
        break;
      }
    }
  }
  return out;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { user, deny } = await requireStaff();
  if (deny) return deny;
  const intake = await prisma.intake.findUnique({ where: { id: params.id }, include: { client: true } });
  if (!intake) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json();
  const incoming = body.fields && typeof body.fields === "object" ? body.fields as Record<string, unknown> : {};
  const helperNotes = clean(body.helperNotes);
  const parsedNotes = parseHelperNotes(helperNotes);
  const current = await loadAnswers(intake.id);
  const next = { ...current };

  for (const [key, value] of Object.entries({ ...parsedNotes, ...incoming })) {
    if (!FIELD_KEYS.has(key)) continue;
    const text = clean(value);
    if (text) next[key] = text;
  }
  if (helperNotes) next.staff_helper_notes = helperNotes;

  const defaults = applyOperationalDefaults(next);
  await saveAnswers(intake.id, defaults);
  await syncStructuredRows(intake.id, defaults);
  await prisma.client.update({
    where: { id: intake.clientId },
    data: {
      midNumber: clean(defaults.mid_number) || intake.client.midNumber,
      recordNumber: clean(defaults.record_number) || intake.client.recordNumber,
      phone: clean(defaults.client_phone_cell) || intake.client.phone,
    },
  });
  await audit("answers_updated", {
    intakeId: intake.id,
    userId: user!.id,
    detail: "NC Tracks / helper info applied",
  });
  return NextResponse.json({ ok: true });
}

