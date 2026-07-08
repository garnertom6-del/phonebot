"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const FIELDS = [
  ["fullName", "Client full name *", "text"], ["dob", "Date of birth *", "date"],
  ["midNumber", "MID#", "text"], ["recordNumber", "Record#", "text"],
  ["intakeDate", "Date of intake", "date"], ["location", "Location", "text"],
  ["email", "Client email", "email"], ["phone", "Client phone", "tel"],
  ["guardianName", "Guardian name (if applicable)", "text"],
  ["guardianEmail", "Guardian email", "email"], ["guardianPhone", "Guardian phone", "tel"],
] as const;

export default function NewIntake() {
  const router = useRouter();
  const [form, setForm] = useState<Record<string, string>>({ location: "Greensboro" });
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; clientLink: string } | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/intakes", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const body = await res.json();
    if (res.ok) setResult(body);
    else setError(body.error || "Failed to create intake");
  }

  if (result) {
    return (
      <main className="mx-auto max-w-xl p-6">
        <div className="card">
          <h1 className="text-xl font-bold text-emerald-600">✓ Intake created</h1>
          <p className="mt-2 text-sm text-slate-600">
            Package: <b>Moore Divine Care Client Intake Package</b>. Send the client this secure
            link (expires in {process.env.NEXT_PUBLIC_LINK_DAYS || 7} days, no client info in the URL):
          </p>
          <div className="mt-3 break-all rounded-lg bg-slate-100 p-3 font-mono text-sm">{result.clientLink}</div>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" onClick={async () => {
              await navigator.clipboard.writeText(result.clientLink); setCopied(true);
            }}>{copied ? "Copied ✓" : "Copy client link"}</button>
            <button className="btn-ghost" onClick={() => fetch(`/api/intakes/${result.id}/remind`, { method: "POST" })}>
              📱 Text (SMS) / email the link to the client
            </button>
            <Link href={`/intakes/${result.id}`} className="btn-secondary">Open intake</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">← Dashboard</Link>
      <form onSubmit={submit} className="card mt-3">
        <h1 className="mb-1 text-xl font-bold">Create New Intake</h1>
        <p className="mb-4 text-sm text-slate-500">Package: Moore Divine Care Client Intake Package (43 pages)</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {FIELDS.map(([key, label, type]) => (
            <div key={key} className={key === "fullName" ? "sm:col-span-2" : ""}>
              <label className="label">{label}</label>
              <input className="input" type={type} value={form[key] || ""}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
            </div>
          ))}
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="btn-primary mt-5 w-full">Create intake & generate secure link</button>
      </form>
    </main>
  );
}
