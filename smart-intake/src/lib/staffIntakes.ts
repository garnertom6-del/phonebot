import type { z } from "zod";
import { appBaseUrl } from "@/lib/baseUrl";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/auditLog";
import { applyOperationalDefaults } from "@/lib/answerDefaults";
import { newIntakeSchema } from "@/lib/validation";
import { newIntakeToken, tokenExpiry, tokenExpiryDays } from "@/lib/tokens";

export type StaffIntakeInput = z.infer<typeof newIntakeSchema>;

export interface StaffIntakeResult {
  id: string;
  clientName: string;
  clientLink: string;
  linkDays: number;
}

export async function createStaffIntake(
  data: StaffIntakeInput,
  userId: string,
  providerId: string,
  req?: Request | { headers?: Headers; nextUrl?: URL; url?: string },
): Promise<StaffIntakeResult> {
  const base = appBaseUrl(req);
  const intake = await prisma.$transaction(async (tx) => {
    const client = await tx.client.create({
      data: {
        providerId,
        fullName: data.fullName,
        dob: data.dob,
        midNumber: data.midNumber,
        recordNumber: data.recordNumber,
        email: data.email || null,
        phone: data.phone || null,
        guardianName: data.guardianName || null,
        guardianEmail: data.guardianEmail || null,
        guardianPhone: data.guardianPhone || null,
      },
    });

    const intake = await tx.intake.create({
      data: {
        providerId,
        clientId: client.id,
        token: newIntakeToken(),
        tokenExpiresAt: tokenExpiry(),
        expectCca: data.expectCca !== false,
        intakeDate: data.intakeDate || new Date().toLocaleDateString("en-US"),
        location: data.location || "Greensboro",
      },
    });

    const prefill: Record<string, unknown> = applyOperationalDefaults({
      client_full_name: data.fullName,
      dob: data.dob,
      mid_number: data.midNumber,
      record_number: data.recordNumber,
      intake_date: intake.intakeDate,
      location: intake.location,
      client_email: data.email,
      client_phone_cell: data.phone,
      guardian_name: data.guardianName,
      guardian_email: data.guardianEmail,
      guardian_phone: data.guardianPhone,
      is_minor_or_incompetent: data.guardianName ? "Yes" : undefined,
    });
    const entries = Object.entries(prefill).filter(([, value]) => value !== undefined && value !== "");
    await Promise.all(entries.map(([key, value]) =>
      tx.intakeAnswer.create({ data: { intakeId: intake.id, key, value: JSON.stringify(value) } })));
    return intake;
  });

  await audit("intake_created", { providerId, intakeId: intake.id, userId, detail: data.fullName });
  return {
    id: intake.id,
    clientName: data.fullName,
    clientLink: `${base}/intake/${intake.token}`,
    linkDays: tokenExpiryDays(),
  };
}
