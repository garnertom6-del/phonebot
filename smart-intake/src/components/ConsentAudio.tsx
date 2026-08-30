"use client";

import { useEffect, useState } from "react";
import { spokenPhoneNumber } from "./IntakeOrientationAudio";
import { brandText, providerPhone } from "@/lib/providerBranding";

/** Play the full legal consent text with the same speechSynthesis pattern as orientation. */
export default function ConsentAudio({ text, providerName, providerPhone: supportPhone }: {
  text?: string;
  providerName?: string;
  providerPhone?: string;
}) {
  const [speaking, setSpeaking] = useState(false);
  const spoken = brandText(text || "", { name: providerName, phone: supportPhone })
    .replace(providerPhone(supportPhone, providerName), spokenPhoneNumber(providerPhone(supportPhone, providerName)));

  useEffect(() => () => {
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();
  }, []);

  function toggleSpeech() {
    if (typeof window === "undefined" || !window.speechSynthesis || !spoken.trim()) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }
    const utterance = new SpeechSynthesisUtterance(spoken);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }

  if (!spoken.trim()) return null;
  return (
    <button type="button" className="btn-secondary min-h-[56px] w-full text-lg font-extrabold" onClick={toggleSpeech}>
      {speaking ? "Stop reading" : "Play audio — hear the full text"}
    </button>
  );
}
