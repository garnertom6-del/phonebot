"use client";

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export default function ViewportMenu({
  open,
  children,
  className = "",
  widthClass = "w-64",
}: {
  open: boolean;
  children: ReactNode;
  className?: string;
  widthClass?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({});

  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const next: CSSProperties = {};
    if (rect.right > window.innerWidth - 8) {
      next.right = 0;
      next.left = "auto";
    }
    if (rect.left < 8) {
      next.left = 0;
      next.right = "auto";
    }
    if (rect.bottom > window.innerHeight - 8) {
      next.bottom = "100%";
      next.top = "auto";
      next.marginBottom = "0.5rem";
      next.marginTop = 0;
    }
    setStyle(next);
  }, [open]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="menu"
      data-viewport-menu="open"
      className={`absolute z-30 mt-2 max-h-[min(24rem,calc(100vh-1rem))] overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 text-slate-800 shadow-xl ${widthClass} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
