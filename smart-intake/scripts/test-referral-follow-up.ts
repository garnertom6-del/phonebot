import assert from "node:assert/strict";
import { localDayBounds, selectReferralFollowUps, type ReferralFollowUp } from "../src/lib/referralFollowUp";

const originalTimezone = process.env.TZ;
process.env.TZ = "America/New_York";
try {
  const now = new Date(2026, 8, 6, 12, 0);
  const row = (id: string, changes: Partial<ReferralFollowUp> = {}): ReferralFollowUp => ({
    id, intakeId: `intake-${id}`, clientName: `Synthetic ${id}`, archived: false,
    resourceName: "Synthetic food support", status: "WANTS_HELP",
    nextContactAt: new Date(2026, 8, 6, 9, 0).toISOString(),
    assignedUserId: "staff-a", assignedUser: { id: "staff-a", name: "Synthetic Owner" }, ownerActive: true,
    permissionGrantedAt: new Date(2026, 8, 1).toISOString(), permissionWithdrawnAt: null,
    ...changes,
  });
  const fixtures = [
    row("late-today", { nextContactAt: new Date(2026, 8, 6, 23, 59, 59).toISOString() }),
    row("overdue", { nextContactAt: new Date(2026, 8, 5, 23, 59, 59).toISOString() }),
    row("start-today", { nextContactAt: new Date(2026, 8, 6).toISOString() }),
    row("tomorrow", { nextContactAt: new Date(2026, 8, 7).toISOString() }),
    row("unassigned", { assignedUserId: null, assignedUser: null, ownerActive: false }),
    row("inactive-owner", { assignedUserId: "former-staff", assignedUser: { id: "former-staff", name: "Former staff" }, ownerActive: false }),
    row("other-owner", { assignedUserId: "staff-b", assignedUser: { id: "staff-b", name: "Other staff" } }),
    row("approved", { status: "APPROVED" }),
    row("withdrawn", { permissionWithdrawnAt: new Date(2026, 8, 2).toISOString() }),
    row("withdrawn-same-time", { permissionWithdrawnAt: new Date(2026, 8, 1).toISOString() }),
    row("permission-renewed", { permissionWithdrawnAt: new Date(2026, 7, 31).toISOString() }),
    row("no-permission", { permissionGrantedAt: null }),
    row("archived", { archived: true }),
    row("denied", { status: "DENIED" }), row("unavailable", { status: "UNAVAILABLE" }), row("declined", { status: "DECLINED" }),
    row("unscheduled", { nextContactAt: null }), row("invalid-date", { nextContactAt: "invalid" }),
  ];
  const selected = selectReferralFollowUps(fixtures, now);
  assert.deepEqual(selected.counts, { all: 8, overdue: 1, today: 7, unassigned: 2 });
  assert.equal(selected.rows[0].id, "overdue");
  assert.equal(selected.rows[1].id, "start-today");
  assert.equal(selected.rows.at(-1)?.id, "late-today");
  assert.deepEqual(selectReferralFollowUps(fixtures, now, { due: "overdue" }).rows.map(r => r.id), ["overdue"]);
  assert.equal(selectReferralFollowUps(fixtures, now, { due: "today" }).rows.length, 7, "the whole local calendar day counts as today, even hours before now");
  assert.deepEqual(new Set(selectReferralFollowUps(fixtures, now, { owner: "unassigned" }).rows.map(r => r.id)), new Set(["unassigned", "inactive-owner"]));
  assert.deepEqual(selectReferralFollowUps(fixtures, now, { owner: "staff-b" }).rows.map(r => r.id), ["other-owner"]);
  assert.equal(selectReferralFollowUps(fixtures, now, { due: "overdue", owner: "staff-b" }).rows.length, 0);
  assert(selected.rows.some(r => r.id === "approved"), "approval alone does not finish assistance follow-up");
  assert(selected.rows.some(r => r.id === "permission-renewed"));
  assert.equal(selectReferralFollowUps([], now).counts.all, 0);
  for (const [month, day, expectedHours] of [[2, 8, 23], [10, 1, 25]]) {
    const dstDay = new Date(2026, month, day, 12);
    const bounds = localDayBounds(dstDay);
    assert.equal((+bounds.end - +bounds.start) / 3_600_000, expectedHours);
    const result = selectReferralFollowUps([
      row("last-minute", { nextContactAt: new Date(+bounds.end - 1000).toISOString() }),
      row("next-day", { nextContactAt: bounds.end.toISOString() }),
    ], dstDay);
    assert.deepEqual(result.rows.map(r => r.id), ["last-minute"], "DST uses the next calendar midnight, not 24 hours later");
    assert.equal(result.rows[0].due, "today");
  }
  console.log("Referral follow-ups: local calendar boundaries, 23/25-hour DST days, permission, closed/archived exclusion, approval follow-up, owner/reassignment filters, and due ordering passed.");
} finally {
  if (originalTimezone === undefined) delete process.env.TZ; else process.env.TZ = originalTimezone;
}
