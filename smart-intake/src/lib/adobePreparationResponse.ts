import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AdobePreparationError } from "./adobePreparation";
export function adobeErrorResponse(error: unknown) {
  if (error instanceof AdobePreparationError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof ZodError) return NextResponse.json({ error: "Check the selected files, tool options and blank-form confirmation." }, { status: 400 });
  // Never return SDK exceptions: they may contain request credentials or signed asset URLs.
  return NextResponse.json({ error: "The preparation request could not be completed. Reload the saved job list before retrying." }, { status: 500 });
}
