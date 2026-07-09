"use client";
/**
 * Voice-to-text wrapper for a text input or textarea. The client taps the
 * microphone, speaks, reviews the transcript preview, and only then accepts
 * it into the answer - nothing is auto-submitted.
 */
import { useEffect, useRef, useState } from "react";

interface Props {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
  inputMode?: "text" | "tel" | "email";
}

type SR = { start: () => void; stop: () => void; lang: string; interimResults: boolean; continuous: boolean;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } } }) => void) | null;
  onend: (() => void) | null; onerror: (() => void) | null };

export default function VoiceInput({ value, onChange, multiline, placeholder, inputMode }: Props) {
  const [supported, setSupported] = useState(false);
  const [recording, setRecording] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const recRef = useRef<SR | null>(null);
  const finalRef = useRef("");

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    setSupported(!!(w.SpeechRecognition || w.webkitSpeechRecognition));
  }, []);

  function start() {
    const w = window as unknown as { SpeechRecognition?: new () => SR; webkitSpeechRecognition?: new () => SR };
    const Ctor = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = true;
    finalRef.current = "";
    rec.onresult = (e) => {
      // Android Chrome re-delivers already-final results (and resultIndex can
      // rewind), so appending across events repeats the speaker's words 2-3x.
      // Rebuild the transcript from the full results list on every event and
      // collapse back-to-back duplicate chunks instead.
      const finals: string[] = [];
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r[0].transcript.trim();
        if (!t) continue;
        if (r.isFinal) {
          if (finals[finals.length - 1]?.toLowerCase() !== t.toLowerCase()) finals.push(t);
        } else interim += " " + t;
      }
      finalRef.current = finals.join(" ");
      setPreview((finalRef.current + interim).trim());
    };
    rec.onend = () => setRecording(false);
    rec.onerror = () => setRecording(false);
    recRef.current = rec;
    setPreview(""); setRecording(true);
    rec.start();
  }

  function stop() { recRef.current?.stop(); setRecording(false); }
  function accept() {
    if (preview) onChange(value ? `${value} ${preview}`.trim() : preview);
    setPreview(null);
  }

  const field = multiline ? (
    <textarea className="input min-h-[110px]" value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  ) : (
    <input className="input" value={value} placeholder={placeholder} inputMode={inputMode}
      onChange={(e) => onChange(e.target.value)} />
  );

  return (
    <div>
      <div className="flex gap-2">
        <div className="flex-1">{field}</div>
        {supported && (
          <button type="button" aria-label={recording ? "Stop recording" : "Speak your answer"}
            onClick={recording ? stop : start}
            className={`h-12 min-w-[72px] shrink-0 rounded-lg border px-3 text-sm font-bold ${recording ? "animate-pulse border-red-400 bg-red-50 text-red-700" : "border-slate-300 bg-white text-brand"}`}>
            {recording ? "Stop" : "Speak"}
          </button>
        )}
      </div>
      {recording && <p className="mt-1 text-sm text-red-600">Listening... tap Stop when you finish speaking.</p>}
      {preview !== null && !recording && (
        <div className="mt-2 rounded-lg border border-brand/40 bg-brand-light p-3">
          <p className="mb-1 text-xs font-semibold text-brand">Here is what we heard. Fix it if needed, then tap &quot;Use this answer&quot;:</p>
          <textarea className="input mb-2 min-h-[60px]" value={preview} onChange={(e) => setPreview(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="btn-primary px-3 py-1.5 text-sm" onClick={accept}>Use this answer</button>
            <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setPreview(null)}>Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}
