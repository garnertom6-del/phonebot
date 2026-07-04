interface Missing { key: string; label: string; section?: string }

export default function MissingFieldsPanel({ required, optional }: { required: Missing[]; optional: Missing[] }) {
  return (
    <div className="card">
      <h3 className="mb-2 font-bold">Missing field checklist</h3>
      {required.length === 0 ? (
        <p className="mb-2 text-sm font-semibold text-emerald-600">✓ All required items complete</p>
      ) : (
        <>
          <p className="mb-1 text-sm font-semibold text-red-600">Required before completion ({required.length}):</p>
          <ul className="mb-3 list-inside list-disc text-sm text-red-700">
            {required.map((m) => <li key={m.key}>{m.label}</li>)}
          </ul>
        </>
      )}
      {optional.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-slate-600">
            Unanswered optional / staff items ({optional.length})
          </summary>
          <ul className="mt-2 max-h-64 list-inside list-disc overflow-y-auto text-xs text-slate-500">
            {optional.map((m) => <li key={m.key}>{m.section ? `${m.section}: ` : ""}{m.label}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}
