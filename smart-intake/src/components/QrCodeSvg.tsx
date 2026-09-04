"use client";

import { qrSvgData } from "@/lib/qrSvg";

type Props = {
  value: string;
  label: string;
  level?: "L" | "M" | "Q" | "H";
  className?: string;
};

/** Client-side QR SVG. Encodes `value` locally so the token URL never leaves the browser. */
export default function QrCodeSvg({ value, label, level = "M", className }: Props) {
  const data = qrSvgData(value, level);
  if (!data) {
    return (
      <div className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-3 text-center text-xs text-slate-500">
        QR code unavailable
      </div>
    );
  }
  return (
    <svg
      viewBox={`0 0 ${data.size} ${data.size}`}
      role="img"
      aria-label={label}
      className={className || "aspect-square w-full rounded-lg border border-slate-200 bg-white p-2 text-slate-900"}
      shapeRendering="crispEdges"
    >
      <path d={data.path} fill="currentColor" />
    </svg>
  );
}
