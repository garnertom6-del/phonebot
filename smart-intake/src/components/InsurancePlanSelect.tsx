"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  insurancePlanSearchText,
  insurancePlanSelectLabel,
  RECORD_NUMBER_PLAN_GROUPS,
  recordNumberMode,
  recordNumberPrefix,
} from "@/lib/insurancePlans";

type Props = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
};

export default function InsurancePlanSelect({ id, value, onChange }: Props) {
  const generatedId = useId();
  const inputId = id || generatedId;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return RECORD_NUMBER_PLAN_GROUPS.map((group) => ({
      ...group,
      plans: group.plans.filter((plan) => !q || insurancePlanSearchText(plan).includes(q)),
    })).filter((group) => group.plans.length > 0);
  }, [query]);

  function choose(plan: string) {
    onChange(plan);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <input
        id={inputId}
        className="input min-h-11 min-w-0"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${inputId}-list`}
        aria-autocomplete="list"
        autoComplete="off"
        value={open ? query : (value ? insurancePlanSelectLabel(value) : "")}
        placeholder="Search or select a plan"
        onFocus={() => {
          setOpen(true);
          setQuery("");
        }}
        onChange={(event) => {
          setOpen(true);
          setQuery(event.target.value);
        }}
      />
      {open && (
        <div
          id={`${inputId}-list`}
          role="listbox"
          className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl"
        >
          <button
            type="button"
            role="option"
            aria-selected={!value}
            className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-sm font-semibold text-slate-600 hover:bg-slate-100"
            onClick={() => choose("")}
          >
            Select the client&apos;s plan
          </button>
          {groups.map((group) => (
            <div key={group.label} className="mt-1">
              <p className="px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-slate-500">{group.label}</p>
              {group.plans.map((plan) => (
                <button
                  key={plan}
                  type="button"
                  role="option"
                  aria-selected={value === plan}
                  className={`flex min-h-11 w-full flex-col justify-center rounded-lg px-3 text-left text-sm ${
                    value === plan ? "bg-brand-light font-semibold text-brand" : "hover:bg-slate-100"
                  }`}
                  onClick={() => choose(plan)}
                >
                  <span>{insurancePlanSelectLabel(plan)}</span>
                  {recordNumberMode(plan) === "generate" && (
                    <span className="text-xs font-normal text-slate-500">{recordNumberPrefix(plan)}-12345</span>
                  )}
                </button>
              ))}
            </div>
          ))}
          {groups.length === 0 && (
            <p className="px-3 py-2 text-sm text-slate-500">No plans match that search.</p>
          )}
        </div>
      )}
    </div>
  );
}
