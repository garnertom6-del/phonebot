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
