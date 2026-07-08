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
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript;
        else interim += r[0].transcript;
      }
      setPreview((finalRef.current + " " + interim).trim());
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
            className={`h-12 w-12 shrink-0 rounded-lg border text-xl ${recording ? "animate-pulse border-red-400 bg-red-50" : "border-slate-300 bg-white"}`}>
            {recording ? "⏹" : "🎤"}
          </button>
        )}
      </div>
      {recording && <p className="mt-1 text-sm text-red-600">Listening... tap ⏹ when you finish speaking.</p>}
      {preview !== null && !recording && (
        <div className="mt-2 rounded-lg border border-brand/40 bg-brand-light p-3">
          <p className="mb-1 text-xs font-semibold text-brand">Transcript preview - edit if needed, then add it:</p>
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
