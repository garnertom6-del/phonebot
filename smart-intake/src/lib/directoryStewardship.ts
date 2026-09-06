import { DIRECTORY_RELEASE, directoryReviewDueOn } from "./directoryCatalog";

export function directoryPermissions(input: {
  isAdmin: boolean; userId: string; membershipRole: string | null;
  ownerUserId: string | null; ownerActive: boolean;
}) {
  return {
    canAssign: input.isAdmin,
    canReview: input.ownerActive && input.membershipRole !== "REVIEWER"
      && (input.isAdmin || input.userId === input.ownerUserId),
  };
}

export function directoryReviewState(lastReviewedAt: string | null, ownerActive: boolean, today: string) {
  const basis = lastReviewedAt?.slice(0, 10) || DIRECTORY_RELEASE.checkedOn;
  const dueOn = directoryReviewDueOn(basis);
  const hopDueOn = directoryReviewDueOn(basis, 7);
  return { dueOn, hopDueOn, status: !ownerActive ? "Owner needed" : !lastReviewedAt ? "Provider review not recorded" : today >= dueOn ? "Review due" : today >= hopDueOn ? "HOP review due" : "Review recorded" };
}
