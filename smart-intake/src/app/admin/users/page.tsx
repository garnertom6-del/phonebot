"use client";
/**
 * Staff logins: the provider admin adds, renames, disables and resets
 * passwords for their own staff. Every person gets their own login so the
 * audit log can say WHO viewed or changed a record (HIPAA accountability).
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface StaffUser {
  membershipId: string; userId: string; email: string; name: string;
  role: string; active: boolean; createdAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  PROVIDER_ADMIN: "Admin", STAFF: "Staff", REVIEWER: "Reviewer",
};

export default function StaffUsersPage() {
  const [users, setUsers] = useState<StaffUser[] | null>(null);
  const [note, setNote] = useState("");
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STAFF" });
  const [busy, setBusy] = useState(false);
  const [showStartingPassword, setShowStartingPassword] = useState(false);
  const [resetDraft, setResetDraft] = useState({ userId: "", password: "", show: false });

  const load = useCallback(() => {
    fetch("/api/staff/users").then(async (r) => {
      const b = await r.json().catch(() => ({}));
      if (r.ok) setUsers(b.users);
      else { setUsers([]); setNote(b.error || "Could not load staff logins."); }
    });
  }, []);
  useEffect(load, [load]);

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setNote("");
    const r = await fetch("/api/staff/users", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form),
    });
    const b = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) {
      setNote(`Added ${form.email}. Give them their password privately - it is not shown again.`);
      setForm({ name: "", email: "", password: "", role: "STAFF" });
      load();
    } else setNote(b.error || "Could not add the staff member.");
  }

  async function patch(u: StaffUser, data: Record<string, unknown>, okNote: string): Promise<boolean> {
    const r = await fetch(`/api/staff/users/${u.userId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const b = await r.json().catch(() => ({}));
    setNote(r.ok ? okNote : b.error || "Change failed.");
    load();
    return r.ok;
  }

  async function resetPassword(u: StaffUser) {
    if (resetDraft.password.length < 8) { setNote("Password must be at least 8 characters."); return; }
    setBusy(true);
    const changed = await patch(u, { password: resetDraft.password }, `Password reset for ${u.email}. Share it privately.`);
    setBusy(false);
    if (changed) setResetDraft({ userId: "", password: "", show: false });
  }

  function disableUser(u: StaffUser) {
    if (!window.confirm(`Disable ${u.name}'s login now? They will no longer be able to sign in.`)) return;
    void patch(u, { active: false }, `${u.name} can no longer sign in.`);
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <Link href="/dashboard" className="text-sm text-brand hover:underline">Dashboard</Link>
      <h1 className="mt-2 text-2xl font-bold text-brand">Staff logins</h1>
      <p className="mt-1 text-sm text-slate-500">
        Every staff member gets their own login, so the record shows who did what.
        Disable a login the day someone leaves.
      </p>
      {note && <p className="mt-3 rounded-lg bg-brand-light p-2 text-sm font-semibold text-brand">{note}</p>}

      <div className="card mt-4">
        <h2 className="mb-3 font-bold">Add a staff member</h2>
        <form onSubmit={addUser} className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="label">Full name</span>
            <input className="input" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="block"><span className="label">Work email (their username)</span>
            <input className="input" type="email" required value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="block"><span className="label">Starting password (8+ characters)</span>
            <div className="flex gap-2">
              <input className="input" type={showStartingPassword ? "text" : "password"} autoComplete="new-password" required minLength={8} value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <button type="button" className="btn-ghost px-3" aria-pressed={showStartingPassword} onClick={() => setShowStartingPassword((shown) => !shown)}>
                {showStartingPassword ? "Hide" : "Show"}
              </button>
            </div></label>
          <label className="block"><span className="label">Role</span>
            <select className="input" value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="STAFF">Staff - full day-to-day use</option>
              <option value="REVIEWER">Reviewer - review answers</option>
              <option value="PROVIDER_ADMIN">Admin - can also manage staff</option>
            </select></label>
          <button className="btn-primary sm:col-span-2" disabled={busy}>
            {busy ? "Adding..." : "Add staff member"}
          </button>
        </form>
      </div>

      <div className="card mt-4">
        <h2 className="mb-3 font-bold">Current staff</h2>
        {users === null && <p className="text-sm text-slate-400">Loading...</p>}
        {users?.length === 0 && <p className="text-sm text-slate-400">No staff logins yet.</p>}
        <ul className="divide-y divide-slate-100">
          {users?.map((u) => (
            <li key={u.userId} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{u.name} {!u.active && <span className="badge bg-slate-200 text-slate-600">disabled</span>}</p>
                  <p className="text-xs text-slate-500">{u.email} - {ROLE_LABELS[u.role] || u.role}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" aria-expanded={resetDraft.userId === u.userId}
                    onClick={() => setResetDraft((current) => current.userId === u.userId ? { userId: "", password: "", show: false } : { userId: u.userId, password: "", show: false })}>Reset password</button>
                  {u.active ? (
                    <button className="btn-ghost px-2 py-1 text-xs" onClick={() => disableUser(u)}>Disable</button>
                  ) : (
                    <button className="btn-ghost px-2 py-1 text-xs"
                      onClick={() => { void patch(u, { active: true }, `${u.name} can sign in again.`); }}>Enable</button>
                  )}
                </div>
              </div>
              {resetDraft.userId === u.userId && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <label className="label" htmlFor={`reset-password-${u.userId}`}>New password for {u.name}</label>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <input id={`reset-password-${u.userId}`} className="input min-w-60 flex-1" type={resetDraft.show ? "text" : "password"}
                      autoComplete="new-password" minLength={8} value={resetDraft.password}
                      onChange={(event) => setResetDraft((current) => ({ ...current, password: event.target.value }))} />
                    <button type="button" className="btn-ghost px-3" aria-pressed={resetDraft.show}
                      onClick={() => setResetDraft((current) => ({ ...current, show: !current.show }))}>{resetDraft.show ? "Hide" : "Show"}</button>
                    <button type="button" className="btn-primary px-3" disabled={busy || resetDraft.password.length < 8}
                      onClick={() => { void resetPassword(u); }}>Save new password</button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
