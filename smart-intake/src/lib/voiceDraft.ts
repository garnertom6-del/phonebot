export type VoiceDraftState = { recording: boolean; hasPreview: boolean };
export const VOICE_DRAFT_MESSAGE = 'Your speech answer is not saved yet. Stop recording, then choose "Use this answer" or "Discard" before continuing or leaving.';

/** One section can contain several voice fields; every preview needs a choice. */
export function createVoiceDraftGuard() {
  const pending = new Set<string>();
  return {
    update(key: string, state: VoiceDraftState) {
      if (state.recording || state.hasPreview) pending.add(key); else pending.delete(key);
      return pending.size > 0;
    },
    hasPending() { return pending.size > 0; },
    canLeave(showMessage: (message: string) => void) {
      if (!pending.size) return true;
      showMessage(VOICE_DRAFT_MESSAGE);
      return false;
    },
  };
}

/** Detach first: stop() can synchronously deliver a final result or end event. */
export function stopSpeechRecognition(recognition: { stop: () => void; onresult: unknown; onend: unknown; onerror: unknown } | null) {
  if (!recognition) return;
  recognition.onresult = null;
  recognition.onend = null;
  recognition.onerror = null;
  try { recognition.stop(); } catch { /* Already stopped or unavailable. */ }
}
