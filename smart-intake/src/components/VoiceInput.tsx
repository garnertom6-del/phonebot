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

function normalizeTranscript(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function overlapLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  for (let len = max; len > 0; len--) {
    if (left.slice(-len) === right.slice(0, len)) return len;
  }
  return 0;
}

function mergeTranscriptChunks(chunks: string[]): string {
  const merged: string[] = [];
  for (const raw of chunks) {
    const chunk = normalizeTranscript(raw);
    if (!chunk) continue;
    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(chunk);
      continue;
    }
    const prevLower = previous.toLowerCase();
    const chunkLower = chunk.toLowerCase();
    if (prevLower === chunkLower) continue;
    if (chunkLower.startsWith(prevLower)) {
      merged[merged.length - 1] = chunk;
      continue;
    }
    if (prevLower.startsWith(chunkLower)) continue;
    const overlap = overlapLength(prevLower, chunkLower);
    if (overlap > 0) {
      merged[merged.length - 1] = `${previous}${chunk.slice(overlap)}`;
      continue;
    }
    merged.push(chunk);
  }
  return merged.join(" ");
}

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
      // Android Chrome and some mobile browsers can re-deliver already-final
      // transcript pieces or send a longer chunk that starts with the exact
      // words from a previous chunk. Rebuild from the full result set and
      // merge overlapping chunks so repeated openings do not duplicate text.
      const finals: string[] = [];
      const interims: string[] = [];
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = normalizeTranscript(r[0].transcript);
        if (!t) continue;
        if (r.isFinal) finals.push(t);
        else interims.push(t);
      }
      finalRef.current = mergeTranscriptChunks(finals);
      setPreview(mergeTranscriptChunks([finalRef.current, ...interims]));
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
