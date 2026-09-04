"use client";
/**
 * "Send it by hand" panel - the fallback when automatic texting is off,
 * blocked (e.g. Twilio 30034 until A2P 10DLC registration clears), or when
 * the client is sitting in the room.
 *
 * Two QR codes cover the two real situations:
 *  - client in the room  -> they scan the secure link on the staff screen
 *  - client somewhere else -> staff scans an sms: link with THEIR phone and
 *    the Messages app opens with the number + message already filled in
 *
 * "Mark as sent by hand" records the delivery so the dashboard stops saying
 * "Not sent yet" and the audit log shows who sent it and how.
 */
import { useEffect, useState } from "react";
import { formatUsPhoneDisplay } from "@/lib/intakeContacts";
import ComputerSmsActions, { type ManualSmsPurpose } from "@/components/ComputerSmsActions";
import QrCodeSvg from "@/components/QrCodeSvg";

export type ManualSendMethod = "sms" | "in_person" | "email";

type Props = {
  intakeId: string;
  clientLink: string;
  /** The exact SMS text (no PHI - provider name, link, help line, STOP wording). */
  message: string;
  phone?: string | null;
  /** client or guardian — shown on the computer-SMS control. */
  phoneRole?: string | null;
  email?: string | null;
  purpose?: ManualSmsPurpose;
  /** sms: / mailto: links built by shareLinks.ts. */
  smsHref?: string;
  mailtoHref?: string;
  /** Why automatic delivery did not happen - shown at the top when present. */
  reason?: string;
  /** Last accepted delivery, if any (ISO string). */
  linkSentAt?: string | null;
  /** True when the link is expired - copying and marking are paused. */
  disabled?: boolean;
  /** Extra staff-facing reason when send is blocked (insurance, etc.). */
  blockReason?: string;
  hideRecordButtons?: boolean;
  /** Called after the intake is marked as sent so the parent can refresh. */
  onMarked?: (linkSentAt: string, method: ManualSendMethod) => void;
};

