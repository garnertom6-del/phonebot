"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { formatUsPhoneDisplay } from "@/lib/intakeContacts";
import {
  detectSmsPlatform,
  deviceLikelyOpensSms,
  isUnreachableClientLink,
  smsHref,
  type SmsPlatform,
} from "@/lib/shareLinks";

export type ManualSmsPurpose = "intake" | "signature" | "copies" | "follow-up";

type Props = {
  intakeId: string;
  purpose: ManualSmsPurpose;
  phone: string;
  role?: string;
  message: string;
  link?: string;
  disabled?: boolean;
  compact?: boolean;
  hideRecordSent?: boolean;
  onStatus?: (message: string) => void;
  onRecorded?: () => void;
};

export default function ComputerSmsActions({
  intakeId,
  purpose,
  phone,
  role,
  message,
  link,
  disabled,
  compact,
  hideRecordSent,
  onStatus,
  onRecorded,
}: Props) {
  const [platform, setPlatform] = useState<SmsPlatform>("unknown");
  const [smsCapable, setSmsCapable] = useState(false);
  const [copiedFallback, setCopiedFallback] = useState(false);
  const [copied, setCopied] = useState(false);
  const [markBusy, setMarkBusy] = useState(false);
  const [markedSent, setMarkedSent] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setPlatform(detectSmsPlatform(ua));
    setSmsCapable(deviceLikelyOpensSms(ua));
  }, []);

  const href = useMemo(() => smsHref(phone, message, platform), [phone, message, platform]);
  const displayPhone = formatUsPhoneDisplay(phone);
  const unreachable = !!link && isUnreachableClientLink(link);
  const recipientLabel = role ? `${role} at ${displayPhone}` : displayPhone;
  const btn = compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const canCopy = !disabled && !!message;
  const canMarkSent = !disabled && !!href;

  async function copyMessage(): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onStatus?.("SMS message copied. Paste it on your phone if a texting app did not open.");
      return true;
    } catch {
      onStatus?.("Could not copy the SMS message. Select the preview and copy it yourself.");
      return false;
    }
  }

  async function openSms(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (disabled || !href) return;
    await copyMessage();
    setCopiedFallback(true);
    if (unreachable) {
      onStatus?.("This link only works on this computer. Do not text it to a client.");
      return;
    }
    if (!smsCapable) {
      onStatus?.("This computer has no texting app. The SMS is copied — paste it on your phone.");
      return;
    }
    window.location.href = href;
  }

  async function markSent() {
    setMarkBusy(true);
    try {
      const res = await fetch(`/api/intakes/${intakeId}/manual-delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose, channel: "sms" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        onStatus?.(body.error || "Could not record that the SMS was sent.");
        return;
      }
      setMarkedSent(true);
      onStatus?.(body.message || `Recorded SMS from this computer to ${recipientLabel}.`);
      onRecorded?.();
    } catch {
      onStatus?.("Could not record that the SMS was sent.");
    } finally {
      setMarkBusy(false);
    }
  }

  return (
    <div className="space-y-2" data-testid="computer-sms-actions">
      {unreachable && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="status">
          This link only works on this computer. Do not text it to a client.
        </p>
      )}
      <p className={`${compact ? "text-xs" : "text-sm"} text-slate-600`}>
        Opens your phone&apos;s Messages app and sends from <b>your</b> number, not the clinic number.
        Recipient: <b>{recipientLabel}</b>.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          className={`${smsCapable && !unreachable ? "btn-ghost" : "btn-primary"} ${btn}`}
          type="button"
          disabled={!canCopy}
          onClick={() => { void copyMessage(); }}
        >
          {copied ? "SMS copied" : "Copy SMS message"}
        </button>
        {href && (
          <a
            className={`${smsCapable && !unreachable ? "btn-primary" : "btn-ghost"} ${btn} ${disabled ? "pointer-events-none opacity-50" : ""}`}
            href={href}
            aria-disabled={disabled}
            data-testid="computer-sms-open"
            onClick={(event) => { void openSms(event); }}
          >
            Open SMS to {displayPhone}
          </a>
        )}
        {!hideRecordSent && (
        <button
          className={`btn-ghost ${btn}`}
          type="button"
          disabled={!canMarkSent || markBusy || markedSent}
          onClick={() => { void markSent(); }}
        >
          {markedSent ? "Marked as sent" : markBusy ? "Saving..." : "I sent this SMS"}
        </button>
        )}
      </div>
      {copiedFallback && !smsCapable && (
        <p className={`${compact ? "text-xs" : "text-sm"} text-slate-600`}>
          If a texting app did not open, paste the copied message on your phone.
        </p>
      )}
    </div>
  );
}
