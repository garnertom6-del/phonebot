export class ContentRevisionConflictError extends Error {
  readonly code = "CONTENT_REVISION_CONFLICT";
  constructor() {
    super("The intake changed in another window. Review the updated answers before signing.");
  }
  toJSON() { return { code: this.code, error: this.message }; }
}

export function assertReviewedContentRevision(expected: unknown, current: number): void {
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected !== current) {
    throw new ContentRevisionConflictError();
  }
}

/** Advance only across our own write; a newer unrelated head was not reviewed. */
export function nextReviewedContentRevision(reviewed: number, previous: unknown, current: unknown): number {
  return previous === reviewed && typeof current === "number" && Number.isSafeInteger(current)
    ? current : reviewed;
}

/** Legacy reviews retain their timestamp gate; new reviews also bind the exact content revision. */
export function staffReviewIsCurrent(
  review: { createdAt: Date; detail: string | null } | null | undefined,
  currentContentRevision: number,
  latestMaterialUpdatedAt?: Date | null,
): boolean {
  if (!review || (latestMaterialUpdatedAt && review.createdAt < latestMaterialUpdatedAt)) return false;
  const recorded = /(?:^|;\s*)contentRevision:(\d+)(?:;|$)/.exec(review.detail || "");
  return !recorded || Number(recorded[1]) === currentContentRevision;
}
