import { NextResponse } from "next/server";
import { DocumentReviewError } from "./documentReviews";

export function reviewError(error: unknown) {
  if (error instanceof DocumentReviewError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  console.error("Document review operation failed", { name: error instanceof Error ? error.name : "UnknownError" });
  return NextResponse.json({ error: "The document review could not be saved or loaded. Reload before retrying." }, { status: 500 });
}
