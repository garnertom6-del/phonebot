import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const response = NextResponse.next();
  if (request.headers.get("accept")?.includes("text/html")) {
    // Avoid stale HTML referring to chunks from a previous Render deploy.
    response.headers.set("Cache-Control", "no-store, max-age=0");
  }
  return response;
}

export const config = {
  matcher: ["/dashboard", "/master/:path*", "/admin/:path*", "/intakes/:path*", "/login"],
};
