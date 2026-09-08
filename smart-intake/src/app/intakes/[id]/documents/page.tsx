import DocumentCenter from "@/components/DocumentCenter";
import { redirect } from "next/navigation";
import { requireStaffForIntake } from "@/lib/staffGuard";
import { providerSignInHref } from "@/lib/safeReturnPath";

export default async function DocumentsPage(props: { params: Promise<{ id: string }>; searchParams: Promise<{ reviewId?: string }> }) {
  const { id } = await props.params;
  const { reviewId } = await props.searchParams;
  const { deny } = await requireStaffForIntake(id);
  if (deny?.status === 401) redirect(providerSignInHref(`/intakes/${id}/documents`));
  if (deny) return <main className="p-6"><h1 className="text-xl font-bold">Document Center unavailable</h1><p>This intake is not available in your provider workspace.</p></main>;
  return <DocumentCenter intakeId={id} initialReviewId={reviewId} />;
}
