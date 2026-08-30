"use client";

export default function PrintPageButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" className="btn-primary min-h-[52px] w-full sm:w-auto" onClick={() => window.print()}>
      {label}
    </button>
  );
}
