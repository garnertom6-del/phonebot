export interface ClientDetailsInput {
  fullName: string;
  dob: string;
  midNumber: string;
  recordNumber: string;
  email?: string;
  phone: string;
  guardianName: string;
  guardianEmail?: string;
  guardianPhone: string;
}

export function clientDetailsAnswerPatch(details: ClientDetailsInput) {
  return {
    client_full_name: details.fullName,
    dob: details.dob,
    mid_number: details.midNumber,
    record_number: details.recordNumber,
    client_email: details.email || "",
    client_phone_cell: details.phone,
    client_phone_home: details.phone,
    guardian_name: details.guardianName,
    guardian_email: details.guardianEmail || "",
    guardian_phone: details.guardianPhone,
  };
}

export function clientDetailsRecordPatch(details: ClientDetailsInput) {
  return {
    fullName: details.fullName,
    dob: details.dob,
    midNumber: details.midNumber || null,
    recordNumber: details.recordNumber,
    email: details.email || null,
    phone: details.phone || null,
    guardianName: details.guardianName || null,
    guardianEmail: details.guardianEmail || null,
    guardianPhone: details.guardianPhone || null,
  };
}
