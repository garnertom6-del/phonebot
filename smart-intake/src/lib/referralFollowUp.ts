import { activeReferralPermission, SUPPORT_CLOSED_STATUSES, type ReferralStaff, type SupportReferralStatus } from "./supportReferralTypes";

export interface ReferralFollowUp {
  id: string;
  intakeId: string;
  clientName: string;
  archived: boolean;
  resourceName: string;
  status: SupportReferralStatus;
  nextContactAt: string | null;
  assignedUserId: string | null;
  assignedUser: ReferralStaff | null;
  ownerActive: boolean;
  permissionGrantedAt: string | null;
  permissionWithdrawnAt: string | null;
}

export type ReferralDueFilter = "all" | "overdue" | "today";
export type DueReferral = ReferralFollowUp & { due: "overdue" | "today" };

/** Calendar boundaries follow the staff member's device, including DST days. */
export function localDayBounds(now: Date) {
  return {
    start: new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    end: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1),
  };
}

export function referralNeedsOwner(referral: ReferralFollowUp): boolean {
  return !referral.assignedUserId || !referral.ownerActive;
}

/** Only scheduled, permitted follow-ups on active intakes are actionable here. */
export function selectReferralFollowUps(
  referrals: ReferralFollowUp[],
  now: Date,
  options: { due?: ReferralDueFilter; owner?: string } = {},
) {
  const { start, end } = localDayBounds(now);
  const eligible: DueReferral[] = [];
  for (const referral of referrals) {
    if (referral.archived || SUPPORT_CLOSED_STATUSES.has(referral.status) || !activeReferralPermission(referral) || !referral.nextContactAt) continue;
    const time = new Date(referral.nextContactAt).getTime();
    if (!Number.isFinite(time) || time >= end.getTime()) continue;
    eligible.push({ ...referral, due: time < start.getTime() ? "overdue" : "today" });
  }
  eligible.sort((a, b) => new Date(a.nextContactAt!).getTime() - new Date(b.nextContactAt!).getTime() || a.clientName.localeCompare(b.clientName) || a.id.localeCompare(b.id));
  const due = options.due || "all";
  const owner = options.owner || "all";
  return {
    counts: {
      all: eligible.length,
      overdue: eligible.filter((item) => item.due === "overdue").length,
      today: eligible.filter((item) => item.due === "today").length,
      unassigned: eligible.filter(referralNeedsOwner).length,
    },
    rows: eligible.filter((item) => (due === "all" || item.due === due) && (owner === "all" || (owner === "unassigned" ? referralNeedsOwner(item) : item.assignedUserId === owner && item.ownerActive))),
  };
}
