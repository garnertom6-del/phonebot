const STAFF_RETURN_PREFIXES = [
  "/dashboard",
  "/intakes",
  "/nctracks",
  "/provider",
  "/admin/users",
  "/admin/pdf-mapping",
  "/master/dashboard",
] as const;

/** Same-origin staff path only. Rejects protocol-relative and external URLs. */
export function safeStaffReturnPath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (!value.startsWith("/")) return null;
  if (value.startsWith("//") || value.includes("://") || /[\s\\]/.test(value)) return null;
  const path = value.split("?")[0] || "";
  const allowed = STAFF_RETURN_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  return allowed ? value : null;
}

export function providerSignInHref(returnTo?: string | null): string {
  const safe = safeStaffReturnPath(returnTo);
  return safe ? `/provider?next=${encodeURIComponent(safe)}` : "/provider";
}

export function loginDestination(input: {
  isMaster: boolean;
  portal: "provider" | "master";
  requested?: string | null;
  defaultDestination: string;
}): string {
  const requested = safeStaffReturnPath(input.requested);
  if (!requested) {
    return input.portal === "provider" && input.isMaster ? "/dashboard" : input.defaultDestination;
  }
  if (requested.startsWith("/master") && !input.isMaster) return input.defaultDestination;
  if (input.portal === "provider" && requested.startsWith("/master")) return "/dashboard";
  return requested;
}
