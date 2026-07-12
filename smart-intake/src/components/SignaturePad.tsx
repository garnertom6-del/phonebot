"use client";
import { useEffect, useRef, useState } from "react";
import SignaturePadLib from "signature_pad";

interface Props {
  onCapture: (data: { imageData: string; printedName: string; relationship?: string; signedDate: string; dobCheck?: string }) => void;
  defaultName?: string;
  roleLabel?: string;
  expectedRole?: "client" | "guardian" | "staff" | "clinician" | "witness" | "medicalDirector";
  /** ask for the client's date of birth as an identity check (client links) */
  askDob?: boolean;
}

const RELATIONSHIPS = [
  { value: "client", label: "Client (myself)" },
  { value: "parent", label: "Parent" },
  { value: "guardian", label: "Legal Guardian" },
  { value: "legalRepresentative", label: "Legal Representative" },
];

const STAFF_ROLE_LABELS: Record<NonNullable<Props["expectedRole"]>, string> = {
  client: "Client",
  guardian: "Parent / Legal Guardian",
  staff: "QP / Qualified Professional",
  clinician: "Clinician",
  witness: "Witness",
  medicalDirector: "Medical Director",
};

const PAD_HEIGHT = 220;

function formatDobInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function croppedSignatureDataUrl(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas.toDataURL("image/png");

  const { width, height } = canvas;
  const pixels = ctx.getImageData(0, 0, width, height);
  const { data } = pixels;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 12) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (minX > maxX || minY > maxY) return canvas.toDataURL("image/png");

  const margin = Math.ceil(Math.max(window.devicePixelRatio || 1, 1) * 12);
  const sx = Math.max(0, minX - margin);
  const sy = Math.max(0, minY - margin);
  const sw = Math.min(width - sx, maxX - minX + 1 + margin * 2);
  const sh = Math.min(height - sy, maxY - minY + 1 + margin * 2);
  const out = document.createElement("canvas");
  const thicken = Math.ceil(Math.max(window.devicePixelRatio || 1, 1) * 0.8);
  out.width = sw + thicken * 2;
  out.height = sh + thicken * 2;
  const outCtx = out.getContext("2d");
  if (!outCtx) return canvas.toDataURL("image/png");

  for (const [dx, dy] of [[0, 0], [thicken, 0], [0, thicken], [-thicken, 0], [0, -thicken]]) {
    outCtx.drawImage(canvas, sx, sy, sw, sh, thicken + dx, thicken + dy, sw, sh);
  }
  return out.toDataURL("image/png");
}

export default function SignaturePad({ onCapture, defaultName = "", roleLabel, expectedRole = "client", askDob = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const defaultRelationship = expectedRole === "guardian" ? "guardian" : "client";
  const isStaffSide = ["staff", "clinician", "witness", "medicalDirector"].includes(expectedRole);
  const [printedName, setPrintedName] = useState(defaultName);
  const [relationship, setRelationship] = useState(defaultRelationship);
  const [signedDate, setSignedDate] = useState(new Date().toLocaleDateString("en-US"));
  const [dobCheck, setDobCheck] = useState("");
  const [error, setError] = useState("");

  useEffect(() => { setPrintedName(defaultName); }, [defaultName]);
  useEffect(() => { setRelationship(defaultRelationship); }, [defaultRelationship]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const data = padRef.current?.toData();
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      canvas.width = canvas.offsetWidth * ratio;
      canvas.height = PAD_HEIGHT * ratio;
      canvas.getContext("2d")!.scale(ratio, ratio);
      padRef.current?.clear();
      if (data) padRef.current?.fromData(data);
    };
    padRef.current = new SignaturePadLib(canvas, {
      penColor: "#050505",
      minWidth: 1.35,
      maxWidth: 4.25,
      velocityFilterWeight: 0.45,
    });
    resize();
    window.addEventListener("resize", resize);
    return () => { window.removeEventListener("resize", resize); padRef.current?.off(); };
  }, []);

  function accept() {
    setError("");
    if (!printedName.trim()) return setError("Please type your name.");
    if (askDob && !dobCheck.trim()) return setError("Please type the client's birthday - it proves it's really you.");
    if (expectedRole === "guardian" && relationship === "client") {
      return setError("Please choose Parent, Legal Guardian, or Legal Representative.");
    }
    if (padRef.current?.isEmpty()) return setError("Please draw your signature above.");
    const canvas = canvasRef.current;
    onCapture({
      imageData: canvas ? croppedSignatureDataUrl(canvas) : padRef.current!.toDataURL("image/png"),
      printedName: printedName.trim(),
      relationship: isStaffSide ? undefined : relationship,
      signedDate,
      dobCheck: askDob ? dobCheck.trim() : undefined,
    });
  }

  return (
    <div className="card">
      {roleLabel && <p className="mb-2 text-sm font-semibold text-brand">{roleLabel}</p>}
      <canvas ref={canvasRef} className="w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white" style={{ height: PAD_HEIGHT }} />
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => padRef.current?.clear()}>Clear</button>
      </div>
      <label className="label mt-4">Printed name of person signing</label>
      <input className="input" value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
      <label className="label mt-3">I am signing as</label>
      {isStaffSide ? (
        <div className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
          {STAFF_ROLE_LABELS[expectedRole]}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {RELATIONSHIPS.map((r) => (
            <button key={r.value} type="button" onClick={() => setRelationship(r.value)}
              className={`chip ${relationship === r.value ? "chip-on" : ""}`}>{r.label}</button>
          ))}
        </div>
      )}
      {askDob && (
        <>
          <label className="label mt-3">Client&apos;s date of birth (identity check)</label>
          <input className="input max-w-[220px]" placeholder="MM / DD / YYYY" inputMode="numeric"
            maxLength={10} autoComplete="bday"
            value={dobCheck} onChange={(e) => setDobCheck(formatDobInput(e.target.value))} />
        </>
      )}
      <label className="label mt-3">Date</label>
      <input className="input max-w-[200px]" value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      <button type="button" className="btn-primary mt-4 w-full" onClick={accept}>Accept signature</button>
    </div>
  );
}
