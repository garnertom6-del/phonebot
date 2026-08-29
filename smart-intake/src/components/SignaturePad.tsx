"use client";
import { useEffect, useId, useRef, useState } from "react";
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

function typedSignatureDataUrl(name: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = 1200;
  canvas.height = 260;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.fillStyle = "#050505";
  context.font = "italic 96px Georgia, serif";
  context.textBaseline = "middle";
  context.fillText(name, 40, canvas.height / 2, canvas.width - 80);
  return canvas.toDataURL("image/png");
}

export default function SignaturePad({ onCapture, defaultName = "", roleLabel, expectedRole = "client", askDob = false }: Props) {
  const fieldId = useId();
  const nameId = `${fieldId}-name`;
  const dobId = `${fieldId}-dob`;
  const dateId = `${fieldId}-date`;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const padRef = useRef<SignaturePadLib | null>(null);
  const defaultRelationship = expectedRole === "guardian" ? "guardian" : "client";
  const isStaffSide = ["staff", "clinician", "witness", "medicalDirector"].includes(expectedRole);
  const [printedName, setPrintedName] = useState(defaultName);
  const [relationship, setRelationship] = useState(defaultRelationship);
  const [signedDate, setSignedDate] = useState(new Date().toLocaleDateString("en-US"));
  const [dobCheck, setDobCheck] = useState("");
  const [error, setError] = useState("");
  const [signatureMode, setSignatureMode] = useState<"draw" | "type">("draw");

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
    if (signatureMode === "draw" && padRef.current?.isEmpty()) return setError("Please draw your signature above, or choose Type my signature.");
    const canvas = canvasRef.current;
    onCapture({
      imageData: signatureMode === "type"
        ? typedSignatureDataUrl(printedName.trim())
        : canvas ? croppedSignatureDataUrl(canvas) : padRef.current!.toDataURL("image/png"),
      printedName: printedName.trim(),
      relationship: isStaffSide ? undefined : relationship,
      signedDate,
      dobCheck: askDob ? dobCheck.trim() : undefined,
    });
  }

  return (
    <div className="card">
      {roleLabel && <p className="mb-2 text-sm font-semibold text-brand">{roleLabel}</p>}
      <fieldset>
        <legend className="label">Signature method</legend>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={signatureMode === "draw" ? "btn-primary px-3 py-1.5 text-sm" : "btn-ghost px-3 py-1.5 text-sm"} aria-pressed={signatureMode === "draw"} onClick={() => setSignatureMode("draw")}>Draw my signature</button>
          <button type="button" className={signatureMode === "type" ? "btn-primary px-3 py-1.5 text-sm" : "btn-ghost px-3 py-1.5 text-sm"} aria-pressed={signatureMode === "type"} onClick={() => setSignatureMode("type")}>Type my signature</button>
        </div>
      </fieldset>
      <div className={signatureMode === "draw" ? "mt-3" : "sr-only"} aria-hidden={signatureMode !== "draw"}>
        <canvas ref={canvasRef} aria-label={`${roleLabel || "Signer"} drawing area`} className="w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white" style={{ height: PAD_HEIGHT }} />
        <div className="mt-2 flex gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-sm" onClick={() => padRef.current?.clear()}>Clear drawing</button>
        </div>
      </div>
      <label htmlFor={nameId} className="label mt-4">Printed name of person signing</label>
      <input id={nameId} className="input" required value={printedName} onChange={(e) => setPrintedName(e.target.value)} />
      <p className="label mt-3" id={`${fieldId}-relationship`}>I am signing as</p>
      {isStaffSide ? (
        <div className="inline-flex rounded-full bg-brand px-4 py-2 text-sm font-semibold text-white">
          {STAFF_ROLE_LABELS[expectedRole]}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`${fieldId}-relationship`}>
          {RELATIONSHIPS.map((r) => (
            <button key={r.value} type="button" aria-pressed={relationship === r.value} onClick={() => setRelationship(r.value)}
              className={`chip ${relationship === r.value ? "chip-on" : ""}`}>{r.label}</button>
          ))}
        </div>
      )}
      {askDob && (
        <>
          <label htmlFor={dobId} className="label mt-3">Client&apos;s date of birth (identity check)</label>
          <input id={dobId} className="input max-w-[220px]" required placeholder="MM / DD / YYYY" inputMode="numeric"
            maxLength={10} autoComplete="bday"
            value={dobCheck} onChange={(e) => setDobCheck(formatDobInput(e.target.value))} />
        </>
      )}
      <label htmlFor={dateId} className="label mt-3">Date</label>
      <input id={dateId} className="input max-w-[200px]" required value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
      {signatureMode === "type" && <p className="mt-2 text-sm text-slate-600">Your printed name below will be rendered as the electronic signature when you accept.</p>}
      {error && <p className="mt-2 text-sm text-red-600" role="alert">{error}</p>}
      <button type="button" className="btn-primary mt-4 w-full" onClick={accept}>Accept signature</button>
    </div>
  );
}
