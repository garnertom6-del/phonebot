"use client";
export default function IntakePaused({ onResume }: { onResume: () => void }) {
  return <section className="card mx-auto max-w-md text-center" role="status">
    <h2 className="text-2xl font-bold text-brand">Your progress is saved</h2>
    <p className="mt-3 text-lg text-slate-600">You can close this page now. Open the same secure link to continue from your saved question.</p>
    <p className="mt-2 text-sm text-slate-500">Your intake has not been submitted by this action.</p>
    <button type="button" className="btn-primary mt-5 min-h-[56px] w-full text-lg" onClick={onResume}>Continue my intake</button>
  </section>;
}
