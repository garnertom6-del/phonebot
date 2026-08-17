export type DashboardFlashKind = "success" | "warning";

export interface DashboardFlash {
  message: string;
  kind: DashboardFlashKind;
}

const DASHBOARD_FLASH_KEY = "smart-intake-dashboard-flash";

export function hasSmsDeliveryFailure(failed: unknown[]): boolean {
  return failed.some((item) => typeof item === "string" && /^\s*sms\b/i.test(item));
}

export function deliveryDashboardFlash(sent: string[], failed: string[]): DashboardFlash | null {
  if (!sent.length) return null;
  if (failed.length) {
    return {
      kind: "warning",
      message: hasSmsDeliveryFailure(failed)
        ? "Email or another delivery channel was accepted, but automatic SMS was not. Open the intake and use Manual sending to copy the text or open SMS on this computer."
        : "The secure intake link was accepted by at least one delivery channel. Another channel needs attention; open the intake to review delivery.",
    };
  }
  return {
    kind: "success",
    message: "The secure intake link was accepted for delivery. You are back on the intake dashboard.",
  };
}

export function storeDashboardFlash(flash: DashboardFlash): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(DASHBOARD_FLASH_KEY, JSON.stringify(flash));
}

export function consumeDashboardFlash(): DashboardFlash | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(DASHBOARD_FLASH_KEY);
  window.sessionStorage.removeItem(DASHBOARD_FLASH_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardFlash>;
    if (
      typeof parsed.message === "string"
      && (parsed.kind === "success" || parsed.kind === "warning")
    ) {
      return { message: parsed.message, kind: parsed.kind };
    }
  } catch {
    // A malformed one-time notice should never block the dashboard.
  }
  return null;
}
