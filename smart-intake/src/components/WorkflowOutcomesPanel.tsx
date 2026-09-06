export type WorkflowOutcomes = {
  totalIntakes:number;submittedIntakes:number;abandonedIntakes:number;inactiveUnsubmitted:number;unsubmittedEligible:number;inactivityDays:number;
  failedDeliveryAttempts:number;failedDeliveryCases:number;referrals:number;referralsContacted:number;assistanceConfirmed:number;
  measurementStartedAt:string|null;
  stages:Array<{stage:string;label:string;visits:number;active:number;totalHours:number;averageHours:number}>;
};
export default function WorkflowOutcomesPanel({data}:{data:WorkflowOutcomes|null}) {
  if(!data)return null;
  const measures=[
    ["Submitted",`${data.submittedIntakes} / ${data.totalIntakes}`],
    ["Staff-recorded abandonment",`${data.abandonedIntakes} / ${data.totalIntakes}`],
    [`Inactive ${data.inactivityDays}+ days (unsubmitted)`,`${data.inactiveUnsubmitted} / ${data.unsubmittedEligible}`],
    ["Cases with delivery failures",`${data.failedDeliveryCases}`],
    ["Tracked SMS delivery failures",`${data.failedDeliveryAttempts}`],
    ["Referrals contacted",`${data.referralsContacted} / ${data.referrals}`],
    ["Assistance confirmed",`${data.assistanceConfirmed} / ${data.referrals}`],
  ];
  return <details className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
    <summary className="min-h-11 cursor-pointer py-2 text-lg font-bold">Workflow outcomes and time waiting</summary>
    <p className="mt-2 text-sm text-slate-600">Provider totals include archived cases. Inactivity uses the last recorded client interaction, or creation if none; staff edits do not reset it. It flags active, unsubmitted cases for review, not proven abandonment. Referral approval alone does not confirm assistance. Delivery failures include earlier attempts even when a later retry succeeded.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{measures.map(([label,value])=><div className="rounded-xl bg-slate-50 p-3" key={label}><p className="text-sm text-slate-600">{label}</p><p className="mt-1 text-xl font-bold">{value}</p></div>)}</div>
    <p className="mt-4 text-sm text-slate-600">Step timing began {data.measurementStartedAt?new Date(data.measurementStartedAt).toLocaleDateString():"when cases are first observed"}. Transitions are recorded after intake events and reconciled on dashboard refresh. No earlier waiting time is backfilled. Open intervals continue accruing time.</p>
    <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Blocked step</th><th className="p-2">Cases now</th><th className="p-2">Visits</th><th className="p-2">Total hours</th><th className="p-2">Mean hours / visit</th></tr></thead><tbody>{data.stages.map(s=><tr key={s.stage} className="border-t border-slate-200"><th className="p-2 font-medium">{s.label}</th><td className="p-2">{s.active}</td><td className="p-2">{s.visits}</td><td className="p-2">{s.totalHours}</td><td className="p-2">{s.averageHours}</td></tr>)}</tbody></table></div>
  </details>;
}
