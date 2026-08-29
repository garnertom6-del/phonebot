export const SESSION_COOKIE_NAME = "mdc_session";

/**
 * Where an unauthenticated visitor should be sent instead of a staff HTML page.
 * Used by middleware and /dashboard layout so the caseload UI never paints first.
 */
export function unauthenticatedStaffRedirect(
  pathname: string,
  hasSessionCookie: boolean,
): string | null {
  if (hasSessionCookie) return null;
  if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) return "/provider";
  return null;
}
