"use client";

import { useId, useState } from "react";
import QrCodeSvg from "@/components/QrCodeSvg";
import { formatUsPhoneDisplay } from "@/lib/intakeContacts";
import { smsHref, type SmsPlatform } from "@/lib/shareLinks";

export default function PhoneSmsHandoff({ phone, message, disabled }: {
  phone?: string | null;
  message: string;
  disabled?: boolean;
}) {
  const selectId = useId();
  const [platform, setPlatform] = useState<SmsPlatform>("unknown");
  const href = !disabled && phone && platform !== "unknown" ? smsHref(phone, message, platform) : "";

  return (
    <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-3" data-testid="phone-sms-handoff">
      <p className="font-semibold text-slate-900">Text from your work phone</p>
      <p className="mt-1 text-xs text-slate-600">No Twilio request is made. Choose your phone, scan with its camera, check the number and message, then tap Send in Messages.</p>
      {phone ? (
        <>
          <p className="mt-2 text-sm">Recipient: <b>{formatUsPhoneDisplay(phone)}</b></p>
          <label htmlFor={selectId} className="mt-3 block text-sm font-semibold">Phone used to send the text</label>
          <select id={selectId} className="input mt-1 w-full" value={platform} disabled={disabled} onChange={(event) => setPlatform(event.target.value as SmsPlatform)}>
            <option value="unknown">Choose iPhone or Android</option>
            <option value="ios">iPhone</option>
            <option value="android">Android</option>
          </select>
          {href ? (
            <div className="mx-auto mt-3 max-w-[260px]">
              <QrCodeSvg level="L" value={href} label={`${platform === "ios" ? "iPhone" : "Android"} QR code to prepare the intake text on your work phone`} />
            </div>
          ) : <p className="mt-3 text-xs text-slate-600">{disabled ? "Sharing is unavailable until the link is ready." : "Choose your sending phone to show its QR code."}</p>}
          <p className="mt-2 text-xs text-slate-600">If your camera does not fill the message, use Copy SMS message below and paste it into your texting app.</p>
        </>
      ) : <p className="mt-2 text-sm">Add a client or guardian cell number first.</p>}
    </div>
  );
}
