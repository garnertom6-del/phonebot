"use client";
import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";

interface Props {
  onCapture: (data: { imageData: string; printedName: string; relationship: string; signedDate: string }) => void;
  defaultName?: string;
  roleLabel?: string;
}

const RELATIONSHIPS = [
  { value: "client", label: "Client (myself)" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Legal Guardian" },
  { value: "legalRepresentative", label: "Legal Representative" },
];

export default function SignaturePad({ onCapture, defaultName = "", roleLabel }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const [printedName, setPrintedName] = useState(defaultName);
  const [relationship, setRelationship] = useState("client");
  const [signedDate, setSignedDate] = useState(new Date().toLocaleDateString("en-US"));
  const [error, setError] = useState("");

  useEffect(() => { setPrintedName(defaultName); }, [defaultName]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const data = padRef.current?.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = 180 * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      padRef.current?.clear();
      if (data) padRef.current?.fromData(data);
    };
    padRef.current = new SignaturePadLib(canvas, { penColor: "#16233a" });
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); padRef.current?.off(); };
  }, []);

  function accept() {
    setError("");
    if (!printedName.trim()) return setError("Please type your printed name.");
    if (padRef.current?.isEmpty()) return setError("Please draw your signature above.");
    onCapture({
      imageData: padRef.current!.toDataURL("image/png"),
      printedName: printedName.trim(), relationship, signedDate,
    });
  }

  return (
    <div className="card">
      {roleLabel && <p className="mb-2 text-sm font-semibold text-brand">{roleLabel}</p>}
      <canvas ref={canvasRef} className="w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white" style={{ height: 180 }} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => padRef.current?.clear()}>Clear</button>
      </div>
      <label className="label mt-4">Printed name of person signing</label>
      <input className="input" value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
      <label className="label mt-3">I am signing as</label>
      <div className="flex flex-wrap gap-2">
        {RELATIONSHIPS.map((r) => (
          <button key={r.value} type="button" onClick={() => setRelationship(r.value)}
            className={`chip ${relationship === r.value ? "chip-on" : ""}`}>{r.label}</button>
        ))}
      </div>
      <label className="label mt-3">Date</label>
      <input className="input max-w-[200px]" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="button" className="btn-primary mt-4 w-full" onClick={accept}>Accept signature</button>
    </div>
  );
}
