"use client";

import { useEffect, useState } from "react";
import { INTAKE_ORIENTATION_AUDIO_URL, INTAKE_ORIENTATION_SUMMARY } from "@/lib/intakeOrientation";
import { providerDisplayName, providerPhone } from "@/lib/providerBranding";

/** Keep speech synthesis from interpreting a phone number as one huge number. */
export function spokenPhoneNumber(displayPhone: string): string {
  const groups = displayPhone.match(/\d+/g);
  if (!groups?.length) return displayPhone;
  return groups.map((group) => group.split("").join(" ")).join(", ");
}

const spokenExplanation = (providerName?: string, supportPhone?: string) =>
  `Welcome to ${providerDisplayName(providerName)}. ${INTAKE_ORIENTATION_SUMMARY} ` +
  `Answer each question as best you can. You may ask questions or contact us at ${spokenPhoneNumber(providerPhone(supportPhone, providerName))}. ` +
  "You will review your answers and sign at the end.";

export default function IntakeOrientationAudio({ providerName, providerPhone: supportPhone, compact = false }: {
  providerName?: string;
  providerPhone?: string;
  compact?: boolean;
}) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  function toggleSpeech() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spokenExplanation(providerName, supportPhone));
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  return (
    <section className={`rounded-xl border border-sky-200 bg-sky-50 text-left ${compact ? "p-3" : "mt-6 p-4"}`}>
      <p className="font-bold text-sky-900">Want to hear how this works?</p>
      <p className="mt-1 text-sm leading-relaxed text-sky-800">
        {INTAKE_ORIENTATION_SUMMARY} You can listen before you start or play it again later.
      </p>
      {INTAKE_ORIENTATION_AUDIO_URL && (
        <audio className="mt-3 w-full" controls preload="none" src={INTAKE_ORIENTATION_AUDIO_URL}>
          Your phone cannot play this audio. You can still complete the intake below.
        </audio>
      )}
      <button type="button" className="btn-secondary mt-3 min-h-[48px] w-full text-base" onClick={toggleSpeech}>
        {speaking ? "Stop explanation" : INTAKE_ORIENTATION_AUDIO_URL ? "Hear the updated explanation" : "Hear the explanation"}
      </button>
      {!INTAKE_ORIENTATION_AUDIO_URL && (
        <p className="mt-2 text-xs text-sky-700">A saved recording can be added by your provider later.</p>
      )}
    </section>
  );
}