export default function ManualSendPanel({
  intakeId, clientLink, message, phone, phoneRole, purpose = "intake", email, smsHref, mailtoHref, reason, linkSentAt, disabled, blockReason, hideRecordButtons, onMarked,
}: Props) {
  const [copied, setCopied] = useState<"" | "message" | "link">("");
  const [marking, setMarking] = useState<ManualSendMethod | "">("");
  const [markedAt, setMarkedAt] = useState<string | null>(linkSentAt || null);
  const [markError, setMarkError] = useState("");
  const [computerSmsNote, setComputerSmsNote] = useState("");

  useEffect(() => { setMarkedAt(linkSentAt || null); }, [linkSentAt]);

  const phoneDisplay = phone ? formatUsPhoneDisplay(phone) : "";

  async function copy(kind: "message" | "link") {
    try {
      await navigator.clipboard.writeText(kind === "message" ? message : clientLink);
      setCopied(kind);
      window.setTimeout(() => setCopied(""), 2500);
    } catch {
      setMarkError("Copy is blocked in this browser. Select the text and copy it with Ctrl+C.");
    }
  }

  async function markSent(method: ManualSendMethod) {
    setMarking(method);
    setMarkError("");
    try {
      const res = await fetch(`/api/intakes/${intakeId}/manual-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method }),
      });
      const body = await res.json().catch(() => ({})) as { ok?: boolean; linkSentAt?: string; error?: string };
      if (!res.ok || !body.ok || !body.linkSentAt) {
        setMarkError(body.error || `Could not record the manual send (${res.status}).`);
        return;
      }
      setMarkedAt(body.linkSentAt);
      onMarked?.(body.linkSentAt, method);
    } catch {
      setMarkError("Could not record the manual send. Check your connection and try again.");
    } finally {
      setMarking("");
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4" data-testid="manual-send-panel">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-bold text-slate-900">Send it by hand</h3>
          <p className="mt-1 text-sm text-slate-600">
            Works without the texting service. Nothing here contains the client&apos;s name or health details.
          </p>
        </div>
        {markedAt && (
          <span className="badge bg-emerald-100 text-emerald-800">Sent {new Date(markedAt).toLocaleString()}</span>
        )}
      </div>

      {reason && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          <span className="font-semibold">Automatic text not delivered: </span>{reason}
        </p>
      )}

      {blockReason && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900" role="alert">
          {blockReason}
        </p>
      )}

      {disabled && (
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-900">
          This link has expired. Renew it first so the client does not open a dead link.
        </p>
      )}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-3">
          <p className="font-semibold text-slate-900">Client is with you?</p>
          <p className="mt-1 text-xs text-slate-600">Turn the screen toward them. Their phone camera opens the secure form - no text message needed.</p>
          <div className="mx-auto mt-3 max-w-[220px]">
            <QrCodeSvg value={disabled ? "" : clientLink} label="QR code that opens the client's secure intake form" />
          </div>
        </div>
        <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-3">
          <p className="font-semibold text-slate-900">Client is somewhere else?</p>
          <p className="mt-1 text-xs text-slate-600">
            {phone
              ? <>Scan this with <b>your</b> phone. Your Messages app opens to {phoneDisplay} with the message filled in - just tap Send.</>
              : <>Add the client&apos;s cell number to use this. You can still copy the message below.</>}
          </p>
          <div className="mx-auto mt-3 max-w-[220px]">
            <QrCodeSvg level="L" value={disabled || !phone || !smsHref ? "" : smsHref} label="QR code that opens your phone's Messages app with the client's number and the message" />
          </div>
        </div>
      </div>

      <p className="mt-4 break-all whitespace-pre-wrap rounded-lg bg-slate-100 p-3 text-sm text-slate-700" data-testid="manual-send-message">{message}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={disabled} onClick={() => { void copy("message"); }}>
          {copied === "message" ? "Message copied" : "Copy message"}
        </button>
        <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={disabled} onClick={() => { void copy("link"); }}>
          {copied === "link" ? "Link copied" : "Copy secure link"}
        </button>
        {email && mailtoHref && !disabled && (
          <a className="btn-ghost px-3 py-2 text-sm" href={mailtoHref}>Open email</a>
        )}
      </div>
      {phone && smsHref && (
        <div className="mt-3">
          <ComputerSmsActions
            intakeId={intakeId}
            purpose={purpose}
            phone={phone}
            role={phoneRole || undefined}
            message={message}
            link={clientLink}
            disabled={disabled}
            hideRecordSent
            onStatus={setComputerSmsNote}
          />
          {computerSmsNote && (
            <p className="mt-2 text-sm text-slate-700" role="status">{computerSmsNote}</p>
          )}
        </div>
      )}

      {!hideRecordButtons && (
      <div className="mt-4 border-t border-slate-200 pt-3">
        <p className="text-sm font-semibold text-slate-900">Done? Record how the client got the link</p>
        <p className="mt-1 text-xs text-slate-600">This clears &quot;Not sent yet&quot; on the dashboard and writes who sent it and how to the audit log.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary px-3 py-2 text-sm" disabled={disabled || !!marking} onClick={() => { void markSent("sms"); }}>
            {marking === "sms" ? "Saving..." : "I texted it from my phone"}
          </button>
          <button type="button" className="btn-secondary px-3 py-2 text-sm" disabled={disabled || !!marking} onClick={() => { void markSent("in_person"); }}>
            {marking === "in_person" ? "Saving..." : "Client scanned it here"}
          </button>
          {email && (
            <button type="button" className="btn-ghost px-3 py-2 text-sm" disabled={disabled || !!marking} onClick={() => { void markSent("email"); }}>
              {marking === "email" ? "Saving..." : "I emailed it"}
            </button>
          )}
        </div>
        {markError && <p className="mt-2 text-sm font-semibold text-red-700" role="alert">{markError}</p>}
      </div>
      )}
    </div>
  );
}
