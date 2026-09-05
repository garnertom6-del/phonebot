"use client";

import dynamic from "next/dynamic";

const PdfFieldMapper = dynamic(() => import("./PdfFieldMapper"), {
  ssr: false,
  loading: () => <p role="status">Loading packet mapping...</p>,
});

export default function PdfMappingEditor(props: { providerId?: string; templateId?: string }) {
  return <PdfFieldMapper {...props} />;
}
