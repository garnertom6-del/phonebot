/**
 * Easy Mode section interstitials ("Tap anywhere to keep going") must consume
 * that tap. On phones the same pointer sequence can land on the next
 * question's chips (live: one tap auto-selected Transgender). Guard incoming
 * answers for one click-cycle after leaving the break screen.
 */
export const INTERSTITIAL_CLICK_GUARD_MS = 450;

export function interstitialGuardUntil(now = Date.now()): number {
  return now + INTERSTITIAL_CLICK_GUARD_MS;
}

export function isInterstitialClickGuarded(guardUntil: number, now = Date.now()): boolean {
  return guardUntil > 0 && now < guardUntil;
}
