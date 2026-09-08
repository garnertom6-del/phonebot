import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/staffGuard";
import AdobePdfReview from "@/components/AdobePdfReview";

export const dynamic = "force-dynamic";
export default async function AdobeViewerTestPage() {
  const { deny } = await requireStaff();
  if (deny) redirect("/provider");
  return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6"><Link className="btn-ghost" href="/dashboard">Back to dashboard</Link><h1 className="text-2xl font-bold">Test Adobe PDF viewer</h1><p>This sample contains no client information. A successful connection displays the sample page below.</p><AdobePdfReview src="/api/adobe/viewer-test" reviewId="smart-intake-adobe-connection-test" clientId={process.env.ADOBE_PDF_EMBED_CLIENT_ID?.trim() || null} /></main>;
}
