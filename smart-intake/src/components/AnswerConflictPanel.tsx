"use client";
import type { AnswerConflict } from "@/lib/answerRevisions";

function display(value: unknown): string {
  if (value === undefined || value === null || value === "") return "Blank";
  if (Array.isArray(value)) return value.join(", ") || "Blank";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export default function AnswerConflictPanel({ conflicts, localAnswers, onResolve, labelForKey }: {
  conflicts: AnswerConflict[];
  localAnswers: Record<string, unknown>;
  onResolve: (key: string, choice: "server" | "local") => void;
  labelForKey?: (key: string) => string;
}) {
  if (!conflicts.length) return null;
  return (
    <section role="alert" className="my-4 rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-slate-900">
      <h2 className="text-lg font-bold">An answer changed in another window</h2>
      <p className="mt-1 text-sm">Your work is still here. Choose a version for each answer, then retry saving.</p>
      <div className="mt-3 space-y-4">
        {conflicts.map((conflict) => (
          <div key={conflict.key} className="rounded-lg border border-amber-200 bg-white p-3">
            <h3 className="font-semibold">{labelForKey?.(conflict.key) || conflict.key.replace(/_/g, " ")}</h3>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div><p className="text-xs font-bold">Saved in the other window</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{display(conflict.serverValue)}</p>
                <button type="button" className="btn-secondary mt-2 min-h-[48px] w-full" onClick={() => onResolve(conflict.key, "server")}>Use saved answer</button>
              </div>
              <div><p className="text-xs font-bold">Your answer</p><p className="mt-1 whitespace-pre-wrap break-words text-sm">{display(Object.prototype.hasOwnProperty.call(localAnswers, conflict.key) ? localAnswers[conflict.key] : conflict.localValue)}</p>
                <button type="button" className="btn-secondary mt-2 min-h-[48px] w-full" onClick={() => onResolve(conflict.key, "local")}>Keep my answer</button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
