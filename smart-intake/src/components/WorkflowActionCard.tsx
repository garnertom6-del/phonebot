"use client";
import Link from "next/link";
import { useState } from "react";
import { waitingLabel, type WorkflowAction } from "@/lib/workflowOutcomes";

export default function WorkflowActionCard({id,action,ownerUserId,staff,readOnly,submittedAt,abandonedAt,onUpdated}:{
  id:string;action:WorkflowAction;ownerUserId:string|null;staff:Array<{id:string;name:string}>;
  readOnly:boolean;submittedAt?:string|null;abandonedAt?:string|null;onUpdated:()=>Promise<void>;
}) {
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [reason,setReason]=useState("");
  const [receiptSource,setReceiptSource]=useState("");
  async function update(data:Record<string,unknown>) {
    if(busy)return;
    setBusy(true);setError("");
    try {
      const response=await fetch(`/api/intakes/${id}/workflow`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Could not save workflow change.");
      setReason("");await onUpdated();
    } catch(e){setError(e instanceof Error?e.message:"Connection problem. Try again.");}
    finally{setBusy(false);}
  }
  return <section className="mt-4 rounded-2xl border-2 border-brand/30 bg-brand-light/30 p-4" aria-label="Next required action">
    <p className="text-xs font-bold uppercase tracking-wider text-brand">Next required action</p>
    <h3 className="mt-1 text-lg font-bold text-slate-900">{action.label}</h3>
    <p className="mt-1 text-sm text-slate-700">{action.reason}</p>
    <p className="mt-2 text-sm"><strong>Responsible:</strong> {action.responsiblePerson}{action.responsiblePerson !== action.responsibleRole ? ` · ${action.responsibleRole}` : ""}</p>
    <p className="mt-1 text-sm"><strong>Observed in this step:</strong> {waitingLabel(action.since)}</p>
    <Link href={action.href} className="btn-primary mt-3 inline-flex min-h-11 items-center">{action.label}</Link>
    {!readOnly&&action.stage==="DELIVERY"&&action.packetId&&<details className="mt-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">Record verified receipt</summary>
      <label className="block" htmlFor={`receipt-${id}`}>How and when was receipt of this packet confirmed?</label>
      <textarea id={`receipt-${id}`} className="input mt-1" maxLength={500} value={receiptSource} onChange={e=>setReceiptSource(e.target.value)} disabled={busy} placeholder="Record the recipient confirmation or delivery evidence, with its date. A send attempt alone is not receipt."/>
      <button type="button" className="btn-secondary mt-2 min-h-11" disabled={busy||receiptSource.trim().length<10} onClick={()=>void update({action:"confirm_delivery",packetId:action.packetId,source:receiptSource})}>Record confirmed packet receipt</button>
    </details>}
    <details className="mt-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">Case ownership and disposition</summary>
      <label className="block font-semibold" htmlFor={`owner-${id}`}>Assigned staff</label>
      <select id={`owner-${id}`} className="input mt-1 max-w-md" value={ownerUserId||""} disabled={readOnly||busy} onChange={e=>void update({action:"assign",ownerUserId:e.target.value||null,expectedOwnerUserId:ownerUserId})}>
        <option value="">Unassigned</option>
        {ownerUserId&&!staff.some(s=>s.id===ownerUserId)&&<option value={ownerUserId}>Previous owner is no longer active</option>}
        {staff.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {!readOnly&&abandonedAt&&<button type="button" className="btn-secondary mt-3 block min-h-11" disabled={busy} onClick={()=>void update({action:"reopen"})}>Reopen intake</button>}
      {!readOnly&&!submittedAt&&!abandonedAt&&<div className="mt-3">
        <label className="block" htmlFor={`abandon-${id}`}>If staff confirmed abandonment, record the reason</label>
        <input id={`abandon-${id}`} className="input mt-1 max-w-md" maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Do not include unnecessary clinical details" disabled={busy}/>
        <button type="button" className="btn-secondary mt-2 block min-h-11" disabled={busy||reason.trim().length<3} onClick={()=>void update({action:"abandon",reason})}>Record abandonment</button>
        <p className="mt-1 text-xs text-slate-500">A quiet case is not automatically abandoned. This records a staff determination and can be reopened.</p>
      </div>}
    </details>
    {error&&<p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
