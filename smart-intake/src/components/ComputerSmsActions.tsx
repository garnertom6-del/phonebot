"use client";

import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { formatUsPhoneDisplay } from "@/lib/intakeContacts";
import PhoneSmsHandoff from "@/components/PhoneSmsHandoff";
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
  const [confirmedSent, setConfirmedSent] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent || "";
    setPlatform(detectSmsPlatform(ua));
    setSmsCapable(deviceLikelyOpensSms(ua));
  }, []);

  useEffect(() => {
    setConfirmedSent(false);
    setMarkedSent(false);
    setCopied(false);
  }, [intakeId, purpose, phone, message, link]);

  const href = useMemo(() => smsHref(phone, message, platform), [phone, message, platform]);
  const displayPhone = formatUsPhoneDisplay(phone);
  const unreachable = !!link && isUnreachableClientLink(link);
  const recipientLabel = role ? `${role} at ${displayPhone}` : displayPhone;
  const btn = compact ? "px-3 py-1.5 text-xs" : "px-3 py-2 text-sm";
  const canCopy = !disabled && !unreachable && !!message;
  const canMarkSent = canCopy && !!href && confirmedSent;

  async function copyMessage(): Promise<boolean> {
    if (!canCopy) return false;
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      onStatus?.("SMS message copied, not sent. Paste it into your approved texting app, check the recipient, and press Send.");
      return true;
    } catch {
      onStatus?.("Could not copy the SMS message. Select the preview and copy it yourself.");
      return false;
    }
  }

  function openSms(event: MouseEvent<HTMLAnchorElement>) {
    if (!canCopy || !href) {
      event.preventDefault();
      return;
    }
    // Keep the native link in the click gesture so phones and paired PCs can open it.
    void copyMessage();
    setCopiedFallback(true);
  }

  async function markSent() {
    if (!canMarkSent) return;
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
      onStatus?.(body.message || `Recorded your manual SMS report for ${recipientLabel}; receipt is not confirmed.`);
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
        Prepare a text in your phone&apos;s Messages app or an already-paired computer app. It sends from <b>your work phone&apos;s</b> number, not Twilio. You must press Send yourself.
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
            className={`${smsCapable && !unreachable ? "btn-primary" : "btn-ghost"} ${btn} ${!canCopy ? "pointer-events-none opacity-50" : ""}`}
            href={canCopy ? href : undefined}
            aria-disabled={!canCopy}
            tabIndex={canCopy ? 0 : -1}
            data-testid="computer-sms-open"
            onClick={openSms}
          >
            {smsCapable ? "Open Messages to" : "Open paired texting app to"} {displayPhone}
          </a>
        )}
      </div>
      {!smsCapable && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          <p className="font-semibold">Text from this computer using your work phone</p>
          <p className="mt-1">Android: pair Google Messages for web. Windows with iPhone or Android: set up Phone Link. Copy the message above, enter the recipient shown here, and send in the paired app.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <a href="https://messages.google.com/web/" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">Open Google Messages for web</a>
            <a href="https://support.microsoft.com/en-us/windows/apps/phonelink/send-and-receive-text-messages-from-your-pc" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">Phone Link setup instructions</a>
          </div>
          <p className="mt-2 text-xs">Pair only an organization-approved device. These links do not pass client details to either site. Honor replies and opt-outs in the app you use.</p>
        </div>
      )}
      {!hideRecordSent && (
        <>
          <PhoneSmsHandoff phone={phone} message={message} disabled={!canCopy} />
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input type="checkbox" className="mt-1" checked={confirmedSent} disabled={!canCopy || markBusy || markedSent} onChange={(event) => setConfirmedSent(event.target.checked)} />
            I actually sent this message to the correct recipient. This records my report, not confirmed delivery.
          </label>
          <button className={`btn-ghost ${btn}`} type="button" disabled={!canMarkSent || markBusy || markedSent} onClick={() => { void markSent(); }}>
            {markedSent ? "Manual send recorded" : markBusy ? "Saving..." : "I sent this SMS"}
          </button>
        </>
      )}
      {copiedFallback && !smsCapable && (
        <p className={`${compact ? "text-xs" : "text-sm"} text-slate-600`}>
          If no app opened, use a paired app above or scan the phone QR. Opening an app does not send or record an SMS.
        </p>
      )}
    </div>
  );
}
