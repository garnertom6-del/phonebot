/** Release dates describe this directory snapshot, not a member's coverage. */
export const DIRECTORY_RELEASE = {
  version: "2026-09-06.1",
  effectiveOn: "2026-09-06",
  checkedOn: "2026-09-06",
  ownerRole: "Provider directory reviewer",
  reviewEveryDays: 30,
} as const;

export interface DirectorySource {
  title: string;
  url: string;
  effectiveOn: string | null;
  checkedOn: string;
}

export function directoryReviewDueOn(checkedOn: string, days: number = DIRECTORY_RELEASE.reviewEveryDays): string {
  const date = new Date(`${checkedOn.slice(0, 10)}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const NC_PLAN_SOURCE: DirectorySource = {
  title: "NC Medicaid health plans and programs",
  url: "https://medicaid.ncdhhs.gov/beneficiaries/medicaid-health-plans-and-programs",
  effectiveOn: null,
  checkedOn: DIRECTORY_RELEASE.checkedOn,
};
export const NC_PLAN_ROSTER_SOURCE: DirectorySource = {
  title: "NC Medicaid health plan roster",
  url: "https://medicaid.ncdhhs.gov/about-nc-medicaid/health-plans",
  effectiveOn: null,
  checkedOn: DIRECTORY_RELEASE.checkedOn,
};
export const NC_WELLCARE_MERGER_SOURCE: DirectorySource = {
  ...NC_PLAN_SOURCE,
  title: "NC Medicaid: WellCare and Carolina Complete Health merger",
  effectiveOn: "2026-04-01",
};
