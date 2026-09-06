"use client";
import { useEffect, useRef } from "react";
import { leaveAfterSave } from "@/lib/clientProgress";

/** Protect same-tab rights navigation and accidental reloads without storing answers locally. */
export function useClientDraftNavigation(dirty: boolean, rightsPath: string, save: () => Promise<boolean>, canLeave?: () => boolean) {
  const latest = useRef({ dirty, rightsPath, save, canLeave });
  latest.current = { dirty, rightsPath, save, canLeave };
  const leaving = useRef(false);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!latest.current.dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const followRights = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || (anchor.target && anchor.target !== "_self")) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.pathname !== latest.current.rightsPath) return;
      if (latest.current.canLeave && !latest.current.canLeave()) { event.preventDefault(); return; }
      if (!latest.current.dirty) return;
      event.preventDefault();
      if (leaving.current) return;
      leaving.current = true;
      void leaveAfterSave(latest.current.save, () => {
        latest.current.dirty = false;
        window.location.assign(destination.href);
      }).finally(() => { leaving.current = false; });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", followRights, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", followRights, true);
    };
  }, []);
}
