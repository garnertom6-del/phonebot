export const INTAKE_ORIENTATION_AUDIO_URL =
  process.env.NEXT_PUBLIC_INTAKE_ORIENTATION_AUDIO_URL?.trim() || "";

export const INTAKE_ORIENTATION_SUMMARY =
  "This short explanation covers your rights, privacy, consent, the intake sections, signatures, and the kinds of services your care team may discuss with you. Tap the Read more tab in each section to see more details before you continue.";

export function intakeOrientationAudioLine(): string {
  if (!INTAKE_ORIENTATION_AUDIO_URL) return "";
  return ` Optional: listen to our intake explanation before or after completing the secure form: ${INTAKE_ORIENTATION_AUDIO_URL}`;
}
