export default function PdfPreview({ src }: { src: string }) {
  return (
    <iframe src={src} className="h-[80vh] w-full rounded-xl border border-slate-300 bg-white"
      title="Completed intake packet preview" />
  );
}
