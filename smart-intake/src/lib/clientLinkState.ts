export const CLIENT_LINK_REMINDER_COOLDOWN_MS = 60_000;

export function clientLinkExpired(expiresAt: string | Date, now = Date.now()): boolean {
  const value = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  return Number.isFinite(value) && value <= now;
}

export function clientLinkMessagingFinished(status: string): boolean {
  return status === "SIGNED" || status === "COMPLETED";
}

export function reminderCooldownSeconds(linkSentAt?: string | Date | null, now = Date.now()): number {
  if (!linkSentAt) return 0;
  const value = linkSentAt instanceof Date ? linkSentAt.getTime() : Date.parse(linkSentAt);
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.ceil((value + CLIENT_LINK_REMINDER_COOLDOWN_MS - now) / 1000));
}
