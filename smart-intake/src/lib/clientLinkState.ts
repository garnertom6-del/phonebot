export const CLIENT_LINK_REMINDER_COOLDOWN_MS = 60_000;

function expiryTimestamp(expiresAt: string | Date): number {
  if (expiresAt instanceof Date) return expiresAt.getTime();
  const text = String(expiresAt).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
  }
  return Date.parse(text);
}

export function clientLinkExpired(expiresAt: string | Date, now = Date.now()): boolean {
  const value = expiryTimestamp(expiresAt);
  return Number.isFinite(value) && value <= now;
}

export function clientLinkExpiryView(expiresAt: string | Date, now = Date.now()): {
  expired: boolean;
  when: string;
  headerLabel: string;
  badgeLabel: string;
} {
  const expired = clientLinkExpired(expiresAt, now);
  const timestamp = expiryTimestamp(expiresAt);
  const when = Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : "Unknown";
  return {
    expired,
    when,
    headerLabel: expired ? `Expired ${when}` : `Expires ${when}`,
    badgeLabel: expired ? "Expired" : "Active",
  };
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
