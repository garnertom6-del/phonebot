"use client";
import { useCallback, useRef, useState } from "react";
import { createVoiceDraftGuard, type VoiceDraftState } from "@/lib/voiceDraft";

export function useVoiceDraftGuard() {
  const guard = useRef<ReturnType<typeof createVoiceDraftGuard> | null>(null);
  if (!guard.current) guard.current = createVoiceDraftGuard();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const update = useCallback((key: string, state: VoiceDraftState) => {
    const next = guard.current!.update(key, state);
    setPending(next);
    if (!next) setMessage("");
  }, []);
  const canLeave = useCallback(() => guard.current!.canLeave(setMessage), []);
  return { pending, message, update, canLeave };
}
