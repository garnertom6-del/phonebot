"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { referralNeedsOwner, selectReferralFollowUps, type ReferralDueFilter, type ReferralFollowUp } from "@/lib/referralFollowUp";
import { SUPPORT_REFERRAL_LABELS, type ReferralStaff } from "@/lib/supportReferralTypes";

export default function ReferralFollowUpPanel({ referrals, staff }: { referrals: ReferralFollowUp[]; staff: ReferralStaff[] }) {
  const [due, setDue] = useState<ReferralDueFilter>("all");
  const [owner, setOwner] = useState("all");
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const refreshDay = () => setNow(new Date());
    refreshDay();
    const timer = window.setInterval(refreshDay, 60_000);
    window.addEventListener("focus", refreshDay);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refreshDay); };
  }, []);
  // A provider change may remove the previously selected staff member.
  const selectedOwner = owner === "all" || owner === "unassigned" || staff.some((person) => person.id === owner) ? owner : "all";
  const selected = useMemo(() => now ? selectReferralFollowUps(referrals, now, { due, owner: selectedOwner }) : null, [referrals, now, due, selectedOwner]);
  return (
    <section className="mt-4 min-w-0 rounded-2xl border border-sky-200 bg-white p-4" aria-labelledby="referral-follow-ups-heading">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id="referral-follow-ups-heading" className="text-lg font-bold">Support follow-ups due</h2>
        {selected && <p className="text-sm font-semibold text-slate-700">{selected.counts.overdue} overdue · {selected.counts.today} today</p>}
      </div>
      <p className="mt-1 text-sm text-slate-600">Scheduled support follow-ups with current client permission. Dates use your device's local calendar; refresh the dashboard for the latest saved changes.</p>
      <div className="mt-3 grid min-w-0 gap-3 sm:grid-cols-2">
        <label className="min-w-0"><span className="label">Follow-up date</span>
          <select className="input min-h-11 w-full min-w-0" value={due} onChange={(event) => setDue(event.target.value as ReferralDueFilter)}>
            <option value="all">All due ({selected?.counts.all ?? 0})</option>
            <option value="overdue">Overdue ({selected?.counts.overdue ?? 0})</option>
            <option value="today">Due today ({selected?.counts.today ?? 0})</option>
          </select>
        </label>
        <label className="min-w-0"><span className="label">Referral owner</span>
          <select className="input min-h-11 w-full min-w-0" value={selectedOwner} onChange={(event) => setOwner(event.target.value)}>
            <option value="all">All staff</option>
            <option value="unassigned">Unassigned / needs reassignment ({selected?.counts.unassigned ?? 0})</option>
            {staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
      </div>
      {!selected ? <p className="mt-3 text-sm" role="status">Loading your local follow-up dates...</p> : selected.rows.length === 0 ? (
        <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{selected.counts.all === 0 ? "No scheduled support follow-ups are due today or overdue." : "No due follow-ups match these filters."}</p>
      ) : (
        <ul className="mt-3 grid min-w-0 gap-3 lg:grid-cols-2">
          {selected.rows.map((referral) => (
            <li className="min-w-0 rounded-xl border border-slate-200 p-3" key={referral.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><p className="break-words font-bold">{referral.clientName}</p><p className="break-words text-sm text-slate-600">{referral.resourceName}</p></div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-semibold ${referral.due === "overdue" ? "bg-amber-100 text-amber-900" : "bg-sky-100 text-sky-900"}`}>{referral.due === "overdue" ? "Overdue" : "Due today"}</span>
              </div>
              <p className="mt-2 text-sm">{new Date(referral.nextContactAt!).toLocaleString([], { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} · {SUPPORT_REFERRAL_LABELS[referral.status]}</p>
              <p className={`mt-1 break-words text-sm ${referralNeedsOwner(referral) ? "font-semibold text-amber-900" : "text-slate-600"}`}>Owner: {referralNeedsOwner(referral) ? referral.assignedUser ? `${referral.assignedUser.name} (needs reassignment)` : "Unassigned" : referral.assignedUser?.name || "Assigned staff"}</p>
              <Link className="btn-ghost mt-3 inline-flex min-h-11 max-w-full items-center justify-center text-center text-sm" href={`/intakes/${encodeURIComponent(referral.intakeId)}#support-referrals`}>Open support follow-up</Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
