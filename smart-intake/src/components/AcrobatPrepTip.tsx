"use client";

import {
  ACROBAT_PACKET_DOWNLOAD_HELP,
  ACROBAT_SCAN_OCR_TIP,
  ACROBAT_TEMPLATE_PREP_TIP,
} from "@/lib/adobeAcrobatPrep";

const COPY = {
  download: ACROBAT_PACKET_DOWNLOAD_HELP,
  template: ACROBAT_TEMPLATE_PREP_TIP,
  scan: ACROBAT_SCAN_OCR_TIP,
} as const;

const TITLE = {
  download: "Acrobat Pro",
  template: "Prepare in Acrobat Pro",
  scan: "Scanned PDF tip",
} as const;

export default function AcrobatPrepTip({
  variant,
  className = "",
}: {
  variant: keyof typeof COPY;
  className?: string;
}) {
  return (
    <p
      data-testid={`acrobat-prep-tip-${variant}`}
      className={`rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs leading-5 text-sky-950 ${className}`}
    >
      <span className="font-semibold">{TITLE[variant]}. </span>
      {COPY[variant]}
    </p>
  );
}
