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

  async function patch(u: StaffUser, data: Record<string, unknown>, okNote: string) {
    const r = await fetch(`/api/staff/users/${u.userId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data),
    });
    const b = await r.json().catch(() => ({}));
    setNote(r.ok ? okNote : b.error || "Change failed.");
    load();
  }

  function resetPassword(u: StaffUser) {
    const pw = prompt(`New password for ${u.name} (at least 8 characters):`);
    if (!pw) return;
    if (pw.length < 8) { setNote("Password must be at least 8 characters."); return; }
    void patch(u, { password: pw }, `Password reset for ${u.email}. Share it privately.`);
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
            <input className="input" required minLength={8} value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
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
            <li key={u.userId} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-semibold">{u.name} {!u.active && <span className="badge bg-slate-200 text-slate-600">disabled</span>}</p>
                <p className="text-xs text-slate-500">{u.email} - {ROLE_LABELS[u.role] || u.role}</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <button className="btn-ghost px-2 py-1 text-xs" onClick={() => resetPassword(u)}>Reset password</button>
                {u.active ? (
                  <button className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => patch(u, { active: false }, `${u.name} can no longer sign in.`)}>Disable</button>
                ) : (
                  <button className="btn-ghost px-2 py-1 text-xs"
                    onClick={() => patch(u, { active: true }, `${u.name} can sign in again.`)}>Enable</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
