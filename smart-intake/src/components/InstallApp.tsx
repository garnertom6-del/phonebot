"use client";
/**
 * Registers the service worker and shows an "Install app" button when the
 * browser offers it (Android/Chrome/Edge). On iPhone/iPad, where there is no
 * install prompt event, it shows the Add-to-Home-Screen instructions instead.
 */
import { useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export default function InstallApp() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) setInstalled(true);

    const onPrompt = (e: Event) => { e.preventDefault(); setDeferred(e as BeforeInstallPromptEvent); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) return null;

  const isIos = typeof navigator !== "undefined" &&
    /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);

  if (deferred) {
    return (
      <button className="btn-ghost" onClick={async () => { await deferred.prompt(); setDeferred(null); }}>
        📲 Install app
      </button>
    );
  }
  if (isIos) {
    return (
      <>
        <button className="btn-ghost" onClick={() => setShowIosHelp((v) => !v)}>📲 Install app</button>
        {showIosHelp && (
          <div className="absolute right-4 z-20 mt-10 max-w-xs rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-lg">
            To install on your iPhone: tap the <b>Share</b> button (the square with an arrow), then
            <b> Add to Home Screen</b>. The app opens full-screen from your home screen after that.
          </div>
        )}
      </>
    );
  }
  return null;
}
