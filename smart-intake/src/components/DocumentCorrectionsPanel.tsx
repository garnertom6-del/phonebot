"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type Pending = { id: string; reviewId: string; page: number; assignedName: string; ownerActive: boolean; createdAt: string; intakeId: string; clientName: string };
export default function DocumentCorrectionsPanel({ providerId }: { providerId: string }) {
  const [data, setData] = useState<{ total: number; corrections: Pending[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setFailed(false);
    void fetch(`/api/document-corrections?providerId=${encodeURIComponent(providerId)}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(body => { if (!controller.signal.aborted) setData(body); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [providerId, retry]);
  if (!data && !failed) return null;
  return <section className="rounded-xl border border-slate-200 bg-white p-4" aria-label="Document corrections"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-bold">Document corrections{data ? ` · ${data.total} open` : ""}</h2><button className="btn-ghost text-sm" onClick={() => setRetry(v => v + 1)}>Refresh corrections</button></div>
    {failed && <p role="alert" className="mt-2 text-sm text-red-800">Document corrections could not be loaded. Refresh to try again.</p>}
    {data?.total === 0 && <p className="mt-2 text-sm text-slate-500">Open an intake&apos;s Document Center to review packets and assign corrections.</p>}
    {data && data.total > 25 && <p className="mt-2 text-sm text-slate-600">Showing the 25 oldest open corrections. Each intake&apos;s Document Center shows its complete list.</p>}
    <div className="mt-2 divide-y">{data?.corrections.map(item => <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.clientName} · page {item.page}</p><p className="text-sm text-slate-600">{item.assignedName} · waiting since {new Date(item.createdAt).toLocaleString()}{!item.ownerActive ? " · needs reassignment" : ""}</p></div><Link className="btn-secondary text-sm" href={`/intakes/${item.intakeId}/documents?reviewId=${item.reviewId}`}>Review correction</Link></div>)}</div>
  </section>;
}
